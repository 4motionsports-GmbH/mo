// C.29 (OPTIN_REWARD T2.4) — before a Mo DOI mail goes out, check whether the
// shop already holds this person's consent, so a shop sign-up that still
// awaits Shopify's own confirmation mail never gets a second one from Mo.
//
// I/O glue around the pure decision in lib/optin-precheck.mjs (the answer
// table is there). Used by the opt-in routes. Never throws; any failure
// answers "proceed" (today's behaviour).
//
//   signed in   → precheckShopifyConsent: Mo's mirror first; Shopify's live
//                 consent (one bounded Admin read, ≤ SHOPIFY_OPTIN_PRECHECK_MS)
//                 only when the mirror has none and the address is not blocked.
//                 What Shopify says is recorded through the one consent resolver
//                 (source 'shopify', origin_ref 'optin_precheck').
//   typed address → mirrorConsentForEmail: Mo's mirror only, no Shopify call.

import { reportError } from "./observability";
import { applyConsentAct, customerIdForEmail, getCustomerConsent, isSubscribed, type CustomerConsent } from "./consent-store";
import type { IncomingConsent } from "./consent-core.mjs";
import { fetchMirrorCustomer } from "./shopify-sync";
import { doiExpiryDays } from "./email-capture-store";
import { shopifyConsentTextVersion } from "./platform-flags.mjs";
import {
  decideOptInPrecheck,
  isFreshShopifyPending,
  needsShopifyConsentRead,
  SHOPIFY_OPTIN_PRECHECK_MS,
  type PrecheckLive,
  type PrecheckMirror,
} from "./optin-precheck.mjs";

export type OptInPrecheckRoute = "proceed" | "already_subscribed" | "shopify_pending" | "blocked";

export interface OptInPrecheck {
  /**
   * proceed            — today's behaviour (the route decides the Mo DOI);
   * already_subscribed — the shop has the consent: no Mo DOI, answer confirmed;
   * shopify_pending    — the shop's own confirmation mail is out: no Mo DOI,
   *                      answer pending + doiEmailSent;
   * blocked            — the shop says unsubscribed / invalid (now on Mo's block
   *                      list too): no Mo DOI, neutral answer.
   */
  route: OptInPrecheckRoute;
  /**
   * What was checked, for the server KPI `shopifyConsent`: skipped |
   * mirror_pending | mirror_pending_stale | subscribed | pending | pending_stale |
   * unsubscribed | invalid | not_subscribed | unavailable.
   */
  check: string;
}

const PROCEED_UNAVAILABLE: OptInPrecheck = { route: "proceed", check: "unavailable" };

function precheckMirror(c: CustomerConsent): PrecheckMirror {
  return { state: c.state, source: c.source, at: c.at, suppressed: Boolean(c.suppression) };
}

/** Signed-in opt-in: Mo's mirror first, the shop's live consent only when the mirror has none. */
export async function precheckShopifyConsent(input: {
  customerId: number;
  shopifyCustomerId: string | null;
}): Promise<OptInPrecheck> {
  try {
    const consent = await getCustomerConsent(input.customerId);
    if (!consent) return PROCEED_UNAVAILABLE;
    const mirror = precheckMirror(consent);
    let live: PrecheckLive | null = null;
    let liveStatus = "skipped";
    if (input.shopifyCustomerId && needsShopifyConsentRead({ mirrorState: mirror.state, suppressed: Boolean(mirror.suppressed) })) {
      const read = await fetchMirrorCustomer(input.shopifyCustomerId, { timeoutMs: SHOPIFY_OPTIN_PRECHECK_MS });
      liveStatus = read.status;
      live = read.status === "ok" ? read.customer.consent : null;
    }
    const d = decideOptInPrecheck({ mirror, live, liveStatus, nowMs: Date.now(), freshDays: doiExpiryDays() });
    if (d.act) {
      // The shop's state goes through the one resolver (a Shopify-sourced act is
      // never pushed back). An unsubscribed / invalid act writes the block-list
      // row in the same transaction. The route keeps its answer even when this
      // write fails: the shop's state stands either way.
      await applyConsentAct({
        customerId: input.customerId,
        incoming: d.act as IncomingConsent,
        originRef: "optin_precheck",
        textVersion: shopifyConsentTextVersion(),
      });
    }
    return { route: d.route, check: d.check };
  } catch (err) {
    reportError(err, { route: "lib/shopify-optin-precheck", phase: "precheckShopifyConsent" });
    return PROCEED_UNAVAILABLE;
  }
}

export interface MirrorConsentForEmail {
  /** The one consent says subscribed. */
  subscribed: boolean;
  /** A shop sign-up within MARKETING_DOI_EXPIRY_DAYS still awaits Shopify's confirmation mail. */
  shopifyPendingFresh: boolean;
}

const NOTHING_KNOWN: MirrorConsentForEmail = { subscribed: false, shopifyPendingFresh: false };

/** Typed-address surfaces (capture form, chat gate): Mo's mirror only, no Shopify call. */
export async function mirrorConsentForEmail(email: string): Promise<MirrorConsentForEmail> {
  try {
    const customerId = await customerIdForEmail(email);
    if (!customerId) return NOTHING_KNOWN;
    const consent = await getCustomerConsent(customerId);
    if (!consent) return NOTHING_KNOWN;
    return {
      subscribed: isSubscribed(consent),
      shopifyPendingFresh: isFreshShopifyPending(precheckMirror(consent), Date.now(), doiExpiryDays()),
    };
  } catch (err) {
    reportError(err, { route: "lib/shopify-optin-precheck", phase: "mirrorConsentForEmail" });
    return NOTHING_KNOWN;
  }
}
