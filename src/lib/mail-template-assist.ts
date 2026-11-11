// „KI-Gestalter“ — the AI designer of the template and Rundmail editor
// (tier `designer`: Opus 5.5 at effort high, ai_usage call site
// `template_assist`). docs/EMAIL_TEMPLATES.md §6, docs/AI_MODELS.md.
//
// The operator describes a mail or a change in everyday language and may
// attach screenshots, pictures, PDFs, HTML or .eml files. The model runs a
// tool loop (mail-template-designer.mjs runDesigner): it searches the catalog,
// lists the shop's collections and hands in the whole block document, which
// is normalised and checked against the catalog, the attachments, the
// operator's words and the current mail before it is accepted. The editor
// shows the result as an unsaved change — nothing is stored here except the
// attachment pictures the accepted design uses (template pictures, Blob).
//
// This file only wires: model and provider options from ai-models.mjs (plus
// prompt caching — a system breakpoint and top-level automatic caching, so
// every later step of the loop and every run of the same use within five
// minutes reads the long prompt from the cache), the I/O of
// mail-template-designer-io.ts, the usage meter (summed over all steps, also
// for a run that fails late) and the error report. Never throws.

import { anthropic } from "@ai-sdk/anthropic";
import { anthropicOptionsFor, maxOutputTokensFor, modelFor } from "./ai-models.mjs";
import { recordAiUsage } from "./ai-usage-store";
import { reportError } from "./observability";
import { getBaseUrl } from "./base-url";
import { docProductRefs, normalizeMailTemplateDoc, stripMoBlocks } from "./mail-template-doc.mjs";
import {
  DESIGNER_LIMITS,
  checkDesignSubmission,
  describeDocProducts,
  designerFailureMessage,
  designerSystemPrompt,
  designerUserContent,
  resolveRefsAgainstCatalog,
  runDesigner,
  searchDesignerProducts,
  type DesignerProgress,
  type DesignerRequest,
} from "./mail-template-designer.mjs";
import {
  isKnownCollectionUrl,
  listShopCollections,
  loadDesignerCatalog,
  prepareDesignerAttachments,
  storeDesignerImages,
  type PreparedDesignerAttachment,
} from "./mail-template-designer-io";

const TIER = "designer" as const;
const MODEL = modelFor(TIER);

export type TemplateAssistResult =
  | {
      ok: true;
      doc: ReturnType<typeof normalizeMailTemplateDoc>;
      notes: string;
      subject: string | null;
      preheader: string | null;
      warnings: string[];
    }
  | { ok: false; message: string };

export type TemplateAssistProgress = DesignerProgress;

/** The origin of our own picture route (/api/email-hero-image/…), or null. */
function ownOrigin(): string | null {
  try {
    return new URL(getBaseUrl()).origin;
  } catch {
    return null;
  }
}

/** True for the abort of a client that went away (nobody reads the answer). */
function isDisconnect(signal: AbortSignal | undefined): boolean {
  const reason = signal?.reason as { name?: unknown } | undefined;
  return Boolean(signal?.aborted) && reason?.name === "AbortError";
}

/**
 * Build or change a block document from the operator's instruction, the
 * session's earlier turns and the attachments. `onProgress` gets German status
 * lines; `signal` aborts the model (the route's time limit or a disconnect);
 * `deadlineAt` (epoch ms, when `signal` fires) lets the loop accept a draft
 * instead of starting a round it cannot finish. Never throws.
 */
