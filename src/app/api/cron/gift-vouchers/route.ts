// Every 5 minutes: the Geschenkgutschein sweep (docs/GIFT_VOUCHERS.md,
// lib/gift-voucher-issue.ts runGiftVoucherSweep) — whatever the orders/paid
// webhook's after() did not finish: due units (issue, retries, units revoked
// before they became a card), revocation flags of issued cards, due mails,
// the print queue (submit behind GIFT_VOUCHER_PRINT_SENDS_APPROVED, poll
// print.one, clean up print files), balances older than 24 h and — with
// GIFT_VOUCHER_FULFILL_ORDERS — the fulfilment of voucher lines in Shopify.
//
// Rows are leased (FOR UPDATE SKIP LOCKED + locked_until), so the sweep and a
// webhook's after() never work on the same voucher at once. Before migration
// 0083 the sweep is a no-op. Protected by CRON_SECRET (GET for Vercel Cron,
// POST for a manual run).

import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { isDbConfigured } from "@/lib/db";
import { giftVoucherTablesExist } from "@/lib/gift-voucher-store";
import { runGiftVoucherSweep } from "@/lib/gift-voucher-issue";
import { reportError } from "@/lib/observability";

export const maxDuration = 120;

// Leaves room for the step that is running when the budget ends (each
// Shopify call is bounded at 30 s in the client).
const TIME_BUDGET_MS = 100_000;

async function handle(req: Request): Promise<Response> {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  if (!isDbConfigured()) {
    return NextResponse.json({ ok: false, error: "No database configured" }, { status: 503 });
  }
  try {
    if (!(await giftVoucherTablesExist())) {
      return NextResponse.json({ ok: true, skipped: "migration_missing" });
    }
    const sweep = await runGiftVoucherSweep({ deadlineMs: Date.now() + TIME_BUDGET_MS });
    return NextResponse.json({ ok: true, ...sweep });
  } catch (err) {
    reportError(err, { route: "api/cron/gift-vouchers" });
    return NextResponse.json({ ok: false, error: "Gift voucher sweep failed" }, { status: 503 });
  }
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  return handle(req);
}
