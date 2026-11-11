// prepareDesignerAttachment — the browser step of an attachment for the AI
// designer („KI-Gestalter“, DesignerPanel): read the picked, dropped or
// pasted file and turn it into what POST /api/admin/vorlagen/assist takes —
// `{ name, mediaType, data: base64 }` — under the rules of
// lib/mail-designer-attachments.mjs:
//
//   · pictures are decoded with their EXIF orientation applied and, unless a
//     GIF or a really transparent PNG is small enough to go as it is, drawn
//     at most 1400 px wide (tall screenshots stay tall) and re-encoded as
//     JPEG 0.85 on white — a very detailed one at a lower quality until it
//     fits imageTargetBytes;
//   · PDFs go as they are (≤ 3 MB, must start with %PDF);
//   · HTML and text files are read as UTF-8 (or Windows-1252) and sent as
//     UTF-8; an e-mail (.eml) goes as its raw bytes — the server reads the
//     MIME parts (≤ 400 KB each).
//
// The server checks every attachment again. Errors are thrown as
// AttachmentPrepError with the German text for a toast.

import { downscaleSteps } from "@/lib/email-hero-upload-client.mjs";
import {
  DESIGNER_ATTACHMENT_LIMITS,
  attachmentSizeProblem,
  designerAttachmentType,
  hasTransparentPixel,
  planImageAttachment,
  pngTransparency,
  readTextAttachment,
  sniffImageType,
  unreadableImageMessage,
  type DesignerMediaType,
} from "@/lib/mail-designer-attachments.mjs";

export class AttachmentPrepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentPrepError";
  }
}

export interface PreparedAttachment {
  name: string;
  mediaType: DesignerMediaType;
  /** base64 of the bytes that are sent */
  data: string;
  /** bytes that are sent (before base64) */
  size: number;
  kind: "image" | "pdf" | "text";
  /** object URL of the sent picture (thumbnail) — revoke when the attachment goes */
  thumbUrl: string | null;
  /** a picture that was shrunk or re-encoded */
  reencoded: boolean;
  /** size of the sent picture in px (null for documents) — the thumbnail fits wide ones whole */
  width: number | null;
  height: number | null;
}

/** base64 of a blob (FileReader — native and fast for megabytes). */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? "").replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error ?? new Error("FileReader"));
    reader.readAsDataURL(blob);
  });
}

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context2d(canvas: HTMLCanvasElement, name: string): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new AttachmentPrepError(unreadableImageMessage(name, null));
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return ctx;
}

