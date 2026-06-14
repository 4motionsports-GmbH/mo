#!/usr/bin/env node
// scripts/reset-test-data.mjs — TRUNCATE every data table and reset sequences.
//
// ⚠  SAFETY GATE: this script exits immediately unless ALLOW_DB_RESET=true is
// set in the environment. It also prints the target database host and name
// before doing anything, so you can verify you are not wiping a production DB.
//
// What is truncated (all data tables — derived from migrations/):
//   messages                       (Cluster A — FK child of conversations)
//   marketing_sends                (Cluster B — FK child of email_captures)
//   conversations                  (Cluster A)
//   kpi_events                     (Cluster A)
//   email_captures                 (Cluster B)
//   suppression_list               (Cluster B)
//   kpi_persona_question_summaries (Cluster A — derived analytics cache)
//   customers                      (Cluster B — migration 0008)
//   ai_usage                       (standalone — migration 0012)
//   bundle_offers                  (FK child of customers + marketing_sends — migration 0013)
//
// What is NOT touched:
//   _migrations        — schema version tracking; never touch
//   Any tables not listed above — schema objects, config, lookup data
//
// Usage:
//   ALLOW_DB_RESET=true node --env-file=.env.local scripts/reset-test-data.mjs
//   ALLOW_DB_RESET=true npm run db:reset

import { neon } from "@neondatabase/serverless";

// ─── Safety gate ──────────────────────────────────────────────────────────────

if (process.env.ALLOW_DB_RESET !== "true") {
  console.error(
    "\n[reset-test-data] ABORTED — safety gate triggered.\n\n" +
      "  This script wipes ALL rows from every data table.\n" +
      "  To proceed you must explicitly set ALLOW_DB_RESET=true:\n\n" +
      "    ALLOW_DB_RESET=true npm run db:reset\n\n" +
      "  Verify you are targeting a TEST database, not production.\n"
  );
  process.exit(1);
}

// ─── Connection string ────────────────────────────────────────────────────────
// Prefer the direct/unpooled string (same preference as migrate.mjs) so that
// large TRUNCATE + RESTART IDENTITY operations don't hit pooler quirks.

function connectionString() {
  return (
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL
  );
}

const cs = connectionString();
if (!cs) {
  console.error(
    "[reset-test-data] No Postgres connection string found.\n" +
      "  Set DATABASE_URL (or DATABASE_URL_UNPOOLED / POSTGRES_URL) in your env file.\n"
  );
  process.exit(1);
}

// ─── Parse host + database from the connection URL ───────────────────────────

let dbHost = "(unknown)";
let dbName = "(unknown)";
try {
  // Normalise postgres:// → postgresql:// so the WHATWG URL parser accepts it.
  const u = new URL(cs.replace(/^postgres:\/\//, "postgresql://"));
  dbHost = u.hostname + (u.port ? `:${u.port}` : "");
  dbName = u.pathname.replace(/^\//, "") || "(unknown)";
} catch {
  // Non-standard URL form — host/db remain as "(unknown)" which is safe;
  // the ALLOW_DB_RESET gate already fired so the user consciously opted in.
}

console.log("");
console.log("══════════════════════════════════════════════════════════════");
console.log("  ⚠   DATA RESET — ALL ROWS IN EVERY DATA TABLE WILL BE DELETED");
console.log("══════════════════════════════════════════════════════════════");
console.log(`  Target host : ${dbHost}`);
console.log(`  Target db   : ${dbName}`);
console.log("══════════════════════════════════════════════════════════════");
console.log("");

// ─── Table list (child-FK tables first, then parents, then standalone) ────────
// RESTART IDENTITY CASCADE handles cascades automatically, but explicit ordering
// makes the intent clear and avoids any FK violation if CASCADE is somehow off.

const DATA_TABLES = [
  // FK children first (deepest nesting first)
  "messages",              // FK → conversations
  "bundle_offers",         // FK → customers (SET NULL), marketing_sends (SET NULL) — migration 0013
  "marketing_sends",       // FK → email_captures
  // Parents / standalone tables (conversations before customers: customer_id ON DELETE SET NULL)
  "conversations",
  "kpi_events",
  "email_captures",
  "suppression_list",
  "kpi_persona_question_summaries",
  "customers",             // added migration 0008; email_captures/conversations truncated first
  "ai_usage",              // added migration 0012
];

console.log("[reset-test-data] Tables to truncate:");
for (const t of DATA_TABLES) {
  console.log(`  • ${t}`);
}
console.log("");

// ─── Connect and execute ──────────────────────────────────────────────────────

const sql = neon(cs);

// Single TRUNCATE statement; CASCADE ensures any FK cascade we might have
// missed is handled automatically. RESTART IDENTITY resets all sequences to 1.
const tableList = DATA_TABLES.join(", ");
console.log("[reset-test-data] Executing TRUNCATE … RESTART IDENTITY CASCADE …");
try {
  await sql.query(`TRUNCATE ${tableList} RESTART IDENTITY CASCADE`);
} catch (err) {
  console.error("[reset-test-data] TRUNCATE failed:", err.message);
  process.exit(1);
}
console.log("[reset-test-data] ✓ Truncated.\n");

// ─── Post-truncate row counts ─────────────────────────────────────────────────
// All should be 0. A non-zero count here means something went wrong.

console.log("[reset-test-data] Row counts after truncate (all must be 0):");
let allZero = true;
for (const table of DATA_TABLES) {
  let n = "error";
  try {
    const rows = await sql.query(`SELECT COUNT(*) AS n FROM ${table}`);
    n = rows[0]?.n ?? "?";
  } catch (err) {
    n = `ERROR: ${err.message}`;
  }
  const isZero = n === "0" || n === 0 || n === 0n;
  if (!isZero) allZero = false;
  const marker = isZero ? "✓" : "✗";
  console.log(`  ${marker}  ${table.padEnd(42)} ${n}`);
}

console.log("");
if (allZero) {
  console.log("[reset-test-data] ✓  Done. All data tables are empty.\n");
} else {
  console.error(
    "[reset-test-data] ✗  WARNING: one or more tables still have rows. " +
      "Check the counts above.\n"
  );
  process.exit(1);
}
