// I/O of the KI-Gestalter's picture tool („generate_image“, the „Bild-KI“) —
// the pure core is mail-designer-pictures.mjs (rules, prompt, attempts, the
// studio, the text verdict; tested), the doc-level swap is in
// mail-template-designer.mjs (finishDesignerPictures). docs/EMAIL_TEMPLATES.md §6.
//
// It reuses the hero pipeline (docs/EMAIL_DESIGNS.md „Hero images“) where it
// fits:
//   * the OpenAI image models and their order — gpt-image-2 in the picture's
//     own size, then the classic size, then gpt-image-1.5
//     (designerPictureAttempts; EMAIL_HERO_IMAGE_MODEL and
//     EMAIL_HERO_IMAGE_QUALITY apply);
//   * the catalogue photos of the products as references through images.edit
//     (email-hero-references.mjs — true-to-product scenes);
//   * a vision check on the analyst tier, here of the picture's TEXT
//     (renderPictureWithCheck: one re-render when it is wrong and time
//     allows; EMAIL_HERO_QA=off or no ANTHROPIC_API_KEY switches it off);
//   * the machine-readable AI marking in every stored file
//     (email-hero-marking.mjs — EU AI Act Art. 50);
//   * the Blob store and the public route of the template pictures: files
//     „template-ki-…“ under the hero prefix, never erased with a person,
//     served by /api/email-hero-image/ (email-hero-blob.mjs).
// Every image call and every check is metered (`ai_usage` call site
// `template_image`, with the model) and returned as a billed call for the run
// line's cost. Needs OPENAI_API_KEY and BLOB_READ_WRITE_TOKEN (the hero
// pipeline's pair). Fail-soft throughout: a picture that cannot be made is a
// failed picture (the design goes on without it), never a thrown error.

import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import { put } from "@vercel/blob";
import { generateObject } from "ai";
import { z } from "zod";
import { anthropic } from "@ai-sdk/anthropic";
import { anthropicOptionsFor, modelFor } from "./ai-models.mjs";
import { recordAiUsage } from "./ai-usage-store";
import { reportError } from "./observability";
import { getBaseUrl } from "./base-url";
import { isTemplateImageUploadConfigured } from "./mail-template-image";
import { TEMPLATE_IMAGE_KIND, heroBlobFileFromPathname, heroBlobKey, heroImagePublicUrl } from "./email-hero-blob.mjs";
import { markAsAiGenerated } from "./email-hero-marking.mjs";
import { heroQaEnabled } from "./email-hero-qa.mjs";
import { loadReferenceImages, pickReferenceCandidates } from "./email-hero-references.mjs";
import { parseProductRef } from "./product-ref.mjs";
import { pickFlattenBackground, resolveRefsAgainstCatalog } from "./mail-template-designer.mjs";
import {
  PICTURE_STORE_WIDTH,
  PICTURE_TEXT_CHECK_PROMPT,
  createPictureStudio,
  designerPictureAttempts,
  designerPicturePrompt,
  isPictureRefusal,
  pictureCrop,
  pictureFailureReason,
  pictureTextVerdict,
  renderPictureWithCheck,
  type PictureCall,
  type PictureImage,
  type PictureJob,
  type PictureOutcome,
  type PictureState,
  type PictureStudio,
} from "./mail-designer-pictures.mjs";
import type { Product } from "./types";

export type { PictureState, PictureStudio };

/** Pixels sharp may decode of a render (a 1536×1536 picture is 2.4 MP). */
const RENDER_PIXELS = 40_000_000;
/** An attempt is only started with at least this much of the picture's time left. */
const ATTEMPT_MIN_MS = 12_000;
/** The longest one image call may take when there is no deadline. */
const ATTEMPT_MAX_MS = 150_000;
/** One upload may take this long (storeTemplateImage's own Blob timeout). */
const STORE_TIMEOUT_MS = 25_000;
/** Uploads may run until this long after the model's deadline (the route's maxDuration is 15 s later). */
const STORE_AFTER_DEADLINE_MS = 8_000;

const ZERO_USAGE = Object.freeze({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

/**
 * Pictures can be generated here: the image model (OPENAI_API_KEY) and the
 * Blob store of the template pictures (BLOB_READ_WRITE_TOKEN) — the hero
 * pipeline's pair (isHeroGenerationConfigured).
 */
export function isDesignerPictureConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY) && isTemplateImageUploadConfigured();
}

/**
 * The EU label „AI GENERATED“ the designer puts under a photo-like picture —
 * the same icon Mo's AI heroes carry (templateAssets in mail-template-design.ts,
 * aiImageLabel in email-designs/performance.ts): EMAIL_AI_LABEL_ICON_URL, else
 * <BASE_URL>/eu-ai-icon-email.png. finishDesignerPictures uses only an https
 * address (a local http base gets a warning instead).
 */
