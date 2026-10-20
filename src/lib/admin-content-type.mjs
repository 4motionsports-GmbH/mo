// Which request Content-Types an admin POST accepts — the CSRF half of
// guardAdminPost (lib/admin-api.ts). Pure and tested.
//
// The admin session cookie is the only credential and it is SameSite=Lax;
// the storefront (www.motionsports.de) and the admin (mo.motionsports.de)
// are the SAME site, so a request a storefront page makes still carries the
// cookie. What stops it is the CORS preflight: a browser sends a cross-origin
// request without one only when its Content-Type essence is CORS-safelisted
// (text/plain, multipart/form-data, application/x-www-form-urlencoded).
// Every other type needs a preflight, which the admin never answers — so only
// same-origin fetch() calls get through.
//
//   * default (no `accept`): the historical rule — the header contains
//     "application/json" — byte-for-byte unchanged for every existing route;
//   * with `accept`: the media type (before any ";" parameters) must equal one
//     entry EXACTLY, and a safelisted type is refused even if a caller lists
//     one — a binary upload (image/jpeg …) keeps the same protection.

/** Content-Types a browser sends cross-origin WITHOUT a preflight. */
export const CORS_SAFELISTED_CONTENT_TYPES = /** @type {const} */ ([
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "text/plain",
]);

/**
 * The media type of a Content-Type header: before any parameters, trimmed,
 * lower-case ("" when absent).
 * @param {unknown} header
 * @returns {string}
 */
export function mediaTypeOf(header) {
  return String(header ?? "").split(";")[0].trim().toLowerCase();
}

/**
 * @param {string | null | undefined} header the request's Content-Type
 * @param {readonly string[] | null | undefined} [accept] exact media types; omitted = JSON (legacy rule)
 * @returns {boolean}
 */
export function isAcceptedAdminContentType(header, accept) {
  if (accept == null) return String(header ?? "").toLowerCase().includes("application/json");
  const type = mediaTypeOf(header);
  if (!type || CORS_SAFELISTED_CONTENT_TYPES.includes(/** @type {any} */ (type))) return false;
  return accept.some((a) => mediaTypeOf(a) === type);
}
