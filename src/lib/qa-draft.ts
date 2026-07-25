// Knowledge-gap Q&A drafting — ONE cheap Haiku pass over the readable
// transcript of an eligible conversation (unmet need / drop-off / contact-form
// hand-over). Produces { gap summary, precise customer-facing question,
// product attribution } for the admin "Wissen" queue, where a human answers
// and publishes it. Mirrors conversation-analysis.ts: same provider wiring,
// same defensive parsing, NO silent fallback — an explicit admin action, so a
// missing key / model error surfaces to the dashboard.
//
// Cluster A only: reads the pseudonymous transcript; usage is recorded against
// the conversation FK so it cascade-deletes with the conversation.

import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { recordAiUsage } from "./ai-usage-store";
import {
  QA_DRAFT_SYSTEM_PROMPT,
  buildQaDraftPrompt,
  parseQaDraftResponse,
} from "./qa-core.mjs";
import type { AdminTranscriptTurn } from "./admin-conversations";

/** Cheap Haiku-class model — back-office drafting, not the consultation model. */
export const QA_DRAFT_MODEL = "claude-haiku-4-5";

// Same bounds as the analysis pass: a very long chat must not become an
// unbounded prompt.
const MAX_TURNS = 60;
const MAX_TRANSCRIPT_CHARS = 12000;

export interface QaDraft {
  gapSummary: string;
  question: string;
  /** Catalog product handle, already validated against the catalog by the caller. */
  productHandle: string | null;
}

export interface QaDraftUsage {
  inputTokens: number;
  outputTokens: number;
}

export type GenerateQaDraftResult =
  | { ok: true; draft: QaDraft | null; usage: QaDraftUsage } // draft=null: no real gap
  | { ok: false; reason: "unconfigured" | "no_data" | "model_error"; message: string };

function renderTranscript(turns: AdminTranscriptTurn[]): string {
  const kept = turns.slice(-MAX_TURNS);
  const text = kept
    .map((t) => `${t.role === "user" ? "Kunde" : "Berater"}: ${t.content.trim()}`)
    .join("\n");
  return text.length > MAX_TRANSCRIPT_CHARS
    ? text.slice(-MAX_TRANSCRIPT_CHARS) + "\n[… Anfang gekürzt]"
    : text;
}

/**
 * Draft a Q&A candidate from ONE conversation. Never throws. `productHandles`
 * are the catalog handles that appeared in the conversation (candidates for
 * attribution); the returned productHandle is only trusted if it is one of
 * them — anything else is coerced to null (general question).
 */
export async function generateQaDraft(input: {
  conversationId: number;
  transcript: AdminTranscriptTurn[];
  productHandles: string[];
}): Promise<GenerateQaDraftResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      ok: false,
      reason: "unconfigured",
      message: "ANTHROPIC_API_KEY ist nicht gesetzt — Q&A-Entwurf nicht möglich.",
    };
  }
  const turns = input.transcript.filter((t) => t.content.trim().length > 0);
  if (turns.length === 0) {
    return {
      ok: false,
      reason: "no_data",
      message: "Kein lesbares Transkript — nichts zu prüfen.",
    };
  }

  try {
    const result = await generateText({
      model: anthropic(QA_DRAFT_MODEL),
      maxOutputTokens: 700,
      system: QA_DRAFT_SYSTEM_PROMPT,
      prompt: buildQaDraftPrompt({
        transcript: renderTranscript(turns),
        productHandles: input.productHandles,
      }),
    });

    const parsed = parseQaDraftResponse(result.text ?? "");
    if (parsed === null) {
      return {
        ok: false,
        reason: "model_error",
        message: "Das Modell lieferte keinen verwertbaren Q&A-Entwurf.",
      };
    }

    const inputTokens = result.usage?.inputTokens ?? 0;
    const outputTokens = result.usage?.outputTokens ?? 0;
    await recordAiUsage({
      callSite: "qa_draft",
      model: QA_DRAFT_MODEL,
      inputTokens,
      outputTokens,
      conversationId: input.conversationId,
    });

    if (!parsed.found) {
      return { ok: true, draft: null, usage: { inputTokens, outputTokens } };
    }

    // Only trust a product attribution that points at a product actually seen
    // in the conversation — anything else becomes a general question.
    const handleSet = new Set(input.productHandles);
    const productHandle =
      parsed.productHandle && handleSet.has(parsed.productHandle)
        ? parsed.productHandle
        : null;

    return {
      ok: true,
      draft: { gapSummary: parsed.gapSummary, question: parsed.question, productHandle },
      usage: { inputTokens, outputTokens },
    };
  } catch (err) {
    return {
      ok: false,
      reason: "model_error",
      message: `Modellfehler: ${(err as Error).message ?? "unbekannt"}`,
    };
  }
}
