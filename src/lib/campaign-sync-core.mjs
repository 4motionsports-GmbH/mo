// Campaign audience-sync mapping + status planning (pure, no I/O) — the
// testable half of src/lib/campaign-sync.ts. The GraphQL transport stays in
// shopify-customers.ts; everything decision-shaped lives here so node:test can
// exercise it on fixture nodes without touching Shopify.

import { deriveCampaignLanguage } from "./campaign-language.mjs";

/** The only marketingState we ever store — anyone else is never a contact. */
export const SUBSCRIBED = "SUBSCRIBED";

/**
 * Normalised opt-in levels. Anything Shopify reports outside this set is
 * conservatively mapped to UNKNOWN (which is send-blocked by default).
 */
const KNOWN_OPT_IN_LEVELS = new Set(["CONFIRMED_OPT_IN", "SINGLE_OPT_IN", "UNKNOWN"]);

/**
 * Convert a Shopify decimal money string (e.g. "129.95") to integer cents.
 * Non-numeric / absent → 0.
 * @param {string | null | undefined} amount
 * @returns {number}
 */
export function moneyToCents(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

/**
 * Map one raw Shopify Customer node to a campaign_contacts upsert row, or null
 * when the customer must NOT be stored: no usable email, or — the hard legal
 * rule — marketingState !== SUBSCRIBED. The GraphQL query already filters with
 * `email_marketing_state:SUBSCRIBED`, but the filter is an optimization; THIS
 * check is the guarantee (fail-closed on a missing consent block).
 *
 * @param {{
 *   id?: string | null,
 *   email?: string | null,
 *   firstName?: string | null,
 *   lastName?: string | null,
 *   locale?: string | null,
 *   numberOfOrders?: string | number | null,
 *   amountSpent?: { amount?: string | null } | null,
 *   defaultAddress?: { countryCodeV2?: string | null } | null,
 *   emailMarketingConsent?: {
 *     marketingState?: string | null,
 *     marketingOptInLevel?: string | null,
 *     consentUpdatedAt?: string | null,
 *   } | null,
 * }} node
 * @returns {{
 *   shopifyCustomerId: string,
 *   email: string,
 *   firstName: string | null,
 *   lastName: string | null,
 *   language: "de" | "en",
 *   optInLevel: string,
 *   consentUpdatedAt: string | null,
 *   ordersCount: number,
 *   totalSpentCents: number,
 *   lastOrderAt: string|null,
 * } | null}
 */
/**
 * Normalise a Shopify timestamp to an ISO string, or null. Anything
 * unparseable becomes null rather than a bogus date — a wrong purchase date
 * would put the contact in the wrong lifecycle segment.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function isoOrNull(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function mapCustomerToContact(node) {
  if (!node || typeof node.id !== "string" || !node.id) return null;
  const email = typeof node.email === "string" ? node.email.trim().toLowerCase() : "";
  if (!email) return null;

  const consent = node.emailMarketingConsent ?? null;
  if (consent?.marketingState !== SUBSCRIBED) return null;

  const rawLevel =
    typeof consent.marketingOptInLevel === "string"
      ? consent.marketingOptInLevel.trim().toUpperCase()
      : "";
  const optInLevel = KNOWN_OPT_IN_LEVELS.has(rawLevel) ? rawLevel : "UNKNOWN";

  const ordersCount = Number(node.numberOfOrders);

  return {
    shopifyCustomerId: node.id,
    email,
    firstName: node.firstName?.trim() || null,
    lastName: node.lastName?.trim() || null,
    language: deriveCampaignLanguage({
      locale: node.locale ?? null,
      countryCode: node.defaultAddress?.countryCodeV2 ?? null,
    }),
    optInLevel,
    consentUpdatedAt: consent.consentUpdatedAt ?? null,
    ordersCount: Number.isFinite(ordersCount) && ordersCount > 0 ? Math.floor(ordersCount) : 0,
    totalSpentCents: moneyToCents(node.amountSpent?.amount),
    // Most recent order date — the lifecycle segment's time axis. Unparseable
    // or absent (never ordered) stays null, which reads as "unknown segment"
    // and leaves the contact's behaviour unchanged.
    lastOrderAt: isoOrNull(node.lastOrder?.createdAt),
  };
}

/**
 * Decide the STATUS a contact row should carry after a sync pass:
 *
 *   - locally suppressed (our suppression list / unsubscribed capture) OR no
 *     longer SUBSCRIBED on Shopify → 'suppressed' — the row is never deleted
 *     mid-campaign (audit trail), it is marked.
 *   - previously 'suppressed' but now eligible again (re-subscribed on the
 *     Shopify side AND not on our list) → back to 'pending' (fresh consent; a
 *     LOCAL opt-out can never be undone by a sync because `locallySuppressed`
 *     wins above).
 *   - anything else keeps its current workflow status ('sent' stays sent,
 *     'drafted' stays drafted, …); brand-new rows start 'pending'.
 *
 * @param {string | null} currentStatus  existing row status, or null when new
 * @param {{ shopifyEligible: boolean, locallySuppressed: boolean }} input
 * @returns {string}
 */
export function planContactStatus(currentStatus, input) {
  if (input.locallySuppressed || !input.shopifyEligible) return "suppressed";
  if (!currentStatus) return "pending";
  if (currentStatus === "suppressed") return "pending";
  return currentStatus;
}
