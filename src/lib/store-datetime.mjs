// The store's timezone, and how a timestamp is rendered for HUMANS in it
// (pure, no I/O — plain .mjs so it is unit-testable with node:test, per the
// locale.mjs convention).
//
// WHY THIS EXISTS — a date is not a timestamp.
//
// Orders, sessions and discount deadlines are stored as UTC instants, but a
// customer reading "deine Bestellung vom 31.8." means the calendar day in
// THEIR day, which is the store's day: Europe/Berlin. Formatting such an
// instant without a timezone inherits it from the host, and every backend host
// we run on is UTC — so an order placed at 00:30 Berlin time on 1 September is
// still 31 August in UTC and gets described to the customer as the wrong day.
// The window is every night between 00:00 and 02:00 Berlin time (01:00–02:00
// in winter), which is small but not rare across a whole order history.
//
// So: pin the timezone, never inherit it. 4motionsports is operated from
// Germany, which makes Europe/Berlin both the deterministic and the correct
// answer, and it handles CET/CEST automatically.
//
// This is the single source of truth for that decision. Its consumers:
//   - the AI prompt builders (marketing-draft, campaign-draft,
//     customer-profile, bundle-suggestion) — dates the model then repeats in
//     customer-facing prose,
//   - shopify-discounts.ts — the customer-facing discount expiry date,
//   - admin-datetime.mjs — the back-office UI, which pins the same zone for
//     the additional reason that a naive format breaks React hydration.

/** The timezone the shop is operated in — every human-facing date uses it. */
export const STORE_TIME_ZONE = "Europe/Berlin";

/**
 * The plain numeric date shape: "31.8.2026" for de-DE, "31/08/2026" for en-GB.
 * Matches what a bare toLocaleDateString(locale) produces, so pinning the
 * timezone changes the DAY when it was wrong and nothing else.
 * @type {Intl.DateTimeFormatOptions}
 */
export const STORE_DATE = { day: "numeric", month: "numeric", year: "numeric" };

/**
 * Coerce a stored timestamp to a valid Date, or null. Accepts an ISO string, a
 * Date or epoch milliseconds; null, undefined, "" and unparseable input all
 * yield null so callers render their own "unknown date" wording rather than
 * leaking "Invalid Date" into an AI prompt.
 *
 * @param {string | number | Date | null | undefined} value
 * @returns {Date | null}
 */
export function toStoreDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Render a stored instant as the calendar date it falls on IN THE STORE's
 * timezone.
 *
 * @param {string | number | Date | null | undefined} value
 * @param {string} [locale] BCP-47 tag — "de-DE" (default) or "en-GB".
 * @param {string} [fallback] returned for absent/unparseable input.
 * @returns {string}
 */
export function formatStoreDate(value, locale = "de-DE", fallback = "") {
  const d = toStoreDate(value);
  if (!d) return fallback;
  return d.toLocaleDateString(locale, { ...STORE_DATE, timeZone: STORE_TIME_ZONE });
}
