// Page context on typed product-page messages (A3, docs/plans/2026-10-04/A3.md).
// Pure, tested.
//
// The widget may attach the open page's facts to a typed or spoken message
// (`context.source: "page"`): the product of a product page, or the single
// category of a collection page. The backend uses it only behind
// CHAT_PAGE_CONTEXT_ENABLED (default off) and keeps a share of sessions as a
// control group (CHAT_PAGE_CONTEXT_HOLDOUT_PCT, default 0) to measure the
// effect honestly. A context without `source` (CTA, nudge, older widgets)
// takes the old path, byte for byte.

import { productIdsFromToolCall } from "./recommended-products.mjs";
import { parseProductRef } from "./product-ref.mjs";

export const CONTEXT_SOURCES = Object.freeze(["page", "cta", "nudge"]);

/** @param {unknown} raw @returns {"page" | "cta" | "nudge" | null} */
export function contextSource(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  return CONTEXT_SOURCES.includes(s) ? /** @type {"page"|"cta"|"nudge"} */ (s) : null;
}

/**
 * Which page a `source: "page"` context describes; anything else is dropped
 * (typed turns never carry the browsing trail).
 * @param {unknown} ctx
 * @returns {"product" | "collection" | null}
 */
export function pageContextKind(ctx) {
  if (!ctx || typeof ctx !== "object") return null;
  const c = /** @type {Record<string, unknown>} */ (ctx);
  if (c.type === "product") return "product";
  if (c.type === "browsing") {
    const rv = Array.isArray(c.recentlyViewed) ? c.recentlyViewed : [];
    if (rv.length !== 1) return null;
    const e = /** @type {Record<string, unknown>} */ (rv[0] ?? {});
    return e.type === "category" && typeof e.name === "string" && e.name.trim() ? "collection" : null;
  }
  return null;
}

/** CHAT_PAGE_CONTEXT_HOLDOUT_PCT → 0–50 (missing / invalid / negative → 0). @param {unknown} raw */
export function parseHoldoutPct(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return 0;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(50, Math.floor(n));
}

/** FNV-1a 32-bit. @param {string} str */
function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 0–99, stable per session; salted so later experiments are independent. @param {string} sessionId */
export function holdoutBucket(sessionId) {
  return fnv1a32(`page-ctx:${sessionId}`) % 100;
}

/** @param {unknown} sessionId @param {number} pct */
export function isPageContextHeldOut(sessionId, pct) {
  if (typeof sessionId !== "string" || !sessionId.trim() || !(pct > 0)) return false;
  return holdoutBucket(sessionId.trim()) < pct;
}

/**
 * What the chat route does with a context, and which event it records.
 * `applied` in the event is the arm, not "a note was added".
 *
 * @param {{ source: string | null, kind: "product" | "collection" | null, hasUserMessage: boolean,
 *   enabled: boolean, heldOut: boolean, pct: number, productResolved: boolean, categoryResolved: boolean }} input
 * @returns {{ ground: boolean, noteStyle: "page" | "default" | "none",
 *   event: null | { applied: boolean, kind: "product" | "collection", resolved: boolean, pct: number } }}
 */
export function planPageContext({ source, kind, hasUserMessage, enabled, heldOut, pct, productResolved, categoryResolved }) {
  if (source !== "page") return { ground: true, noteStyle: "default", event: null };
  if (!hasUserMessage || kind == null) return { ground: false, noteStyle: "none", event: null };
  const resolved = kind === "product" ? productResolved === true : categoryResolved === true;
  if (!enabled) return { ground: false, noteStyle: "none", event: { applied: false, kind, resolved, pct: 100 } };
  const share = kind === "product" ? Math.max(0, Math.min(50, Number(pct) || 0)) : 0;
  if (heldOut && kind === "product") {
    return { ground: false, noteStyle: "none", event: { applied: false, kind, resolved, pct: share } };
  }
  if (resolved) return { ground: true, noteStyle: "page", event: { applied: true, kind, resolved: true, pct: share } };
  return { ground: false, noteStyle: "none", event: { applied: true, kind, resolved: false, pct: share } };
}

