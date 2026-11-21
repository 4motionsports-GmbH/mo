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

test("Geschenkgutscheine: no voucher table keeps the person's data as it is", () => {
  for (const t of ["gift_vouchers", "gift_voucher_print_jobs", "gift_voucher_drafts"]) {
    assert.equal(ERASURE_PLAN[t].treatment, "anonymise", `${t} is anonymised (the card stays money for its recipient)`);
  }
  // An ordered draft holds a copy of the Premium-Karte's recipient address.
  assert.match(ERASURE_PLAN.gift_voucher_drafts.why, /recipient address/);
});

// Source-level (tests cannot import lib/customer-erasure.ts).
test("GUARDRAIL: erasePerson clears the ordered drafts' address while the buyer link still finds them", () => {
  const src = readFileSync(new URL("./customer-erasure.ts", import.meta.url), "utf8").replace(/\s+/g, " ");
  const jobs = src.indexOf("sql`UPDATE gift_voucher_print_jobs SET recipient_postal_address = NULL");
  const drafts = src.indexOf("sql`UPDATE gift_voucher_drafts SET recipient_postal_address = NULL");
  const buyer = src.indexOf("sql`UPDATE gift_vouchers SET customer_id = NULL, shopify_customer_id = NULL, buyer_email = NULL");
  assert.ok(jobs > 0, "the print jobs' statement exists");
  assert.ok(drafts > jobs, "the drafts' statement exists and follows the print jobs'");
  assert.ok(buyer > drafts, "… and runs before the statement that removes the buyer link it matches on");
  const stmt = src.slice(drafts, src.indexOf("`,", drafts));
  for (const match of [
    "WHERE recipient_postal_address IS NOT NULL",
    "id IN ( SELECT draft_id FROM gift_vouchers WHERE draft_id IS NOT NULL",
    "customer_id = ${cid}",
    "(shopify_customer_id IS NOT NULL AND shopify_customer_id = ${shopifyCustomerId}::text)",
    "lower(buyer_email) = ANY(${emailList}::text[])",
  ]) {
    assert.ok(stmt.includes(match), `the drafts' statement has ${match}`);
  }
});
