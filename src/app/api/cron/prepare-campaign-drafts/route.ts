// Nightly „Vorbereiten“ for the Kampagne review desk (docs/CAMPAIGNS.md):
// draft the next N pending contacts so the queue is full when the operator
// starts the day. Runs after the audience sync (02:30) and the catalog sync
// (03:00) — see vercel.json — so every draft is written from fresh data.
//
// OFF by default: generation costs API money, so CAMPAIGN_AUTO_PREPARE_COUNT
// (0 = skip) is the deployment's explicit decision (campaign-flags.mjs). The
// run is chunked like the desk's own Vorbereiten, stops when the pending
// contacts run out and keeps inside the function-duration limit. Nothing is
// ever SENT here — every draft still needs a human on the desk.
//
// Protected by CRON_SECRET — Vercel Cron sends Authorization: Bearer <secret>.
// Manual invocation: curl -H "Authorization: Bearer $CRON_SECRET" $URL

import { NextResponse } from "next/server";
import { campaignAutoPrepareConfig } from "@/lib/campaign-flags.mjs";
import { prepareNextDrafts } from "@/lib/campaign-prepare";
import { isDbConfigured } from "@/lib/db";
import { reportError } from "@/lib/observability";
import { requireCronAuth } from "@/lib/cron-auth";

export const maxDuration = 300;

// Contacts per prepare call (the same chunking the desk uses) and the time
// budget that keeps the last chunk inside maxDuration.
const CHUNK = 5;
const TIME_BUDGET_MS = 240_000;

async function handle(req: Request): Promise<Response> {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const config = campaignAutoPrepareConfig();
  if (config.count === 0) {
    return NextResponse.json({ ok: true, skipped: "disabled", ...config });
  }
  if (!isDbConfigured()) {
    return NextResponse.json({ ok: false, error: "No database configured" }, { status: 503 });
  }

  const startedAt = Date.now();
  const totals = { requested: config.count, prepared: 0, failed: 0, suppressed: 0, exhausted: false };
  try {
    for (let done = 0; done < config.count; done += CHUNK) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;
      const count = Math.min(CHUNK, config.count - done);
      const result = await prepareNextDrafts(count, config.discountPercent, config.textMode);
      totals.prepared += result.prepared;
      totals.failed += result.failed;
      totals.suppressed += result.suppressed;
      if (result.exhausted) {
        totals.exhausted = true;
        break;
      }
    }
    console.log("[cron/prepare-campaign-drafts] done", totals);
    return NextResponse.json({ ok: true, ...totals, textMode: config.textMode, discountPercent: config.discountPercent });
  } catch (err) {
    reportError(err, { route: "api/cron/prepare-campaign-drafts" });
    return NextResponse.json({ ok: false, error: (err as Error).message, ...totals }, { status: 503 });
  }
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  // Vercel Cron uses GET by default — accept both.
  return handle(req);
}
