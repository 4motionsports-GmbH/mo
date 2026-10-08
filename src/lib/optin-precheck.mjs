// C.29 (OPTIN_REWARD T2.4) — before a Mo DOI mail goes out, does the shop
// already hold this person's consent? Pure decision core; the I/O lives in
// lib/shopify-optin-precheck.ts.
//
// A shop sign-up with the newsletter box gets Shopify's own confirmation mail
// (marketingState PENDING). When Mo's mirror missed it, the chat asked again
// and Mo sent a second confirmation mail. The signed-in opt-in therefore reads
// Shopify's live consent when Mo's own copy has none, and Mo's mirror alone
// already answers a known Shopify pending:
//
//   Mo mirror                 Shopify live            route               act            check
//   suppressed (any)          not read                proceed             —              skipped
//   pending (shopify, fresh)  not read                shopify_pending     —              mirror_pending
//   pending (shopify, stale)  not read                proceed             —              mirror_pending_stale
//   other than not_subscribed not read                proceed             —              skipped
//   not_subscribed            SUBSCRIBED              already_subscribed  subscribed     subscribed
//   not_subscribed            PENDING, fresh          shopify_pending     pending        pending
//   not_subscribed            PENDING, stale/undated  proceed             —              pending_stale
//   not_subscribed            UNSUBSCRIBED            blocked             unsubscribed   unsubscribed
//   not_subscribed            INVALID                 blocked             invalid        invalid
//   not_subscribed            NOT_SUBSCRIBED/REDACTED proceed             —              not_subscribed
//   not_subscribed            no read (no Shopify id) proceed             —              skipped
//   not_subscribed            read failed / off       proceed             —              unavailable
//
// "proceed" is today's behaviour (the opt-in route decides the Mo DOI);
// "blocked" means no Mo DOI and the neutral answer. Every act carries source
// 'shopify' (the shop's state, recorded through the one consent resolver).
//
// "Fresh": consentUpdatedAt within `freshDays` (MARKETING_DOI_EXPIRY_DAYS —
// a shop link older than Mo's own may be dead, Shopify does not resend) and
// not more than FUTURE_SKEW_MS ahead of the server clock.

/** Budget of the live Shopify read in the signed-in opt-in (one Admin call). */
export const SHOPIFY_OPTIN_PRECHECK_MS = 1500;

/** Clock skew tolerated for a consentUpdatedAt in the future. */
export const FUTURE_SKEW_MS = 5 * 60 * 1000;

const DAY_MS = 86_400_000;

/**
 * @typedef {Object} PrecheckMirror        Mo's copy of the one consent
 * @property {string} state                subscribed | pending | unsubscribed | not_subscribed
 * @property {string | null} source        who set it (shopify, mo_signin, …)
 * @property {string | null} at            ISO time of the act
 * @property {boolean} [suppressed]        the address is on the block list (any reason)
 *
 * @typedef {Object} PrecheckLive          Shopify's live consent (mapShopifyConsent)
 * @property {string} state                subscribed | pending | unsubscribed | not_subscribed | redacted | invalid
 * @property {string | null} level
 * @property {string | null} at
 *
 * @typedef {"proceed" | "already_subscribed" | "shopify_pending" | "blocked"} PrecheckRoute
 *
 * @typedef {Object} PrecheckDecision
 * @property {PrecheckRoute} route
 * @property {{ state: string, level?: string | null, at: string | null, source: "shopify" } | null} act
 * @property {string} check                for the server KPI `shopifyConsent`
 */

/**
 * Is a consent time recent enough that its confirmation link still counts as
 * "in the inbox"? Undated or unreadable → false.
 * @param {string | null | undefined} at
 * @param {number} nowMs
 * @param {number} freshDays
 */
export function isFreshConsentTime(at, nowMs, freshDays) {
  if (!at) return false;
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return false;
  return nowMs - t <= freshDays * DAY_MS && t <= nowMs + FUTURE_SKEW_MS;
}

/**
 * Mo's mirror holds a shop sign-up whose confirmation mail is out: pending,
 * set by Shopify, fresh, and the address is not blocked.
 * @param {PrecheckMirror | null} mirror
 * @param {number} nowMs
 * @param {number} freshDays
 */
export function isFreshShopifyPending(mirror, nowMs, freshDays) {
  return Boolean(
    mirror &&
      !mirror.suppressed &&
      mirror.state === "pending" &&
      mirror.source === "shopify" &&
      isFreshConsentTime(mirror.at, nowMs, freshDays)
  );
}

/**
 * Read Shopify live only when a Mo DOI would otherwise go out: the mirror has
 * no consent and the address is not blocked.
 * @param {{ mirrorState: string | null | undefined, suppressed: boolean }} input
 */
export function needsShopifyConsentRead({ mirrorState, suppressed }) {
  return mirrorState === "not_subscribed" && !suppressed;
}

/**
 * The precheck decision (table above).
 * @param {{
 *   mirror: PrecheckMirror | null,
 *   live: PrecheckLive | null,
 *   liveStatus: string,
 *   nowMs: number,
 *   freshDays: number,
 * }} i  `liveStatus`: "skipped" when no read ran, else fetchMirrorCustomer's status
 * @returns {PrecheckDecision}
 */
export function decideOptInPrecheck(i) {
  const proceed = (check) => ({ route: /** @type {PrecheckRoute} */ ("proceed"), act: null, check });
  const m = i.mirror;
  if (!m) return proceed("unavailable");
  if (m.suppressed) return proceed("skipped");
  if (m.state === "pending" && m.source === "shopify") {
    return isFreshShopifyPending(m, i.nowMs, i.freshDays)
      ? { route: "shopify_pending", act: null, check: "mirror_pending" }
      : proceed("mirror_pending_stale");
  }
  if (m.state !== "not_subscribed") return proceed("skipped");

  const L = i.live;
  if (!L) {
    if (i.liveStatus === "skipped") return proceed("skipped");
    // Read fine, but Shopify holds no consent object for this customer.
    if (i.liveStatus === "ok") return proceed("not_subscribed");
    return proceed("unavailable");
  }
  /** @param {string} state */
  const act = (state) => ({ state, level: L.level ?? null, at: L.at ?? null, source: /** @type {const} */ ("shopify") });
  switch (L.state) {
    case "subscribed":
      return { route: "already_subscribed", act: act("subscribed"), check: "subscribed" };
    case "pending":
      return isFreshConsentTime(L.at, i.nowMs, i.freshDays)
        ? { route: "shopify_pending", act: act("pending"), check: "pending" }
        : proceed("pending_stale");
    case "unsubscribed":
      return { route: "blocked", act: act("unsubscribed"), check: "unsubscribed" };
    case "invalid":
      return { route: "blocked", act: { state: "invalid", at: L.at ?? null, source: "shopify" }, check: "invalid" };
    default:
      // not_subscribed, redacted
      return proceed("not_subscribed");
  }
}
