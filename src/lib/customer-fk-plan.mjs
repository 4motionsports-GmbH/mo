// What a MERGE of two customer rows does with every table that points at a
// customer (pure). Two rows become one person when Shopify reports an e-mail
// change onto an address an Interessent already uses, or when a sign-in finds
// both rows (docs/archive/CUSTOMER_PLATFORM_PLAN.md §6.1). lib/customer-merge-store.ts
// executes this plan; customer-fk-plan.test.mjs parses migrations/*.sql and
// FAILS when a column referencing customers(id) is missing here — a new
// feature cannot add a customer link that a merge would silently orphan.
//
// Treatments:
//   repoint      — UPDATE <table> SET <column> = keep WHERE <column> = drop
//   keep_or_drop — one row per customer (PK / unique): keep the survivor's,
//                  move the dropped row's only when the survivor has none
//   drop         — derived data recomputed for the survivor; the dropped
//                  row's copy is deleted

/** @type {Record<string, { column: string, treatment: "repoint" | "keep_or_drop" | "drop" }>} */
export const CUSTOMER_FK_PLAN = {
  conversations: { column: "customer_id", treatment: "repoint" },
  email_captures: { column: "customer_id", treatment: "repoint" },
  marketing_sends: { column: "customer_id", treatment: "repoint" },
  bundle_offers: { column: "customer_id", treatment: "repoint" },
  customer_oauth_tokens: { column: "customer_id", treatment: "keep_or_drop" },
  customer_session_links: { column: "customer_id", treatment: "repoint" },
  customer_link_grants: { column: "customer_id", treatment: "repoint" },
  campaign_letters: { column: "customer_id", treatment: "repoint" },
  email_messages: { column: "customer_id", treatment: "repoint" },
  physical_letters: { column: "customer_id", treatment: "repoint" },
  campaign_contacts: { column: "customer_id", treatment: "repoint" },
  campaign_sends: { column: "customer_id", treatment: "repoint" },
  customer_orders: { column: "customer_id", treatment: "repoint" },
  customer_facts: { column: "customer_id", treatment: "drop" },
  consent_events: { column: "customer_id", treatment: "repoint" },
  shopify_outbox: { column: "customer_id", treatment: "repoint" },
  inbox_items: { column: "customer_id", treatment: "repoint" },
};

/**
 * Every (table, column) that references customers(id), replaying the
 * migrations in order.
 *
 * @param {string[]} migrationTexts oldest first
 * @returns {Array<{ table: string, column: string }>}
 */
export function customerForeignKeys(migrationTexts) {
  const found = new Map();
  for (const raw of migrationTexts) {
    const sql = raw.replace(/--[^\n]*/g, "");
    for (const stmt of sql.split(";")) {
      const create = stmt.match(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(/);
      const alter = stmt.match(/ALTER TABLE (\w+)/);
      const table = create?.[1] ?? alter?.[1];
      if (!table) continue;
      const re = create
        ? /^\s*(\w+)\s+BIGINT[^,\n]*REFERENCES customers\s*\(id\)/gm
        : /ADD COLUMN IF NOT EXISTS (\w+)\s+BIGINT[^,\n]*REFERENCES customers\s*\(id\)/g;
      for (const m of stmt.matchAll(re)) found.set(`${table}.${m[1]}`, { table, column: m[1] });
    }
    for (const m of sql.matchAll(/DROP TABLE IF EXISTS (\w+)/g)) {
      for (const key of [...found.keys()]) if (key.startsWith(`${m[1]}.`)) found.delete(key);
    }
  }
  return [...found.values()];
}
