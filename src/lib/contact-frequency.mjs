// Contact frequency — a SOFT warning before a marketing mail goes to a person
// who already received several in a short time (owner, 12.10.2026). Pure, no
// I/O: the setting's parsing and bounds, the threshold rule and the German
// texts the desk, Kunden → Marketing, the send routes and Einstellungen share.
//
//   - Setting (admin_settings key 'contact_frequency', migration 0078):
//     { maxMails, windowDays }, default 3 mails in 30 days — the warning shows
//     when the person ALREADY received maxMails or more in the last windowDays
//     days, i.e. before the 4th. 0 in either field switches it off (house
//     rule: 0 disables, never "everything"). Out of bounds / broken → default.
//   - Counted (admin-settings-store.countRecentMarketingMails): campaign_sends
//     with is_test = false (every campaign incl. Einzelansprache and the copy
//     path) + marketing_sends with status 'sent', matched by e-mail OR
//     customer id. Not counted: DOI, chat summary, correspondence replies,
//     test sends, letters — never read from email_messages.
//   - A warning only: the operator can always send anyway (the routes take
//     `ignoreContactFrequency: true` after the confirm). It is NOT a send gate
//     and differs from the hard cap MARKETING_MIN_SEND_INTERVAL_DAYS (a
//     refusal while the last send is too recent). Test contacts never warn;
//     the release cron and sample sends never check it.

import { num, plural } from "./admin-format.mjs";

/** @typedef {{ maxMails: number, windowDays: number }} ContactFrequencySettings */
/** @typedef {{ count: number, maxMails: number, windowDays: number }} ContactFrequencyWarning */

/** The admin_settings key (migration 0078). */
export const CONTACT_FREQUENCY_KEY = "contact_frequency";

/** @type {Readonly<ContactFrequencySettings>} */
export const DEFAULT_CONTACT_FREQUENCY = Object.freeze({ maxMails: 3, windowDays: 30 });

/** Inclusive bounds per field; 0 switches the warning off. */
export const CONTACT_FREQUENCY_LIMITS = Object.freeze({
  maxMails: Object.freeze({ min: 0, max: 50 }),
  windowDays: Object.freeze({ min: 0, max: 365 }),
});

/** The review check's key on the Kampagne desk (campaign-review-checks.mjs). */
export const CONTACT_FREQUENCY_CHECK = "contact_frequency";

/** The error code of the routes' 409 answer. */
export const CONTACT_FREQUENCY_ERROR = "contact_frequency";

/**
 * A whole number within [min, max] from a number or a digit string, else null.
 * @param {unknown} value
 * @param {{ min: number, max: number }} bounds
 * @returns {number | null}
 */
