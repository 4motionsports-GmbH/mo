// Pictures for e-mail templates and Rundmails (the block „Bild“, the logo,
// the Titelbild fallback) — processing and storage. docs/EMAIL_TEMPLATES.md.
//
// Any aspect ratio (a banner, a product shot, a square): the picture is
// oriented by its EXIF data, scaled down to at most 1200 px wide (2× the
// 600-px mail, sharp on phones and Retina screens), stripped of every
// metadata tag (no camera EXIF or GPS leaves the server) and stored as JPEG —
// or PNG when it has transparency. WebP / AVIF / HEIF become JPEG or PNG
// (classic Outlook cannot show WebP). Animated GIFs (Black-Week banners) are
// kept byte for byte when they fit (≤ 1200 px wide, ≤ 2 MB) — re-encoding
// would lose frames or quality; otherwise the operator gets a German message.
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

export const TEMPLATE_IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const TEMPLATE_IMAGE_MAX_BYTES = 4_000_000;
const MAX_WIDTH = 1200;
const MIN_WIDTH = 200;
const GIF_MAX_BYTES = 2_000_000;
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

/** Process and store one uploaded picture. Never throws. */
export async function storeTemplateImage(bytes: Buffer): Promise<TemplateImageResult> {
  if (!isTemplateImageUploadConfigured()) {
    return fail(503, "not_configured", "Bild-Upload nicht eingerichtet (BLOB_READ_WRITE_TOKEN fehlt).");
  }
  let meta: sharp.Metadata;
  try {
    meta = await sharp(bytes, { animated: true, limitInputPixels: 40_000_000 }).metadata();
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

  if (format === "gif" && (meta.pages ?? 1) > 1) {
    if (width > MAX_WIDTH || bytes.length > GIF_MAX_BYTES) {
      return fail(
        400,
        "gif_too_large",
        `Animierte GIFs dürfen höchstens ${MAX_WIDTH} px breit und 2 MB groß sein (dieses: ${width} px, ${Math.round(bytes.length / 1024)} KB).`
      );
    }
    out = bytes;
    ext = "gif";
    contentType = "image/gif";
    warnings.push("Animiertes GIF: Outlook für Windows zeigt nur das erste Bild — das sollte allein verständlich sein.");
  } else {
    try {
      // EXIF orientation first, then at most MAX_WIDTH wide (never enlarged).
      const img = sharp(bytes, { limitInputPixels: 40_000_000 })
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
  if (out.length > 600_000) warnings.push(`Das Bild ist ${Math.round(out.length / 1024)} KB groß — große Bilder laden langsam.`);

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
