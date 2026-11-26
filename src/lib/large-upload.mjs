// Pictures over 4 MB for templates and Rundmails — the rules the browser and
// the server share (pure, tested: large-upload.test.mjs). docs/EMAIL_TEMPLATES.md §7.
//
// The normal upload sends the picture's bytes to POST /api/admin/vorlagen/image
// — at most 4 MB, because Vercel caps a request at 4.5 MB (owner report
// 26.11.2026: the client's 11.5-MB GIF could not be uploaded at all). A larger
// picture goes straight from the browser to the Blob store under a temporary
// name (a short-lived token from /api/admin/vorlagen/image/upload-token that
// allows exactly that name, picture types, at most 25 MB), then
// /api/admin/vorlagen/image/from-upload processes it like any upload —
// scaled, an animated GIF shrunk to 2 MB — and deletes the temporary file.
// Leftovers of an upload that never got processed are swept after an hour.

/** The normal upload's limit (the bytes in one request) — above it the picture goes straight to the Blob store. */
export const LARGE_UPLOAD_FROM_BYTES = 4_000_000;
/** The largest picture taken at all. */
export const LARGE_UPLOAD_MAX_BYTES = 25_000_000;
/** Where the temporary files live — never served, never read or deleted outside it. */
export const LARGE_UPLOAD_PREFIX = "template-upload-tmp/";
/** The types taken (the picture field's `accept`). */
export const LARGE_UPLOAD_CONTENT_TYPES = Object.freeze(["image/gif", "image/jpeg", "image/png", "image/webp"]);
/** How long an upload token is valid. */
export const LARGE_UPLOAD_TOKEN_MS = 15 * 60 * 1000;
/** A temporary file older than this was never processed (the window was closed) — it is swept. */
export const LARGE_UPLOAD_STALE_MS = 60 * 60 * 1000;

/** @type {Readonly<Record<string, string>>} */
const EXTENSIONS = Object.freeze({ "image/gif": "gif", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" });

/**
 * A temporary file's pathname, as the browser asks for it (`id`: random,
 * e.g. crypto.randomUUID()) — or as the Blob store answers, with its random
 * suffix („…-Xy12AbC.gif“). Nothing but these is ever read or deleted.
 */
const PATHNAME_RE = /^template-upload-tmp\/[a-z0-9][a-z0-9-]{7,63}(?:-[A-Za-z0-9]{1,40})?\.(?:gif|jpg|png|webp)$/;

/**
 * The temporary pathname to upload a picture of `contentType` to; null for a
 * type that is not taken or an id that is too short.
 * @param {unknown} id  random (crypto.randomUUID())
 * @param {unknown} contentType
 * @returns {string | null}
 */
export function largeUploadPathname(id, contentType) {
  const ext = EXTENSIONS[String(contentType ?? "").toLowerCase()];
  const safe = String(id ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+/, "")
    .slice(0, 64);
  if (!ext || safe.length < 8) return null;
  return `${LARGE_UPLOAD_PREFIX}${safe}.${ext}`;
}

/**
 * Is this the pathname of a temporary upload?
 * @param {unknown} pathname
 * @returns {pathname is string}
 */
export function isLargeUploadPathname(pathname) {
  return typeof pathname === "string" && PATHNAME_RE.test(pathname);
}

/**
 * Which way a picture goes: the normal upload (≤ 4 MB), straight to the
 * Blob store (≤ 25 MB, a type that is taken) — or not at all, with the
 * German message.
 * @param {number} size  bytes
 * @param {string} type  the file's MIME type
 * @returns {{ route: "normal" } | { route: "large" } | { route: "refuse", message: string }}
 */
export function largeUploadRoute(size, type) {
  if (size <= LARGE_UPLOAD_FROM_BYTES) return { route: "normal" };
  const gif = type === "image/gif";
  if (!LARGE_UPLOAD_CONTENT_TYPES.includes(type)) {
    return { route: "refuse", message: "Höchstens 4 MB — bitte verkleinern." };
  }
  if (size > LARGE_UPLOAD_MAX_BYTES) {
    return {
      route: "refuse",
      message: gif
        ? "Höchstens 25 MB — das GIF bitte kürzer, schmaler oder mit weniger Einzelbildern exportieren."
        : "Höchstens 25 MB — bitte verkleinern.",
    };
  }
  return { route: "large" };
}

/**
 * The temporary files to sweep: under the prefix, uploaded more than
 * LARGE_UPLOAD_STALE_MS ago.
 * @param {ReadonlyArray<{ pathname: string, url: string, uploadedAt: Date | string }>} blobs
 * @param {number} now  ms
 * @returns {string[]}  their URLs
 */
export function staleLargeUploads(blobs, now) {
  return blobs
    .filter((b) => isLargeUploadPathname(b.pathname) && now - new Date(b.uploadedAt).getTime() > LARGE_UPLOAD_STALE_MS)
    .map((b) => b.url);
}
