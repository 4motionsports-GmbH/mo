// Orchestration for the knowledge-gap scan: draft a Q&A candidate from ONE
// conversation (transcript → Haiku draft → qa_entries row → scanned stamp).
// Shared by the single-conversation "Entwurf" action and the bulk scan route
// so both produce identical entries. See docs/QA_KNOWLEDGE.md.

import { getAdminConversationDetail } from "./admin-conversations";
import { generateQaDraft, QA_DRAFT_MODEL } from "./qa-draft";
import {
  createQaEntry,
  getConversationProductHandles,
  markConversationQaScanned,
  type QaEntry,
} from "./qa-store";
import { loadProductCatalog } from "./catalog-store";

export type DraftOutcome =
  | { status: "created"; entry: QaEntry }
  | { status: "no_gap" } // model saw no reusable knowledge gap
  | { status: "duplicate" } // same question already queued/answered/published
  | { status: "no_transcript" }
  | { status: "error"; message: string };

/**
 * Run the draft pass for one conversation and persist the outcome. ALWAYS
 * stamps qa_scanned_at on a conclusive outcome (created / no_gap / duplicate /
 * no_transcript) so the bulk scan never re-spends tokens on it; a model/config
 * error leaves the conversation unscanned for a retry.
 */
export async function draftQaForConversation(conversationId: number): Promise<DraftOutcome> {
  const detail = await getAdminConversationDetail(conversationId);
  if (!detail || detail.transcript.length === 0) {
    await markConversationQaScanned(conversationId);
    return { status: "no_transcript" };
  }

  // Product candidates: handles seen in the conversation, validated against
  // the catalog (so a stale/mistyped handle can never be attributed).
  const [rawHandles, catalog] = await Promise.all([
    getConversationProductHandles(conversationId),
    loadProductCatalog().catch(() => []),
  ]);
  const catalogIds = new Set(catalog.map((p) => p.id));
  const productHandles = rawHandles.filter((h) => catalogIds.has(h));

  const result = await generateQaDraft({
    conversationId,
    transcript: detail.transcript,
    productHandles,
  });
  if (!result.ok) {
    return { status: "error", message: result.message };
  }

  if (!result.draft) {
    await markConversationQaScanned(conversationId);
    return { status: "no_gap" };
  }

  const productTitle = result.draft.productHandle
    ? (catalog.find((p) => p.id === result.draft!.productHandle)?.name ?? null)
    : null;

  const entry = await createQaEntry({
    conversationId,
    productId: result.draft.productHandle,
    productTitle,
    gapSummary: result.draft.gapSummary,
    question: result.draft.question,
    model: QA_DRAFT_MODEL,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
  });
  await markConversationQaScanned(conversationId);
  if (!entry) return { status: "duplicate" };
  return { status: "created", entry };
}
