// The initial alignment of the one consent with Shopify („Erstabgleich“,
// docs/archive/CUSTOMER_PLATFORM_PLAN.md §7.7). Migration 0064 translated today's
// three stores into customers.email_consent_*, and the first Shopify import
// runs every Shopify customer through the resolver — where Mo holds the newer
// act, that already queues a consent write for Shopify. What no act ever
// reaches are the people who confirmed our double opt-in BEFORE the switch and
// have no Shopify customer: this module reports them and, on an explicit
// operator confirm, queues one `customer_create` per person (D-3). The outbox
// sends them only while SHOPIFY_CONSENT_WRITEBACK is on, at its own pace.
//
// Best-effort like every store: no DB → null; failures are reported.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";

export interface ConsentAlignmentReport {
  /** Subscribed in Mo, no Shopify customer, real address, not blocked, no create queued. */
  moOnlySubscribers: number;
  /** customer_create rows waiting (pending / failed / running). */
  createsOpen: number;
  /** consent_update rows waiting, by the target state they will write. */
  consentWritesOpen: { subscribe: number; unsubscribe: number };
}

/** The counts for Einstellungen → Shopify-Abgleich. Never throws. */
export async function getConsentAlignmentReport(sql: Sql | null = getSql()): Promise<ConsentAlignmentReport | null> {
  if (!sql) return null;
  try {
    const [only, outbox] = (await Promise.all([
      sql`
        SELECT count(*)::int AS n
          FROM customers c
         WHERE c.email_consent_state = 'subscribed'
           AND c.shopify_customer_id IS NULL
           AND position('@' in c.email) > 0
           AND c.email NOT LIKE 'shopify:%'
           AND NOT EXISTS (
                 SELECT 1 FROM suppression_list s
                  WHERE s.email = c.email AND s.reason IN ('bounce', 'complaint', 'erasure')
               )
           AND NOT EXISTS (
                 SELECT 1 FROM shopify_outbox o
                  WHERE o.kind = 'customer_create' AND o.customer_id = c.id
                    AND o.status IN ('pending', 'failed', 'running')
               )
      `,
      sql`
        SELECT count(*) FILTER (WHERE kind = 'customer_create')::int AS creates,
               count(*) FILTER (WHERE kind = 'consent_update' AND payload->>'state' = 'subscribed')::int AS subscribe,
               count(*) FILTER (WHERE kind = 'consent_update' AND payload->>'state' <> 'subscribed')::int AS unsubscribe
          FROM shopify_outbox
         WHERE status IN ('pending', 'failed', 'running')
      `,
    ])) as [Array<{ n: number }>, Array<{ creates: number; subscribe: number; unsubscribe: number }>];
    return {
      moOnlySubscribers: Number(only[0]?.n ?? 0),
      createsOpen: Number(outbox[0]?.creates ?? 0),
      consentWritesOpen: {
        subscribe: Number(outbox[0]?.subscribe ?? 0),
        unsubscribe: Number(outbox[0]?.unsubscribe ?? 0),
      },
    };
  } catch (err) {
    reportError(err, { route: "lib/consent-alignment", phase: "report" });
    return null;
  }
}

/**
 * Queue a `customer_create` for every Mo-only subscriber (the same payload the
 * consent store writes for a fresh DOI). Idempotent: people with an open
 * create are skipped. Returns the number queued; never throws.
 */
export async function queueMoOnlySubscribers(sql: Sql | null = getSql()): Promise<number | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      INSERT INTO shopify_outbox (kind, customer_id, payload)
      SELECT 'customer_create', c.id,
             jsonb_build_object(
               'state', c.email_consent_state,
               'level', c.email_consent_level,
               'at', c.email_consent_at,
               'email', c.email,
               'firstName', c.first_name,
               'lastName', c.last_name
             )
        FROM customers c
       WHERE c.email_consent_state = 'subscribed'
         AND c.shopify_customer_id IS NULL
         AND position('@' in c.email) > 0
         AND c.email NOT LIKE 'shopify:%'
         AND NOT EXISTS (
               SELECT 1 FROM suppression_list s
                WHERE s.email = c.email AND s.reason IN ('bounce', 'complaint', 'erasure')
             )
         AND NOT EXISTS (
               SELECT 1 FROM shopify_outbox o
                WHERE o.kind = 'customer_create' AND o.customer_id = c.id
                  AND o.status IN ('pending', 'failed', 'running')
             )
      RETURNING id
    `) as Array<{ id: number }>;
    return rows.length;
  } catch (err) {
    reportError(err, { route: "lib/consent-alignment", phase: "queue" });
    return null;
  }
}
