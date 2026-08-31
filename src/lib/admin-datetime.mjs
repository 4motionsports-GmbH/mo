// Deterministic date/time formatting for the admin back-office (pure, no I/O —
// plain .mjs so it is unit-testable with node:test, per the locale.mjs /
// consent-copy-version.mjs convention).
//
// WHY THIS EXISTS — hydration safety.
//
// /admin is `force-dynamic`: every tab body is rendered on the SERVER and the
// client components are then hydrated in the operator's browser. A bare
// `new Date(iso).toLocaleString("de-DE")` resolves the timezone from the host,
// which is NOT the same on both sides:
//
//   server (Vercel/Node, TZ=UTC)      → "31.8.2026, 22:40:00"
//   browser (operator, Europe/Berlin) → "1.9.2026, 00:40:00"
//
// React sees two different strings for the same node and throws a hydration
// mismatch (the minified "React error #418"), discards the server HTML and
// re-renders the subtree on the client. Note the DATE alone flips too — any
// instant after 22:00 UTC lands on the next day in Berlin — so date-only
// renders are just as unsafe as ones that print a clock time.
//
// The fix is to pin the timezone instead of inheriting it, exactly like
// shopify-discounts.ts already does for customer-facing expiry dates: the shop
// is operated from Germany, so Europe/Berlin is both the deterministic AND the
// correct answer. The server now renders the same string the operator's
// browser does — output in the browser is unchanged, only the server catches up.
//
// Every admin component formats through here; a bare toLocale*String on a Date
// in the admin tree is a bug.

/** The store's timezone — every admin timestamp is rendered in it. */
export const ADMIN_TIME_ZONE = "Europe/Berlin";

/** What an absent or unparseable timestamp renders as. */
export const ADMIN_EMPTY = "—";

// ── Option presets ────────────────────────────────────────────────────────────
// One preset per shape used in the admin UI, so call sites stay readable and
// two panels showing the same kind of timestamp cannot drift apart.

/** 31.8.2026 — the de-DE default (matches a bare toLocaleDateString). */
/** @type {Intl.DateTimeFormatOptions} */
export const ADMIN_DATE = { day: "numeric", month: "numeric", year: "numeric" };
/** 31.08.2026 — zero-padded, for table columns that should align. */
/** @type {Intl.DateTimeFormatOptions} */
export const ADMIN_DATE_PADDED = { day: "2-digit", month: "2-digit", year: "numeric" };
/** 31. Aug. 2026 — written month, for prose-y captions. */
/** @type {Intl.DateTimeFormatOptions} */
export const ADMIN_DATE_MEDIUM = { dateStyle: "medium" };
/** 31.08. — chart axis ticks (no year). */
/** @type {Intl.DateTimeFormatOptions} */
export const ADMIN_DAY_MONTH = { day: "2-digit", month: "2-digit" };
/** 31.08.2026, 22:40 */
/** @type {Intl.DateTimeFormatOptions} */
export const ADMIN_DATE_TIME_PADDED = {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};
/** 31. Aug. 2026, 22:40 */
/** @type {Intl.DateTimeFormatOptions} */
export const ADMIN_DATE_TIME_MEDIUM = { dateStyle: "medium", timeStyle: "short" };
/** 31.08.26, 22:40 */
/** @type {Intl.DateTimeFormatOptions} */
export const ADMIN_DATE_TIME_SHORT = { dateStyle: "short", timeStyle: "short" };
/** 22:40 */
/** @type {Intl.DateTimeFormatOptions} */
export const ADMIN_TIME = { hour: "2-digit", minute: "2-digit" };
/** 31.8.2026, 22:40:00 — the de-DE default (matches a bare toLocaleString). */
/** @type {Intl.DateTimeFormatOptions} */
export const ADMIN_DATE_TIME_FULL = {};

/**
 * Coerce an admin timestamp to a valid Date, or null.
 * Accepts an ISO string, a Date, or an epoch-millisecond number; null,
 * undefined, "" and unparseable values all yield null so callers can render
 * the empty dash instead of "Invalid Date".
 *
 * @param {string | number | Date | null | undefined} value
 * @returns {Date | null}
 */
export function toAdminDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Format an admin timestamp in the store's timezone — identical on the server
 * and in the browser, so it is safe to render during hydration.
 *
 * @param {string | number | Date | null | undefined} value
 * @param {Intl.DateTimeFormatOptions} [options] one of the ADMIN_* presets
 * @param {string} [fallback] rendered when `value` is absent/unparseable
 * @returns {string}
 */
export function formatAdmin(value, options = ADMIN_DATE, fallback = ADMIN_EMPTY) {
  const d = toAdminDate(value);
  if (!d) return fallback;
  return d.toLocaleString("de-DE", { ...options, timeZone: ADMIN_TIME_ZONE });
}
