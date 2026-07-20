// Scheduled campaign-audience re-sync (docs/CAMPAIGNS.md, Task A).
//
// Triggered daily by Vercel Cron (see vercel.json) so Shopify-side
// unsubscribes are caught and marked 'suppressed' without the admin having to
// click "Sync". Fail-safe by design: if a run fails, NOTHING is sent anyway —
// every campaign email still requires a human clicking Send behind the
// campaign gates, and the send path re-checks suppression per recipient.
//
// Protected by CRON_SECRET — Vercel Cron sends Authorization: Bearer <secret>.
// Manual invocation: curl -H "Authorization: Bearer $CRON_SECRET" $URL

import { NextResponse } from "next/server";
import { syncCampaignAudience } from "@/lib/campaign-sync";
import { reportError } from "@/lib/observability";
import { requireCronAuth } from "@/lib/cron-auth";

export const maxDuration = 300;

async function handle(req: Request): Promise<Response> {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  try {
    const result = await syncCampaignAudience();
    if (!result.ok) {
      // Not configured — visibly skipped rather than silently "succeeding".
      return NextResponse.json({ ok: false, error: result.message }, { status: 503 });
    }
    console.log("[cron/sync-campaign-audience] done", result);
    return NextResponse.json(result);
  } catch (err) {
    reportError(err, { route: "api/cron/sync-campaign-audience" });
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 503 }
    );
  }
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  // Vercel Cron uses GET by default — accept both.
  return handle(req);
}
