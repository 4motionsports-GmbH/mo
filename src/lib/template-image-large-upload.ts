// Pictures over 4 MB for templates and Rundmails (the rules: large-upload.mjs).
// Vercel caps a request at 4.5 MB, so the browser uploads such a picture
// straight to the Blob store (@vercel/blob/client `upload()`): this file issues
// the token for that one upload and then processes the temporary file — read,
// stored like any upload (storeTemplateImage: scaled, an animated GIF shrunk to
// 2 MB), deleted whatever happened. docs/EMAIL_TEMPLATES.md §7.

import { del, get, list } from "@vercel/blob";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { reportError } from "./observability";
import {
  LARGE_UPLOAD_CONTENT_TYPES,
  LARGE_UPLOAD_MAX_BYTES,
  LARGE_UPLOAD_PREFIX,
  LARGE_UPLOAD_TOKEN_MS,
  isLargeUploadPathname,
  staleLargeUploads,
} from "./large-upload.mjs";
import { storeTemplateImage, type TemplateImageResult } from "./mail-template-image";

export type LargeUploadTokenResult =
  | { ok: true; json: { type: "blob.generate-client-token"; clientToken: string } }
  | { ok: false; status: number; code: string; message: string };

const BAD_PATHNAME = "Ungültiger Dateiname für den Upload — bitte erneut hochladen.";

/**
 * The token for ONE direct upload: exactly the temporary pathname the browser
 * named (large-upload.mjs), a picture type, at most 25 MB, valid 15 minutes,
 * a random suffix, no completion callback (the browser asks for the
 * processing itself). Sweeps temporary files nobody processed first. Never throws.
 */
export async function largeUploadToken(req: Request, body: unknown): Promise<LargeUploadTokenResult> {
  const event = body as HandleUploadBody | null;
  if (!event || typeof event !== "object" || event.type !== "blob.generate-client-token") {
    return { ok: false, status: 400, code: "bad_request", message: "Ungültige Anfrage." };
  }
  if (!isLargeUploadPathname(event.payload?.pathname)) {
    return { ok: false, status: 400, code: "bad_pathname", message: BAD_PATHNAME };
  }
  await sweepStaleLargeUploads();
  try {
    const res = await handleUpload({
      request: req,
      body: event,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: [...LARGE_UPLOAD_CONTENT_TYPES],
        maximumSizeInBytes: LARGE_UPLOAD_MAX_BYTES,
        validUntil: Date.now() + LARGE_UPLOAD_TOKEN_MS,
        addRandomSuffix: true,
      }),
    });
    if (res.type !== "blob.generate-client-token") {
      return { ok: false, status: 400, code: "bad_request", message: "Ungültige Anfrage." };
    }
    return { ok: true, json: res };
  } catch (err) {
    reportError(err, { route: "lib/template-image-large-upload", phase: "token" });
    return { ok: false, status: 500, code: "token_failed", message: "Der Upload konnte nicht vorbereitet werden — bitte erneut versuchen." };
  }
}

/**
 * Process a picture the browser uploaded straight to the Blob store: only a
 * temporary upload's pathname, at most 25 MB, stored like any upload — and
 * the temporary file deleted, whatever happened. Never throws.
 */
export async function storeLargeTemplateImage(pathname: unknown): Promise<TemplateImageResult> {
  if (!isLargeUploadPathname(pathname)) return { ok: false, status: 400, code: "bad_pathname", message: BAD_PATHNAME };
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  try {
    let bytes: Buffer | null;
    try {
      const res = await get(pathname, { access: "private", token, useCache: false });
      if (!res || res.statusCode !== 200) {
        return { ok: false, status: 404, code: "not_found", message: "Die hochgeladene Datei ist nicht mehr da — bitte erneut hochladen." };
      }
      bytes = res.blob.size > LARGE_UPLOAD_MAX_BYTES ? null : await readCapped(res.stream, LARGE_UPLOAD_MAX_BYTES);
    } catch (err) {
      reportError(err, { route: "lib/template-image-large-upload", phase: "read" });
      return { ok: false, status: 502, code: "read_failed", message: "Die hochgeladene Datei konnte nicht gelesen werden — bitte erneut versuchen." };
    }
    if (!bytes) return { ok: false, status: 413, code: "too_large", message: "Das Bild ist größer als 25 MB — bitte verkleinern." };
    return await storeTemplateImage(bytes);
  } finally {
    await del(pathname, { token }).catch((err: unknown) =>
      reportError(err, { route: "lib/template-image-large-upload", phase: "delete" })
    );
  }
}

/** A stream read into one Buffer; null when it is longer than `max`. */
async function readCapped(stream: ReadableStream<Uint8Array>, max: number): Promise<Buffer | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

/** Temporary files an hour old were never processed (the window was closed) — deleted. Best effort. */
async function sweepStaleLargeUploads(): Promise<void> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  try {
    const { blobs } = await list({ prefix: LARGE_UPLOAD_PREFIX, limit: 100, token });
    const stale = staleLargeUploads(blobs, Date.now());
    if (stale.length > 0) await del(stale, { token });
  } catch (err) {
    reportError(err, { route: "lib/template-image-large-upload", phase: "sweep" });
  }
}
