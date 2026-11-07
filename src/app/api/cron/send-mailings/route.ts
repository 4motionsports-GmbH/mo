// The Rundmail runner (every minute, see vercel.json). Sends the released,
// due Rundmails in batches — every legal gate per recipient, one Resend batch
// request per batch with an idempotency key, paced to the mailing's rate —
// until shortly before the next run. Planned mails start here at their time;
// an open admin page drives the same step in between (POST
// /api/admin/rundmail/step). lib/mailing-send.ts, docs/CAMPAIGNS.md §9.
//
// Does nothing unless a Rundmail is released; CAMPAIGN_SENDS_APPROVED off
// pauses it. Protected by CRON_SECRET — Vercel Cron sends Authorization:
// Bearer <secret>.

import { NextResponse } from "next/server";
import { isDbConfigured } from "@/lib/db";
import { runMailingStep } from "@/lib/mailing-send";
import { reportError } from "@/lib/observability";
import { requireCronAuth } from "@/lib/cron-auth";

// The first run of a Rundmail matches its audience (can take a while for a
// large base); the batches stop ~50 s after the start so the next minute's
// run takes over without overlap (a lease keeps one runner per mailing).
export const maxDuration = 300;

async function handle(req: Request): Promise<Response> {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  if (!isDbConfigured()) {
    return NextResponse.json({ ok: false, error: "No database configured" }, { status: 503 });
  }
  const startedAt = Date.now();
  try {
    const result = await runMailingStep({ deadlineMs: startedAt + 55_000 });
    if (result.mailings > 0) console.log("[cron/send-mailings] done", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    reportError(err, { route: "api/cron/send-mailings" });
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 503 });
  }
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
