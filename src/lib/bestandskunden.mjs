// §7 Abs. 3 UWG "Bestandskunden" (existing-customer) decision logic — kept in
// plain .mjs (pure, no I/O) so the part with real legal consequences is
// unit-tested in isolation, mirroring the email-offer-trigger.mjs /
// welcome-discount-flag.mjs convention. The DB reads/writes live in
// lib/bestandskunden-store.ts.
//
// ⚠️ SEPARATE LAWFUL BASIS — NEVER MERGE WITH DOI CONSENT. §7 Abs. 3 UWG lets a
// trader email an EXISTING customer about its OWN SIMILAR products WITHOUT prior
// opt-in consent, IF four conditions hold (all of them):
//   1. the address was obtained in connection with the SALE of a product,
//   2. it is used for direct advertising of the trader's OWN SIMILAR goods,
//   3. the customer has NOT objected (a SEPARATE, Bestandskunden-specific
//      opt-out, honoured independently of the DOI marketing suppression), and
//   4. the customer is told, clearly at collection AND in every message, that
//      they may object at any time at no cost beyond base transmission rates.
//
// This module answers ONLY the eligibility half of (1): does the customer have a
// COMPLETED PURCHASE in their Shopify order history? An account alone, an
// abandoned checkout (never an order at all), or a cancelled/voided/refunded
// order does NOT qualify. The "similar products" boundary (2) and the opt-out
// copy (4) are reviewed by the lawyer; real sends stay gated behind
// BESTANDSKUNDE_SENDS_APPROVED (default OFF) until that sign-off — see
// docs/CONSENT_FLOW.md.

/**
 * Shopify financial statuses that count as a COMPLETED purchase for §7(3):
 * money was actually received and not fully reversed.
 *   - PAID                — the sale completed.
 *   - PARTIALLY_REFUNDED  — a real purchase, only partly refunded; the kept
 *                           goods still establish the customer relationship.
 * Everything else is deliberately excluded:
 *   - PENDING / AUTHORIZED / EXPIRED — no completed payment.
 *   - VOIDED                          — the order was cancelled before capture.
 *   - REFUNDED                        — the sale was fully reversed.
 *   - null / unknown                  — we don't know, so we don't flag
 *                                       (fail-closed; "unknown" must never
 *                                       masquerade as "purchased").
 * The set is intentionally narrow and is the exact boundary the lawyer signs
 * off before BESTANDSKUNDE_SENDS_APPROVED is flipped on.
 */
export const BESTANDSKUNDE_COMPLETED_STATUSES = new Set([
  "PAID",
  "PARTIALLY_REFUNDED",
]);

/**
 * Whether a single order's financial status counts as a completed purchase.
 * Case-insensitive; null/blank/unknown → false.
 *
 * @param {string | null | undefined} financialStatus
 * @returns {boolean}
 */
export function isCompletedPurchaseStatus(financialStatus) {
  if (typeof financialStatus !== "string") return false;
  return BESTANDSKUNDE_COMPLETED_STATUSES.has(financialStatus.trim().toUpperCase());
}

/**
 * Decide §7(3) eligibility from a customer's cached Shopify order history
 * (lib/shopify-orders.ts OrderHistory, or the Customer-Account-API equivalent).
 * Eligible ⇔ at least one order is a COMPLETED purchase (see the status set).
 *
 * Defensive: a null/empty/malformed history → NOT eligible (fail-closed — an
 * unknown purchase state must never grant the §7(3) basis).
 *
 * @param {{ orders?: Array<{ financialStatus?: string | null }> } | null | undefined} orderHistory
 * @returns {boolean}
 */
export function isBestandskundeEligible(orderHistory) {
  if (!orderHistory || !Array.isArray(orderHistory.orders)) return false;
  return orderHistory.orders.some((o) => isCompletedPurchaseStatus(o?.financialStatus));
}

const TRUTHY = new Set(["1", "true", "yes", "on"]);

/**
 * Whether REAL §7(3) Bestandskunden sends are approved to go out. Reads
 * BESTANDSKUNDE_SENDS_APPROVED; defaults to FALSE (fail-closed) for any absent,
 * empty, or unrecognised value.
 *
 * ⚠️ This is a SEPARATE gate from CONSENT_COPY_LAWYER_APPROVED (which governs
 * the DOI-consented marketing path + personalisation). The §7(3) audience,
 * eligibility, suppression and opt-out are BUILT regardless, but no
 * existing-customer mail is sent until a lawyer has blessed the "own similar
 * products" boundary and the opt-out copy and this flag is flipped on.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function isBestandskundenSendsApproved(env = process.env) {
  const raw = env.BESTANDSKUNDE_SENDS_APPROVED;
  if (typeof raw !== "string") return false;
  return TRUTHY.has(raw.trim().toLowerCase());
}
