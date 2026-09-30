#!/usr/bin/env node
// Build the customer profile for EVERY customer that has none yet (or whose
// data changed since the last one) — the first full run after migration 0059,
// when thousands of Kampagne contacts become customers at once. The nightly
// cron keeps profiles current afterwards; this just does the first sweep
// without waiting night after night.
//
// It does NOT run the generation locally: it calls the deployed cron endpoint
// (/api/cron/refresh-customers?only=profiles) in a loop, so the work runs with
// production's keys and database and goes through exactly the same code path
// as the nightly upkeep. Each call does one time-bounded batch; the loop stops
// when nothing is left or a round makes no progress.
//
//   PUBLIC_BASE_URL=https://… CRON_SECRET=… npm run profiles:backfill
//   (optional) --batch=40   profiles per call (default 30, max 200)
//   (optional) --max=500    stop after this many profiles in total
//
// Cost: one Opus pass per customer with data (≈ $0.10 each, see
// docs/AI_MODELS.md); customers without any data are only stamped.

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  })
);

const base = (args.url || process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
const secret = process.env.CRON_SECRET || "";
const batch = Number.parseInt(args.batch ?? "30", 10);
const max = Number.parseInt(args.max ?? "0", 10);

if (!base || !secret) {
  console.error("Set PUBLIC_BASE_URL (or --url=…) and CRON_SECRET.");
  process.exit(1);
}

let total = 0;
for (let round = 1; ; round++) {
  const res = await fetch(`${base}/api/cron/refresh-customers?only=profiles&batch=${batch}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!res.ok) {
    console.error(`Round ${round}: HTTP ${res.status} — ${await res.text()}`);
    process.exit(1);
  }
  const body = await res.json();
  const p = body.profiles ?? {};
  const done = (p.generated ?? 0) + (p.noData ?? 0) + (p.failed ?? 0);
  total += p.generated ?? 0;
  console.log(
    `Round ${round}: ${p.generated ?? 0} generated, ${p.noData ?? 0} without data, ` +
      `${p.failed ?? 0} failed — ${p.remaining ?? 0} remaining`
  );
  if (!p.remaining || done === 0) break;
  if (max > 0 && total >= max) {
    console.log(`Stopped at --max=${max}.`);
    break;
  }
}
console.log(`Done. ${total} profiles generated.`);
