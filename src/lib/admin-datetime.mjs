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

import { STORE_TIME_ZONE } from "./store-datetime.mjs";

/**
 * The store's timezone — every admin timestamp is rendered in it. Re-exported
 * from store-datetime.mjs so the back-office and the customer-facing dates can
 * never drift onto different zones.
 */
export const ADMIN_TIME_ZONE = STORE_TIME_ZONE;

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
/** Montag, 31.08.2026, 22:40 — a planned moment with its weekday (a send must
 * never be read on the wrong day). */
/** @type {Intl.DateTimeFormatOptions} */
export const ADMIN_WEEKDAY_DATE_TIME = {
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

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

// ── <input type="datetime-local"> in the store's timezone ────────────────────
// A datetime-local value has no zone. The operator plans in Berlin time
// whatever zone the browser runs in (a laptop on travel, a VM in UTC), so the
// admin never lets the browser read it: these two convert explicitly.

const BERLIN_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: ADMIN_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Berlin wall-clock parts of an instant (strings, zero-padded). @param {number} ms */
function berlinParts(ms) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const p of BERLIN_PARTS.formatToParts(new Date(ms))) out[p.type] = p.value;
  return out;
}

/** Berlin's UTC offset at an instant, in ms. @param {number} ms */
function berlinOffsetMs(ms) {
  const p = berlinParts(ms);
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  return wall - Math.floor(ms / 60_000) * 60_000;
}

/**
 * The value of an `<input type="datetime-local">` for an instant, as Berlin
 * wall time („2026-11-28T08:00“). "" for absent or unparseable input.
 *
 * @param {string | number | Date | null | undefined} value
 * @returns {string}
 */
export function toBerlinInputValue(value) {
  const d = toAdminDate(value);
  if (!d) return "";
  const p = berlinParts(d.getTime());
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/**
 * A datetime-local value read as Berlin wall time → the ISO instant
 * („2026-11-28T08:00“ → "2026-11-28T07:00:00.000Z"), or null for anything
 * that is not a real date and time. Summer and winter time are handled; a
 * time the spring switch skips (02:30 on the last Sunday of March) becomes
 * the same wall time one hour later (03:30), the doubled hour of the autumn
 * switch its second occurrence (winter time).
 *
 * @param {unknown} input
 * @returns {string | null}
 */
export function fromBerlinInputValue(input) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d{1,3})?)?$/.exec(String(input ?? "").trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1, 6).map(Number);
  if (mo < 1 || mo > 12 || h > 23 || mi > 59) return null;
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(naive);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  // Start from the naive instant and correct by Berlin's offset there; the
  // second pass settles the instants next to a switch.
  let guess = naive;
  for (let i = 0; i < 2; i++) guess = naive - berlinOffsetMs(guess);
  return new Date(guess).toISOString();
}
