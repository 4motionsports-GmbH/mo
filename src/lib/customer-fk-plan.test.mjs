import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CUSTOMER_FK_PLAN, customerForeignKeys } from "./customer-fk-plan.mjs";

const migrationsDir = fileURLToPath(new URL("../../migrations/", import.meta.url));
const migrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(migrationsDir + f, "utf8"));

test("every column referencing customers(id) is covered by the merge plan", () => {
  const fks = customerForeignKeys(migrations);
  for (const t of ["conversations", "email_captures", "customer_orders"]) {
    assert.ok(fks.some((f) => f.table === t), `parser should find ${t}`);
  }
  const missing = fks.filter((f) => CUSTOMER_FK_PLAN[f.table]?.column !== f.column);
  assert.deepEqual(
    missing,
    [],
    `Customer links without a merge decision: ${missing.map((f) => `${f.table}.${f.column}`).join(", ")} — add them to CUSTOMER_FK_PLAN and lib/customer-merge-store.ts.`
  );
});

test("the merge plan names no link that does not exist", () => {
  const fks = customerForeignKeys(migrations);
  const unknown = Object.entries(CUSTOMER_FK_PLAN).filter(
    ([t, p]) => !fks.some((f) => f.table === t && f.column === p.column)
  );
  assert.deepEqual(unknown, []);
});

test("the parser handles CREATE, ALTER and DROP", () => {
  const fks = customerForeignKeys([
    "CREATE TABLE IF NOT EXISTS a (\n  id BIGINT,\n  customer_id BIGINT REFERENCES customers (id) ON DELETE SET NULL\n);",
    "ALTER TABLE b\n  ADD COLUMN IF NOT EXISTS owner_id BIGINT REFERENCES customers (id);",
    "CREATE TABLE IF NOT EXISTS c (\n  customer_id BIGINT REFERENCES customers (id)\n);",
    "DROP TABLE IF EXISTS c;",
  ]);
  assert.deepEqual(fks, [
    { table: "a", column: "customer_id" },
    { table: "b", column: "owner_id" },
  ]);
});
