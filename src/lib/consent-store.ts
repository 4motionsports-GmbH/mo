// The one write path for the e-mail-marketing consent (I/O around
// lib/consent-core.mjs). Every change — our DOI confirm, the unsubscribe link,
// the admin opt-out, a Shopify webhook, the bulk import, the reconciliation —
// calls applyConsentActs. It loads the current state of each person, lets the
// pure resolver decide, and writes the result in ONE transaction:
//
//   customers.email_consent_* (+ the legacy marketing_status mirror),
//   consent_events (the history),
//   suppression_list (opt-out rows added / lifted, hard blocks),
//   shopify_outbox (Mo-side changes pushed to Shopify, drift healed).
//
// See docs/CUSTOMER_PLATFORM_PLAN.md §7 and docs/CONSENT_FLOW.md. Best-effort
// like every store: no DB → null; failures are reported, never thrown.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import {
  resolveEmailConsent,
  legacyMarketingStatus,
  type ConsentState,
  type ConsentLevel,
  type ConsentSource,
  type IncomingConsent,
} from "./consent-core.mjs";

export type { ConsentState, ConsentLevel, ConsentSource } from "./consent-core.mjs";

export interface CustomerConsent {
  state: ConsentState;
  level: ConsentLevel | null;
  at: string | null;
  source: string | null;
  syncedAt: string | null;
  /** Block-list reason for the address, if any (unsubscribe/manual/bounce/complaint/erasure). */
  suppression: string | null;
  suppressionAt: string | null;
}

export interface ConsentAct {
  customerId: number;
  incoming: IncomingConsent;
  /** What carried the act (email_capture:<id>, webhook:<id>, admin, import …). */
  originRef?: string | null;
  /** Shopify-side consent text version (SHOPIFY_CONSENT_TEXT_VERSION). */
  textVersion?: string | null;
  note?: string | null;
}

export interface ConsentActResult {
  customerId: number;
  outcome: string;
  changed: boolean;
  state: ConsentState;
  /** Outbox rows enqueued for this person (inline processing by the caller). */
  outboxIds: number[];
}

interface CurrentRow {
  id: number;
  email: string;
  shopifyCustomerId: string | null;
  firstName: string | null;
  lastName: string | null;
  consent: CustomerConsent;
}

const isRealEmail = (e: string) => e.includes("@") && !e.startsWith("shopify:");

function mapConsent(r: Record<string, unknown>): CustomerConsent {
  return {
    state: (r.email_consent_state as ConsentState) ?? "not_subscribed",
    level: (r.email_consent_level as ConsentLevel | null) ?? null,
    at: r.email_consent_at ? new Date(String(r.email_consent_at)).toISOString() : null,
    source: (r.email_consent_source as string | null) ?? null,
    syncedAt: r.email_consent_synced_at ? new Date(String(r.email_consent_synced_at)).toISOString() : null,
    suppression: (r.suppression_reason as string | null) ?? null,
    suppressionAt: r.suppression_added_at ? new Date(String(r.suppression_added_at)).toISOString() : null,
  };
}

/** The current consent of one customer, or null (unknown id / no DB). */
export async function getCustomerConsent(
  customerId: number,
  sql: Sql | null = getSql()
): Promise<CustomerConsent | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT c.email_consent_state, c.email_consent_level, c.email_consent_at,
             c.email_consent_source, c.email_consent_synced_at,
             s.reason AS suppression_reason, s.added_at AS suppression_added_at
        FROM customers c
        LEFT JOIN suppression_list s ON s.email = c.email
       WHERE c.id = ${customerId}
    `) as Array<Record<string, unknown>>;
    return rows[0] ? mapConsent(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/consent-store", phase: "getCustomerConsent" });
    return null;
  }
}

/** The consent history of one customer, newest first. */
export interface ConsentEventRow {
  id: number;
  occurredAt: string;
  source: string;
  state: string;
  level: string | null;
  note: string | null;
}

export async function listConsentEvents(
  customerId: number,
  limit = 50,
  sql: Sql | null = getSql()
): Promise<ConsentEventRow[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT id, occurred_at, source, state, level, note
        FROM consent_events
       WHERE customer_id = ${customerId}
       ORDER BY occurred_at DESC, id DESC
       LIMIT ${limit}
    `) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r.id),
      occurredAt: new Date(String(r.occurred_at)).toISOString(),
      source: String(r.source),
      state: String(r.state),
      level: (r.level as string | null) ?? null,
      note: (r.note as string | null) ?? null,
    }));
  } catch (err) {
    reportError(err, { route: "lib/consent-store", phase: "listConsentEvents" });
    return [];
  }
}

/**
 * Apply consent acts for one or many customers (several acts for the same
 * customer are applied in order). Returns one result per act, or null when no
 * DB is configured / the transaction failed. Never throws.
 */
