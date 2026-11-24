// Pictures for e-mail templates and Rundmails (the block „Bild“, the logo,
// the Titelbild fallback) — processing and storage. docs/EMAIL_TEMPLATES.md.
//
// Any aspect ratio (a banner, a product shot, a square): the picture is
// oriented by its EXIF data, scaled down to at most 1200 px wide (2× the
// 600-px mail, sharp on phones and Retina screens), stripped of every
// metadata tag (no camera EXIF or GPS leaves the server) and stored as JPEG —
// or PNG when it has transparency. WebP / AVIF / HEIF become JPEG or PNG
// (classic Outlook cannot show WebP). Animated GIFs (Black-Week banners) are
// kept byte for byte when they fit (≤ 1200 px wide, ≤ 2 MB); one that does not
// is shrunk — every frame resized and encoded again, timing and loop kept, at
// most 1200 px wide and narrower until it is ≤ 2 MB (mail-template-gif.mjs,
// tested) — and refused only when not even 600 px fits the time budget.
// Only the first frame is read up front: sharp's pixel limit counts an
// animated image as all frames stacked, so a 1440-px GIF with 20 frames was
// refused as „nicht lesbar“ (owner report 24.11.2026).
//
// Stored privately in the Blob store under email-heroes/template-<stamp>…
// and delivered by the public route /api/email-hero-image/<file> (the hero
// pipeline's), with a random suffix and an immutable cache. Template files
// are never deleted (sent mails reference them) and never erased with a
// person (email-hero-blob.mjs isTemplateImageFile).

import sharp from "sharp";
import { put } from "@vercel/blob";
import { getBaseUrl } from "./base-url";
import { reportError } from "./observability";
import { TEMPLATE_IMAGE_KIND, heroBlobFileFromPathname, heroBlobKey, heroImagePublicUrl } from "./email-hero-blob.mjs";
import {
  GIF_ENCODE_OPTIONS,
  GIF_MAX_WIDTH,
  GIF_UPLOAD_BUDGET_SECONDS,
  gifShrunkWarning,
  planAnimatedGif,
  shrinkAnimatedGif,
  sizeLabel,
} from "./mail-template-gif.mjs";

export const TEMPLATE_IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const TEMPLATE_IMAGE_MAX_BYTES = 4_000_000;
const MAX_WIDTH = GIF_MAX_WIDTH;
const MIN_WIDTH = 200;
/** Pixels of ONE picture (or one frame of an animated GIF) sharp may decode. */
const FRAME_PIXEL_LIMIT = 40_000_000;
const BLOB_PUT_TIMEOUT_MS = 25_000;

export type TemplateImageResult =
  | { ok: true; url: string; width: number; height: number; warnings: string[] }
  | { ok: false; status: number; code: string; message: string };

function fail(status: number, code: string, message: string): TemplateImageResult {
  return { ok: false, status, code, message };
}

export function isTemplateImageUploadConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/**
 * Process and store one uploaded picture. `gifBudgetSeconds`: how long
 * shrinking an animated GIF may take (default: the upload's 150 s; the
 * KI-Gestalter passes what its deadline leaves). Never throws.
 */
