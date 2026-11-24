// Changing a campaign's end after the fact — „Ende ändern“ / „Verlängern“
// (pure, tested: campaign-end.test.mjs). The I/O is extendCampaignEnd in
// campaigns-store.ts and POST /api/admin/campaigns/extend; the dialog is
// admin/kampagnen/ExtendEndDialog.tsx. docs/CAMPAIGNS.md §2.6.
//
// A campaign's end (`ends_at`; a Rundmail's „Versand spätestens bis“) stops it:
// from that moment the send paths skip it (phase „abgelaufen“), and the
// nightly job sets it to „beendet“. An end set too early by mistake — a
// Rundmail stopped at 11:50 with 2,065 recipients still waiting (24.11.2026,
// fixed by hand in the database) — is fixed in the admin: a later end and,
// when the date is what ended it, the campaign running again. Nobody gets a
// mail twice: a Rundmail only ever sends to recipients still waiting, and a
// personal campaign only sends what is approved on the review desk.
//
// The rules (campaignEndChange):
//   * Einzelansprache has no end; an archived campaign stays archived.
//   * A draft, a planned, running or paused campaign: only the date changes
//     (`change`) — one already past its end („abgelaufen“) runs again at once.
//   * An ended campaign („beendet“) runs again with the new end (`resume`)
//     only when its date ended it:
//       - a Rundmail whose send is not finished — the nightly job ended it;
//         a finished or cancelled send has nothing left to send;
//       - any other kind whose end had passed when it ended (ends_at ≤
//         ended_at). One ended by hand before its end resumes through
//         „Wieder aufnehmen“, not here — an end date is no reason to undo a
//         deliberate stop.
//   * A Rundmail whose send is finished cannot be changed at all.
// The new end (validateCampaignEnd): none („offen“) or at least 15 minutes
// ahead (an end a minute away would stop it again at once), after a planned
// start, at most a year ahead (a typo such as 2062 is caught).

import { toBerlinInputValue, fromBerlinInputValue } from "./admin-datetime.mjs";
import { formatMailingDuration, mailingDurationMinutes } from "./mailing-schedule.mjs";

/** The new end lies at least this far ahead. */
export const CAMPAIGN_END_MIN_LEAD_MINUTES = 15;
/** … and at most this far. */
export const CAMPAIGN_END_MAX_DAYS = 366;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** @param {unknown} v */
function ms(v) {
  if (v === null || v === undefined || v === "") return NaN;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  return Date.parse(String(v));
}

/**
 * @typedef {{
 *   kind: string,
 *   status: string,
 *   startsAt?: string | null,
 *   endsAt?: string | null,
 *   endedAt?: string | null,
 *   finished?: boolean,
 * }} CampaignEndInput
 *   `finished`: a Rundmail's send is finished (campaign_mailings.finished_at —
 *   everyone sent, or cancelled); ignored for other kinds.
 *
 * @typedef {(
 *   | { ok: true, mode: "change" | "resume", expired: boolean }
 *   | { ok: false, message: string }
 * )} CampaignEndChange
 *   `resume`: the campaign is „beendet“ and runs again with the new end;
 *   `expired`: its end has passed — it stopped because of it (always true for
 *   `resume`).
 */

/**
 * May the end of this campaign be changed now, and what does a change do?
 * @param {CampaignEndInput} c
 * @param {{ now?: number | Date }} [opts]
 * @returns {CampaignEndChange}
 */
export function campaignEndChange(c, opts = {}) {
  const now = ms(opts.now ?? Date.now());
  if (c.kind === "einzel") return { ok: false, message: "Die Einzelansprache hat kein Ende." };
  if (c.status === "archiviert") return { ok: false, message: "Eine archivierte Kampagne lässt sich nicht mehr verlängern." };
  if (c.kind === "rundmail" && c.finished === true) {
    return { ok: false, message: "Der Versand dieser Rundmail ist abgeschlossen — es wartet niemand mehr auf die Mail." };
  }
  const end = ms(c.endsAt);
  const expired = Number.isFinite(end) && end <= now;
  if (c.status === "beendet") {
    if (c.kind === "rundmail") return { ok: true, mode: "resume", expired: true };
    const ended = ms(c.endedAt);
    if (Number.isFinite(end) && Number.isFinite(ended) && end <= ended) return { ok: true, mode: "resume", expired: true };
    return {
      ok: false,
      message: "Die Kampagne wurde von Hand beendet, nicht durch ihr Ende — „Wieder aufnehmen“ startet sie neu.",
    };
  }
  if (c.status === "entwurf" || c.status === "aktiv" || c.status === "pausiert") return { ok: true, mode: "change", expired };
  return { ok: false, message: "Das Ende dieser Kampagne lässt sich nicht ändern." };
}