function boundedInt(value, { min, max }) {
  let n = null;
  if (typeof value === "number") n = value;
  else if (typeof value === "string" && /^\s*\d+\s*$/.test(value)) n = Number(value.trim());
  if (n === null || !Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

/** @param {unknown} value @returns {Record<string, unknown> | null} */
function asObject(value) {
  let v = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : null;
}

/**
 * The stored setting (JSONB object or its JSON text) → settings. Fail-soft:
 * every field that is missing, not a whole number or out of bounds takes its
 * default, so a broken row never switches the warning off by accident.
 * @param {unknown} value
 * @returns {ContactFrequencySettings}
 */
export function parseContactFrequency(value) {
  const obj = asObject(value) ?? {};
  return {
    maxMails: boundedInt(obj.maxMails, CONTACT_FREQUENCY_LIMITS.maxMails) ?? DEFAULT_CONTACT_FREQUENCY.maxMails,
    windowDays: boundedInt(obj.windowDays, CONTACT_FREQUENCY_LIMITS.windowDays) ?? DEFAULT_CONTACT_FREQUENCY.windowDays,
  };
}

/**
 * Strict check of a NEW value (the Einstellungen route body): both fields
 * required, whole numbers within the bounds. Never falls back to a default —
 * the operator gets a German message instead.
 * @param {unknown} value
 * @returns {{ ok: true, settings: ContactFrequencySettings } | { ok: false, message: string }}
 */
export function validateContactFrequencyInput(value) {
  const obj = asObject(value);
  const { maxMails: mailBounds, windowDays: dayBounds } = CONTACT_FREQUENCY_LIMITS;
  const maxMails = obj ? boundedInt(obj.maxMails, mailBounds) : null;
  if (maxMails === null) {
    return {
      ok: false,
      message: `„Warnung ab“ muss eine ganze Zahl von ${mailBounds.min} bis ${mailBounds.max} sein (0 = aus).`,
    };
  }
  const windowDays = obj ? boundedInt(obj.windowDays, dayBounds) : null;
  if (windowDays === null) {
    return {
      ok: false,
      message: `„Zeitraum“ muss eine ganze Zahl von ${dayBounds.min} bis ${dayBounds.max} Tagen sein (0 = aus).`,
    };
  }
  return { ok: true, settings: { maxMails, windowDays } };
}

/**
 * Is the warning switched on? (0 in either field = off.)
 * @param {Partial<ContactFrequencySettings> | null | undefined} settings
 */
export function contactFrequencyEnabled(settings) {
  const s = parseContactFrequency(settings ?? undefined);
  return s.maxMails > 0 && s.windowDays > 0;
}

/**
 * The warning for one recipient, or null: off, unknown count (a failed count
 * never warns) or below the threshold. At/over the threshold — the person
 * already received `maxMails` or more marketing mails in the window.
 * @param {{ count: number | null | undefined, settings: Partial<ContactFrequencySettings> | null | undefined }} input
 * @returns {ContactFrequencyWarning | null}
 */
export function contactFrequencyWarning({ count, settings }) {
  const s = parseContactFrequency(settings ?? undefined);
  if (s.maxMails <= 0 || s.windowDays <= 0) return null;
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) return null;
  if (count < s.maxMails) return null;
  return { count, maxMails: s.maxMails, windowDays: s.windowDays };
}

// ── German texts ──────────────────────────────────────────────────────────

/** "1 Werbe-Mail" / "3 Werbe-Mails". @param {number} count */
export function marketingMailsText(count) {
  return plural(count, "Werbe-Mail", "Werbe-Mails");
}

/** "in 30 Tagen" / "in 1 Tag" (a count in a window). @param {number} days */
function inDays(days) {
  return `in ${plural(days, "Tag", "Tagen")}`;
}

/** "in den letzten 30 Tagen" / "am letzten Tag". @param {number} days */
function lastDays(days) {
  return days === 1 ? "am letzten Tag" : `in den letzten ${num(days)} Tagen`;
}

/**
 * The fact as a short line — "3 Werbe-Mails in 30 Tagen" (desk „Letzte Mail“,
 * Kunden → Marketing).
 * @param {number} count
 * @param {number} windowDays
 */
export function recentMailsText(count, windowDays) {
  return `${marketingMailsText(count)} ${inDays(windowDays)}`;
}

/**
 * The review hint's title — „Schon 3 Werbe-Mails in 30 Tagen“.
 * @param {ContactFrequencyWarning} w
 */
export function contactFrequencyTitle(w) {
  return `Schon ${recentMailsText(w.count, w.windowDays)}`;
}

/**
 * The confirm question — „Schon 3 Werbe-Mails in den letzten 30 Tagen an diese
 * Adresse — trotzdem senden?“
 * @param {ContactFrequencyWarning} w
 */
export function contactFrequencyQuestion(w) {
  return `Schon ${marketingMailsText(w.count)} ${lastDays(w.windowDays)} an diese Adresse — trotzdem senden?`;
}

/** What counts — the one explanation (review hint, InfoTips, confirm). */
export const CONTACT_FREQUENCY_COUNTED =
  "Gezählt werden alle Kampagnen-Mails (auch Einzelansprache und Kopier-Versand) und gesendete Marketing-Mails an diese Adresse oder diese Person. Nicht gezählt: Testmails, Anmelde-Bestätigung (DOI), Chat-Zusammenfassung, Antworten aus der Korrespondenz und Briefe.";

/** The review hint's detail. */
export const CONTACT_FREQUENCY_HINT_DETAIL = `Nur ein Hinweis — Senden bleibt möglich. ${CONTACT_FREQUENCY_COUNTED}`;

/**
 * The routes' 409 message (German, with the numbers).
 * @param {ContactFrequencyWarning} w
 */
export function contactFrequencyMessage(w) {
  return `Diese Adresse hat ${lastDays(w.windowDays)} schon ${marketingMailsText(w.count)} bekommen (Warnung ab ${num(w.maxMails)}, Einstellungen → Kontakthäufigkeit). Nur ein Hinweis — nach Bestätigung kann trotzdem gesendet werden.`;
}

/**
 * The setting in one line — „Warnung ab 3 Werbe-Mails in 30 Tagen“ / „Aus“.
 * @param {Partial<ContactFrequencySettings> | null | undefined} settings
 */
export function contactFrequencySummary(settings) {
  const s = parseContactFrequency(settings ?? undefined);
  if (!contactFrequencyEnabled(s)) return "Aus";
  return `Warnung ab ${marketingMailsText(s.maxMails)} ${inDays(s.windowDays)}`;
}

/**
 * The hard cap's read-only label next to the warning setting —
 * MARKETING_MIN_SEND_INTERVAL_DAYS: „aus“ / „1 Tag“ / „14 Tage“.
 * @param {number} days
 */
export function sendIntervalLabel(days) {
  const n = Number(days);
  return Number.isFinite(n) && n > 0 ? plural(n, "Tag", "Tage") : "aus";
}

// ── the routes' 409 answer ────────────────────────────────────────────────

/**
 * The JSON body the send routes answer with (status 409) when the warning
 * applies and the request did not carry `ignoreContactFrequency: true`:
 * the usual error envelope plus the numbers for the client's confirm.
 * @param {ContactFrequencyWarning} w
 */
export function contactFrequencyConflict(w) {
  return {
    error: { code: CONTACT_FREQUENCY_ERROR, message: contactFrequencyMessage(w) },
    frequency: { count: w.count, maxMails: w.maxMails, windowDays: w.windowDays },
  };
}

/**
 * The numbers from such a 409 body (AdminApiError.details on the client), or
 * null when the body is anything else.
 * @param {unknown} body
 * @returns {ContactFrequencyWarning | null}
 */
export function readContactFrequencyConflict(body) {
  const b = /** @type {{ error?: { code?: unknown }, frequency?: Record<string, unknown> } | null} */ (
    body && typeof body === "object" ? body : null
  );
  if (!b || !b.error || b.error.code !== CONTACT_FREQUENCY_ERROR) return null;
  const f = b.frequency && typeof b.frequency === "object" ? b.frequency : {};
  const count = Number(f.count);
  const maxMails = Number(f.maxMails);
  const windowDays = Number(f.windowDays);
  if (![count, maxMails, windowDays].every((n) => Number.isInteger(n) && n >= 0)) return null;
  return { count, maxMails, windowDays };
}
