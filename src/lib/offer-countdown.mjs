// The "your offer is still valid for …" countdown in the recommendation
// mails. E-mail cannot run scripts, so the count is a SNAPSHOT taken when the
// mail is rendered (send time; the preview shows the same numbers) — days and
// hours, never minutes, so the snapshot stays true for the hours in which a
// mail is typically opened. The exact deadline is always printed next to it.
//
// Pure and tested; the designs only lay these values out.

import { STORE_TIME_ZONE } from "./store-datetime.mjs";

const HOUR_MS = 3_600_000;

/**
 * The earliest of several deadlines (ISO strings / Dates / null), or null.
 * @param {...(string | Date | null | undefined)} deadlines
 * @returns {string | null} ISO string
 */
export function earliestDeadline(...deadlines) {
  let best = null;
  for (const d of deadlines) {
    if (!d) continue;
    const t = new Date(d).getTime();
    if (!Number.isFinite(t)) continue;
    if (best === null || t < best) best = t;
  }
  return best === null ? null : new Date(best).toISOString();
}

/**
 * Whole days and remaining hours until `expiresAt`, rounded DOWN so the mail
 * never promises more time than there is.
 * @param {string | Date} expiresAt
 * @param {Date} [now]
 * @returns {{ expired: boolean, days: number, hours: number, totalHours: number }}
 */
export function remainingParts(expiresAt, now = new Date()) {
  const ms = new Date(expiresAt).getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return { expired: true, days: 0, hours: 0, totalHours: 0 };
  const totalHours = Math.floor(ms / HOUR_MS);
  return { expired: false, days: Math.floor(totalHours / 24), hours: totalHours % 24, totalHours };
}

/** The deadline as the reader should see it, in the shop's time zone. */
export function deadlineLabel(expiresAt, language = "de") {
  const d = new Date(expiresAt);
  if (!Number.isFinite(d.getTime())) return "";
  if (language === "en") {
    return `${d.toLocaleDateString("en-GB", { timeZone: STORE_TIME_ZONE, weekday: "short", day: "numeric", month: "short", year: "numeric" })}, ${d.toLocaleTimeString("en-GB", { timeZone: STORE_TIME_ZONE, hour: "2-digit", minute: "2-digit" })}`;
  }
  return `${d.toLocaleDateString("de-DE", { timeZone: STORE_TIME_ZONE, weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })}, ${d.toLocaleTimeString("de-DE", { timeZone: STORE_TIME_ZONE, hour: "2-digit", minute: "2-digit" })} Uhr`;
}

/** Fixed wording per language. */
export function countdownCopy(language = "de") {
  return language === "en"
    ? { heading: "Your offer ends in", days: (n) => (n === 1 ? "day" : "days"), hours: (n) => (n === 1 ? "hour" : "hours"), until: "until", today: "Your offer ends today" }
    : { heading: "Dein Angebot gilt noch", days: (n) => (n === 1 ? "Tag" : "Tage"), hours: (n) => (n === 1 ? "Stunde" : "Stunden"), until: "bis", today: "Dein Angebot endet heute" };
}

/**
 * The plain-text line ("Dein Angebot gilt noch 3 Tage und 14 Stunden – bis
 * Fr., 12.09.2026, 23:59 Uhr"), or "" when already expired.
 * @param {string | Date} expiresAt
 * @param {"de" | "en"} [language]
 * @param {Date} [now]
 */
export function countdownText(expiresAt, language = "de", now = new Date()) {
  const r = remainingParts(expiresAt, now);
  if (r.expired) return "";
  const c = countdownCopy(language);
  const parts = [];
  if (r.days > 0) parts.push(`${r.days} ${c.days(r.days)}`);
  if (r.hours > 0 || parts.length === 0) parts.push(`${r.hours} ${c.hours(r.hours)}`);
  const joiner = language === "en" ? " and " : " und ";
  return `${c.heading} ${parts.join(joiner)} – ${c.until} ${deadlineLabel(expiresAt, language)}`;
}
