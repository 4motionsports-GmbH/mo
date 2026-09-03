// Storage keys and public URLs for the generated hero images.
//
// WHY A ROUTE INSTEAD OF A PUBLIC BLOB URL: this deployment's Vercel Blob store
// is PRIVATE — it holds the product catalog and the embeddings, which must not
// be world-readable — and a private store rejects `access: "public"` writes
// outright. Mail clients, on the other hand, fetch hero images anonymously from
// the recipient's inbox, so the image needs SOME public URL.
//
// So the image is written privately like everything else, and served through
// our own public route (/api/email-hero-image/<file>), which reads the blob
// server-side with the store token and streams it back with a long immutable
// cache. The route may therefore only ever reach files under the hero prefix —
// hence the strict filename validation here, which is the security boundary
// that keeps the catalog blobs unreachable.
//
// Pure .mjs so the validation is unit-tested under node --test.

/** Every hero image lives under this prefix; the route can reach nothing else. */
export const HERO_BLOB_PREFIX = "email-heroes/";

/**
 * Storage key for a freshly generated hero (a random suffix is appended by the
 * blob SDK, so URLs are not enumerable).
 *
 * @param {"marketing" | "campaign"} kind
 * @param {number} id
 * @returns {string}
 */
/**
 * Storage key for one hero file. `variant` distinguishes the files of one
 * render (e.g. "mobile" for the phone crop), `ext` the encoding ("png" or
 * "jpg" — heroes are stored as JPEG since the mobile variant shipped).
 * @param {string} kind
 * @param {number} id
 * @param {{ variant?: string, ext?: "png" | "jpg" }} [opts]
 */
export function heroBlobKey(kind, id, opts = {}) {
  const variant = opts.variant ? `-${opts.variant}` : "";
  const ext = opts.ext === "jpg" ? "jpg" : "png";
  return `${HERO_BLOB_PREFIX}${kind}-${id}-${Date.now()}${variant}.${ext}`;
}

/** The MIME type a hero file is served with, from its extension. */
export function heroBlobContentType(file) {
  return /\.jpe?g$/i.test(String(file ?? "")) ? "image/jpeg" : "image/png";
}

/**
 * Validate the single path segment the public route receives. Returns the
 * filename, or null when it is anything other than a plain hero PNG name.
 *
 * Rejects separators and traversal outright: the pathname handed to the blob
 * store is built as `${HERO_BLOB_PREFIX}${file}`, so a value containing "/",
 * "\" or ".." must never pass — that is what stops the route from being turned
 * into a reader for the private catalog blobs.
 *
 * @param {unknown} file
 * @returns {string | null}
 */
export function parseHeroBlobFile(file) {
  if (typeof file !== "string") return null;
  let decoded = file;
  try {
    decoded = decodeURIComponent(file);
  } catch {
    return null;
  }
  if (decoded.includes("/") || decoded.includes("\\") || decoded.includes("..")) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(png|jpe?g)$/i.test(decoded)) return null;
  return decoded;
}

/**
 * The blob pathname for a validated filename.
 * @param {string} file
 * @returns {string}
 */
export function heroBlobPathname(file) {
  return `${HERO_BLOB_PREFIX}${file}`;
}

/**
 * The file part of a blob pathname (what the public URL carries).
 * @param {string} pathname
 * @returns {string}
 */
export function heroBlobFileFromPathname(pathname) {
  const s = String(pathname ?? "");
  const idx = s.lastIndexOf("/");
  return idx >= 0 ? s.slice(idx + 1) : s;
}

/**
 * The public, mail-client-fetchable URL of a stored hero image.
 * @param {string} baseUrl  Absolute deployment base URL (no trailing slash).
 * @param {string} file
 * @returns {string}
 */
export function heroImagePublicUrl(baseUrl, file) {
  return `${baseUrl}/api/email-hero-image/${encodeURIComponent(file)}`;
}
