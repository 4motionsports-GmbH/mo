// Scheduled customer-data refresh.
//
// Triggered by Vercel Cron (see vercel.json). Keeps each customer's cached
// Shopify data fresh WITHOUT the admin having to press "Käufe aktualisieren":
// order history (→ owned items) and the lawful postal address. So drafts are
// never built on stale purchase/address data.
//
// Bounded per run (CUSTOMER_REFRESH_BATCH, default 25) over the MOST-STALE
// customers (purchase_summary older than CUSTOMER_REFRESH_STALE_HOURS, default
// 24), sequential to stay within Shopify rate limits — successive daily runs
// sweep the whole base. Reuses lib/customer-refresh (same path as the on-demand
// button).
//
// Then the PROFILE UPKEEP (lib/customer-profile runProfileUpkeep): up to
// CUSTOMER_PROFILE_BATCH people with a Mo chat or correspondence (Vollprofil,
// default 30, 0 disables) and up to CUSTOMER_PROFILE_LIGHT_BATCH Shopify
// customers with orders only (Kaufprofil, writer tier, default 0) whose profile is
// missing or older than their latest activity get it regenerated — the same
// regenerateCustomerProfile as the Kunden button — a few at a time and never
// starting a new one after the time budget, so the run fits maxDuration.
// `?only=profiles` skips the data refresh (used by
// scripts/backfill-customer-profiles.mjs for the first full build);
// `?batch=N` overrides the profile batch for that call.
//
// Protected by CRON_SECRET — Vercel Cron sends Authorization: Bearer <secret>.
// Manual: curl -H "Authorization: Bearer $CRON_SECRET" $URL

import { NextResponse } from "next/server";
import { listCustomersForDataRefresh } from "@/lib/customer-store";
import { refreshCustomerData } from "@/lib/customer-refresh";
import { autoCaptureMissingAddresses } from "@/lib/address-capture";
import { runProfileUpkeep } from "@/lib/customer-profile";
import { customerProfileLightBatch } from "@/lib/platform-flags.mjs";
import { reportError } from "@/lib/observability";
import { requireCronAuth } from "@/lib/cron-auth";

export const maxDuration = 300;

/** Stop starting new profile passes this long after the run began (ms) —
 *  leaves room for the passes still in flight inside maxDuration. */
const PROFILE_BUDGET_MS = 200_000;

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Parse a non-negative integer (0 allowed — "0 disables"), else fallback. */
function nonNegIntParam(raw: string | null | undefined, fallback: number): number {
  const n = raw != null && raw !== "" ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 200) : fallback;
}

async function handle(req: Request): Promise<Response> {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  const startedAt = Date.now();
  const url = new URL(req.url);
  const onlyProfiles = url.searchParams.get("only") === "profiles";
  const profileBatch = nonNegIntParam(
    url.searchParams.get("batch") ?? process.env.CUSTOMER_PROFILE_BATCH,
    30
  );

  const batch = intEnv("CUSTOMER_REFRESH_BATCH", 25);
  const staleHours = intEnv("CUSTOMER_REFRESH_STALE_HOURS", 24);
  const staleBefore = new Date(Date.now() - staleHours * 3_600_000).toISOString();

  try {
    let considered = 0;
    let refreshed = 0;
    let failed = 0;
    let addresses = { checked: 0, captured: 0 };
    if (!onlyProfiles) {
      const candidates = await listCustomersForDataRefresh(batch, staleBefore);
      considered = candidates.length;
      for (const c of candidates) {
        const result = await refreshCustomerData(c);
        if (result.ok) refreshed++;
        else failed++;
      }
      // Missing lawful postal addresses (physical mail, §4): a small bounded pass
      // per run — this used to run in the background of every Kunden page view.
      addresses = await autoCaptureMissingAddresses({ limit: 12 });
    }
    // Profile upkeep AFTER the data refresh, so profiles read fresh purchases.
    const profiles = await runProfileUpkeep({
      batch: profileBatch,
      deadlineMs: startedAt + PROFILE_BUDGET_MS,
      concurrency: 3,
    });
    // Purchase-only profiles with whatever time is left (off by default).
    const lightProfiles = await runProfileUpkeep({
      batch: customerProfileLightBatch(),
      depth: "kauf",
      deadlineMs: startedAt + PROFILE_BUDGET_MS + 40_000,
      concurrency: 4,
    });
    const summary = {
      considered,
      refreshed,
      failed,
      batch,
      staleHours,
      addressesChecked: addresses.checked,
      addressesCaptured: addresses.captured,
      profiles,
      lightProfiles,
    };
    console.log("[cron/refresh-customers] done", summary);
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    reportError(err, { route: "api/cron/refresh-customers" });
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
