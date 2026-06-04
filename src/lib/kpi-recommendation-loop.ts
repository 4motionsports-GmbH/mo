// The "recommendation → purchase" loop — the headline ROI number.
//
// For every marketing-eligible contact (DOI-confirmed, not unsubscribed, not
// suppressed) we bridge READ-ONLY to their conversation via the pseudonymous
// session_id (Cluster A ↔ Cluster B, same bridge the marketing tab uses), then
// ask Shopify what that email actually bought (read_orders). If a recommended
// product turns up in a real order, that contact counts as a "recommendation →
// purchase".
//
// ⚠️ Honest limitations (surfaced in the UI):
//   - Covers ONLY users who gave an email AND confirmed consent — a minority of
//     all chatters, and not all buyers.
//   - Product matching is by NORMALISED handle (see kpi-match.mjs); a renamed or
//     archived product can be missed.
//   - Capped at RECOMMENDATION_LOOP_MAX_CONTACTS recent contacts to bound the
//     number of Shopify calls per dashboard load — it is a sample, not a census.

import { getSql, type Sql } from "./db";
import { loadConversationForSummary } from "./conversation-store";
import { fetchPurchasedItemsByEmail } from "./shopify-orders";
import { isShopifyConfigured } from "./shopify";
import { hasRecommendedPurchase } from "./kpi-match.mjs";
import { reportError } from "./observability";

const RECOMMENDATION_LOOP_MAX_CONTACTS = 100;

export interface RecommendationLoopResult {
  /** Whether Shopify is wired up at all (false ⇒ the rate is unknowable). */
  shopifyConfigured: boolean;
  /** Eligible contacts examined (capped sample). */
  contactsExamined: number;
  /** Of those, contacts whose chat actually recommended ≥1 product. */
  withRecommendation: number;
  /** Of those, contacts with a known purchase (Shopify answered, non-empty). */
  withPurchase: number;
  /** Of those, contacts whose order contained a recommended product. */
  withRecommendedPurchase: number;
  /** Contacts where Shopify couldn't answer (unconfigured / error). */
  purchaseUnknown: number;
  /** withRecommendedPurchase / withPurchase — null when denominator is 0. */
  recommendationToPurchaseRate: number | null;
  /** True when the eligible set was truncated to the cap. */
  sampled: boolean;
}

interface EligibleContact {
  email: string;
  sessionId: string;
}

/**
 * Compute the recommendation→purchase loop. Returns null only when no DB is
 * configured; otherwise always returns a result (degrading to "unknown" rates
 * when Shopify is unavailable). Never throws.
 */
export async function getRecommendationLoop(
  sql: Sql | null = getSql()
): Promise<RecommendationLoopResult | null> {
  if (!sql) return null;

  const shopifyConfigured = isShopifyConfigured();

  let contacts: EligibleContact[] = [];
  let sampled = false;
  try {
    const rows = (await sql`
      SELECT ec.email, ec.session_id
        FROM email_captures ec
       WHERE ec.marketing_doi_status = 'confirmed'
         AND ec.unsubscribed_at IS NULL
         AND ec.session_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM suppression_list s WHERE s.email = ec.email)
       ORDER BY ec.doi_confirmed_at DESC NULLS LAST, ec.id DESC
       LIMIT ${RECOMMENDATION_LOOP_MAX_CONTACTS + 1}
    `) as Array<{ email: string; session_id: string }>;
    sampled = rows.length > RECOMMENDATION_LOOP_MAX_CONTACTS;
    contacts = rows.slice(0, RECOMMENDATION_LOOP_MAX_CONTACTS).map((r) => ({
      email: String(r.email),
      sessionId: String(r.session_id),
    }));
  } catch (err) {
    reportError(err, { route: "lib/kpi-recommendation-loop", phase: "listContacts" });
    return {
      shopifyConfigured,
      contactsExamined: 0,
      withRecommendation: 0,
      withPurchase: 0,
      withRecommendedPurchase: 0,
      purchaseUnknown: 0,
      recommendationToPurchaseRate: null,
      sampled: false,
    };
  }

  const outcomes = await Promise.all(
    contacts.map(async (c) => {
      const conversation = await loadConversationForSummary(c.sessionId);
      const recommended = conversation?.recommendedProductIds ?? [];
      if (recommended.length === 0) {
        return { hasRecommendation: false } as const;
      }
      // Only worth a Shopify call when we recommended something.
      const purchased = await fetchPurchasedItemsByEmail(c.email);
      if (purchased === null) {
        return { hasRecommendation: true, purchaseKnown: false } as const;
      }
      if (purchased.length === 0) {
        return { hasRecommendation: true, purchaseKnown: true, hasPurchase: false } as const;
      }
      const match = hasRecommendedPurchase(
        recommended,
        purchased.map((p) => p.handle)
      );
      return {
        hasRecommendation: true,
        purchaseKnown: true,
        hasPurchase: true,
        match,
      } as const;
    })
  );

  let withRecommendation = 0;
  let withPurchase = 0;
  let withRecommendedPurchase = 0;
  let purchaseUnknown = 0;
  for (const o of outcomes) {
    if (!o.hasRecommendation) continue;
    withRecommendation++;
    if (!o.purchaseKnown) {
      purchaseUnknown++;
      continue;
    }
    if (o.hasPurchase) {
      withPurchase++;
      if (o.match) withRecommendedPurchase++;
    }
  }

  return {
    shopifyConfigured,
    contactsExamined: contacts.length,
    withRecommendation,
    withPurchase,
    withRecommendedPurchase,
    purchaseUnknown,
    recommendationToPurchaseRate:
      withPurchase > 0 ? withRecommendedPurchase / withPurchase : null,
    sampled,
  };
}