/** Free a canvas' pixel memory at once (Safari keeps it until GC otherwise). */
function release(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

/** Does the picture really have transparent pixels? Checked on a small copy (cheap, edges survive). */
function looksTransparent(bitmap: ImageBitmap, name: string): boolean {
  const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = canvasOf(w, h);
  try {
    const ctx = context2d(canvas, name);
    ctx.drawImage(bitmap, 0, 0, w, h);
    return hasTransparentPixel(ctx.getImageData(0, 0, w, h).data);
  } catch (err) {
    if (err instanceof AttachmentPrepError) throw err;
    return false;
  } finally {
    release(canvas);
  }
}

/** Draw the picture at width×height in halving steps (no aliasing), the last step on white. */
function drawScaled(bitmap: ImageBitmap, width: number, height: number, name: string): HTMLCanvasElement {
  const steps = downscaleSteps(bitmap.width, bitmap.height, width, height);
  if (steps.length === 0) steps.push([width, height]);
  let source: CanvasImageSource = bitmap;
  let sw = bitmap.width;
  let sh = bitmap.height;
  let previous: HTMLCanvasElement | null = null;
  for (let i = 0; i < steps.length; i++) {
    const [w, h] = steps[i];
    const next = canvasOf(w, h);
    const ctx = context2d(next, name);
    if (i === steps.length - 1) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(source, 0, 0, sw, sh, 0, 0, w, h);
    release(previous);
    previous = next;
    source = next;
    sw = w;
    sh = h;
  }
  if (!previous) throw new AttachmentPrepError(unreadableImageMessage(name, null));
  return previous;
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", quality));
}

async function prepareImage(file: File, name: string, claimed: string): Promise<PreparedAttachment> {
  const L = DESIGNER_ATTACHMENT_LIMITS;
  const head = await bytesOf(file.slice(0, 64));
  const sniffed = sniffImageType(head);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // The type is right but the browser cannot decode it: broken, or not what
    // its name claims (a HEIC renamed to .jpg), or HEIC in a browser without it.
    throw new AttachmentPrepError(unreadableImageMessage(name, sniffed ?? claimed));
  }
  try {
    let transparent = false;
    if (sniffed === "image/png" && file.size <= L.keepImageBytes) {
      const alpha = pngTransparency(await bytesOf(file));
      transparent = alpha === "alpha" || alpha === "trns" ? looksTransparent(bitmap, name) : false;
    }
    const plan = planImageAttachment({ type: sniffed, bytes: file.size, width: bitmap.width, height: bitmap.height, transparent, name });
    if (!plan.ok) throw new AttachmentPrepError(plan.message);

    if (!plan.reencode) {
      const blob = file.type === plan.mediaType ? file : new Blob([file], { type: plan.mediaType });
      return {
        name,
        mediaType: plan.mediaType,
        data: await blobToBase64(blob),
        size: blob.size,
        kind: "image",
        thumbUrl: URL.createObjectURL(blob),
        reencoded: false,
        width: plan.width,
        height: plan.height,
      };
    }

    const canvas = drawScaled(bitmap, plan.width, plan.height, name);
    try {
      let blob: Blob | null = null;
      for (const quality of L.jpegQualities) {
        blob = await toJpeg(canvas, quality);
        if (!blob) throw new AttachmentPrepError(unreadableImageMessage(name, null));
        if (blob.size <= L.imageTargetBytes) break;
      }
      if (!blob) throw new AttachmentPrepError(unreadableImageMessage(name, null));
      return {
        name,
        mediaType: "image/jpeg",
        data: await blobToBase64(blob),
        size: blob.size,
        kind: "image",
        thumbUrl: URL.createObjectURL(blob),
        reencoded: true,
        width: plan.width,
        height: plan.height,
      };
    } finally {
      release(canvas);
    }
  } finally {
    bitmap.close();
  }
}

async function preparePdf(file: File, name: string): Promise<PreparedAttachment> {
  const head = new TextDecoder("latin1").decode(await bytesOf(file.slice(0, 1024)));
  if (!head.includes("%PDF-")) throw new AttachmentPrepError(`„${name}“ ist keine PDF-Datei.`);
  return {
    name,
    mediaType: "application/pdf",
    data: await blobToBase64(file),
    size: file.size,
    kind: "pdf",
    thumbUrl: null,
    reencoded: false,
    width: null,
    height: null,
  };
}

async function prepareText(file: File, name: string, mediaType: DesignerMediaType): Promise<PreparedAttachment> {
  if (mediaType === "message/rfc822") {
    // The raw message: its MIME parts declare their own charsets and
    // transfer encodings — re-encoding would break them.
    const bytes = await bytesOf(file);
    const check = readTextAttachment(bytes, name);
    if (!check.ok) throw new AttachmentPrepError(check.message);
    return { name, mediaType, data: await blobToBase64(file), size: file.size, kind: "text", thumbUrl: null, reencoded: false, width: null, height: null };
  }
  const read = readTextAttachment(await bytesOf(file), name);
  if (!read.ok) throw new AttachmentPrepError(read.message);
  const utf8 = new Blob([read.text], { type: `${mediaType};charset=utf-8` });
  return { name, mediaType, data: await blobToBase64(utf8), size: utf8.size, kind: "text", thumbUrl: null, reencoded: false, width: null, height: null };
}

/**
 * Prepare one file for the designer. `name` overrides the file name (a
 * pasted picture is called „image.png“ by every browser).
 */
export async function prepareDesignerAttachment(file: File, name: string = file.name || "Anhang"): Promise<PreparedAttachment> {
  const type = designerAttachmentType(file.type, name);
  if (!type.ok) throw new AttachmentPrepError(type.message);
  const tooBig = attachmentSizeProblem(type.kind, type.mediaType, file.size, name);
  if (tooBig) throw new AttachmentPrepError(tooBig);
  try {
    if (type.kind === "image") return await prepareImage(file, name, type.mediaType);
    if (type.kind === "pdf") return await preparePdf(file, name);
    return await prepareText(file, name, type.mediaType as DesignerMediaType);
  } catch (err) {
    if (err instanceof AttachmentPrepError) throw err;
    throw new AttachmentPrepError(`„${name}“ konnte nicht gelesen werden — bitte erneut versuchen.`);
  }
}
