// Nightly (02:30 UTC, after the reconcile and the facts): end every campaign
// whose end date passed and refresh the recipients of every active one from
// its audience — new matches join dynamic campaigns, people who lost consent
// or got blocked are suppressed, laufend campaigns re-admit people after
// their re-entry period; campaigns with letters (0074) refresh their letter
// recipients and fetch purchase addresses for the open ones
// (CAMPAIGN_LETTER_ADDRESS_NIGHTLY). Nothing is drafted or sent here.
// docs/CAMPAIGNS.md §2.3. Protected by CRON_SECRET.

import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { isDbConfigured } from "@/lib/db";
import { listCampaigns, refreshLiveAudiences } from "@/lib/campaigns-store";
import { nightlyLetterAddresses } from "@/lib/campaign-letters";
import { reportError } from "@/lib/observability";

export const maxDuration = 300;

async function handle(req: Request): Promise<Response> {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  if (!isDbConfigured()) {
    return NextResponse.json({ ok: false, error: "No database configured" }, { status: 503 });
  }
  try {
    const deadline = Date.now() + 260_000;
    const result = await refreshLiveAudiences({ deadlineMs: deadline - 60_000 });
    // Letters (0074): purchase addresses for open letter recipients.
    const letterAddresses = await nightlyLetterAddresses(await listCampaigns({}), deadline);
    console.log("[cron/campaign-audiences] done", { ...result, letterAddresses });
    return NextResponse.json({ ok: true, ...result, letterAddresses });
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
