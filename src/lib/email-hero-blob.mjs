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
 * The key kind of a campaign's uploaded default hero („Kampagnenbild“,
 * lib/campaign-hero.mjs): `campaign-default-<campaignId|new>-<stamp>…`. One
 * file is shared by EVERY mail of the campaign, so it must never be deleted
 * with one person's data (erasableHeroPathnames) — and it can never be
 * confused with a per-draft `campaign-<contactId>-…` file.
 */
export const CAMPAIGN_DEFAULT_HERO_KIND = "campaign-default";

/**
 * Storage key for one hero file (a random suffix is appended by the blob
 * SDK, so URLs are not enumerable). `kind` is "marketing" / "campaign" for a
 * per-draft hero (`id` = the send / contact id) or CAMPAIGN_DEFAULT_HERO_KIND.
 * `variant` distinguishes the files of one render (e.g. "mobile" for the
 * phone crop), `ext` the encoding ("png" or "jpg" — heroes are stored as JPEG
 * since the mobile variant shipped), `stamp` the millisecond timestamp — pass
 * the same one for the files of one render so they stay recognisably a pair
 * (default: now).
 * @param {string} kind
 * @param {number | string} id
 * @param {{ variant?: string, ext?: "png" | "jpg", stamp?: number }} [opts]
 */
export function heroBlobKey(kind, id, opts = {}) {
  const variant = opts.variant ? `-${opts.variant}` : "";
  const ext = opts.ext === "jpg" ? "jpg" : "png";
  const stamp = Number.isSafeInteger(opts.stamp) && Number(opts.stamp) > 0 ? opts.stamp : Date.now();
  return `${HERO_BLOB_PREFIX}${kind}-${id}-${stamp}${variant}.${ext}`;
}

/**
 * Is this hero file (or blob pathname) a campaign's shared default picture?
 * @param {unknown} fileOrPathname
 * @returns {boolean}
 */
export function isCampaignDefaultHeroFile(fileOrPathname) {
  if (typeof fileOrPathname !== "string") return false;
  return heroBlobFileFromPathname(fileOrPathname).startsWith(`${CAMPAIGN_DEFAULT_HERO_KIND}-`);
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

/**
 * The blob pathname behind a stored hero URL (the inverse of
 * heroImagePublicUrl) — what erasure hands to Blob `del`. Null for anything
 * that is not one of our hero URLs (the default image, a foreign URL, junk),
 * so erasure can never delete an unrelated blob.
 * @param {unknown} url
 * @returns {string | null}
 */
export function heroBlobPathnameFromUrl(url) {
  if (typeof url !== "string" || !url) return null;
  const marker = "/api/email-hero-image/";
  const idx = url.indexOf(marker);
  if (idx < 0) return null;
  const file = parseHeroBlobFile(url.slice(idx + marker.length).split(/[?#]/)[0]);
  return file ? heroBlobPathname(file) : null;
}

/**
 * The blob pathnames erasure may delete for one person: the hero URLs of
 * their drafts and sends, deduplicated, without anything that is not one of
 * our hero files — and NEVER a campaign's shared default picture (a
 * `campaign-default-…` file is resolved at render time and not copied into
 * per-person rows, but if one ever got there, erasing one recipient must not
 * break the picture in every other mail of the campaign).
 * @param {Iterable<unknown>} urls
 * @returns {string[]}
 */
export function erasableHeroPathnames(urls) {
  const out = new Set();
  for (const url of urls ?? []) {
    const path = heroBlobPathnameFromUrl(url);
    if (path && !isCampaignDefaultHeroFile(path)) out.add(path);
  }
  return [...out];
}
