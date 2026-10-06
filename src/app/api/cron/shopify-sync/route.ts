// Every 5 minutes: the Shopify write-back outbox (consent changes, new
// Shopify customers for Mo-only subscribers, erasure requests) and — while an
// import runs — one more bounded import step, so a started import finishes
// even when nobody keeps the Einstellungen card open.
// docs/archive/CUSTOMER_PLATFORM_PLAN.md §6.2 (sync layer: import + outbox).
//
// Each part is gated by its own flag (SHOPIFY_CONSENT_WRITEBACK,
// SHOPIFY_ERASURE_SYNC, SHOPIFY_CUSTOMER_SYNC_ENABLED); with all off this is
// a no-op. Protected by CRON_SECRET.

import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { isDbConfigured } from "@/lib/db";
import { processShopifyOutbox } from "@/lib/shopify-outbox";
import { runCustomerImportStep } from "@/lib/shopify-sync";
import { reportError } from "@/lib/observability";

export const maxDuration = 120;

const TIME_BUDGET_MS = 100_000;

async function handle(req: Request): Promise<Response> {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  if (!isDbConfigured()) {
    return NextResponse.json({ ok: false, error: "No database configured" }, { status: 503 });
  }
  const deadlineMs = Date.now() + TIME_BUDGET_MS;
  try {
    const outbox = await processShopifyOutbox({ limit: 100, deadlineMs: Date.now() + 40_000 });
    let importStep: { done: boolean; waiting: boolean; reason?: string } | null = null;
    // Steps until the budget is spent or the import has nothing to do.
    while (Date.now() < deadlineMs - 20_000) {
      const step = await runCustomerImportStep({ deadlineMs: deadlineMs - 10_000 });
      importStep = { done: step.done, waiting: step.waiting, reason: step.reason };
      if (!step.ok || step.done || step.waiting) break;
    }
    return NextResponse.json({ ok: true, outbox, import: importStep });
  } catch (err) {
    reportError(err, { route: "api/cron/shopify-sync" });
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 503 });
  }
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  return handle(req);
}