export function designerAiLabelIconUrl(): string {
  const custom = (process.env.EMAIL_AI_LABEL_ICON_URL ?? "").trim();
  return /^https?:\/\//.test(custom) ? custom : `${getBaseUrl()}/eu-ai-icon-email.png`;
}

type LoadedReference = { label: string; url: string; role: "new" | "owned"; bytes: Buffer };

/**
 * The catalogue photos of the products a picture shows (productRefs), as the
 * hero pipeline loads them: the first picture of each, ≤ 768 px, JPEG.
 * Fail-soft: an unreachable photo only makes the picture less specific.
 */
async function loadPictureReferences(refs: readonly string[], catalog: readonly Product[]): Promise<LoadedReference[]> {
  if (refs.length === 0) return [];
  try {
    const byId = new Map(catalog.map((p) => [p.id, p]));
    const products = refs.map((r) => byId.get(parseProductRef(r).productId)).filter((p): p is Product => Boolean(p));
    const candidates = pickReferenceCandidates({ recommended: products });
    return (await loadReferenceImages(candidates)) as LoadedReference[];
  } catch (err) {
    reportError(err, { route: "lib/mail-designer-pictures-io", phase: "references" });
    return [];
  }
}

/**
 * A render as the picture: a banner rendered in 3:2 cropped to its middle 3:1
 * band (pictureCrop), the size read back, and — when transparency was asked
 * for — whether the result really has see-through pixels.
 */
async function pictureFromRender(bytes: Buffer, job: PictureJob, model: string): Promise<PictureImage> {
  const meta = await sharp(bytes, { limitInputPixels: RENDER_PIXELS }).metadata();
  let width = meta.width ?? job.width;
  let height = meta.height ?? job.height;
  let out = bytes;
  const crop = pictureCrop(width, height, job.aspect);
  if (crop) {
    out = await sharp(bytes, { limitInputPixels: RENDER_PIXELS }).extract(crop).png().toBuffer();
    width = crop.width;
    height = crop.height;
  }
  let transparent = false;
  if (job.transparent && meta.hasAlpha) {
    const stats = await sharp(out, { limitInputPixels: RENDER_PIXELS }).stats();
    transparent = !stats.isOpaque;
  }
  return { bytes: out, width, height, transparent, model };
}

/**
 * One render of a picture: the attempts in order (designerPictureAttempts),
 * the first that delivers wins. Each attempt is metered; a refusal of the
 * subject (moderation) ends the chain — another size or model would refuse it
 * too; an attempt cut off by the picture's time counts as a call whose cost is
 * not known.
 */
