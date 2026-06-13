// Scheduled bundle-offer expiry sweep.
//
// Triggered by Vercel Cron (see vercel.json). Sweeps bundle offers that are
// status='active' AND past expires_at: archives their Shopify product (ARCHIVED,
// never deleted — preserves order history, reversible; spike §5) and flips the
// row to status='expired' + archived_at. Idempotent; archive failures are
// logged loudly and retried on the next run. A late click on an archived offer
// is handled gracefully by /api/r/<token> (the "Angebot abgelaufen" page).
//
// Protected by CRON_SECRET — Vercel Cron sends Authorization: Bearer <secret>.
// Manual invocation: curl -H "Authorization: Bearer $CRON_SECRET" $URL

import { NextResponse } from "next/server";
import { expireBundleOffers } from "@/lib/bundle-offers";
import { isDbConfigured } from "@/lib/db";
import { reportError } from "@/lib/observability";

export const maxDuration = 60;

function isAuthorized(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  return m[1] === expected;
}

async function handle(req: Request): Promise<Response> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isDbConfigured()) {
    // No DB — surface as 503 so the run is visibly skipped, not silently "ok".
    return NextResponse.json(
      { ok: false, error: "No database configured" },
      { status: 503 }
    );
  }
  try {
    const result = await expireBundleOffers();
    console.log("[cron/expire-bundles] done", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    reportError(err, { route: "api/cron/expire-bundles" });
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