/**
 * Check a new end: null / "" = no end („offen“), else an instant at least
 * CAMPAIGN_END_MIN_LEAD_MINUTES ahead, after a planned start (`startsAt` in
 * the future), at most CAMPAIGN_END_MAX_DAYS ahead.
 * @param {unknown} value  an ISO instant, or null / "" for none
 * @param {{ now?: number | Date, startsAt?: string | null }} [opts]
 * @returns {{ ok: true, endsAt: string | null } | { ok: false, message: string }}
 */
export function validateCampaignEnd(value, opts = {}) {
  if (value === null || value === undefined || value === "") return { ok: true, endsAt: null };
  const now = ms(opts.now ?? Date.now());
  const t = ms(value);
  if (typeof value !== "string" && !(value instanceof Date)) return { ok: false, message: "Ungültiger Zeitpunkt." };
  if (!Number.isFinite(t)) return { ok: false, message: "Ungültiger Zeitpunkt." };
  if (t < now + CAMPAIGN_END_MIN_LEAD_MINUTES * MINUTE_MS) {
    return { ok: false, message: `Das neue Ende muss mindestens ${CAMPAIGN_END_MIN_LEAD_MINUTES} Minuten in der Zukunft liegen.` };
  }
  if (t > now + CAMPAIGN_END_MAX_DAYS * DAY_MS) return { ok: false, message: "Höchstens ein Jahr im Voraus." };
  const start = ms(opts.startsAt);
  if (Number.isFinite(start) && start > now && t <= start) {
    return { ok: false, message: "Das Ende muss nach dem geplanten Start liegen." };
  }
  return { ok: true, endsAt: new Date(t).toISOString() };
}

/**
 * The Berlin calendar day `days` after the Berlin day of `now`, as
 * „YYYY-MM-DD“.
 * @param {number} now
 * @param {number} days
 */
function berlinDayPlus(now, days) {
  const [y, m, d] = toBerlinInputValue(now).slice(0, 10).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Quick choices for the new end (Berlin wall time, the value of an
 * `<input type="datetime-local">`): today 23:59 (while it is still far
 * enough ahead), tomorrow 23:59, in seven days 23:59.
 * @param {{ now?: number | Date }} [opts]
 * @returns {Array<{ key: "heute" | "morgen" | "woche", label: string, value: string }>}
 */
export function campaignEndSuggestions(opts = {}) {
  const now = ms(opts.now ?? Date.now());
  /** @type {Array<{ key: "heute" | "morgen" | "woche", label: string, value: string }>} */
  const out = [];
  const today = `${berlinDayPlus(now, 0)}T23:59`;
  const todayAt = ms(fromBerlinInputValue(today));
  if (Number.isFinite(todayAt) && todayAt >= now + CAMPAIGN_END_MIN_LEAD_MINUTES * MINUTE_MS) {
    out.push({ key: "heute", label: "Heute 23:59", value: today });
  }
  out.push({ key: "morgen", label: "Morgen 23:59", value: `${berlinDayPlus(now, 1)}T23:59` });
  out.push({ key: "woche", label: "In 7 Tagen", value: `${berlinDayPlus(now, 7)}T23:59` });
  return out;
}

/**
 * Does a Rundmail's remaining send fit before an end? `open` recipients at
 * the tempo label `perMinute`, starting at `startsAt` (default now).
 * `fits` is true without an end or without anyone waiting.
 * @param {{ open: number, perMinute: number, endsAt?: string | null, startsAt?: string | null, now?: number | Date }} r
 * @returns {{ minutes: number, label: string, fits: boolean }}
 */
export function mailingEndOutlook({ open, perMinute, endsAt = null, startsAt = null, now = Date.now() }) {
  const minutes = mailingDurationMinutes(open, perMinute);
  const label = formatMailingDuration(minutes);
  const end = ms(endsAt);
  if (minutes === 0 || !Number.isFinite(end)) return { minutes, label, fits: true };
  const start = Math.max(ms(now), Number.isFinite(ms(startsAt)) ? ms(startsAt) : 0);
  return { minutes, label, fits: start + minutes * MINUTE_MS <= end };
}
