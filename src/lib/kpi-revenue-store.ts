// The Shopify code lookup of „Umsatz durch Mo“ (docs/ADMIN_DASHBOARD.md §5.1):
// the orders that redeemed a UNIQUE single-use discount code minted by Mo's
// outbound mail (MS5-… on marketing_sends, MK-… on campaign_sends; both
// usageLimit:1), asked of Shopify per code. See docs/CAMPAIGNS.md.
//
// Why it still exists next to the webhook ledger (`mo_orders`, which ingests
// every coded order too): the ledger only fills from the moment the orders
// webhooks were registered. This lookup finds the coded orders of a period that
// the ledger never saw; the pure mergeCodeRedemptions (lib/mo-revenue.mjs)
// drops every redemption the ledger already holds, so an order is counted once.
// `redemptions` carries the redeemed orders for that merge; the aggregate
// fields describe the lookup itself (checked, unknown, capped).
//
// Cost: a bounded per-code fan-out to Shopify (capped, newest-first, only codes
// minted on/before the window end), served from the 10-minute KPI cache
// (lib/kpi-cache). The money summation + realised-status policy live in the
// pure ./kpi-revenue-core.

import { getSql, type Sql } from "./db";
import { isShopifyConfigured } from "./shopify";
import { fetchCodeRedemption, type CodeRedemption } from "./shopify-orders";
import { summarizeRedemptions } from "./kpi-revenue-core.mjs";
import { reportError } from "./observability";
import type { KpiRange } from "./kpi-range";

// Bound the per-load Shopify fan-out: at most this many codes are checked for a
// redeeming order, newest-first (same cap discipline as the marketing funnel).
export const REVENUE_MAX_CODES = 100;

/** One redeemed Mo code and its order, as Shopify reported it. */
export interface MoCodeRedemption {
  code: string;
  orderName: string | null;
  createdAt: string | null;
  amount: number | null;
  currency: string | null;
  financialStatus: string | null;
}

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
  /** Every redeemed code in the window with its order (paid or not) — merged
   * with the ledger at render time (mergeCodeRedemptions). */
  redemptions: MoCodeRedemption[];
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
    // Candidate codes: sent marketing emails (MS5-) AND campaign emails (MK-)
    // that carried a code, minted on or before the window end, newest-first
    // across both channels, capped (+1 to detect truncation).
    const codeRows = (await sql`
      SELECT t.discount_code FROM (
        SELECT discount_code, sent_at
          FROM marketing_sends
         WHERE status = 'sent'
           AND discount_code IS NOT NULL
           AND sent_at < (${range.to}::date + 1)
        UNION ALL
        SELECT discount_code, sent_at
          FROM campaign_sends
         WHERE discount_code IS NOT NULL
           AND is_test = false
           AND sent_at < (${range.to}::date + 1)
      ) t
       ORDER BY t.sent_at DESC NULLS LAST
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
    const redemptions: MoCodeRedemption[] = [];
    results.forEach((r, i) => {
      if (r.status !== "redeemed") return;
      redemptions.push({
        code: codes[i],
        orderName: r.orderName,
        createdAt: r.createdAt,
        amount: r.amount,
        currency: r.currency,
        financialStatus: r.financialStatus,
      });
    });
    return {
      revenueAmount: summary.revenueAmount,
      currency: summary.currency ?? "EUR",
      orderCount: summary.orderCount,
      shopifyConfigured,
      codesChecked: summary.codesChecked,
      redemptionUnknown: summary.redemptionUnknown,
      codesInScope: codes.length,
      sampled,
      redemptions,
      range: { from: range.from, to: range.to, days: range.days, label: range.label },
    } satisfies MoRevenue;
  } catch (err) {
    reportError(err, { route: "lib/kpi-revenue-store", phase: "getMoRevenue" });
    return null;
  }
}
