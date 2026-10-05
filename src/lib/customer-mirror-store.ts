// The customer mirror: Shopify customers → `customers` rows (I/O).
//
// ONE write path for the bulk import, the nightly reconciliation and the
// customers/* webhooks (rows normalised by lib/shopify-customer-map.mjs):
//
//   1. erased people stay out — Shopify ids with an erasure tombstone, and
//      e-mails erased in Mo before this Shopify account existed;
//   2. match by Shopify id, then by e-mail (an Interessent who chatted with
//      that address gets the Shopify id stamped on), else insert
//      (source 'shopify');
//   3. a payload older than the stored shopify_updated_at changes nothing
//      (stale guard for out-of-order webhooks);
//   4. an e-mail change onto an address an Interessent already uses merges
//      the two rows (lib/customer-merge-store.ts);
//   5. the embedded emailMarketingConsent goes through the consent resolver
//      (lib/consent-store.ts) — never written directly.
//
// docs/archive/CUSTOMER_PLATFORM_PLAN.md §6.1–§6.2.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { applyConsentActs, type ConsentAct } from "./consent-store";
import { mergeCustomers } from "./customer-merge-store";
import { shopifyConsentTextVersion } from "./platform-flags.mjs";
import type { MirrorCustomer } from "./shopify-customer-map.mjs";

export interface MirrorUpsertResult {
  inserted: number;
  updated: number;
  stamped: number;
  merged: number;
  skipped: number;
  consentChanged: number;
  /** Customer ids touched (for follow-up work such as facts). */
  customerIds: number[];
}

interface ExistingRow {
  id: number;
  email: string;
  shopifyCustomerId: string | null;
  shopifyUpdatedAt: number | null;
}

const EMPTY: MirrorUpsertResult = {
  inserted: 0,
  updated: 0,
  stamped: 0,
  merged: 0,
  skipped: 0,
  consentChanged: 0,
  customerIds: [],
};

