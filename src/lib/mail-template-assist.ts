// „KI-Gestalter“ — the AI designer of the template and Rundmail editor
// (tier `designer`, ai_usage call site `template_assist`).
// docs/EMAIL_TEMPLATES.md §6, docs/AI_MODELS.md.
//
// The operator describes a mail or a change in everyday language and may
// attach screenshots, pictures, PDFs, HTML or .eml files. The model runs a
// tool loop (mail-template-designer.mjs runDesigner): it searches the catalog,
// lists the shop's collections, has pictures generated (generate_image — the
// picture AI renders in the background, mail-designer-pictures-io.ts) and
// hands in the whole block document, which is normalised and checked against
// the catalog, the attachments, the operator's words, the team's house style,
// the pictures of the run and the current mail before it is accepted. The
// editor shows the result as an unsaved change — nothing is stored here
// except the attachment pictures and generated pictures the accepted design
// uses (template pictures, Blob).
//
// How it runs comes from the team's settings (Einstellungen → „KI-Gestalter“,
// admin_settings `mail_designer`, getDesignerSettings) with the panel's
// choice for this conversation on top (the request's `settings`,
// mergeDesignerSettings): the model (Opus 5.5 by default, Sonnet 5.5 or Fable
// 5.2), the effort („Denktiefe“, with an output cap that grows with it), the
// freedom, the capabilities switch and the pictures switch (working rules in
// the user content — the pictures line also says when the picture service is
// not configured) and the house style (the last section of the system
// prompt; its links, codes and numbers count as named). When the chosen model is not open to this
// Anthropic account (Fable 5.2 under zero data retention, a model the key may
// not use), the request runs once more on Opus 5.5 — same effort, same
// deadline, a leading warning — when enough time is left
// (runDesignerWithFallback over the tested rule designerFallbackModel).
//
// This file only wires: settings, model and provider options (plus prompt
// caching — a system breakpoint and top-level automatic caching, so every
// later step of the loop and every run of the same use within five minutes
// reads the long prompt from the cache), the I/O of
// mail-template-designer-io.ts, the usage meter (per run with the model that
// ran, summed over all steps, also for a run that fails late), the run line
// (model, seconds, cost of the model calls and the picture calls, pictures —
// designerRunInfo) and the error report. After an accepted design the
// pictures it uses are awaited (until shortly after the deadline), stored and
// swapped in (finishDesignerPictures: a picture that failed is removed
// cleanly, a photo-like one labelled). When the operator cancels (the client
// disconnects) nothing more happens after the model: no second run, every
// picture render aborted, no picture stored for a result nobody receives —
// the usage is still recorded. Never throws.

import { anthropic } from "@ai-sdk/anthropic";
import { anthropicOptionsWithEffort } from "./ai-models.mjs";
import { recordAiUsage } from "./ai-usage-store";
import { getDesignerSettings } from "./admin-settings-store";
import { reportError } from "./observability";
import { getBaseUrl } from "./base-url";
import { docProductRefs, normalizeMailTemplateDoc, stripMoBlocks } from "./mail-template-doc.mjs";
import { designerMaxOutputTokens, designerPictureState, designerRunRules, mergeDesignerSettings } from "./mail-template-designer-settings.mjs";
import {
  DESIGNER_LIMITS,
  checkDesignSubmission,
  describeDocProducts,
  designerFailureMessage,
  designerMoChatUrl,
  designerProviderOptions,
  designerRequestFailure,
  designerRequestWarnings,
  designerRunInfo,
  designerSystemPrompt,
  designerUserContent,
  finishDesignerPictures,
  pictureIndexesInDoc,
  resolveRefsAgainstCatalog,
  runDesigner,
  runDesignerWithFallback,
  searchDesignerProducts,
  type DesignerProgress,
  type DesignerRequest,
  type DesignerRunInfo,
} from "./mail-template-designer.mjs";
import { DESIGNER_PICTURE_LIMITS } from "./mail-designer-pictures.mjs";
import {
  createDesignerPictureStudio,
  designerAiLabelIconUrl,
  isDesignerPictureConfigured,
  storeDesignerPictures,
  type PictureStudio,
} from "./mail-designer-pictures-io";
import {
  isKnownShopPage,
  listShopCollections,
  loadDesignerCatalog,
  prepareDesignerAttachments,
  storeDesignerImages,
  type PreparedDesignerAttachment,
} from "./mail-template-designer-io";

const TIER = "designer" as const;

export type { DesignerRunInfo };

export type TemplateAssistResult =
  | {
      ok: true;
      doc: ReturnType<typeof normalizeMailTemplateDoc>;
      notes: string;
      subject: string | null;
      preheader: string | null;
      warnings: string[];
      /** Model, effort, label, freedom, capabilities switch, seconds, cost, fallback — the NDJSON result's `run`. */
      run: DesignerRunInfo;
    }
  | {
      ok: false;
      message: string;
      /** Present once a model ran (the cost of a failed run). */
      run?: DesignerRunInfo;
    };

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

