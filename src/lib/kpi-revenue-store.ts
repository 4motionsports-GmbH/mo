// "Umsatz über Mo-Rabattcodes" — the revenue attributable to Mo, computed
// HONESTLY from the ONLY signal that ties an order back to Mo and exposes its
// value: a UNIQUE single-use discount code minted by Mo's marketing flow
// (MS5-… codes on marketing_sends, usageLimit:1). See docs/ADMIN_DASHBOARD.md.
//
// Deliberately NOT counted (no reliable attribution exists for them):
//   - plain in-chat / summary cart permalinks — they carry NO discount, UTM, or
//     marker, so the resulting order is indistinguishable from any storefront
//     order. Inventing attribution here would be misleading.
//   - bundle offers — we track the CLICK (kpi_events) but not the purchase.
//   - the welcome code — that automatic discount has been retired.
//
// Cost: a bounded per-code fan-out to Shopify (capped, newest-first, only codes
// minted on/before the window end), mirroring the marketing funnel's pattern. The
// money summation + realised-status policy live in the pure ./kpi-revenue-core.

import { getSql, type Sql } from "./db";
import { isShopifyConfigured } from "./shopify";
import { fetchCodeRedemption, type CodeRedemption } from "./shopify-orders";
import { summarizeRedemptions } from "./kpi-revenue-core.mjs";
import { reportError } from "./observability";
import type { KpiRange } from "./kpi-range";

// Bound the per-load Shopify fan-out: at most this many codes are checked for a
// redeeming order, newest-first (same cap discipline as the marketing funnel).
export const REVENUE_MAX_CODES = 100;

export interface MoRevenue {
  /** Sum of realised (paid) order totals attributed to Mo, in the window. */
  revenueAmount: number;
  /** Currency of the counted orders (shop currency; EUR for this store). */
  currency: string;
  /** Orders that contributed to revenue. */
  orderCount: number;
  /** Whether Shopify is wired up (false ⇒ revenue is unknowable). */
  shopifyConfigured: boolean;
  /** Codes actually checked against Shopify (capped sample). */
  codesChecked: number;
  /** Codes where Shopify couldn't answer (unconfigured / error) — not counted. */
  redemptionUnknown: number;
  /** Sent, coded marketing emails in scope (minted on/before the window end). */
  codesInScope: number;
  /** True when the checked set was truncated to REVENUE_MAX_CODES. */
  sampled: boolean;
  /** Echo of the window, for the caveat/label. */
  range: { from: string; to: string; days: number; label: string };
}

/**
 * Revenue attributed to Mo for `range`: sum the actually-paid totals of orders
 * that redeemed a Mo marketing code WITHIN the window. `sent_at <= window end`
 * bounds the candidate codes (a code minted after the window can't be redeemed
 * inside it); the per-order date filter happens in fetchCodeRedemption. Returns
 * null only when no DB is configured. Never throws.
 */
export async function getMoRevenue(
  range: KpiRange,
  sql: Sql | null = getSql()
): Promise<MoRevenue | null> {
  if (!sql) return null;
  const shopifyConfigured = isShopifyConfigured();

  try {
    // Candidate codes: sent marketing emails that carried a code, minted on or
    // before the window end, newest-first, capped (+1 to detect truncation).
    const codeRows = (await sql`
      SELECT discount_code
        FROM marketing_sends
       WHERE status = 'sent'
         AND discount_code IS NOT NULL
         AND sent_at < (${range.to}::date + 1)
       ORDER BY sent_at DESC NULLS LAST, id DESC
       LIMIT ${REVENUE_MAX_CODES + 1}
    `) as Array<{ discount_code: string }>;

    const sampled = codeRows.length > REVENUE_MAX_CODES;
    const codes = codeRows.slice(0, REVENUE_MAX_CODES).map((r) => String(r.discount_code));

    let results: CodeRedemption[];
    if (shopifyConfigured && codes.length > 0) {
      results = await Promise.all(
        codes.map((c) => fetchCodeRedemption(c, { from: range.from, to: range.to }))
      );
    } else {
      // Can't check — every coded send is "unknown" rather than "zero revenue".
      results = codes.map(() => ({ status: "unknown" as const }));
    }

    const summary = summarizeRedemptions(results);
    return {
      revenueAmount: summary.revenueAmount,
      currency: summary.currency ?? "EUR",
      orderCount: summary.orderCount,
      shopifyConfigured,
      codesChecked: summary.codesChecked,
      redemptionUnknown: summary.redemptionUnknown,
      codesInScope: codes.length,
      sampled,
      range: { from: range.from, to: range.to, days: range.days, label: range.label },
    } satisfies MoRevenue;
  } catch (err) {
    reportError(err, { route: "lib/kpi-revenue-store", phase: "getMoRevenue" });
    return null;
  }
}