export async function assistMailTemplate(
  input: DesignerRequest,
  opts: { onProgress?: (p: TemplateAssistProgress) => void; signal?: AbortSignal; deadlineAt?: number | null } = {}
): Promise<TemplateAssistResult> {
  const progress = (stage: TemplateAssistProgress["stage"], text: string) => {
    try {
      opts.onProgress?.({ stage, text });
    } catch {
      /* a broken listener never breaks the run */
    }
  };
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, message: "Kein KI-Schlüssel konfiguriert (ANTHROPIC_API_KEY)." };
  try {
    progress("start", "Der KI-Gestalter startet …");

    let attachments: PreparedDesignerAttachment[] = [];
    let originals = new Map<number, Buffer>();
    if (input.attachments.length > 0) {
      progress("attachments", input.attachments.length === 1 ? "Liest den Anhang …" : `Liest ${input.attachments.length} Anhänge …`);
      const prepared = await prepareDesignerAttachments(input.attachments);
      if (!prepared.ok) return { ok: false, message: prepared.message };
      attachments = prepared.attachments;
      originals = prepared.originals;
    }

    const { catalog, isCatalogImage } = await loadDesignerCatalog();
    const current = input.doc ? normalizeMailTemplateDoc(input.doc) : null;
    const operatorText = [
      input.instruction,
      ...input.history.filter((t) => t.role === "user").map((t) => t.text),
      input.context.subject ?? "",
      input.context.preheader ?? "",
    ].join("\n");
    const checkContext = {
      use: input.use,
      operatorText,
      currentDoc: current,
      attachments: attachments.map((a) => ({ index: a.index, kind: a.kind, name: a.name })),
      resolveRefs: (refs: string[]) => resolveRefsAgainstCatalog(catalog, refs),
      isKnownShopUrl: isKnownCollectionUrl,
      isCatalogImage,
      ownOrigin: ownOrigin(),
    };
    const base = anthropicOptionsFor(TIER);
    const run = await runDesigner({
      model: anthropic(MODEL),
      system: designerSystemPrompt({ use: input.use }),
      userContent: designerUserContent({
        instruction: input.instruction,
        history: input.history,
        doc: current,
        use: input.use,
        attachments,
        context: input.context,
        today: new Date(),
        docProducts: current ? describeDocProducts(catalog, docProductRefs(current)) : [],
      }),
      providerOptions: { ...base, anthropic: { ...(base.anthropic ?? {}), cacheControl: { type: "ephemeral" } } },
      maxOutputTokens: maxOutputTokensFor(TIER, DESIGNER_LIMITS.answerTokens),
      searchProducts: (query: string, max?: number) => searchDesignerProducts(catalog, query, max),
      listCollections: listShopCollections,
      checkSubmission: (submission, round) => checkDesignSubmission(submission, { ...checkContext, now: new Date(), ...round }),
      onProgress: (p) => progress(p.stage, p.text),
      onError: (err) => reportError(err, { route: "lib/mail-template-assist", phase: "tool" }),
      abortSignal: opts.signal,
      deadlineAt: opts.deadlineAt ?? null,
    });

    await recordAiUsage({
      callSite: "template_assist",
      model: MODEL,
      inputTokens: run.usage.inputTokens,
      outputTokens: run.usage.outputTokens,
      cacheReadTokens: run.usage.cacheReadTokens,
      cacheWriteTokens: run.usage.cacheWriteTokens,
    });

    if (!run.ok) {
      if (run.error && !isDisconnect(opts.signal)) {
        reportError(run.error, { route: "lib/mail-template-assist", phase: "run", steps: run.steps, rounds: run.rounds });
      }
      return { ok: false, message: run.message };
    }
    if (run.fallback === "error") {
      // The model failed while correcting a draft: the cleaned draft is returned, the error reported.
      reportError(run.error ?? new Error("designer run ended early"), { route: "lib/mail-template-assist", phase: "fallback", steps: run.steps });
    }

    const stored = await storeDesignerImages(run.doc, run.usedAttachments, originals, {
      deadlineAt: opts.deadlineAt ?? null,
      onProgress: (text) => progress("images", text),
    });
    const doc = input.use === "bulk" ? stripMoBlocks(stored.doc) : stored.doc;
    return {
      ok: true,
      doc,
      notes: run.notes,
      subject: input.use === "bulk" ? run.subject : null,
      preheader: input.use === "bulk" ? run.preheader : null,
      warnings: [...run.warnings, ...stored.warnings],
    };
  } catch (err) {
    reportError(err, { route: "lib/mail-template-assist", phase: "assist" });
    return { ok: false, message: designerFailureMessage(err) };
  }
}