export async function storeTemplateImage(bytes: Buffer, opts: { gifBudgetSeconds?: number } = {}): Promise<TemplateImageResult> {
  if (!isTemplateImageUploadConfigured()) {
    return fail(503, "not_configured", "Bild-Upload nicht eingerichtet (BLOB_READ_WRITE_TOKEN fehlt).");
  }
  let meta: sharp.Metadata;
  try {
    // The first frame only (`pages` still counts them all): the limit holds per frame — read
    // `animated`, sharp counts all frames stacked and a long GIF looked unreadable.
    meta = await sharp(bytes, { limitInputPixels: FRAME_PIXEL_LIMIT }).metadata();
  } catch {
    return fail(400, "unreadable", "Das Bild ist nicht lesbar — bitte JPG, PNG, GIF oder WebP hochladen.");
  }
  const format = meta.format ?? "";
  if (!["jpeg", "png", "webp", "gif", "heif", "avif"].includes(format)) {
    return fail(400, "format", "Dieses Bildformat geht nicht — bitte JPG, PNG, GIF oder WebP hochladen.");
  }
  const warnings: string[] = [];
  let out: Buffer;
  let ext: "jpg" | "png" | "gif";
  let contentType: string;
  let width = meta.width ?? 0;
  let height = meta.pageHeight ?? meta.height ?? 0;
  const frames = meta.pages ?? 1;

  if (format === "gif" && frames > 1) {
    const gif = { width, height, frames };
    const budgetSeconds = opts.gifBudgetSeconds ?? GIF_UPLOAD_BUDGET_SECONDS;
    const plan = planAnimatedGif({ ...gif, bytes: bytes.length, budgetSeconds });
    if (plan.action === "refuse") return fail(400, plan.code, plan.message);
    if (plan.action === "keep") {
      out = bytes;
    } else {
      // Every frame decoded (the limit is exactly the stack: frames × one frame), resized, encoded again.
      const stackPixels = width * height * frames + 1;
      let shrunk: Awaited<ReturnType<typeof shrinkAnimatedGif>>;
      try {
        shrunk = await shrinkAnimatedGif({
          gif,
          firstWidth: plan.width,
          budgetSeconds,
          encode: (w: number) =>
            sharp(bytes, { animated: true, limitInputPixels: stackPixels })
              .resize({ width: w, withoutEnlargement: true })
              .gif({ ...GIF_ENCODE_OPTIONS })
              .toBuffer(),
        });
      } catch (err) {
        reportError(err, { route: "lib/mail-template-image", phase: "gif" });
        return fail(400, "unreadable", "Das GIF konnte nicht verarbeitet werden — bitte neu exportieren.");
      }
      if (!shrunk.ok) return fail(400, shrunk.code, shrunk.message);
      out = Buffer.from(shrunk.data);
      try {
        const encoded = await sharp(out).metadata();
        width = encoded.width ?? shrunk.width;
        height = encoded.pageHeight ?? encoded.height ?? height;
      } catch {
        width = shrunk.width;
      }
      warnings.push(gifShrunkWarning({ fromWidth: gif.width, toWidth: width, fromBytes: bytes.length, toBytes: out.length, frames }));
    }
    ext = "gif";
    contentType = "image/gif";
    warnings.push("Animiertes GIF: Outlook für Windows zeigt nur das erste Bild — das sollte allein verständlich sein.");
  } else {
    try {
      // EXIF orientation first, then at most MAX_WIDTH wide (never enlarged).
      const img = sharp(bytes, { limitInputPixels: FRAME_PIXEL_LIMIT })
        .rotate()
        .resize({ width: MAX_WIDTH, withoutEnlargement: true });
      const hasAlpha = meta.hasAlpha === true && format !== "jpeg";
      if (hasAlpha) {
        out = await img.png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer();
        ext = "png";
        contentType = "image/png";
      } else {
        out = await img.flatten({ background: "#ffffff" }).toColourspace("srgb").jpeg({ quality: 86, mozjpeg: true }).toBuffer();
        ext = "jpg";
        contentType = "image/jpeg";
      }
      const finalMeta = await sharp(out).metadata();
      width = finalMeta.width ?? width;
      height = finalMeta.height ?? height;
    } catch (err) {
      reportError(err, { route: "lib/mail-template-image", phase: "process" });
      return fail(400, "unreadable", "Das Bild konnte nicht verarbeitet werden — bitte als JPG oder PNG exportieren.");
    }
  }
  if (width < MIN_WIDTH) warnings.push(`Das Bild ist nur ${width} px breit — in der Mail wirkt es eventuell unscharf.`);
  if (width < 600 && width >= MIN_WIDTH) warnings.push("Für ein vollbreites Bild mindestens 1200 px Breite verwenden (scharf auf dem Handy).");
  if (out.length > 600_000) warnings.push(`Das Bild ist ${sizeLabel(out.length)} groß — große Bilder laden langsam.`);

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), BLOB_PUT_TIMEOUT_MS);
  try {
    const blob = await put(heroBlobKey(TEMPLATE_IMAGE_KIND, "img", { ext, stamp: Date.now() }), out, {
      access: "private",
      contentType,
      addRandomSuffix: true,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      abortSignal: abort.signal,
    });
    const file = heroBlobFileFromPathname(blob.pathname);
    return { ok: true, url: heroImagePublicUrl(getBaseUrl(), file), width, height, warnings };
  } catch (err) {
    reportError(err, { route: "lib/mail-template-image", phase: "put" });
    return fail(502, "storage_failed", "Das Bild konnte nicht gespeichert werden — bitte erneut versuchen.");
  } finally {
    clearTimeout(timer);
  }
}