/** The answer for a client that went away — nobody reads it. */
const CANCELLED: TemplateAssistResult = { ok: false, message: "Abgebrochen — die Verbindung wurde getrennt." };

/**
 * Build or change a block document from the operator's instruction, the
 * session's earlier turns and the attachments, with the team's settings and
 * the panel's choice for this conversation. `onProgress` gets German status
 * lines; `signal` aborts the model (the route's time limit or a disconnect);
 * `deadlineAt` (epoch ms, when `signal` fires) lets the loop accept a draft
 * instead of starting a round it cannot finish and decides whether a second
 * run on Opus 5.5 still fits; `startedAt` (epoch ms, the request's start) is
 * where the run line's seconds count from. Never throws.
 */
export async function assistMailTemplate(
  input: DesignerRequest,
  opts: {
    onProgress?: (p: TemplateAssistProgress) => void;
    signal?: AbortSignal;
    deadlineAt?: number | null;
    startedAt?: number;
  } = {}
): Promise<TemplateAssistResult> {
  const startedAt = opts.startedAt ?? Date.now();
  const progress = (stage: TemplateAssistProgress["stage"], text: string) => {
    try {
      opts.onProgress?.({ stage, text });
    } catch {
      /* a broken listener never breaks the run */
    }
  };
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, message: "Kein KI-Schlüssel konfiguriert (ANTHROPIC_API_KEY)." };
  /** One picture studio per model run; a second run (fallback) starts afresh — the first run's pictures are of no use to it. */
  const studios: PictureStudio[] = [];
  // The pictures of a run render in the background: the operator going away
  // aborts them; the route's time limit does not (they may finish a few
  // seconds past it — the studio's own timer ends them).
  const picturesCancel = new AbortController();
  const onAbort = () => {
    if (isDisconnect(opts.signal)) picturesCancel.abort(opts.signal?.reason);
  };
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    progress("start", "Der KI-Gestalter startet …");
    // The team's settings (defaults without a database), the panel's choice on top; the house style always from the store.
    const settings = mergeDesignerSettings(await getDesignerSettings(), input.settings);

    let attachments: PreparedDesignerAttachment[] = [];
    let originals = new Map<number, Buffer>();
    if (input.attachments.length > 0) {
      progress("attachments", input.attachments.length === 1 ? "Liest den Anhang …" : `Liest ${input.attachments.length} Anhänge …`);
      const prepared = await prepareDesignerAttachments(input.attachments);
      if (!prepared.ok) return { ok: false, message: prepared.message };
      attachments = prepared.attachments;
      originals = prepared.originals;
    }

    const { catalog, isCatalogImage, shopFilePrefixes } = await loadDesignerCatalog();
    if (isDisconnect(opts.signal)) return CANCELLED;
    // generate_image: on, switched off (the team's or this conversation's setting), or not configured
    const pictureState = designerPictureState(settings, isDesignerPictureConfigured());
    const current = input.doc ? normalizeMailTemplateDoc(input.doc) : null;
    const operatorText = [
      input.instruction,
      ...input.history.filter((t) => t.role === "user").map((t) => t.text),
      input.context.subject ?? "",
      input.context.preheader ?? "",
    ].join("\n");
    const moChatUrl = designerMoChatUrl();
    const checkContext = {
      use: input.use,
      operatorText,
      // the team's house style: its links, codes and numbers count as named
      houseStyle: settings.houseStyle,
      currentDoc: current,
      // the text of HTML / EML / TXT attachments as the model reads it — a second source of named values
      attachments: attachments.map((a) => ({ index: a.index, kind: a.kind, name: a.name, text: a.text ?? null, subject: a.subject ?? null })),
      resolveRefs: (refs: string[]) => resolveRefsAgainstCatalog(catalog, refs),
      isKnownShopUrl: isKnownShopPage,
      isCatalogImage,
      shopFilePrefixes,
      ownOrigin: ownOrigin(),
      moChatUrl,
    };
    // The same prompt, content, options and checks for a second run — only the model differs.
    const system = designerSystemPrompt({ use: input.use, moChatUrl, houseStyle: settings.houseStyle });
    const userContent = designerUserContent({
      instruction: input.instruction,
      history: input.history,
      doc: current,
      use: input.use,
      attachments,
      context: input.context,
      today: new Date(),
      docProducts: current ? describeDocProducts(catalog, docProductRefs(current)) : [],
      rules: designerRunRules(settings, { pictures: pictureState }),
    });
    const providerOptions = designerProviderOptions(anthropicOptionsWithEffort(TIER, settings.effort));
    const maxOutputTokens = designerMaxOutputTokens(settings.effort, DESIGNER_LIMITS.answerTokens);

    const pictureCalls = () => studios.flatMap((st) => st.calls());
    const picturesMade = () => studios.reduce((n, st) => n + st.produced(), 0);

    // The chosen model — and once more on Opus 5.5 when it is not open to this account (runDesignerWithFallback).
    const { run, model, fallbackFrom, calls } = await runDesignerWithFallback({
      model: settings.model,
      runOnce: async (runModel: string) => {
        for (const earlier of studios) earlier.abort("Ein zweiter Lauf hat begonnen.");
        const studio = createDesignerPictureStudio({
          state: pictureState,
          catalog,
          deadlineAt: opts.deadlineAt ?? null,
          cancelSignal: picturesCancel.signal,
          onProgress: (text) => progress("images", text),
        });
        studios.push(studio);
        const result = await runDesigner({
          model: anthropic(runModel),
          system,
          userContent,
          providerOptions,
          maxOutputTokens,
          searchProducts: (query: string, max?: number) => searchDesignerProducts(catalog, query, max),
          listCollections: listShopCollections,
          pictures: studio,
          // `round` carries the pictures started in this run — the only placeholders a design may use
          checkSubmission: (submission, round) => checkDesignSubmission(submission, { ...checkContext, now: new Date(), ...round }),
          onProgress: (p) => progress(p.stage, p.text),
          onError: (err) => reportError(err, { route: "lib/mail-template-assist", phase: "tool" }),
          abortSignal: opts.signal,
          deadlineAt: opts.deadlineAt ?? null,
        });
        // metered per run with the model that ran
        await recordAiUsage({
          callSite: "template_assist",
          model: runModel,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          cacheReadTokens: result.usage.cacheReadTokens,
          cacheWriteTokens: result.usage.cacheWriteTokens,
        });
        return result;
      },
      signal: opts.signal,
      deadlineAt: opts.deadlineAt ?? null,
      // reported for the maintainer (e.g. Fable 5.2 under zero data retention), then the second run
      onFallback: (from, _to, error) => reportError(error, { route: "lib/mail-template-assist", phase: "model_unavailable", model: from }),
      onProgress: (p) => progress(p.stage, p.text),
    });
    const runInfo = () =>
      designerRunInfo({ settings, model, fallbackFrom, ms: Date.now() - startedAt, calls: [...calls, ...pictureCalls()], pictures: picturesMade() });
    const lastStudio = studios[studios.length - 1] ?? null;
    // The operator cancelled: no picture is stored for a draft nobody receives (template files are never deleted).
    if (isDisconnect(opts.signal)) return CANCELLED;
    // Aborted but not a disconnect: the route's time limit.
    const timedOut = Boolean(opts.signal?.aborted);

    if (!run.ok) {
      if (run.error) {
        reportError(run.error, { route: "lib/mail-template-assist", phase: "run", model, steps: run.steps, rounds: run.rounds });
      }
      return {
        ok: false,
        message: designerRequestFailure({ message: run.message, error: run.error, fallbackFrom, timedOut, effort: settings.effort }),
        run: runInfo(),
      };
    }
    if (run.fallback === "error") {
      // The model failed while correcting a draft: the cleaned draft is returned, the error reported.
      reportError(run.error ?? new Error("designer run ended early"), { route: "lib/mail-template-assist", phase: "fallback", model, steps: run.steps });
    }

    // The generated pictures the design uses: awaited (a little past the deadline at most), the rest aborted.
    const usedPictures = pictureIndexesInDoc(run.doc);
    for (const st of studios) if (st !== lastStudio) st.abort("Nicht verwendet.");
    const settled = lastStudio
      ? await lastStudio.settle({
          used: usedPictures,
          until: opts.deadlineAt != null ? opts.deadlineAt + DESIGNER_PICTURE_LIMITS.afterDeadlineMs : null,
        })
      : [];
    if (isDisconnect(opts.signal)) return CANCELLED;
    // Attachment pictures and generated pictures are stored side by side, then swapped in.
    const [stored, storedPictures] = await Promise.all([
      storeDesignerImages(run.doc, run.usedAttachments, originals, {
        deadlineAt: opts.deadlineAt ?? null,
        onProgress: (text) => progress("images", text),
      }),
      storeDesignerPictures(settled, usedPictures, {
        deadlineAt: opts.deadlineAt ?? null,
        onProgress: (text) => progress("images", text),
      }),
    ]);
    const finished = finishDesignerPictures(stored.doc, {
      urls: storedPictures.urls,
      failed: storedPictures.failed,
      pictures: lastStudio?.pictures() ?? [],
      labelIconUrl: designerAiLabelIconUrl(),
      language: input.context.language,
    });
    const doc = input.use === "bulk" ? stripMoBlocks(finished.doc) : finished.doc;
    return {
      ok: true,
      doc,
      notes: run.notes,
      subject: input.use === "bulk" ? run.subject : null,
      preheader: input.use === "bulk" ? run.preheader : null,
      warnings: designerRequestWarnings({
        warnings: run.warnings,
        storedWarnings: [...stored.warnings, ...finished.warnings],
        runFallback: run.fallback,
        fallbackFrom,
        timedOut,
        effort: settings.effort,
      }),
      run: runInfo(),
    };
  } catch (err) {
    reportError(err, { route: "lib/mail-template-assist", phase: "assist" });
    return { ok: false, message: designerFailureMessage(err) };
  } finally {
    // No render outlives the request (after an accepted design every used picture is settled already).
    opts.signal?.removeEventListener("abort", onAbort);
    for (const st of studios) st.abort();
  }
}
