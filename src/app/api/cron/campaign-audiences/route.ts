// Nightly (02:30 UTC, after the reconcile and the facts): end every campaign
// whose end date passed and refresh the recipients of every active one from
// its audience — new matches join dynamic campaigns, people who lost consent
// or got blocked are suppressed, laufend campaigns re-admit people after
// their re-entry period. Nothing is drafted or sent here.
// docs/CAMPAIGNS.md §2.3. Protected by CRON_SECRET.

import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { isDbConfigured } from "@/lib/db";
import { refreshLiveAudiences } from "@/lib/campaigns-store";
import { reportError } from "@/lib/observability";

export const maxDuration = 300;

async function handle(req: Request): Promise<Response> {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  if (!isDbConfigured()) {
    return NextResponse.json({ ok: false, error: "No database configured" }, { status: 503 });
  }
  try {
    const result = await refreshLiveAudiences({ deadlineMs: Date.now() + 260_000 });
    console.log("[cron/campaign-audiences] done", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    reportError(err, { route: "api/cron/campaign-audiences" });
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 503 });
  }
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  return handle(req);
}