async function renderPictureOnce(
  job: PictureJob,
  o: { attempt: number; emphasizeText: boolean; signal?: AbortSignal },
  ctx: { references: LoadedReference[]; deadlineAt: number | null }
): Promise<PictureOutcome> {
  const calls: PictureCall[] = [];
  const client = new OpenAI();
  const refs = ctx.references;
  const files = refs.length ? await Promise.all(refs.map((r, i) => toFile(r.bytes, `reference-${i + 1}.jpg`, { type: "image/jpeg" }))) : [];
  const attempts = designerPictureAttempts(process.env, { aspect: job.aspect, transparent: job.transparent, withReferences: files.length > 0 });
  let lastError: unknown = null;
  for (const attempt of attempts) {
    if (o.signal?.aborted) break;
    const left = ctx.deadlineAt == null ? ATTEMPT_MAX_MS : Math.min(ATTEMPT_MAX_MS, ctx.deadlineAt - Date.now());
    if (left < ATTEMPT_MIN_MS) {
      lastError = lastError ?? Object.assign(new Error("Zeitlimit des Bildes erreicht."), { name: "TimeoutError" });
      break;
    }
    const prompt = designerPicturePrompt(job, {
      size: attempt.size,
      cropTo: attempt.cropTo ?? null,
      references: attempt.mode === "edit" ? refs : [],
      emphasizeText: o.emphasizeText,
    });
    const common = {
      model: attempt.model,
      // The installed SDK types list only the classic sizes; gpt-image-2
      // renders free sizes (multiples of 16, at most 3:1) — the banner's 1536×512.
      size: attempt.size as "1536x1024",
      quality: attempt.quality as "low" | "medium" | "high",
      n: 1,
      ...(attempt.background ? { background: attempt.background, output_format: "png" as const } : {}),
    };
    const requestOptions = { signal: o.signal, maxRetries: 0, timeout: left };
    try {
      const res =
        attempt.mode === "edit"
          ? await client.images.edit(
              { ...common, image: files, prompt, ...(attempt.inputFidelity ? { input_fidelity: attempt.inputFidelity } : {}) },
              requestOptions
            )
          : await client.images.generate({ ...common, prompt }, requestOptions);
      const usage = { ...ZERO_USAGE, inputTokens: res.usage?.input_tokens ?? 0, outputTokens: res.usage?.output_tokens ?? 0 };
      calls.push({ model: attempt.model, usage, usageComplete: true });
      await recordAiUsage({ callSite: "template_image", model: attempt.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
      const b64 = res.data?.[0]?.b64_json;
      if (!b64) throw new Error(`${attempt.model} returned no image`);
      const image = await pictureFromRender(Buffer.from(b64, "base64"), job, attempt.model);
      const warnings =
        job.transparent && !image.transparent
          ? [`Bild ${job.n}: Der Hintergrund ist nicht transparent geworden — bitte prüfen, ob das Bild auf seinem Abschnitt gut aussieht.`]
          : [];
      return { ok: true, image, calls, warnings };
    } catch (err) {
      lastError = err;
      if (o.signal?.aborted) {
        calls.push({ model: attempt.model, usage: { ...ZERO_USAGE }, usageComplete: false });
        break;
      }
      reportError(err, { route: "lib/mail-designer-pictures-io", phase: `${attempt.mode}:${attempt.model}:${attempt.size}` });
      if (isPictureRefusal(err)) break;
    }
  }
  return { ok: false, reason: pictureFailureReason(lastError, o.signal ?? null), calls };
}

const TEXT_CHECK_SCHEMA = z.object({
  text: z.string().describe("All lettering visible in the picture, exactly as rendered, in reading order; empty when there is none."),
  legible: z.boolean().describe("Is the main lettering clearly legible at a glance?"),
});

/**
 * Read a picture's text back (the analyst tier — a vision call of about a
 * cent): the picture as a ≤ 1024-px JPEG, a transparent one laid on the
 * background its pixels stand out on (pickFlattenBackground). The model
 * transcribes without being told the expected text; pictureTextVerdict
 * compares. Null when the check is off (EMAIL_HERO_QA=off, no ANTHROPIC_API_KEY).
 */
async function checkPictureText(
  image: PictureImage,
  expected: string,
  o: { signal?: AbortSignal }
): Promise<{ verdict: ReturnType<typeof pictureTextVerdict>; calls: PictureCall[] } | null> {
  if (!heroQaEnabled()) return null;
  const src = Buffer.from(image.bytes);
  let background = "#ffffff";
  if (image.transparent) {
    const raw = await sharp(src, { limitInputPixels: RENDER_PIXELS }).resize({ width: 64, height: 64, fit: "inside" }).ensureAlpha().raw().toBuffer();
    background = pickFlattenBackground(raw).background;
  }
  const jpeg = await sharp(src, { limitInputPixels: RENDER_PIXELS })
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .flatten({ background })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
  const model = modelFor("analyst");
  const { object, usage } = await generateObject({
    model: anthropic(model),
    providerOptions: anthropicOptionsFor("analyst"),
    schema: TEXT_CHECK_SCHEMA,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", image: jpeg, mediaType: "image/jpeg" },
          { type: "text", text: PICTURE_TEXT_CHECK_PROMPT },
        ],
      },
    ],
    abortSignal: o.signal,
    maxRetries: 1,
  });
  const u = { ...ZERO_USAGE, inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0 };
  await recordAiUsage({ callSite: "template_image", model, inputTokens: u.inputTokens, outputTokens: u.outputTokens });
  return {
    verdict: pictureTextVerdict({ expected, read: object.text ?? "", legible: object.legible === true }),
    calls: [{ model, usage: u, usageComplete: true }],
  };
}

/**
 * The pictures of one designer run (createPictureStudio) wired to the real
 * services: product refs checked against the catalog, the reference photos,
 * the OpenAI renders with the text check. `state` — "on", "off" (the team's
 * or the conversation's setting) or "unavailable" (not configured) — decides
 * what generate_image answers. `cancelSignal` aborts every render (the
 * operator went away); `deadlineAt` is the model's deadline (renders may run
 * a few seconds past it).
 */