const CARD_TOOLS = new Set(["show_product", "compare_products", "add_to_cart"]);

/** Product cards in a turn. @param {ReadonlyArray<{ toolName?: string }>} toolCalls */
export function countProductCards(toolCalls) {
  return (toolCalls ?? []).filter((t) => t && CARD_TOOLS.has(String(t.toolName))).length;
}

/**
 * Product cards other than a show_product of the open page's product (any
 * variant of it). Only the count is stored, never an id.
 * @param {ReadonlyArray<{ toolName?: string, input?: unknown }>} toolCalls
 * @param {string | null | undefined} pageProductId
 */
export function countOtherCards(toolCalls, pageProductId) {
  const page = pageProductId ? parseProductRef(pageProductId).productId : null;
  let n = 0;
  for (const t of toolCalls ?? []) {
    if (!t || !CARD_TOOLS.has(String(t.toolName))) continue;
    if (page && t.toolName === "show_product") {
      const ids = productIdsFromToolCall(t).map((id) => parseProductRef(id).productId);
      if (ids.length > 0 && ids.every((id) => id === page)) continue;
    }
    n++;
  }
  return n;
}

/**
 * Applied vs. holdout on one binary outcome: rates, difference with a Wald
 * 95 % interval, relative lift. Null rates for empty arms.
 * @param {{ applied: { n: number, k: number }, holdout: { n: number, k: number } }} arms
 */
export function compareArms({ applied, holdout }) {
  const pa = applied.n > 0 ? applied.k / applied.n : null;
  const ph = holdout.n > 0 ? holdout.k / holdout.n : null;
  if (pa == null || ph == null) {
    return { appliedRate: pa, holdoutRate: ph, diff: null, relLift: null, ciLow: null, ciHigh: null, significant: false };
  }
  const diff = pa - ph;
  const se = Math.sqrt((pa * (1 - pa)) / applied.n + (ph * (1 - ph)) / holdout.n);
  const z = 1.959963984540054;
  const ciLow = diff - z * se;
  const ciHigh = diff + z * se;
  return {
    appliedRate: pa,
    holdoutRate: ph,
    diff,
    relLift: ph > 0 ? diff / ph : null,
    ciLow,
    ciHigh,
    significant: se > 0 && (ciLow > 0 || ciHigh < 0),
  };
}

