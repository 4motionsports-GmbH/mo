// The erasure contract: for EVERY table that can hold data about a person,
// what "delete everything about this customer" does with it. Pure (no I/O) so
// node:test can check it against the migrations: customer-erasure-core.test.mjs
// parses migrations/*.sql, finds every table with a personal-data column, and
// fails when a table is missing here. A new feature that stores personal data
// therefore cannot ship without deciding how erasure handles it — and the
// erasure SQL in lib/customer-erasure.ts implements exactly this map.
//
// Treatments:
//   delete    — the rows about the person are deleted
//   cascade   — deleted by a foreign key (ON DELETE CASCADE) when its parent goes
//   anonymise — kept, but every link to the person is removed (aggregate or
//               operational records that carry no personal data once unlinked)
//   retain    — kept on purpose; `why` names the lawful reason

/** @type {Record<string, { treatment: "delete" | "cascade" | "anonymise" | "retain", why: string }>} */
export const ERASURE_PLAN = {
  customers: { treatment: "delete", why: "The customer record: email, profile, cached purchases, address, drafts." },
  customer_oauth_tokens: { treatment: "cascade", why: "Shopify sign-in tokens (FK customers)." },
  customer_session_links: { treatment: "cascade", why: "Session ↔ customer links (FK customers)." },
  customer_auth_pending: { treatment: "delete", why: "Pending sign-in state of the person's sessions." },
  customer_link_grants: { treatment: "cascade", why: "One-time sign-in link codes (FK customers, 0073)." },
  customer_merge_conflicts: { treatment: "delete", why: "Identity-merge audit rows naming the person." },
  conversations: { treatment: "delete", why: "Every chat of the person (all devices)." },
  messages: { treatment: "cascade", why: "Chat transcripts (FK conversations)." },
  ai_usage: {
    treatment: "delete",
    why: "Usage rows linked to the person's chats (cascade) or Kampagne contact (deleted).",
  },
  kpi_events: { treatment: "delete", why: "Pseudonymous events keyed by the person's session ids." },
  mo_attribution_tokens: { treatment: "delete", why: "Order-attribution tokens of the person's sessions." },
  mo_orders: {
    treatment: "anonymise",
    why: "Aggregate order facts stay for revenue KPIs; session id and token are removed.",
  },
  email_captures: { treatment: "delete", why: "Consent records for the address." },
  marketing_sends: { treatment: "delete", why: "Marketing drafts and sends to the person." },
  email_messages: { treatment: "delete", why: "Correspondence with the person (both directions)." },
  physical_letters: { treatment: "delete", why: "Letters to the person, incl. the postal address." },
  feedback: { treatment: "delete", why: "Feedback given with the address or from the person's chats." },
  campaign_contacts: { treatment: "delete", why: "The Kampagne contact (Shopify subscriber snapshot)." },
  campaign_drafts: { treatment: "cascade", why: "Kampagne drafts (FK campaign_contacts)." },
  campaign_sends: { treatment: "delete", why: "Sent Kampagne mails (address, subject, body)." },
  bundle_offers: {
    treatment: "anonymise",
    why: "The Shopify bundle product record stays (it is a shop product); the link to the person is removed.",
  },
  qa_entries: {
    treatment: "anonymise",
    why: "Knowledge-base Q&A is written without personal details; the link to the chat is removed (FK SET NULL).",
  },
  analytics_reports: {
    treatment: "anonymise",
    why: "The person's per-customer profile section is removed from every stored report.",
  },
  suppression_list: {
    treatment: "retain",
    why: "The address is kept with reason 'erasure' so it is never mailed or re-imported from Shopify again (Art. 17(3)(b)/(e) — honouring the request).",
  },
  customer_orders: {
    treatment: "cascade",
    why: "The mirrored Shopify orders (FK customers). Shopify keeps the legally required records itself.",
  },
  customer_facts: { treatment: "cascade", why: "Derived purchase/activity figures (FK customers)." },
  consent_events: { treatment: "cascade", why: "The person's consent history (FK customers)." },
  shopify_outbox: {
    treatment: "delete",
    why: "Open Shopify writes for the person are deleted; completed rows keep only the Shopify id (FK SET NULL, e-mail blanked on completion).",
  },
  inbox_items: { treatment: "cascade", why: "Eingang items about the person (FK customers)." },
  erasure_tombstones: {
    treatment: "retain",
    why: "The Shopify id of the erased person, so no import or webhook re-creates them before Shopify has redacted the record; removed 30 days after Shopify confirms (Art. 17(3)(b)/(e)).",
  },
  admin_access_log: {
    treatment: "retain",
    why: "Security audit of operator actions: operator IP and a numeric customer id only, own retention window.",
  },
};

/** Column names that mark a table as holding personal data. */
export const PERSONAL_COLUMN = /^(email|.*_email|customer_id|campaign_contact_id|contact_id|session_id|conversation_id|shopify_customer_id|first_name|last_name|recipient_.*|postal_address.*|phone|ip)$/;

/**
 * The tables (with their personal-data columns) defined by the given
 * migrations, in order — CREATE TABLE, ALTER TABLE … ADD/DROP COLUMN and DROP
 * TABLE are replayed so the result is the current schema.
 *
 * @param {string[]} migrationTexts the SQL files, oldest first
 * @returns {Map<string, string[]>}
 */
export function personalDataTables(migrationTexts) {
  /** @type {Map<string, Set<string>>} */
  const tables = new Map();
  for (const raw of migrationTexts) {
    const sql = raw.replace(/--[^\n]*/g, "");
    for (const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\n\);/g)) {
      const cols = [...m[2].matchAll(/^\s*(\w+)\s+[A-Z]/gm)].map((c) => c[1]);
      const set = tables.get(m[1]) ?? new Set();
      cols.forEach((c) => set.add(c));
      tables.set(m[1], set);
    }
    for (const m of sql.matchAll(/ALTER TABLE (\w+)([\s\S]*?);/g)) {
      const set = tables.get(m[1]) ?? new Set();
      for (const c of m[2].matchAll(/ADD COLUMN IF NOT EXISTS (\w+)/g)) set.add(c[1]);
      for (const c of m[2].matchAll(/DROP COLUMN IF EXISTS (\w+)/g)) set.delete(c[1]);
      tables.set(m[1], set);
    }
    for (const m of sql.matchAll(/DROP TABLE IF EXISTS (\w+)/g)) tables.delete(m[1]);
  }
  /** @type {Map<string, string[]>} */
  const out = new Map();
  for (const [t, cols] of tables) {
    const hits = [...cols].filter((c) => PERSONAL_COLUMN.test(c)).sort();
    if (hits.length > 0) out.set(t, hits);
  }
  return out;
}
