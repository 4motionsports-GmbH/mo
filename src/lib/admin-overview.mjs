// Pure, I/O-free derivations for the admin OVERVIEW (Übersicht) screen. Kept in
// plain .mjs so the aggregation maths is unit-tested with node:test and shared
// by the server-rendered OverviewTab. NOTHING here fetches or mutates: callers
// pass in data already read from the stores (admin-overview-store.ts), and we
// only bucket / merge / sort / cap it for display.

import { adminTabHref } from "./admin-tabs.mjs";

/**
 * @typedef {Object} MarketingTargetLike
 * @property {string} email
 * @property {string|Date|null} confirmedAt
 * @property {{ status: string }} [purchase]
 */

/**
 * Bucket marketing-eligible targets by purchase status (kept for callers that
 * still hold a target list; the Übersicht itself now counts in SQL — see
 * admin-overview-store.ts marketingSummary, which uses the same buckets).
 *
 * @param {MarketingTargetLike[]} targets
 * @returns {{ eligible: number, notPurchased: number, purchased: number, unknown: number }}
 */
export function summarizeMarketingTargets(targets) {
  const list = Array.isArray(targets) ? targets : [];
  let notPurchased = 0;
  let purchased = 0;
  let unknown = 0;
  for (const t of list) {
    const status = t?.purchase?.status;
    if (status === "no_purchase") notPurchased++;
    else if (status === "purchased") purchased++;
    else unknown++;
  }
  return { eligible: list.length, notPurchased, purchased, unknown };
}

/**
 * @param {unknown} value
 * @returns {number} epoch ms or NaN
 */
function toTime(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" && value) return Date.parse(value);
  return Number.NaN;
}

/**
 * The most recently DOI-confirmed contacts, newest first, capped to `limit`.
 * Accepts ISO strings AND Date objects for `confirmedAt` (the Neon driver hands
 * back Dates for timestamptz columns — TECH-C8) and normalises to ISO strings.
 * Entries without a parseable confirmation date are dropped.
 *
 * @param {MarketingTargetLike[]} targets
 * @param {number} [limit]
 * @returns {{ email: string, confirmedAt: string }[]}
 */
export function recentConfirmedContacts(targets, limit = 5) {
  const list = Array.isArray(targets) ? targets : [];
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 5;
  return list
    .map((t) => ({
      email: t && typeof t.email === "string" ? t.email : "",
      time: toTime(t?.confirmedAt),
    }))
    .filter((t) => t.email && !Number.isNaN(t.time))
    .sort((a, b) => b.time - a.time)
    .slice(0, cap)
    .map((t) => ({ email: t.email, confirmedAt: new Date(t.time).toISOString() }));
}

/**
 * @typedef {{ id: number, email: string, subject: string|null, sentAt: string|null, source: "campaign"|"marketing" }} RecentSendLike
 */

/**
 * Merge campaign and marketing sends into one "Zuletzt gesendet" feed, newest
 * first (sends without a timestamp last), capped to `limit`. Stable for equal
 * timestamps (campaign before marketing, then by id descending).
 *
 * @param {RecentSendLike[]} campaign
 * @param {RecentSendLike[]} marketing
 * @param {number} [limit]
 * @returns {RecentSendLike[]}
 */
export function mergeRecentSends(campaign, marketing, limit = 5) {
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 5;
  const all = [
    ...(Array.isArray(campaign) ? campaign : []).map((s) => ({ ...s, source: "campaign" })),
    ...(Array.isArray(marketing) ? marketing : []).map((s) => ({ ...s, source: "marketing" })),
  ];
  return all
    .map((s, index) => ({ s, index, time: toTime(s.sentAt) }))
    .sort((a, b) => {
      const aNaN = Number.isNaN(a.time);
      const bNaN = Number.isNaN(b.time);
      if (aNaN && bNaN) return a.index - b.index;
      if (aNaN) return 1;
      if (bNaN) return -1;
      if (b.time !== a.time) return b.time - a.time;
      return a.index - b.index;
    })
    .slice(0, cap)
    .map((x) => /** @type {RecentSendLike} */ (x.s));
}

/**
 * @typedef {Object} TodayInput
 * @property {{ pending: number, drafted: number, sentToday: number } | null} campaign
 * @property {number} unmatchedInbound
 * @property {number} qaOpen
 * @property {number} runningReports
 * @property {number} runningImprovementRuns
 */

/**
 * @typedef {Object} TodayItem
 * @property {string} key
 * @property {string} label
 * @property {number} value
 * @property {string} hint
 * @property {string} href
 * @property {boolean} attention true when the item needs work today
 */

/**
 * The "Heute" block: what needs attention now, each card a deep link into the
 * screen where the work happens. Pure mapping from counts to display items.
 *
 * @param {TodayInput} input
 * @returns {TodayItem[]}
 */
export function todayItems(input) {
  const n = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  const campaign = input?.campaign ?? null;
  const drafted = n(campaign?.drafted);
  const pending = n(campaign?.pending);
  const sentToday = n(campaign?.sentToday);
  const inbox = n(input?.unmatchedInbound);
  const qaOpen = n(input?.qaOpen);
  const reports = n(input?.runningReports);
  const runs = n(input?.runningImprovementRuns);

  return [
    {
      key: "kampagne",
      label: "Kampagne · Entwürfe",
      value: drafted,
      hint: `${pending} offen · ${sentToday} heute gesendet`,
      href: adminTabHref("kampagne"),
      attention: drafted > 0,
    },
    {
      key: "posteingang",
      label: "Posteingang · offen",
      value: inbox,
      hint: inbox === 1 ? "E-Mail ohne Kundenzuordnung" : "E-Mails ohne Kundenzuordnung",
      href: adminTabHref("kunden"),
      attention: inbox > 0,
    },
    {
      key: "wissen",
      label: "Wissen · offene Fragen",
      value: qaOpen,
      hint: qaOpen === 1 ? "Kundenfrage ohne Antwort" : "Kundenfragen ohne Antwort",
      href: adminTabHref("wissen"),
      attention: qaOpen > 0,
    },
    {
      key: "analysen",
      label: "Analysen · laufend",
      value: reports + runs,
      hint: `${reports} Komplettanalysen · ${runs} Verbesserungsläufe`,
      href: adminTabHref(runs > 0 && reports === 0 ? "verbesserung" : "analyse"),
      attention: reports + runs > 0,
    },
  ];
}
