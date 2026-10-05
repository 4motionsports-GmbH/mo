// What proves that a chat session is signed in (P0.3, D-AP1). Pure, tested.
//
// Two proofs exist:
//   token — a Customer Account sign-in in the chat („Anmelden“): the server
//           holds a live access token for the customer.
//   shop  — the shop's App Proxy vouched for the logged-in customer
//           (logged_in_customer_id, HMAC-signed, fresh) and the same browser
//           session redeemed the one-time code. Counts for
//           APP_PROXY_SIGNIN_MAX_AGE_HOURS after that redeem (renewed on every
//           new tab session), only while APP_PROXY_SIGNIN_ENABLED is on.
//
// Order status stays token-only (ANWALTSDOSSIER §16.1, F-32).

/**
 * The proof a fresh App Proxy recognition would give: shop when the shop proof
 * counts, else token when the customer holds a chat token, else none.
 * @param {{ hasToken: boolean, shopProofHours: number }} input
 * @returns {"shop" | "token" | "none"}
 */
export function shopRecognitionProof({ hasToken, shopProofHours }) {
  if (Number(shopProofHours) > 0) return "shop";
  return hasToken === true ? "token" : "none";
}

/**
 * Decide what whoami does for a signed, fresh request from a logged-in shop
 * customer. Checks, in this order: another customer's signed-in link on the
 * session → handover (end it, no code); the kill switch; a usable proof.
 *
 * @param {{ flagOn: boolean, shopProofHours: number, hasToken: boolean, liveToken: boolean,
 *   linkedShopifyCustomerId: string | null, shopifyCustomerId: string }} input
 * @returns {{ action: "handover" | "no_code" | "issue", proof: "shop" | "token" | "none",
 *   hasToken: boolean, alreadySignedIn: boolean, noCode: null | "flag_off" | "no_proof" | "handover" }}
 */
export function decideShopRecognition({
  flagOn,
  shopProofHours,
  hasToken,
  liveToken,
  linkedShopifyCustomerId,
  shopifyCustomerId,
}) {
  const linked = linkedShopifyCustomerId == null ? null : String(linkedShopifyCustomerId);
  const own = String(shopifyCustomerId);
  const tokenFlag = hasToken === true;
  if (linked != null && linked !== own) {
    return { action: "handover", proof: shopRecognitionProof({ hasToken: tokenFlag, shopProofHours }), hasToken: tokenFlag, alreadySignedIn: false, noCode: "handover" };
  }
  const alreadySignedIn = linked != null && linked === own;
  const proof = shopRecognitionProof({ hasToken: liveToken === true, shopProofHours });
  if (flagOn !== true) return { action: "no_code", proof, hasToken: tokenFlag, alreadySignedIn, noCode: "flag_off" };
  if (proof === "none") return { action: "no_code", proof, hasToken: tokenFlag, alreadySignedIn, noCode: "no_proof" };
  return { action: "issue", proof, hasToken: tokenFlag, alreadySignedIn, noCode: null };
}

/**
 * The proof behind an existing signed-in link. customer_account → token (the
 * caller still checks the live token). app_proxy → shop while the shop proof
 * counts and the link was authenticated within the window (at most 60 s in
 * the future), else token (it then needs a chat token, the old rule).
 * Anything else → null (not signed in).
 *
 * @param {{ linkKind: unknown, authenticatedAt: unknown, nowMs: number, shopProofHours: number }} input
 * @returns {"token" | "shop" | null}
 */
export function signedInProofFor({ linkKind, authenticatedAt, nowMs, shopProofHours }) {
  if (linkKind === "customer_account") return "token";
  if (linkKind !== "app_proxy") return null;
  const hours = Number(shopProofHours);
  if (!(hours > 0)) return "token";
  const at =
    authenticatedAt instanceof Date
      ? authenticatedAt.getTime()
      : typeof authenticatedAt === "string"
        ? Date.parse(authenticatedAt)
        : Number.NaN;
  if (!Number.isFinite(at)) return "token";
  if (at > nowMs + 60_000) return "token";
  if (nowMs - at > hours * 3_600_000) return "token";
  return "shop";
}

/**
 * The note on a consent_events row of a Mo opt-in made while signed in, so the
 * Art. 7(1) record shows which sign-in stood behind it.
 * @param {unknown} proof
 * @returns {string | null}
 */
export function signInProofNote(proof) {
  if (proof === "token") return "Anmeldenachweis: Kundenkonto-Anmeldung im Chat";
  if (proof === "shop") return "Anmeldenachweis: Shop-Login (App Proxy)";
  return null;
}
