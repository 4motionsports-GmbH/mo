// Scheduled data-retention job.
//
// Triggered by Vercel Cron (see vercel.json). Enforces the windows in
// docs/DATA_RETENTION.md: abandons stale conversations, deletes expired
// conversations/messages and kpi_events, and purges PII for opted-out email
// captures. Configurable via env (RETENTION_DAYS, KPI_RETENTION_DAYS,
// ABANDON_AFTER_MINUTES, SUPPRESSED_CAPTURE_PURGE_DAYS).
//
// Protected by CRON_SECRET — Vercel Cron sends Authorization: Bearer <secret>.
// Manual invocation: curl -H "Authorization: Bearer $CRON_SECRET" $URL

import { NextResponse } from "next/server";
import { runRetention, retentionOptionsFromEnv } from "@/lib/retention";
import { reportError } from "@/lib/observability";
import { requireCronAuth } from "@/lib/cron-auth";

export const maxDuration = 60;

async function handle(req: Request): Promise<Response> {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const opts = retentionOptionsFromEnv();
  try {
    const result = await runRetention(opts);
    console.log("[cron/retention] done", { ...opts, ...result });
    return NextResponse.json({ ok: true, options: opts, ...result });
  } catch (err) {
    reportError(err, { route: "api/cron/retention" });
    // No database configured (or a transient failure) — surface as 503 so the
    // cron run is visibly skipped rather than silently "succeeding".
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
