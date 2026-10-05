// Hourly (:20): the Eingang job — rules over the customer facts and recent
// events → inbox items (upsert by dedupe key, close what stopped firing,
// expire), the 14-day outcomes of decided items, and AI suggestions within
// INBOX_AI_DAILY_LIMIT (0 = none). Never sends anything.
// docs/archive/CUSTOMER_PLATFORM_PLAN.md §11.4. Protected by CRON_SECRET.

import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { isDbConfigured } from "@/lib/db";
import { runInboxSignals } from "@/lib/inbox-signals";
import { reportError } from "@/lib/observability";

export const maxDuration = 300;

async function handle(req: Request): Promise<Response> {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  if (!isDbConfigured()) {
    return NextResponse.json({ ok: false, error: "No database configured" }, { status: 503 });
  }
  try {
    const result = await runInboxSignals({ deadlineMs: Date.now() + 240_000 });
    console.log("[cron/inbox] done", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    reportError(err, { route: "api/cron/inbox" });
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 503 });
  }
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  return handle(req);
}
