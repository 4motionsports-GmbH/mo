import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RESET_PRESERVE_TABLES,
  stripSqlComments,
  tablesFromMigrations,
  planReset,
  quoteIdent,
} from "./db-reset-plan.mjs";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");
const repoMigrations = () =>
  readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), "utf8") }));

test("stripSqlComments: drops both comment kinds, keeps string literals", () => {
  const out = stripSqlComments("CREATE TABLE a (x int); -- CREATE TABLE b\n/* CREATE TABLE c */ SELECT '--keep';");
  assert.ok(out.includes("CREATE TABLE a"));
  assert.ok(!out.includes("TABLE b"));
  assert.ok(!out.includes("TABLE c"));
  assert.ok(out.includes("'--keep'"));
  // A block-comment opener inside a line comment does not swallow the next line.
  assert.ok(stripSqlComments("-- see /* here\nCREATE TABLE d (x int);").includes("CREATE TABLE d"));
});

test("tablesFromMigrations: create, drop (list), rename, in filename order", () => {
  const files = [
    { name: "0002_b.sql", sql: "DROP TABLE IF EXISTS old_one, \"public\".old_two;\nALTER TABLE IF EXISTS keep_me RENAME TO kept;" },
    { name: "0001_a.sql", sql: "CREATE TABLE IF NOT EXISTS old_one (id int);\nCREATE TABLE public.old_two (id int);\ncreate unlogged table \"Keep_Me\" (id int);\nCREATE TABLE IF NOT EXISTS plain (id int);" },
    { name: "0003_c.sql", sql: "-- CREATE TABLE commented (id int);\nCREATE TEMP TABLE scratch (id int);" },
  ];
  assert.deepEqual(tablesFromMigrations(files), ["kept", "plain"]);
});

test("tablesFromMigrations: the repository's migrations yield today's schema", () => {
  const tables = tablesFromMigrations(repoMigrations());
  for (const t of ["conversations", "customers", "campaigns", "shopify_outbox", "customer_link_grants", "campaign_letters", "improvement_runs"]) {
    assert.ok(tables.includes(t), t);
  }
  // Dropped by 0029 / 0049.
  for (const t of ["bestandskunden_suppression_list", "email_templates", "email_template_assignments"]) {
    assert.ok(!tables.includes(t), t);
  }
  // Every preserved table except the tracker is created by a migration.
  for (const t of Object.keys(RESET_PRESERVE_TABLES)) {
    if (t !== "_migrations") assert.ok(tables.includes(t), t);
  }
});

test("planReset: truncates every migrated table except the preserved ones", () => {
  const plan = planReset({
    liveTables: ["_migrations", "campaigns", "conversations", "messages", "email_design_selections"],
    migrationTables: ["campaigns", "conversations", "messages", "email_design_selections", "not_yet_applied"],
    foreignKeys: [{ from: "messages", to: "conversations" }, { from: "campaign_contacts", to: "campaigns" }],
  });
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.truncate, ["conversations", "messages"]);
  assert.deepEqual(plan.preserved, ["_migrations", "campaigns", "email_design_selections"]);
});

test("planReset: aborts on a database migrate.mjs never ran on", () => {
  const plan = planReset({ liveTables: ["conversations"], migrationTables: ["conversations"] });
  assert.equal(plan.errors.length, 1);
  assert.match(plan.errors[0], /_migrations/);
});

test("planReset: aborts on a live table no migration creates", () => {
  const plan = planReset({ liveTables: ["_migrations", "conversations", "invoices"], migrationTables: ["conversations"] });
  assert.equal(plan.errors.length, 1);
  assert.match(plan.errors[0], /invoices/);
});

test("planReset: aborts when a kept table references a wiped one", () => {
  const plan = planReset({
    liveTables: ["_migrations", "campaigns", "customers"],
    migrationTables: ["campaigns", "customers"],
    foreignKeys: [
      { from: "campaigns", to: "customers" },
      { from: "audit.trail", to: "customers" },
    ],
  });
  assert.equal(plan.errors.length, 2);
  assert.match(plan.errors[0], /campaigns .* customers/);
  assert.match(plan.errors[1], /audit\.trail/);
});

test("quoteIdent: doubles embedded quotes", () => {
  assert.equal(quoteIdent("messages"), '"messages"');
  assert.equal(quoteIdent('we"ird'), '"we""ird"');
});