/** Inverse standard normal CDF (Acklam). @param {number} p */
function probit(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) return -probit(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * Sessions needed for a two-sided two-proportion z-test (pooled variance under
 * H0, unpooled under H1) with an unequal split.
 * @param {{ baseRate: number, relLift: number, holdoutShare: number, alpha?: number, power?: number }} input
 */
export function requiredSampleSize({ baseRate, relLift, holdoutShare, alpha = 0.05, power = 0.8 }) {
  const p2 = baseRate;
  const p1 = baseRate * (1 + relLift);
  const q2 = holdoutShare;
  const q1 = 1 - holdoutShare;
  const pBar = q1 * p1 + q2 * p2;
  const za = probit(1 - alpha / 2);
  const zb = probit(power);
  const num =
    za * Math.sqrt(pBar * (1 - pBar) * (1 / q1 + 1 / q2)) + zb * Math.sqrt((p1 * (1 - p1)) / q1 + (p2 * (1 - p2)) / q2);
  const total = Math.ceil((num * num) / ((p1 - p2) * (p1 - p2)));
  return { total, applied: Math.ceil(total * q1), holdout: Math.ceil(total * q2) };
}

/**
 * @param {{ applied: { n: number }, holdout: { n: number } }} arms
 * @param {{ applied: number, holdout: number }} target
 */
export function experimentProgress({ applied, holdout }, target) {
  return {
    reached: applied.n >= target.applied && holdout.n >= target.holdout,
    applied: { n: applied.n, target: target.applied },
    holdout: { n: holdout.n, target: target.holdout },
  };
}

/** Pre-registered experiment — null until the holdout starts (set in that commit). */
export const PAGE_CONTEXT_EXPERIMENT = null;

const ARM_FIELDS = Object.freeze([
  "sessions", "turns", "unanswered", "firstCard", "firstOtherCard", "clicked", "clickedOther",
  "cart", "ctaAfter", "orderWindowClosed", "ordered", "orderedAssisted",
]);

function emptyArm() {
  return Object.fromEntries(ARM_FIELDS.map((f) => [f, 0]));
}

/**
 * Fold the per-(arm, pct, resolved, primed, locale, window) rows of the
 * product kind into coverage, the comparison population and the exclusion
 * reasons. Comparison = applied/holdout arm, one constant share equal to the
 * pre-registered experiment's, on or after its start (rows carry no date, so
 * the caller filters the range), resolved, not primed by a CTA/nudge, click
 * window closed.
 *
 * @param {Array<Record<string, unknown>>} rows
 * @param {{ pct: number, targetPerArm: { applied: number, holdout: number } } | null} experiment
 */
export function summarisePageContextRows(rows, experiment) {
  const arms = { applied: emptyArm(), holdout: emptyArm() };
  const excluded = { otherShare: 0, mixed: 0, unresolved: 0, primed: 0, windowOpen: 0 };
  const byLocale = { de: { sessions: 0, resolved: 0 }, en: { sessions: 0, resolved: 0 } };
  const pcts = new Set();
  let sessions = 0;
  let resolved = 0;
  for (const r of rows ?? []) {
    const n = Number(r.sessions) || 0;
    if (n <= 0) continue;
    sessions += n;
    const loc = r.locale === "en" ? "en" : "de";
    byLocale[loc].sessions += n;
    if (r.resolved === true) {
      resolved += n;
      byLocale[loc].resolved += n;
    }
    const pct = Number(r.pct);
    pcts.add(pct);
    const arm = r.arm === "applied" || r.arm === "holdout" ? r.arm : null;
    if (!arm) {
      excluded.mixed += n;
      continue;
    }
    if (!experiment || !(pct > 0 && pct < 100) || pct !== experiment.pct) {
      excluded.otherShare += n;
      continue;
    }
    if (r.resolved !== true) {
      excluded.unresolved += n;
      continue;
    }
    if (r.primed === true) {
      excluded.primed += n;
      continue;
    }
    if (r.click_window_open === true) {
      excluded.windowOpen += n;
      continue;
    }
    const a = arms[arm];
    const map = {
      sessions: "sessions", turns: "turns", unanswered: "unanswered", firstCard: "first_card",
      firstOtherCard: "first_other_card", clicked: "clicked", clickedOther: "clicked_other", cart: "cart",
      ctaAfter: "cta_after", orderWindowClosed: "order_window_closed", ordered: "ordered", orderedAssisted: "ordered_assisted",
    };
    for (const [k, col] of Object.entries(map)) a[k] += Number(r[col]) || 0;
  }
  const primary =
    experiment && arms.applied.sessions + arms.holdout.sessions > 0
      ? compareArms({
          applied: { n: arms.applied.sessions, k: arms.applied.clickedOther },
          holdout: { n: arms.holdout.sessions, k: arms.holdout.clickedOther },
        })
      : null;
  const progress = experiment
    ? experimentProgress({ applied: { n: arms.applied.sessions }, holdout: { n: arms.holdout.sessions } }, experiment.targetPerArm)
    : null;
  return {
    sessions,
    resolved,
    byLocale,
    pcts: [...pcts].sort((x, y) => x - y),
    arms,
    excluded,
    primary,
    progress,
  };
}