export function createDesignerPictureStudio(o: {
  state: PictureState;
  catalog: readonly Product[];
  deadlineAt: number | null;
  cancelSignal?: AbortSignal | null;
  onProgress?: (text: string) => void;
}): PictureStudio {
  return createPictureStudio({
    state: o.state,
    deadlineAt: o.deadlineAt,
    cancelSignal: o.cancelSignal ?? null,
    onProgress: o.onProgress,
    onError: (err) => reportError(err, { route: "lib/mail-designer-pictures-io", phase: "render" }),
    primaryModel: designerPictureAttempts(process.env)[0]?.model,
    checkRefs: (refs) => {
      const known = new Set(resolveRefsAgainstCatalog(o.catalog, refs).known);
      return { unknown: refs.filter((r) => !known.has(r)) };
    },
    render: async (job, { signal, deadlineAt }) => {
      const references = await loadPictureReferences(job.productRefs, o.catalog);
      return renderPictureWithCheck(job, {
        renderOnce: (j, ro) => renderPictureOnce(j, ro, { references, deadlineAt }),
        checkText: (image, expected, co) => checkPictureText(image, expected, co),
        deadlineAt,
        signal,
      });
    },
  });
}

/**
 * Store one generated picture as a template picture: at most the purpose's
 * width (1,200 px, an icon 320), PNG when it is transparent (else JPEG on
 * white), the AI marking written into the file (email-hero-marking.mjs — the
 * image model's own provenance data does not survive re-encoding), under
 * „template-ki-…“ (never erased with a person) and served by our own route.
 */
async function storeGeneratedPicture(image: PictureImage, job: PictureJob): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  if (!isTemplateImageUploadConfigured()) return { ok: false, message: "Bild-Upload nicht eingerichtet" };
  let out: Buffer;
  let ext: "png" | "jpg";
  let contentType: string;
  try {
    const width = PICTURE_STORE_WIDTH[job.purpose] ?? 1200;
    const pipeline = sharp(Buffer.from(image.bytes), { limitInputPixels: RENDER_PIXELS }).resize({ width, withoutEnlargement: true });
    const marking = { tool: image.model };
    if (image.transparent) {
      out = await markAsAiGenerated(pipeline, marking).png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer();
      ext = "png";
      contentType = "image/png";
    } else {
      out = await markAsAiGenerated(pipeline.flatten({ background: "#ffffff" }).toColourspace("srgb"), marking)
        .jpeg({ quality: 86, mozjpeg: true })
        .toBuffer();
      ext = "jpg";
      contentType = "image/jpeg";
    }
  } catch (err) {
    reportError(err, { route: "lib/mail-designer-pictures-io", phase: "process" });
    return { ok: false, message: "das Bild ließ sich nicht verarbeiten" };
  }
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), STORE_TIMEOUT_MS);
  try {
    const blob = await put(heroBlobKey(TEMPLATE_IMAGE_KIND, "ki", { ext, stamp: Date.now() }), out, {
      access: "private",
      contentType,
      addRandomSuffix: true,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      abortSignal: abort.signal,
    });
    return { ok: true, url: heroImagePublicUrl(getBaseUrl(), heroBlobFileFromPathname(blob.pathname)) };
  } catch (err) {
    reportError(err, { route: "lib/mail-designer-pictures-io", phase: "put" });
    return { ok: false, message: "Speichern fehlgeschlagen" };
  } finally {
    clearTimeout(timer);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), Math.max(0, ms));
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

/**
 * Store the finished pictures the accepted design uses (`used`; the others
 * are never stored — template files are never deleted) and return their
 * URLs, plus why a picture could not be stored (finishDesignerPictures names
 * it and removes it from the mail). Uploads run in parallel until a few
 * seconds after the model's deadline. Never throws.
 */
export async function storeDesignerPictures(
  settled: ReadonlyArray<{ n: number; job: PictureJob; outcome: PictureOutcome | null }>,
  used: readonly number[],
  opts: { deadlineAt?: number | null; onProgress?: (text: string) => void } = {}
): Promise<{ urls: Map<number, string>; failed: Map<number, string> }> {
  const urls = new Map<number, string>();
  const failed = new Map<number, string>();
  const ready = settled.filter((s) => used.includes(s.n) && s.outcome?.ok === true);
  if (ready.length === 0) return { urls, failed };
  try {
    opts.onProgress?.(ready.length === 1 ? "Speichert das erzeugte Bild …" : `Speichert ${ready.length} erzeugte Bilder …`);
  } catch {
    /* a broken listener never stops the upload */
  }
  const until = opts.deadlineAt != null ? opts.deadlineAt + STORE_AFTER_DEADLINE_MS : Infinity;
  const budget = Math.max(3_000, Math.min(STORE_TIMEOUT_MS, until - Date.now()));
  const results = await Promise.all(
    ready.map(async (s) => {
      const outcome = s.outcome as Extract<PictureOutcome, { ok: true }>;
      return { n: s.n, result: await withTimeout(storeGeneratedPicture(outcome.image, s.job), budget, null) };
    })
  );
  for (const { n, result } of results) {
    if (result?.ok) urls.set(n, result.url);
    else failed.set(n, result ? result.message : "Speichern dauerte zu lange");
  }
  return { urls, failed };
}
