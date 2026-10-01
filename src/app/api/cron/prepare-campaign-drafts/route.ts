// Nightly „Vorbereiten“ for the campaign review desks (docs/CAMPAIGNS.md):
// draft the next pending recipients so the queues are full when the operator
// starts the day. Runs after the reconcile (01:45), the audience refresh
// (02:30) and the catalog sync (03:00) — see vercel.json — so every draft is
// written from fresh data.
//
// OFF by default: generation costs API money. CAMPAIGN_AUTO_PREPARE_COUNT
// (0 = skip) is the deployment's nightly BUDGET across all campaigns; each
// live campaign takes its own auto_prepare_per_day from it, highest priority
// first (campaign-def.planAutoPrepare). Legacy mode: when no campaign set a
// per-day figure, the whole budget goes to the lifecycle campaign with the
// CAMPAIGN_AUTO_PREPARE_* offer settings — the behaviour before campaigns.
// Nothing is ever SENT here — every draft still needs a human on the desk.
//
// Protected by CRON_SECRET — Vercel Cron sends Authorization: Bearer <secret>.

import { NextResponse } from "next/server";
import { campaignAutoPrepareConfig } from "@/lib/campaign-flags.mjs";
import { planAutoPrepare, isCampaignLive } from "@/lib/campaign-def.mjs";
import { prepareNextDrafts } from "@/lib/campaign-prepare";
import { listCampaigns } from "@/lib/campaigns-store";
import { isDbConfigured } from "@/lib/db";
import { reportError } from "@/lib/observability";
import { requireCronAuth } from "@/lib/cron-auth";

export const maxDuration = 300;

// Recipients per prepare call (the same chunking the desk uses) and the time
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
  const campaigns = await listCampaigns();
  let plan = planAutoPrepare(campaigns, config.count);
  let legacy = false;
  if (plan.length === 0) {
    const lifecycle = campaigns.find((c) => c.slug === "lebenszyklus" && isCampaignLive(c));
    if (lifecycle) {
      plan = [{ campaignId: lifecycle.id, count: config.count }];
      legacy = true;
    }
  }

  const perCampaign: Array<{ campaignId: number; prepared: number; failed: number; suppressed: number; exhausted: boolean }> = [];
  try {
    for (const entry of plan) {
      const totals = { campaignId: entry.campaignId, prepared: 0, failed: 0, suppressed: 0, exhausted: false };
      for (let done = 0; done < entry.count; done += CHUNK) {
        if (Date.now() - startedAt > TIME_BUDGET_MS) break;
        const result = await prepareNextDrafts({
          campaignId: entry.campaignId,
          count: Math.min(CHUNK, entry.count - done),
          ...(legacy
            ? { discountPercent: config.discountPercent, textMode: config.textMode, discountScope: config.discountScope }
            : {}),
        });
        totals.prepared += result.prepared;
        totals.failed += result.failed;
        totals.suppressed += result.suppressed;
        if (result.exhausted) {
          totals.exhausted = true;
          break;
        }
      }
      perCampaign.push(totals);
    }
    console.log("[cron/prepare-campaign-drafts] done", { legacy, perCampaign });
    return NextResponse.json({ ok: true, budget: config.count, legacy, perCampaign });
  } catch (err) {
    reportError(err, { route: "api/cron/prepare-campaign-drafts" });
    return NextResponse.json({ ok: false, error: (err as Error).message, perCampaign }, { status: 503 });
  }
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  // Vercel Cron uses GET by default — accept both.
  return handle(req);
}
