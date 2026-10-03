// Release job for „Freigeben" (every 10 minutes, see vercel.json).
//
// Sends the campaign mails a person approved on the review desk once their
// release time has come — one at a time, at most CAMPAIGN_RELEASE_MAX_PER_RUN
// per run, CAMPAIGN_RELEASE_SPACING_MS apart — through approveAndSendCampaign,
// so every legal gate runs at send time. A mail that changed after the approval
// or that a gate refuses goes back to the review queue with the reason; nothing
// is retried automatically. Also recovers rows a timeout left in 'sending'.
// Does nothing unless CAMPAIGN_RELEASE_ENABLED is on. lib/campaign-release.ts.
//
// Protected by CRON_SECRET — Vercel Cron sends Authorization: Bearer <secret>.

import { NextResponse } from "next/server";
import { isDbConfigured } from "@/lib/db";
import { releaseDueCampaignMails } from "@/lib/campaign-release";
import { reportError } from "@/lib/observability";
import { requireCronAuth } from "@/lib/cron-auth";

export const maxDuration = 300;

async function handle(req: Request): Promise<Response> {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  if (!isDbConfigured()) {
    return NextResponse.json({ ok: false, error: "No database configured" }, { status: 503 });
  }
  const startedAt = Date.now();
  try {
    const result = await releaseDueCampaignMails({ deadlineMs: startedAt + 240_000 });
    console.log("[cron/release-campaign-mails] done", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    reportError(err, { route: "api/cron/release-campaign-mails" });
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 503 });
  }
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
