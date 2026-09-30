import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ERASURE_PLAN, personalDataTables } from "./customer-erasure-core.mjs";

const migrationsDir = fileURLToPath(new URL("../../migrations/", import.meta.url));
const migrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(migrationsDir + f, "utf8"));

test("every table that holds personal data is covered by the erasure plan", () => {
  const tables = personalDataTables(migrations);
  // Sanity: the parser finds the obvious ones.
  for (const t of ["customers", "conversations", "campaign_contacts", "email_messages"]) {
    assert.ok(tables.has(t), `parser should find ${t}`);
  }
  const missing = [...tables.keys()].filter((t) => !(t in ERASURE_PLAN));
  assert.deepEqual(
    missing,
    [],
    `Tables with personal data but no erasure decision: ${missing
      .map((t) => `${t} (${tables.get(t).join(", ")})`)
      .join("; ")} — add them to ERASURE_PLAN and to lib/customer-erasure.ts.`
  );
});

test("the erasure plan names no table that doesn't exist any more", () => {
  const tables = personalDataTables(migrations);
  // analytics_reports carries names inside jsonb, so the column scan can't see it.
  const unknown = Object.keys(ERASURE_PLAN).filter(
    (t) => !tables.has(t) && t !== "analytics_reports"
  );
  assert.deepEqual(unknown, []);
});

test("retained tables always say why", () => {
  for (const [t, p] of Object.entries(ERASURE_PLAN)) {
    assert.ok(p.why && p.why.length > 10, `${t} needs a reason`);
  }
});

test("personalDataTables replays drops", () => {
  const t = personalDataTables([
    "CREATE TABLE IF NOT EXISTS a (\n  id BIGINT,\n  email TEXT\n);",
    "ALTER TABLE a DROP COLUMN IF EXISTS email;",
    "CREATE TABLE IF NOT EXISTS b (\n  customer_id BIGINT\n);",
    "DROP TABLE IF EXISTS b;",
  ]);
  assert.equal(t.size, 0);
});
