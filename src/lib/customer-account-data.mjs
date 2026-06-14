// Pure transforms for the SIGNED-IN (tier-3) Customer Account data — no I/O, so
// they unit-test without a DB or network (same pattern as customer-merge.mjs).
//
// Two jobs:
//   1. Normalise the Customer Account API `customer { … }` GraphQL node into the
//      SAME shapes the rest of the app already consumes — the OrderHistory blob
//      cached on customers.purchase_summary (migration 0008) and a compact,
//      DATA-MINIMISED account summary (name + city/country) for the chat
//      greeting and the marketing profile.
//   2. Decide whether a signed-in customer's HISTORY may be used to PERSONALISE
//      (the consent gate). The authenticated session is the re-identification;
//      the consent-to-use-history-for-personalisation requirement is unchanged
//      from tier 2 (CONSENT_COPY_LAWYER_APPROVED + marketing consent).
//
// ⚠️ Customer Account API field shapes differ from the Admin Customer object and
// MUST be re-verified against the rendered schema (see the verify gate in
// docs/CUSTOMER_ACCOUNT.md). These mappers read DEFENSIVELY so a renamed/absent
// optional field degrades (fewer items) rather than throwing.

// Keep the cached history bounded the same way the Admin path does.
export const CA_ORDER_HISTORY_MAX_ORDERS = 20;
export const CA_ORDER_MAX_LINE_ITEMS = 25;

/** Best display name: displayName → "first last" → first → null. */
export function deriveDisplayName(identity) {
  if (!identity) return null;
  const dn = typeof identity.displayName === "string" ? identity.displayName.trim() : "";
  if (dn) return dn;
  const joined = [identity.firstName, identity.lastName]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean)
    .join(" ");
  return joined || null;
}

/**
 * Normalise a Customer Account API `orders` connection into the OrderHistory
 * shape cached on customers.purchase_summary (lib/shopify-orders.ts). The
 * Customer Account Order uses `processedAt` (not Admin's `createdAt`),
 * `totalPrice` as a flat MoneyV2 (not Admin's `currentTotalPriceSet.shopMoney`),
 * and `financialStatus` (not `displayFinancialStatus`). Line items expose only
 * a title + quantity (no Admin-style product handle), so `handle` stays null —
 * owned-item matching for tier 3 falls back to titles, which is all the live
 * chat surfaces anyway.
 */
export function mapCustomerAccountOrders(customerNode, opts = {}) {
  const maxOrders = opts.maxOrders ?? CA_ORDER_HISTORY_MAX_ORDERS;
  const maxLineItems = opts.maxLineItems ?? CA_ORDER_MAX_LINE_ITEMS;
  const nodes = Array.isArray(customerNode?.orders?.nodes) ? customerNode.orders.nodes : [];

  const orders = nodes.slice(0, maxOrders).map((o) => {
    const money = o?.totalPrice ?? null;
    const liNodes = Array.isArray(o?.lineItems?.nodes) ? o.lineItems.nodes : [];
    return {
      name: typeof o?.name === "string" ? o.name : "",
      createdAt: o?.processedAt ?? o?.createdAt ?? null,
      totalAmount: money && money.amount != null ? String(money.amount) : null,
      currencyCode: money && money.currencyCode != null ? String(money.currencyCode) : null,
      financialStatus: o?.financialStatus ?? null,
      items: liNodes.slice(0, maxLineItems).map((li) => ({
        title: (typeof li?.title === "string" && li.title) || (typeof li?.name === "string" && li.name) || null,
        handle: typeof li?.product?.handle === "string" ? li.product.handle : null,
        quantity: Number(li?.quantity) || 0,
      })),
    };
  });

  return {
    orders,
    truncated: nodes.length >= maxOrders,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Compact, DATA-MINIMISED address context for the greeting / profile: the
 * default address's city + ISO country code ONLY (never the street). The
 * Customer Account API CustomerAddress exposes `territoryCode` (ISO country);
 * we fall back across a couple of documented field names defensively.
 */
export function buildAddressContext(customerNode) {
  const a = customerNode?.defaultAddress ?? null;
  if (!a) return null;
  const city = typeof a.city === "string" && a.city.trim() ? a.city.trim() : null;
  const countryCode =
    (typeof a.territoryCode === "string" && a.territoryCode.trim()) ||
    (typeof a.countryCodeV2 === "string" && a.countryCodeV2.trim()) ||
    null;
  if (!city && !countryCode) return null;
  return { city, countryCode: countryCode || null };
}

/** Count of saved addresses (defensive — the connection may be absent). */
export function countAddresses(customerNode) {
  const nodes = customerNode?.addresses?.nodes;
  if (Array.isArray(nodes)) return nodes.length;
  return customerNode?.defaultAddress ? 1 : 0;
}

/**
 * The compact account summary cached on customers.shopify_account_summary
 * (migration 0015). Name + address context + counts only — never raw street
 * addresses or order totals.
 */
export function buildAccountSummary(customerNode) {
  return {
    displayName: deriveDisplayName(customerNode),
    firstName: typeof customerNode?.firstName === "string" && customerNode.firstName.trim()
      ? customerNode.firstName.trim()
      : null,
    addressContext: buildAddressContext(customerNode),
    addressCount: countAddresses(customerNode),
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * THE PERSONALISATION CONSENT GATE for a signed-in (tier-3) customer.
 *
 * Re-identification is the authenticated session itself (no in-session email
 * capture needed). But using their PURCHASE HISTORY / PROFILE to personalise
 * the live chat or the marketing profile is the SAME purpose tier 2 needs
 * consent for, and that requirement is UNCHANGED. So history-personalisation
 * resolves only when BOTH hold:
 *
 *   1. lawyerApproved — the consent/privacy copy that covers "profile building
 *      from past interactions and purchases" is legally signed off
 *      (CONSENT_COPY_LAWYER_APPROVED). Until then this is a hard release gate:
 *      NOTHING personalised leaks for anyone.
 *   2. The customer has given the affirmative, unbundled, double-opt-in
 *      MARKETING consent (marketing_status = 'confirmed') — the same consent
 *      vehicle the GDPR TODO (docs/CUSTOMERS.md) extends to cover
 *      personalisation from past conversations + purchases. Signing in
 *      establishes IDENTITY, never this consent.
 *
 * Fails closed: a non-consented or anonymous user resolves to `false`, so only
 * the authenticated greeting-by-name (which uses the session's own identity, not
 * its history) is ever shown to them.
 */
export function canPersonaliseSignedIn({ lawyerApproved, marketingStatus }) {
  return Boolean(lawyerApproved) && marketingStatus === "confirmed";
}
