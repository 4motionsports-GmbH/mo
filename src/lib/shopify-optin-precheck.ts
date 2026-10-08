// C.29 (OPTIN_REWARD T2.4) — before a Mo DOI mail goes out, check whether the
// shop already holds this person's consent, so a shop sign-up that still
// awaits Shopify's own confirmation mail never gets a second one from Mo.
//
// Interface used by the opt-in routes; the implementation follows in the C.29
// change. Never throws; any failure answers "proceed" (today's behaviour).

export type OptInPrecheckRoute = "proceed" | "already_subscribed" | "shopify_pending" | "blocked";

export interface OptInPrecheck {
  route: OptInPrecheckRoute;
  /** What was checked, for the server KPI `shopifyConsent` (e.g. "skipped", "pending", "unavailable"). */
  check: string;
}

/** Signed-in opt-in: Mo's mirror first, the shop's live consent only when the mirror has none. */
export async function precheckShopifyConsent(input: {
  customerId: number;
  shopifyCustomerId: string | null;
}): Promise<OptInPrecheck> {
  void input;
  return { route: "proceed", check: "skipped" };
}

export interface MirrorConsentForEmail {
  /** The one consent says subscribed. */
  subscribed: boolean;
  /** A shop sign-up within MARKETING_DOI_EXPIRY_DAYS still awaits Shopify's confirmation mail. */
  shopifyPendingFresh: boolean;
}

/** Typed-address surfaces (capture form, chat gate): Mo's mirror only, no Shopify call. */
export async function mirrorConsentForEmail(email: string): Promise<MirrorConsentForEmail> {
  void email;
  return { subscribed: false, shopifyPendingFresh: false };
}