export async function applyConsentActs(
  acts: ConsentAct[],
  sql: Sql | null = getSql()
): Promise<ConsentActResult[] | null> {
  if (!sql) return null;
  if (acts.length === 0) return [];
  try {
    const ids = [...new Set(acts.map((a) => a.customerId))];
    const rows = (await sql`
      SELECT c.id, c.email, c.shopify_customer_id, c.first_name, c.last_name,
             c.email_consent_state, c.email_consent_level, c.email_consent_at,
             c.email_consent_source, c.email_consent_synced_at,
             s.reason AS suppression_reason, s.added_at AS suppression_added_at
        FROM customers c
        LEFT JOIN suppression_list s ON s.email = c.email
       WHERE c.id = ANY(${ids}::bigint[])
    `) as Array<Record<string, unknown>>;
    const current = new Map<number, CurrentRow>();
    for (const r of rows) {
      current.set(Number(r.id), {
        id: Number(r.id),
        email: String(r.email),
        shopifyCustomerId: (r.shopify_customer_id as string | null) ?? null,
        firstName: (r.first_name as string | null) ?? null,
        lastName: (r.last_name as string | null) ?? null,
        consent: mapConsent(r),
      });
    }

    const results: ConsentActResult[] = [];
    // Final state per customer (several acts → the last decision wins).
    const finalState = new Map<number, { state: ConsentState; level: ConsentLevel | null; at: string | null; source: string | null }>();
    const synced = new Set<number>();
    const events: Array<Record<string, unknown>> = [];
    const suppress = new Map<string, string>();
    const liftSuppression = new Set<string>();
    const liftErasure = new Set<string>();
    const push = new Set<number>();

    for (const act of acts) {
      const row = current.get(act.customerId);
      if (!row) {
        results.push({ customerId: act.customerId, outcome: "ignored", changed: false, state: "not_subscribed", outboxIds: [] });
        continue;
      }
      const d = resolveEmailConsent(row.consent, act.incoming);
      if (d.changed) {
        row.consent = {
          ...row.consent,
          state: d.next.state,
          level: d.next.level,
          at: d.next.at,
          source: d.next.source,
        };
        finalState.set(row.id, d.next);
        events.push({
          customer_id: row.id,
          occurred_at: d.next.at,
          source: act.incoming.source,
          state: d.next.state,
          level: d.next.level,
          origin_ref: act.originRef ?? null,
          text_version: act.textVersion ?? null,
          note: act.note ?? null,
        });
      } else if (d.outcome === "blocked") {
        events.push({
          customer_id: row.id,
          occurred_at: act.incoming.at ?? new Date().toISOString(),
          source: act.incoming.source,
          state: row.consent.state,
          level: row.consent.level,
          origin_ref: act.originRef ?? null,
          text_version: act.textVersion ?? null,
          note: d.note,
        });
      }
      if (d.effects.markSynced) synced.add(row.id);
      if (isRealEmail(row.email)) {
        if (d.effects.suppress) {
          suppress.set(row.email, d.effects.suppress);
          row.consent.suppression = row.consent.suppression && ["bounce", "complaint", "erasure"].includes(row.consent.suppression)
            ? row.consent.suppression
            : d.effects.suppress;
        }
        if (d.effects.liftSuppression) {
          liftSuppression.add(row.email);
          row.consent.suppression = null;
        }
        if (d.effects.liftErasure) {
          liftErasure.add(row.email);
          row.consent.suppression = null;
        }
      }
      if (d.effects.pushToShopify) push.add(row.id);
      results.push({ customerId: row.id, outcome: d.outcome, changed: d.changed, state: row.consent.state, outboxIds: [] });
    }

    // Outbox rows: the TARGET state of everyone with a Mo-side change.
    const consentUpdates: Array<Record<string, unknown>> = [];
    const creates: Array<Record<string, unknown>> = [];
    for (const id of push) {
      const row = current.get(id)!;
      const target = { state: row.consent.state, level: row.consent.level, at: row.consent.at };
      if (row.shopifyCustomerId) {
        consentUpdates.push({ customer_id: id, shopify_customer_id: row.shopifyCustomerId, payload: target });
      } else if (row.consent.state === "subscribed" && isRealEmail(row.email)) {
        // Mo-only subscriber → one subscriber list: create the Shopify customer
        // with the consent (docs/CUSTOMER_PLATFORM_PLAN.md D-3).
        creates.push({
          customer_id: id,
          payload: { ...target, email: row.email, firstName: row.firstName, lastName: row.lastName },
        });
      }
    }

    const updates = [...finalState.entries()].map(([id, s]) => ({
      id,
      state: s.state,
      level: s.level,
      at: s.at,
      source: s.source,
      legacy: legacyMarketingStatus(s.state),
    }));
    const suppressRows = [...suppress.entries()].map(([email, reason]) => ({ email, reason }));

    const queries = [];
    if (updates.length > 0) {
      queries.push(sql`
        UPDATE customers c
           SET email_consent_state  = x.state,
               email_consent_level  = x.level,
               email_consent_at     = x.at,
               email_consent_source = x.source,
               marketing_status     = x.legacy,
               facts_dirty_at       = now()
          FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb)
               AS x(id bigint, state text, level text, at timestamptz, source text, legacy text)
         WHERE c.id = x.id
      `);
    }
    if (synced.size > 0) {
      queries.push(sql`
        UPDATE customers SET email_consent_synced_at = now() WHERE id = ANY(${[...synced]}::bigint[])
      `);
    }
    if (events.length > 0) {
      queries.push(sql`
        INSERT INTO consent_events (customer_id, occurred_at, source, state, level, origin_ref, text_version, note)
        SELECT x.customer_id, x.occurred_at, x.source, x.state, x.level, x.origin_ref, x.text_version, x.note
          FROM jsonb_to_recordset(${JSON.stringify(events)}::jsonb)
               AS x(customer_id bigint, occurred_at timestamptz, source text, state text, level text,
                    origin_ref text, text_version text, note text)
      `);
    }
    if (suppressRows.length > 0) {
      // A hard block (bounce / complaint / erasure) is never downgraded to an opt-out.
      queries.push(sql`
        INSERT INTO suppression_list (email, reason)
        SELECT x.email, x.reason FROM jsonb_to_recordset(${JSON.stringify(suppressRows)}::jsonb) AS x(email text, reason text)
        ON CONFLICT (email) DO UPDATE
          SET reason = EXCLUDED.reason, added_at = now()
          WHERE suppression_list.reason IS NULL
             OR suppression_list.reason NOT IN ('bounce', 'complaint', 'erasure')
             OR EXCLUDED.reason IN ('complaint', 'erasure')
      `);
    }
    if (liftSuppression.size > 0) {
      queries.push(sql`
        DELETE FROM suppression_list
         WHERE email = ANY(${[...liftSuppression]}::text[])
           AND COALESCE(reason, 'unsubscribe') IN ('unsubscribe', 'manual')
      `);
    }
    if (liftErasure.size > 0) {
      queries.push(sql`
        DELETE FROM suppression_list WHERE email = ANY(${[...liftErasure]}::text[]) AND reason = 'erasure'
      `);
    }
    if (consentUpdates.length > 0) {
      // Supersede older open consent writes of the same people — only the
      // newest target state is ever sent.
      queries.push(sql`
        UPDATE shopify_outbox SET status = 'skipped', done_at = now(), last_error = 'superseded'
         WHERE kind = 'consent_update' AND status IN ('pending', 'failed')
           AND customer_id = ANY(${consentUpdates.map((u) => u.customer_id as number)}::bigint[])
      `);
      queries.push(sql`
        INSERT INTO shopify_outbox (kind, customer_id, shopify_customer_id, payload)
        SELECT 'consent_update', x.customer_id, x.shopify_customer_id, x.payload
          FROM jsonb_to_recordset(${JSON.stringify(consentUpdates)}::jsonb)
               AS x(customer_id bigint, shopify_customer_id text, payload jsonb)
        RETURNING id, customer_id
      `);
    }
    if (creates.length > 0) {
      queries.push(sql`
        INSERT INTO shopify_outbox (kind, customer_id, payload)
        SELECT 'customer_create', x.customer_id, x.payload
          FROM jsonb_to_recordset(${JSON.stringify(creates)}::jsonb) AS x(customer_id bigint, payload jsonb)
         WHERE NOT EXISTS (
                 SELECT 1 FROM shopify_outbox o
                  WHERE o.kind = 'customer_create' AND o.customer_id = x.customer_id
                    AND o.status IN ('pending', 'failed', 'running')
               )
        RETURNING id, customer_id
      `);
    }

    if (queries.length > 0) {
      const out = (await sql.transaction(queries)) as Array<Array<Record<string, unknown>>>;
      const outboxRows = out.flat().filter((r) => r && "customer_id" in r && "id" in r && !("n" in r));
      for (const r of outboxRows) {
        const res = results.filter((x) => x.customerId === Number(r.customer_id));
        for (const x of res) x.outboxIds.push(Number(r.id));
      }
    }
    return results;
  } catch (err) {
    reportError(err, { route: "lib/consent-store", phase: "applyConsentActs" });
    return null;
  }
}

/** One act for one customer — the common case in the routes. */
export async function applyConsentAct(
  act: ConsentAct,
  sql: Sql | null = getSql()
): Promise<ConsentActResult | null> {
  const res = await applyConsentActs([act], sql);
  return res?.[0] ?? null;
}

/** The customer id for an address (consent acts are keyed by customer). */
export async function customerIdForEmail(
  email: string,
  sql: Sql | null = getSql()
): Promise<number | null> {
  if (!sql) return null;
  const e = email.trim().toLowerCase();
  if (!e) return null;
  try {
    const rows = (await sql`SELECT id FROM customers WHERE email = ${e}`) as Array<{ id: number }>;
    return rows[0] ? Number(rows[0].id) : null;
  } catch (err) {
    reportError(err, { route: "lib/consent-store", phase: "customerIdForEmail" });
    return null;
  }
}

/**
 * Is e-mail marketing to this customer currently consented (subscribed and
 * no hard block)? The level gate (single opt-in) is the eligibility core's.
 */
export function isSubscribed(c: Pick<CustomerConsent, "state" | "suppression"> | null): boolean {
  if (!c) return false;
  return c.state === "subscribed" && !["bounce", "complaint", "erasure"].includes(c.suppression ?? "");
}
