#!/usr/bin/env node
// scripts/reset-test-data.mjs — TRUNCATE every data table and reset sequences.
//
// ⚠  SAFETY GATE: this script exits immediately unless ALLOW_DB_RESET=true is
// set in the environment. It also prints the target database host and name
// before doing anything, so you can verify you are not wiping a production DB.
//
// What is truncated: every table the migrations in migrations/ create (and no
// later one drops), read from the files at run time — no hand-maintained list
// to fall behind the schema (the old one stopped at 0031 and aborted on every
// newer database). The plan is pure and tested: src/lib/db-reset-plan.mjs.
//
// What is NOT touched (RESET_PRESERVE_TABLES in that module):
//   _migrations              — schema version tracker
//   campaigns                — campaign definitions incl. the built-in
//                              Einzelansprache / Lebenszyklus (only 0066 creates them)
//   email_design_selections  — which e-mail design each mail type uses
//
// Guards, before anything is deleted (each ABORTS with exit 1):
//   · ALLOW_DB_RESET=true is required (above all else);
//   · the database must have `_migrations` (migrate.mjs ran on it);
//   · every live public table must be created by a migration in this checkout
//     or be preserved — a foreign database, a hand-made table or a checkout
//     older than the database is never wiped;
//   · no kept table may hold a foreign key to a wiped one.
// The TRUNCATE runs WITHOUT CASCADE, so Postgres itself refuses rather than
// reaching into a kept table; afterwards every wiped table must count 0 and
// every preserved table must still hold its rows.
//
// Usage:
//   ALLOW_DB_RESET=true node --env-file=.env.local scripts/reset-test-data.mjs
//   ALLOW_DB_RESET=true npm run db:reset
// Local Postgres behind the Neon-protocol proxy (docs/DATABASE.md): also set
// NEON_FETCH_ENDPOINT=http://127.0.0.1:4444/sql (same switch as src/lib/db.ts).

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { neon, neonConfig } from "@neondatabase/serverless";
import { RESET_PRESERVE_TABLES, planReset, quoteIdent, tablesFromMigrations } from "../src/lib/db-reset-plan.mjs";

if (process.env.NEON_FETCH_ENDPOINT) {
  neonConfig.fetchEndpoint = process.env.NEON_FETCH_ENDPOINT;
}

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

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

// ─── Plan: what goes, what stays ──────────────────────────────────────────────

let migrationTables;
try {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), "utf8") }));
  migrationTables = tablesFromMigrations(files);
} catch (err) {
  console.error(`[reset-test-data] Could not read ${MIGRATIONS_DIR}:`, err.message);
  process.exit(1);
}

const sql = neon(cs);

let plan;
try {
  const liveRows = await sql.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
  );
  // Every foreign key INTO a public table; the referencing side is schema-
  // qualified unless it is public itself.
  const fkRows = await sql.query(
    `SELECT CASE WHEN sn.nspname = 'public' THEN s.relname ELSE sn.nspname || '.' || s.relname END AS from_table,
            t.relname AS to_table
       FROM pg_constraint c
       JOIN pg_class s ON s.oid = c.conrelid
       JOIN pg_namespace sn ON sn.oid = s.relnamespace
       JOIN pg_class t ON t.oid = c.confrelid
       JOIN pg_namespace tn ON tn.oid = t.relnamespace
      WHERE c.contype = 'f' AND tn.nspname = 'public'`
  );
  plan = planReset({
    liveTables: liveRows.map((r) => r.table_name),
    migrationTables,
    foreignKeys: fkRows.map((r) => ({ from: r.from_table, to: r.to_table })),
  });
} catch (err) {
  console.error("[reset-test-data] Could not read the live schema:", err.message);
  process.exit(1);
}

if (plan.errors.length > 0) {
  console.error(
    "[reset-test-data] ABORTED — nothing was deleted:\n" +
      plan.errors.map((e) => `    • ${e}`).join("\n") +
      "\n  Check the connection, run the migrations of this checkout, or classify the table in " +
      "src/lib/db-reset-plan.mjs (RESET_PRESERVE_TABLES).\n"
  );
  process.exit(1);
}
if (plan.truncate.length === 0) {
  console.log("[reset-test-data] Nothing to truncate — no migrated data tables in this database.\n");
  process.exit(0);
}

console.log(`[reset-test-data] ✓ Plan: ${plan.truncate.length} data tables from ${migrationTables.length} migrated tables.`);
console.log("[reset-test-data] Tables to truncate:");
for (const t of plan.truncate) console.log(`  • ${t}`);
console.log("[reset-test-data] Tables kept:");
for (const t of plan.preserved) console.log(`  · ${t.padEnd(26)} ${RESET_PRESERVE_TABLES[t] ?? ""}`);
console.log("");

async function countRows(table) {
  const rows = await sql.query(`SELECT count(*)::bigint AS n FROM ${quoteIdent(table)}`);
  return String(rows[0]?.n ?? "?");
}

const keptBefore = new Map();
for (const t of plan.preserved) keptBefore.set(t, await countRows(t));

// ─── Truncate ─────────────────────────────────────────────────────────────────
// One statement, so it is all-or-nothing. No CASCADE: the plan already holds
// every table that references a wiped one; should anything still point in,
// Postgres refuses instead of wiping a kept table. RESTART IDENTITY resets the
// sequences of the wiped tables to 1.

console.log("[reset-test-data] Executing TRUNCATE … RESTART IDENTITY …");
try {
  await sql.query(`TRUNCATE ${plan.truncate.map(quoteIdent).join(", ")} RESTART IDENTITY`);
} catch (err) {
  console.error("[reset-test-data] TRUNCATE failed (nothing was deleted):", err.message);
  process.exit(1);
}
console.log("[reset-test-data] ✓ Truncated.\n");

// ─── Post-truncate row counts ─────────────────────────────────────────────────
// Wiped tables must be 0, kept tables unchanged.

console.log("[reset-test-data] Row counts after truncate (all must be 0):");
let ok = true;
for (const table of plan.truncate) {
  let n;
  try {
    n = await countRows(table);
  } catch (err) {
    n = `ERROR: ${err.message}`;
  }
  const isZero = n === "0";
  if (!isZero) ok = false;
  console.log(`  ${isZero ? "✓" : "✗"}  ${table.padEnd(42)} ${n}`);
}
console.log("[reset-test-data] Kept tables (row counts unchanged):");
for (const table of plan.preserved) {
  let n;
  try {
    n = await countRows(table);
  } catch (err) {
    n = `ERROR: ${err.message}`;
  }
  const same = n === keptBefore.get(table);
  if (!same) ok = false;
  console.log(`  ${same ? "✓" : "✗"}  ${table.padEnd(42)} ${n}${same ? "" : ` (was ${keptBefore.get(table)})`}`);
}

console.log("");
if (ok) {
  console.log("[reset-test-data] ✓  Done. All data tables are empty; kept tables untouched.\n");
} else {
  console.error("[reset-test-data] ✗  WARNING: the counts above do not match. Check them.\n");
  process.exit(1);
}
