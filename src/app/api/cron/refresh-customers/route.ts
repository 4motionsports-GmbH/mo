// Scheduled customer-data refresh.
//
// Triggered by Vercel Cron (see vercel.json). Keeps each customer's cached
// Shopify data fresh WITHOUT the admin having to press "Käufe aktualisieren":
// order history (→ owned items + §7(3) Bestandskunde eligibility) and the lawful
// postal address. So drafts are never built on stale purchase/address data.
//
// Bounded per run (CUSTOMER_REFRESH_BATCH, default 25) over the MOST-STALE
// customers (purchase_summary older than CUSTOMER_REFRESH_STALE_HOURS, default
// 24), sequential to stay within Shopify rate limits — successive daily runs
// sweep the whole base. Reuses lib/customer-refresh (same path as the on-demand
// button). Does NOT touch the paid AI profile (that stays manual, by design).
//
// Protected by CRON_SECRET — Vercel Cron sends Authorization: Bearer <secret>.
// Manual: curl -H "Authorization: Bearer $CRON_SECRET" $URL

import { NextResponse } from "next/server";
import { listCustomersForDataRefresh } from "@/lib/customer-store";
import { refreshCustomerData } from "@/lib/customer-refresh";
import { reportError } from "@/lib/observability";

export const maxDuration = 300;

function isAuthorized(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] === expected : false;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function handle(req: Request): Promise<Response> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const batch = intEnv("CUSTOMER_REFRESH_BATCH", 25);
  const staleHours = intEnv("CUSTOMER_REFRESH_STALE_HOURS", 24);
  const staleBefore = new Date(Date.now() - staleHours * 3_600_000).toISOString();

  try {
    const candidates = await listCustomersForDataRefresh(batch, staleBefore);
    let refreshed = 0;
    let failed = 0;
    for (const c of candidates) {
      const result = await refreshCustomerData(c);
      if (result.ok) refreshed++;
      else failed++;
    }
    const summary = { considered: candidates.length, refreshed, failed, batch, staleHours };
    console.log("[cron/refresh-customers] done", summary);
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    reportError(err, { route: "api/cron/refresh-customers" });
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 503 });
  }
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  // Vercel Cron uses GET by default — accept both.
  return handle(req);
}
