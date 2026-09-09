// Pure filter core of the Gespräche screen: the URL contract (g* params) in
// ONE place — parsing on the server (page.tsx) and serialising on the client
// (the workspace's navigation) share these functions, so list, count and links
// can never disagree about what a filter means. node:test covers it; the typed
// wrapper lives in ./admin-conversations.ts.
//
//   ?tab=gespraeche&grange=7d|30d|90d|custom[&gfrom&gto][&gtier=anonymous|
//   email-only|signed-in][&gerr=1][&gcat=<key>][&gqual=<key>][&gq=<text>]
//   [&gpage=N][&gid=<conversationId>]

import { DEFAULT_KPI_PRESET, resolveKpiRange } from "./kpi-range.mjs";
import {
  TIERS,
  ANALYSIS_CATEGORIES,
  ANALYSIS_QUALITIES,
} from "./conversation-analysis-core.mjs";

/** Longest accepted search input (defensive cap; URLs stay shareable). */
export const SEARCH_MAX_LENGTH = 200;

/**
 * @typedef {{
 *   range: { preset: string, from: string, to: string, days: number, label: string },
 *   tier: string | null,
 *   hasError: boolean,
 *   category: string | null,
 *   quality: string | null,
 *   q: string | null,
 *   page: number,
 * }} ConversationFilter
 *
 * @typedef {{
 *   preset: string, from: string, to: string, label: string,
 *   tier: string | null, hasError: boolean, category: string | null,
 *   quality: string | null, q: string | null, page: number,
 * }} ConversationFilterState  flat shape the client workspace holds
 */

/**
 * Parse the g* URL params into a validated filter. The date window reuses the
 * KPI range resolver (same presets/clamping), unknown tier/category/quality
 * values fall back to "no filter", the search is trimmed and capped, the page
 * is a positive integer (default 1).
 * @param {Record<string, string | null | undefined>} [params]
 * @param {Date} [now]
 * @returns {ConversationFilter}
 */
export function parseConversationFilter(params = {}, now) {
  const range = resolveKpiRange(
    { kpiRange: params.grange, kpiFrom: params.gfrom, kpiTo: params.gto },
    now
  );
  const tier = params.gtier && TIERS.includes(params.gtier) ? params.gtier : null;
  const hasError = params.gerr === "1" || params.gerr === "true";
  const category =
    params.gcat && ANALYSIS_CATEGORIES.includes(params.gcat) ? params.gcat : null;
  const quality =
    params.gqual && ANALYSIS_QUALITIES.includes(params.gqual) ? params.gqual : null;
  const qRaw = (params.gq ?? "").trim().slice(0, SEARCH_MAX_LENGTH);
  const q = qRaw.length > 0 ? qRaw : null;
  const pageNum = Number.parseInt(params.gpage ?? "1", 10);
  const page = Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1;
  return { range, tier, hasError, category, quality, q, page };
}

/**
 * A positive integer conversation id from `?gid=`, else null.
 * @param {unknown} raw
 * @returns {number | null}
 */
export function parseConversationId(raw) {
  if (typeof raw !== "string" || !/^\d{1,12}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * The flat state the client holds (range spread into preset/from/to/label).
 * @param {ConversationFilter} filter
 * @returns {ConversationFilterState}
 */
export function flattenConversationFilter(filter) {
  return {
    preset: filter.range.preset,
    from: filter.range.from,
    to: filter.range.to,
    label: filter.range.label,
    tier: filter.tier,
    hasError: filter.hasError,
    category: filter.category,
    quality: filter.quality,
    q: filter.q,
    page: filter.page,
  };
}

/**
 * URL params for a filter state (only non-default keys), optionally with an
 * override and the selected conversation. Inverse of parseConversationFilter.
 * @param {ConversationFilterState} state
 * @param {Partial<ConversationFilterState>} [next]
 * @param {number | null} [conversationId]
 * @returns {Record<string, string>}
 */
export function conversationFilterParams(state, next = {}, conversationId = null) {
  const s = { ...state, ...next };
  /** @type {Record<string, string>} */
  const sp = { tab: "gespraeche", grange: s.preset };
  if (s.preset === "custom") {
    sp.gfrom = s.from;
    sp.gto = s.to;
  }
  if (s.tier) sp.gtier = s.tier;
  if (s.hasError) sp.gerr = "1";
  if (s.category) sp.gcat = s.category;
  if (s.quality) sp.gqual = s.quality;
  if (s.q) sp.gq = s.q;
  if (s.page > 1) sp.gpage = String(s.page);
  if (conversationId != null && conversationId > 0) sp.gid = String(conversationId);
  return sp;
}

/**
 * @param {ConversationFilterState} state
 * @param {Partial<ConversationFilterState>} [next]
 * @param {number | null} [conversationId]
 */
export function conversationFilterHref(state, next = {}, conversationId = null) {
  return `/admin?${new URLSearchParams(conversationFilterParams(state, next, conversationId)).toString()}`;
}

/**
 * How many filters deviate from the defaults (drives the "Zurücksetzen (n)"
 * affordance). The page is not a filter.
 * @param {ConversationFilterState} state
 */
export function activeConversationFilterCount(state) {
  let n = 0;
  if (state.preset !== DEFAULT_KPI_PRESET) n++;
  if (state.tier) n++;
  if (state.hasError) n++;
  if (state.category) n++;
  if (state.quality) n++;
  if (state.q) n++;
  return n;
}

/** The default (reset) state for a given "today". @param {Date} [now] */
export function defaultConversationFilterState(now) {
  return flattenConversationFilter(parseConversationFilter({}, now));
}