function ts(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function mapExisting(r: Record<string, unknown>): ExistingRow {
  return {
    id: Number(r.id),
    email: String(r.email),
    shopifyCustomerId: (r.shopify_customer_id as string | null) ?? null,
    shopifyUpdatedAt: r.shopify_updated_at ? ts(String(r.shopify_updated_at)) : null,
  };
}

function identityPayload(c: MirrorCustomer) {
  return {
    first_name: c.firstName,
    last_name: c.lastName,
    locale: c.locale,
    country_code: c.countryCode,
    shopify_state: c.state,
    shopify_tags: c.tags,
    shopify_created_at: c.createdAt,
    shopify_updated_at: c.updatedAt,
  };
}

/**
 * Upsert mirrored customers. `origin` labels the consent events
 * (import | reconcile | webhook:<id>). Never throws; null without a DB.
 */
export async function upsertMirrorCustomers(
  input: MirrorCustomer[],
  opts: { origin: string },
  sql: Sql | null = getSql()
): Promise<MirrorUpsertResult | null> {
  if (!sql) return null;
  if (input.length === 0) return { ...EMPTY, customerIds: [] };
  const result: MirrorUpsertResult = { ...EMPTY, customerIds: [] };
  try {
    // Newest payload per Shopify id wins inside one batch.
    const byId = new Map<string, MirrorCustomer>();
    for (const c of input) {
      const prev = byId.get(c.shopifyId);
      if (!prev || (ts(c.updatedAt) ?? 0) >= (ts(prev.updatedAt) ?? 0)) byId.set(c.shopifyId, c);
    }
    let rows = [...byId.values()];
    const ids = rows.map((c) => c.shopifyId);
    const emails = rows.map((c) => c.email).filter((e): e is string => Boolean(e));

    const [tombstones, erased, existingById, existingByEmail] = await Promise.all([
      sql`SELECT shopify_customer_id FROM erasure_tombstones WHERE shopify_customer_id = ANY(${ids}::text[])`,
      sql`SELECT email, added_at FROM suppression_list WHERE reason = 'erasure' AND email = ANY(${emails}::text[])`,
      sql`SELECT id, email, shopify_customer_id, shopify_updated_at FROM customers
           WHERE shopify_customer_id = ANY(${ids}::text[])`,
      sql`SELECT id, email, shopify_customer_id, shopify_updated_at FROM customers
           WHERE email = ANY(${emails}::text[])`,
    ]) as [Array<Record<string, unknown>>, Array<Record<string, unknown>>, Array<Record<string, unknown>>, Array<Record<string, unknown>>];

    const tombstoned = new Set(tombstones.map((r) => String(r.shopify_customer_id)));
    const erasedAt = new Map(erased.map((r) => [String(r.email), ts(String(r.added_at))]));
    const rowByShopifyId = new Map(existingById.map((r) => [String(r.shopify_customer_id), mapExisting(r)]));
    const rowByEmail = new Map(existingByEmail.map((r) => [String(r.email), mapExisting(r)]));

    rows = rows.filter((c) => {
      if (tombstoned.has(c.shopifyId)) return false;
      // An e-mail erased in Mo stays out — unless this Shopify account was
      // created after the erasure (a new relationship).
      if (c.email && erasedAt.has(c.email)) {
        const erasedTs = erasedAt.get(c.email) ?? null;
        const createdTs = ts(c.createdAt);
        if (erasedTs === null || createdTs === null || createdTs <= erasedTs) return false;
      }
      return true;
    });
    result.skipped = byId.size - rows.length;

    const updates: Array<Record<string, unknown>> = [];
    const stamps: Array<Record<string, unknown>> = [];
    const inserts: Array<Record<string, unknown>> = [];
    const merges: Array<{ keepId: number; dropId: number; email: string }> = [];
    const resolvedId = new Map<string, number>();

    for (const c of rows) {
      const existing = rowByShopifyId.get(c.shopifyId);
      if (existing) {
        resolvedId.set(c.shopifyId, existing.id);
        const incomingTs = ts(c.updatedAt);
        if (existing.shopifyUpdatedAt !== null && incomingTs !== null && incomingTs < existing.shopifyUpdatedAt) {
          continue; // stale payload — consent still runs below on its own clock
        }
        let email: string | null = null;
        if (c.email && c.email !== existing.email) {
          const owner = rowByEmail.get(c.email);
          if (!owner) email = c.email;
          else if (!owner.shopifyCustomerId) merges.push({ keepId: existing.id, dropId: owner.id, email: c.email });
          // owner with another Shopify id: that row's own update moves it away first.
        }
        updates.push({ id: existing.id, email, ...identityPayload(c) });
        continue;
      }
      const byEmail = c.email ? rowByEmail.get(c.email) : undefined;
      if (byEmail && !byEmail.shopifyCustomerId) {
        resolvedId.set(c.shopifyId, byEmail.id);
        stamps.push({ id: byEmail.id, shopify_customer_id: c.shopifyId, shopify_customer_gid: c.gid, ...identityPayload(c) });
        continue;
      }
      // New person. An address another Shopify id still holds in our mirror
      // gets the placeholder until that row moves on.
      const email = c.email && !byEmail ? c.email : `shopify:${c.shopifyId}`;
      inserts.push({
        email,
        shopify_customer_id: c.shopifyId,
        shopify_customer_gid: c.gid,
        first_seen_at: c.createdAt,
        ...identityPayload(c),
      });
    }

    const queries = [];
    if (updates.length > 0) {
      queries.push(sql`
        UPDATE customers c SET
          email              = COALESCE(x.email, c.email),
          first_name         = x.first_name,
          last_name          = x.last_name,
          locale             = COALESCE(x.locale, c.locale),
          country_code       = x.country_code,
          shopify_state      = x.shopify_state,
          shopify_tags       = COALESCE(x.shopify_tags, '{}'),
          shopify_created_at = COALESCE(x.shopify_created_at, c.shopify_created_at),
          shopify_updated_at = COALESCE(x.shopify_updated_at, c.shopify_updated_at),
          shopify_synced_at  = now(),
          facts_dirty_at     = now()
        FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb) AS x(
          id bigint, email text, first_name text, last_name text, locale text, country_code text,
          shopify_state text, shopify_tags text[], shopify_created_at timestamptz, shopify_updated_at timestamptz)
        WHERE c.id = x.id
          AND (x.email IS NULL OR NOT EXISTS (SELECT 1 FROM customers o WHERE o.email = x.email AND o.id <> c.id))
      `);
    }
    if (stamps.length > 0) {
      queries.push(sql`
        UPDATE customers c SET
          shopify_customer_id  = x.shopify_customer_id,
          shopify_customer_gid = x.shopify_customer_gid,
          shopify_linked_at    = COALESCE(c.shopify_linked_at, now()),
          first_name         = COALESCE(x.first_name, c.first_name),
          last_name          = COALESCE(x.last_name, c.last_name),
          locale             = COALESCE(x.locale, c.locale),
          country_code       = x.country_code,
          shopify_state      = x.shopify_state,
          shopify_tags       = COALESCE(x.shopify_tags, '{}'),
          shopify_created_at = x.shopify_created_at,
          shopify_updated_at = x.shopify_updated_at,
          shopify_synced_at  = now(),
          facts_dirty_at     = now()
        FROM jsonb_to_recordset(${JSON.stringify(stamps)}::jsonb) AS x(
          id bigint, shopify_customer_id text, shopify_customer_gid text, first_name text, last_name text,
          locale text, country_code text, shopify_state text, shopify_tags text[],
          shopify_created_at timestamptz, shopify_updated_at timestamptz)
        WHERE c.id = x.id AND c.shopify_customer_id IS NULL
      `);
    }
    if (inserts.length > 0) {
      queries.push(sql`
        INSERT INTO customers (
          email, source, identity_tier, shopify_customer_id, shopify_customer_gid, shopify_linked_at,
          first_name, last_name, locale, country_code, shopify_state, shopify_tags,
          shopify_created_at, shopify_updated_at, shopify_synced_at, first_seen_at, last_seen_at, facts_dirty_at)
        SELECT x.email, 'shopify', 1, x.shopify_customer_id, x.shopify_customer_gid, now(),
               x.first_name, x.last_name, x.locale, x.country_code, x.shopify_state, COALESCE(x.shopify_tags, '{}'),
               x.shopify_created_at, x.shopify_updated_at, now(),
               COALESCE(x.first_seen_at, now()), COALESCE(x.first_seen_at, now()), now()
          FROM jsonb_to_recordset(${JSON.stringify(inserts)}::jsonb) AS x(
            email text, shopify_customer_id text, shopify_customer_gid text, first_seen_at timestamptz,
            first_name text, last_name text, locale text, country_code text, shopify_state text,
            shopify_tags text[], shopify_created_at timestamptz, shopify_updated_at timestamptz)
        ON CONFLICT DO NOTHING
        RETURNING id, shopify_customer_id
      `);
    }
    if (queries.length > 0) {
      const out = (await sql.transaction(queries)) as Array<Array<Record<string, unknown>>>;
      const insertedRows = inserts.length > 0 ? out[out.length - 1] : [];
      for (const r of insertedRows) resolvedId.set(String(r.shopify_customer_id), Number(r.id));
      result.inserted = insertedRows.length;
    }
    result.updated = updates.length;
    result.stamped = stamps.length;

    for (const m of merges) {
      const res = await mergeCustomers(m.keepId, m.dropId, { newEmail: m.email, note: "E-Mail-Änderung in Shopify" }, sql);
      if (res.ok) result.merged++;
    }

    // Consent through the resolver, never written directly.
    const textVersion = shopifyConsentTextVersion();
    const acts: ConsentAct[] = [];
    for (const c of rows) {
      const customerId = resolvedId.get(c.shopifyId);
      if (!customerId || !c.consent) continue;
      if (c.consent.state === "redacted") continue; // the erasure path handles it
      acts.push({
        customerId,
        incoming: {
          state: c.consent.state,
          level: c.consent.level,
          at: c.consent.at,
          source: "shopify",
        },
        originRef: opts.origin,
        textVersion,
      });
    }
    if (acts.length > 0) {
      const applied = await applyConsentActs(acts, sql);
      result.consentChanged = (applied ?? []).filter((a) => a.changed).length;
    }
    result.customerIds = [...new Set(resolvedId.values())];
    return result;
  } catch (err) {
    reportError(err, { route: "lib/customer-mirror-store", phase: "upsertMirrorCustomers" });
    return null;
  }
}

/** The customer row of a Shopify id, or null. */
export async function customerIdForShopifyId(
  shopifyId: string,
  sql: Sql | null = getSql()
): Promise<number | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`SELECT id FROM customers WHERE shopify_customer_id = ${shopifyId}`) as Array<{ id: number }>;
    return rows[0] ? Number(rows[0].id) : null;
  } catch (err) {
    reportError(err, { route: "lib/customer-mirror-store", phase: "customerIdForShopifyId" });
    return null;
  }
}

/** Mark customers' facts for recomputation (orders, chats, sends changed). */
export async function markFactsDirty(customerIds: number[], sql: Sql | null = getSql()): Promise<void> {
  if (!sql || customerIds.length === 0) return;
  try {
    await sql`UPDATE customers SET facts_dirty_at = now() WHERE id = ANY(${customerIds}::bigint[])`;
  } catch (err) {
    reportError(err, { route: "lib/customer-mirror-store", phase: "markFactsDirty" });
  }
}
