// prepareHeroUpload — the browser step of the Kampagnenbild upload
// (kampagnen/CampaignHeroField): decode the picked file with its EXIF
// orientation applied, check it against the shared upload rules on the size
// that will be sent (lib/email-hero-upload-client.mjs over
// email-hero-upload.mjs — a too-small picture fails here, without a round
// trip), and shrink + re-encode a heavy or huge photo to JPEG on a canvas so
// it fits Vercel's request limit. The server checks the bytes again and does
// the real processing (crop, 1536×720, gradient, phone crop) — nothing here
// is trusted. Errors are thrown as HeroUploadPrepError with the German text.

import {
  CLIENT_JPEG_QUALITIES,
  downscaleSteps,
  heroUploadContentType,
  planHeroUpload,
} from "@/lib/email-hero-upload-client.mjs";
import { HERO_UPLOAD_MAX_BYTES, heroUploadError } from "@/lib/email-hero-upload.mjs";

export class HeroUploadPrepError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "HeroUploadPrepError";
    this.code = code;
  }
}

export interface PreparedHeroUpload {
  /** What is sent: the original file, or the re-encoded JPEG. Its `type` is
   *  one of the route's accepted Content-Types. */
  blob: Blob;
  /** Original file name (display only, the route sanitises it). */
  name: string;
  reencoded: boolean;
  /** Size of `blob` in pixels (oriented). */
  width: number;
  height: number;
}

function fail(code: Parameters<typeof heroUploadError>[0]): never {
  const e = heroUploadError(code);
  throw new HeroUploadPrepError(e.code, e.message);
}

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) return fail("unreadable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return ctx;
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", quality));
}

/** Draw the picture at `width`×`height` in halving steps, on white (a
 *  transparent PNG becomes white, as the server's flatten does). */
function drawScaled(bitmap: ImageBitmap, width: number, height: number): HTMLCanvasElement {
  const steps = downscaleSteps(bitmap.width, bitmap.height, width, height);
  if (steps.length === 0) steps.push([width, height]);
  let source: CanvasImageSource = bitmap;
  let sw = bitmap.width;
  let sh = bitmap.height;
  let canvas: HTMLCanvasElement | null = null;
  for (let i = 0; i < steps.length; i++) {
    const [w, h] = steps[i];
    const next = canvasOf(w, h);
    const ctx = context2d(next);
    if (i === steps.length - 1) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(source, 0, 0, sw, sh, 0, 0, w, h);
    canvas = next;
    source = next;
    sw = w;
    sh = h;
  }
  return canvas ?? fail("unreadable");
}

export async function prepareHeroUpload(file: File): Promise<PreparedHeroUpload> {
  const contentType = heroUploadContentType(file.type, file.name);
  if (!contentType) fail("format");
  if (file.size <= 0) fail("empty");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // The type is right but the browser cannot decode it: broken, or not
    // what its name claims (e.g. a HEIC renamed to .jpg).
    return fail("unreadable");
  }

  try {
    const plan = planHeroUpload({ contentType, bytes: file.size, width: bitmap.width, height: bitmap.height });
    if (!plan.ok) throw new HeroUploadPrepError(plan.code, plan.message);

    if (!plan.reencode) {
      // Send the original bytes; an untyped file gets the type its name says.
      const blob = file.type === contentType ? file : new Blob([file], { type: contentType });
      return { blob, name: file.name, reencoded: false, width: plan.width, height: plan.height };
    }

    const canvas = drawScaled(bitmap, plan.width, plan.height);
    for (const quality of CLIENT_JPEG_QUALITIES) {
      const blob = await toJpeg(canvas, quality);
      if (!blob) return fail("unreadable");
      if (blob.size <= HERO_UPLOAD_MAX_BYTES) {
        return { blob, name: file.name, reencoded: true, width: plan.width, height: plan.height };
      }
    }
    return fail("too_large");
  } finally {
    bitmap.close();
  }
}
