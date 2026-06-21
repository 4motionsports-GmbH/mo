// Typed locale surface for the TS side of the backend. The runtime lives in
// locale.mjs (pure, node:test-able, shared with the `*-core.mjs` copy modules);
// this module adds the `Locale` type and a request-resolution helper used by
// the storefront-facing routes.

import { DEFAULT_LOCALE, isLocale, normalizeLocale, pick } from "./locale.mjs";

export type Locale = "de" | "en";

export { DEFAULT_LOCALE, isLocale, normalizeLocale, pick };

/**
 * Resolve the effective locale for a request, in priority order:
 *   1. an explicit value (e.g. a `locale` field already parsed from the JSON
 *      body of a POST),
 *   2. the `?locale=` query parameter (used by the GET endpoints clicked from
 *      emails / opened as forms),
 *   3. the `x-ms-locale` request header (a stable signal the widget can set
 *      once for every call),
 * defaulting to German. Every step is fail-soft via `normalizeLocale`, so a
 * malformed value never throws and never escalates past German.
 */
export function resolveLocale(
  req: Request,
  explicit?: unknown
): Locale {
  if (explicit !== undefined && explicit !== null && explicit !== "") {
    return normalizeLocale(explicit);
  }
  try {
    const qp = new URL(req.url).searchParams.get("locale");
    if (qp) return normalizeLocale(qp);
  } catch {
    // Non-absolute URL (shouldn't happen for a real Request) — ignore.
  }
  const header = req.headers.get("x-ms-locale");
  if (header) return normalizeLocale(header);
  return DEFAULT_LOCALE;
}
