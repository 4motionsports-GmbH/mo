// Nightly (01:45 UTC): catch everything a webhook may have missed — every
// Shopify customer and order changed since the last complete run — and then
// recompute the customer facts (lifecycle, value, churn, …) the Kunden list
// and the campaign audiences read. Replaces the old subscriber-only audience
// sync. docs/archive/CUSTOMER_PLATFORM_PLAN.md §6.2 (nightly reconciliation)
// and §6.4 (facts).
//
// Reports when no Shopify webhook arrived for more than two days (an outage:
// orders are no longer attributed). Reconcile is gated by
// SHOPIFY_CUSTOMER_SYNC_ENABLED; the facts run always
// (they also cover chat-only people). With SHOPIFY_WRITEBACK_ENABLED the fresh
// facts then queue Mo's `mo-…` customer tags for Shopify (lib/shopify-insights).
// Protected by CRON_SECRET.

import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { isDbConfigured } from "@/lib/db";
import { getSyncHealth, reconcileShopifyCustomers } from "@/lib/shopify-sync";
import { isWebhookQuiet } from "@/lib/shopify-sync-health.mjs";
import { isShopifyCustomerSyncEnabled } from "@/lib/platform-flags.mjs";
import { recomputeCustomerFacts } from "@/lib/customer-facts";
import { queueInsightWritebacks } from "@/lib/shopify-insights";
import { reportError } from "@/lib/observability";

export const maxDuration = 300;

async function handle(req: Request): Promise<Response> {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  if (!isDbConfigured()) {
    return NextResponse.json({ ok: false, error: "No database configured" }, { status: 503 });
  }
  const startedAt = Date.now();
  try {
    const reconcile = await reconcileShopifyCustomers({ deadlineMs: startedAt + 170_000 });
    const facts = await recomputeCustomerFacts({ deadlineMs: startedAt + 260_000 });
    const insightTags = await queueInsightWritebacks({ deadlineMs: startedAt + 285_000 });
    console.log("[cron/shopify-reconcile] done", { reconcile, facts, insightTags });
    // The reconcile covers the order copy, but attribution and instant consent
    // need the webhooks: report an outage once a night until it is fixed.
    if (isShopifyCustomerSyncEnabled()) {
      const health = await getSyncHealth();
      if (health && isWebhookQuiet(health.lastWebhookAt)) {
        reportError(new Error(`No Shopify webhook since ${health.lastWebhookAt} — check the subscriptions (npm run shopify:webhooks)`), {
          route: "api/cron/shopify-reconcile",
          phase: "webhooks-quiet",
        });
      }
    }
    return NextResponse.json({ ok: true, reconcile, facts, insightTags });
  } catch (err) {
    reportError(err, { route: "api/cron/shopify-reconcile" });
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 503 });
  }
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  return handle(req);
}
