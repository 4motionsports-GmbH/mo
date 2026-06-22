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
//   customer_oauth_tokens          (FK child of customers — migration 0014)
//   customer_auth_pending          (standalone CSRF/PKCE state — migration 0014)
//   customer_merge_conflicts       (standalone sign-in conflict audit — migration 0014)
//   customer_session_links         (FK child of customers — migration 0019)
//   feedback                       (standalone — migration 0020)
//   email_messages                 (FK child of customers + marketing_sends — migration 0021)
//   physical_letters               (FK child of customers + marketing_sends — migration 0022)
//   admin_access_log               (standalone PII-access audit — migration 0028)
//
// The list is CURRENT THROUGH MIGRATION 0030 (email_captures.locale is a new
// COLUMN — cleared automatically by TRUNCATE, no list change needed;
// bestandskunden_suppression_list from 0017 was dropped in 0029). A completeness
// guard below cross-checks this list against the LIVE schema and ABORTS if a
// later migration added a data table that isn't listed here — so a pre-launch
// reset can never again silently miss a table.
//
// What is NOT touched:
//   _migrations        — schema version tracking; never touch (see PRESERVE_TABLES)
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
  "email_messages",        // FK → customers (SET NULL), marketing_sends (SET NULL) — migration 0021
  "physical_letters",      // FK → customers (SET NULL), marketing_sends (SET NULL) — migration 0022
  "marketing_sends",       // FK → email_captures
  "customer_oauth_tokens", // FK → customers (CASCADE) — migration 0014
  "customer_session_links", // FK → customers (CASCADE) — migration 0019
  // Parents / standalone tables (conversations before customers: customer_id ON DELETE SET NULL)
  "conversations",
  "kpi_events",
  "email_captures",
  "suppression_list",
  "kpi_persona_question_summaries",
  "customers",             // added migration 0008; email_captures/conversations truncated first
  "ai_usage",              // added migration 0012
  // Standalone tables — no FK constraints
  "customer_auth_pending",    // CSRF/PKCE state — migration 0014
  "customer_merge_conflicts", // sign-in conflict audit — migration 0014
  "feedback",                 // standalone — migration 0020
  "admin_access_log",         // admin PII-access audit — migration 0028 (no FK by design)
];

// Tables the reset deliberately PRESERVES. Only the schema-version tracker — the
// completeness guard below treats every other live base table as data that MUST
// appear in DATA_TABLES.
const PRESERVE_TABLES = new Set(["_migrations"]);

console.log("[reset-test-data] Tables to truncate:");
for (const t of DATA_TABLES) {
  console.log(`  • ${t}`);
}
console.log("");

// ─── Connect and execute ──────────────────────────────────────────────────────

const sql = neon(cs);

// ─── Completeness guard (drift protection) ────────────────────────────────────
// Cross-check DATA_TABLES against the LIVE schema so a future migration that adds
// a data table can never be silently missed by a pre-launch reset. Every public
// base table must be either in DATA_TABLES or in PRESERVE_TABLES; anything else
// ABORTS with instructions (rather than leaving stray rows behind at go-live).
try {
  const liveRows = await sql.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
  );
  const live = liveRows.map((r) => r.table_name);
  const listed = new Set(DATA_TABLES);
  const unlisted = live.filter((t) => !listed.has(t) && !PRESERVE_TABLES.has(t));
  // Also surface a stale list entry (a table that was dropped by a migration) so
  // the TRUNCATE below doesn't fail on a non-existent relation.
  const liveSet = new Set(live);
  const missingFromDb = DATA_TABLES.filter((t) => !liveSet.has(t));

  if (missingFromDb.length > 0) {
    console.error(
      "[reset-test-data] ABORTED — DATA_TABLES lists table(s) that don't exist " +
        "in this database (stale after a DROP, or you're pointed at the wrong DB):\n" +
        missingFromDb.map((t) => `    • ${t}`).join("\n") +
        "\n  Remove them from DATA_TABLES (or check the connection).\n"
    );
    process.exit(1);
  }
  if (unlisted.length > 0) {
    console.error(
      "[reset-test-data] ABORTED — the live schema has data table(s) NOT covered " +
        "by this reset (a newer migration added them):\n" +
        unlisted.map((t) => `    • ${t}`).join("\n") +
        "\n  Add each to DATA_TABLES (in FK-safe order) — or to PRESERVE_TABLES if " +
        "it must survive a reset — then re-run. Refusing to reset with stray data.\n"
    );
    process.exit(1);
  }
  console.log("[reset-test-data] ✓ Completeness guard: every live data table is covered.\n");
} catch (err) {
  console.error("[reset-test-data] Completeness guard could not query the schema:", err.message);
  process.exit(1);
}

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
