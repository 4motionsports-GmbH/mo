// The Shopify outbox — every write Mo makes to a Shopify customer.
//
// Rows are enqueued by the consent store (consent_update, customer_create) and
// by the erasure path (consent_update + data_erasure). Each row carries its
// TARGET state, so running it twice is harmless. The worker runs right after a
// change (best-effort, inline) and from /api/cron/shopify-sync every five
// minutes; failures back off (lib/outbox-core.mjs) until done or dead. A dead
// row is shown in Einstellungen → Shopify-Abgleich and in the Eingang.
//
// Mutations (Admin GraphQL, scope write_customers — verify the input shapes
// against the configured SHOPIFY_API_VERSION, docs/CUSTOMER_PLATFORM_PLAN.md
// §6.2):
//   customerEmailMarketingConsentUpdate(input: { customerId, emailMarketingConsent })
//   customerCreate(input: { email, firstName, lastName, emailMarketingConsent })
//   customerRequestDataErasure(customerId)

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { adminGraphql, isShopifyConfigured } from "./shopify";
import { planOutboxRetry, isPermanentUserError, OUTBOX_MAX_ATTEMPTS } from "./outbox-core.mjs";
import { toShopifyConsentInput, customerGid, numericShopifyId } from "./shopify-customer-map.mjs";
import {
  isShopifyConsentWritebackEnabled,
  isShopifyErasureSyncEnabled,
} from "./platform-flags.mjs";

interface OutboxRow {
  id: number;
  kind: string;
  customerId: number | null;
  shopifyCustomerId: string | null;
  payload: Record<string, unknown>;
  attempts: number;
}

interface UserError {
  field?: string[] | null;
  message?: string;
  code?: string;
}

class PermanentOutboxError extends Error {}

const CONSENT_UPDATE = /* GraphQL */ `
  mutation MoConsentUpdate($input: CustomerEmailMarketingConsentUpdateInput!) {
    customerEmailMarketingConsentUpdate(input: $input) {
      customer { id }
      userErrors { field message code }
    }
  }
`;

const CUSTOMER_CREATE = /* GraphQL */ `
  mutation MoCustomerCreate($input: CustomerInput!) {
    customerCreate(input: $input) {
      customer { id }
      userErrors { field message }
    }
  }
`;

const DATA_ERASURE = /* GraphQL */ `
  mutation MoDataErasure($customerId: ID!) {
    customerRequestDataErasure(customerId: $customerId) {
      customerId
      userErrors { field message code }
    }
  }
`;

const CUSTOMER_BY_EMAIL = /* GraphQL */ `
  query MoCustomerByEmail($query: String!) {
    customers(first: 1, query: $query) { nodes { id } }
  }
`;

function assertNoUserErrors(errors: UserError[] | undefined): void {
  if (!errors || errors.length === 0) return;
  const msg = errors.map((e) => e.message ?? e.code ?? "error").join("; ");
  if (isPermanentUserError(errors)) throw new PermanentOutboxError(msg);
  throw new Error(msg);
}

/** Shopify's customer id for an e-mail, or null. Never throws. */
export async function findShopifyCustomerIdByEmail(email: string): Promise<string | null> {
  if (!isShopifyConfigured()) return null;
  const e = email.trim().toLowerCase();
  if (!e.includes("@")) return null;
  try {
    const data = await adminGraphql<{ customers: { nodes: Array<{ id: string }> } }>(CUSTOMER_BY_EMAIL, {
      query: `email:"${e.replace(/"/g, "")}"`,
    });
    return numericShopifyId(data.customers?.nodes?.[0]?.id ?? null);
  } catch (err) {
    reportError(err, { route: "lib/shopify-outbox", phase: "findShopifyCustomerIdByEmail" });
    return null;
  }
}

async function runConsentUpdate(shopifyId: string, payload: Record<string, unknown>): Promise<void> {
  const consent = toShopifyConsentInput({
    state: String(payload.state ?? "not_subscribed"),
    level: (payload.level as string | null) ?? null,
  });
  // Shopify accepts SUBSCRIBED / UNSUBSCRIBED / NOT_SUBSCRIBED writes; a local
  // "pending" is never pushed (the consent core keeps it local).
  const input: Record<string, unknown> = {
    customerId: customerGid(shopifyId),
    emailMarketingConsent: {
      marketingState: consent.marketingState,
      ...(consent.marketingState === "SUBSCRIBED" ? { marketingOptInLevel: consent.marketingOptInLevel } : {}),
      ...(payload.at ? { consentUpdatedAt: String(payload.at) } : {}),
    },
  };
  const data = await adminGraphql<{
    customerEmailMarketingConsentUpdate: { userErrors: UserError[] } | null;
  }>(CONSENT_UPDATE, { input });
  assertNoUserErrors(data.customerEmailMarketingConsentUpdate?.userErrors);
}

/** Link a Shopify id to the customer row (never stealing one another row holds). */
async function linkShopifyId(sql: Sql, customerId: number, shopifyId: string): Promise<void> {
  await sql`
    UPDATE customers
       SET shopify_customer_id  = ${shopifyId},
           shopify_customer_gid = ${customerGid(shopifyId)},
           shopify_linked_at    = COALESCE(shopify_linked_at, now()),
           email_consent_synced_at = now()
     WHERE id = ${customerId}
       AND shopify_customer_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM customers o WHERE o.shopify_customer_id = ${shopifyId})
  `;
}

async function runCustomerCreate(sql: Sql, row: OutboxRow): Promise<void> {
  const p = row.payload;
  const email = String(p.email ?? "").trim().toLowerCase();
  if (!email.includes("@") || row.customerId == null) throw new PermanentOutboxError("no e-mail");

  // The customer may meanwhile have been linked (sign-in, import) — then this
  // is just a consent update.
  const linked = (await sql`SELECT shopify_customer_id FROM customers WHERE id = ${row.customerId}`) as Array<{
    shopify_customer_id: string | null;
  }>;
  if (!linked[0]) throw new PermanentOutboxError("customer gone");
  if (linked[0].shopify_customer_id) {
    await runConsentUpdate(linked[0].shopify_customer_id, p);
    return;
  }

  const consent = toShopifyConsentInput({ state: String(p.state ?? "subscribed"), level: (p.level as string | null) ?? null });
  const input: Record<string, unknown> = {
    email,
    ...(p.firstName ? { firstName: String(p.firstName) } : {}),
    ...(p.lastName ? { lastName: String(p.lastName) } : {}),
    emailMarketingConsent: {
      marketingState: consent.marketingState,
      marketingOptInLevel: consent.marketingOptInLevel,
      ...(p.at ? { consentUpdatedAt: String(p.at) } : {}),
    },
  };
  const data = await adminGraphql<{
    customerCreate: { customer: { id: string } | null; userErrors: UserError[] } | null;
  }>(CUSTOMER_CREATE, { input });
  const errors = data.customerCreate?.userErrors ?? [];
  if (errors.some((e) => /taken/i.test(e.message ?? ""))) {
    // A Shopify customer with this address exists (our mirror did not know
    // yet): link it and write the consent there.
    const existing = await findShopifyCustomerIdByEmail(email);
    if (!existing) throw new Error("email taken but customer not found");
    await linkShopifyId(sql, row.customerId, existing);
    await runConsentUpdate(existing, p);
    return;
  }
  assertNoUserErrors(errors);
  const created = numericShopifyId(data.customerCreate?.customer?.id ?? null);
  if (!created) throw new Error("customerCreate returned no id");
  await linkShopifyId(sql, row.customerId, created);
}

async function runDataErasure(shopifyId: string): Promise<void> {
  // Consent off first — it takes effect at once for every Shopify-side mailer,
  // while Shopify's erasure itself follows its own schedule.
  await runConsentUpdate(shopifyId, { state: "unsubscribed", level: null, at: new Date().toISOString() });
  const data = await adminGraphql<{
    customerRequestDataErasure: { userErrors: UserError[] } | null;
  }>(DATA_ERASURE, { customerId: customerGid(shopifyId) });
  assertNoUserErrors(data.customerRequestDataErasure?.userErrors);
}

function enabledFor(kind: string): boolean {
  if (kind === "data_erasure") return isShopifyErasureSyncEnabled();
  if (kind === "consent_update" || kind === "customer_create") return isShopifyConsentWritebackEnabled();
  return false;
}

async function runRow(sql: Sql, row: OutboxRow): Promise<void> {
  switch (row.kind) {
    case "consent_update": {
      const shopifyId = row.shopifyCustomerId;
      if (!shopifyId) throw new PermanentOutboxError("no Shopify id");
      await runConsentUpdate(shopifyId, row.payload);
      return;
    }
    case "customer_create":
      await runCustomerCreate(sql, row);
      return;
    case "data_erasure": {
      if (!row.shopifyCustomerId) throw new PermanentOutboxError("no Shopify id");
      await runDataErasure(row.shopifyCustomerId);
      return;
    }
    default:
      throw new PermanentOutboxError(`unknown kind ${row.kind}`);
  }
}

export interface OutboxRunResult {
  claimed: number;
  done: number;
  failed: number;
  dead: number;
  disabled: boolean;
}

/**
 * Work off due outbox rows: claim (lease 5 min), run, record. `ids` narrows to
 * specific rows (the inline attempt right after an enqueue). Never throws.
 */
export async function processShopifyOutbox(
  opts: { limit?: number; deadlineMs?: number; ids?: number[] } = {},
  sql: Sql | null = getSql()
): Promise<OutboxRunResult> {
  const result: OutboxRunResult = { claimed: 0, done: 0, failed: 0, dead: 0, disabled: false };
  if (!sql || !isShopifyConfigured()) {
    result.disabled = true;
    return result;
  }
  const kinds = ["consent_update", "customer_create", "data_erasure"].filter(enabledFor);
  if (kinds.length === 0) {
    result.disabled = true;
    return result;
  }
  const limit = Math.max(1, Math.min(opts.limit ?? 25, 200));
  const ids = opts.ids && opts.ids.length > 0 ? opts.ids : null;
  try {
    const claimed = (await sql`
      UPDATE shopify_outbox o
         SET status = 'running', attempts = o.attempts + 1,
             next_attempt_at = now() + interval '5 minutes'
       WHERE o.id IN (
         SELECT id FROM shopify_outbox
          WHERE kind = ANY(${kinds}::text[])
            AND status IN ('pending', 'failed', 'running')
            AND next_attempt_at <= now()
            AND (${ids}::bigint[] IS NULL OR id = ANY(${ids}::bigint[]))
          ORDER BY id
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
       )
      RETURNING o.id, o.kind, o.customer_id, o.shopify_customer_id, o.payload, o.attempts
    `) as Array<Record<string, unknown>>;
    result.claimed = claimed.length;

    for (const r of claimed) {
      if (opts.deadlineMs && Date.now() > opts.deadlineMs) break;
      const row: OutboxRow = {
        id: Number(r.id),
        kind: String(r.kind),
        customerId: r.customer_id == null ? null : Number(r.customer_id),
        shopifyCustomerId: (r.shopify_customer_id as string | null) ?? null,
        payload: (r.payload as Record<string, unknown>) ?? {},
        attempts: Number(r.attempts),
      };
      let ok = false;
      let permanent = false;
      let message: string | null = null;
      try {
        await runRow(sql, row);
        ok = true;
      } catch (err) {
        permanent = err instanceof PermanentOutboxError;
        message = err instanceof Error ? err.message.slice(0, 500) : String(err);
        if (!permanent && row.attempts >= OUTBOX_MAX_ATTEMPTS) {
          reportError(err, { route: "lib/shopify-outbox", phase: row.kind });
        }
      }
      const plan = planOutboxRetry({ attempts: row.attempts, ok, permanent });
      if (plan.status === "done") result.done++;
      else if (plan.status === "dead") result.dead++;
      else result.failed++;
      await sql`
        UPDATE shopify_outbox
           SET status = ${plan.status},
               next_attempt_at = COALESCE(${plan.nextAttemptAt}::timestamptz, next_attempt_at),
               last_error = ${message},
               done_at = CASE WHEN ${plan.status} = 'done' THEN now() ELSE done_at END,
               -- The e-mail of a create is only needed until it ran.
               payload = CASE WHEN ${plan.status} IN ('done', 'dead') AND kind = 'customer_create'
                              THEN payload - 'email' - 'firstName' - 'lastName' ELSE payload END
         WHERE id = ${row.id}
      `;
    }
  } catch (err) {
    reportError(err, { route: "lib/shopify-outbox", phase: "processShopifyOutbox" });
  }
  return result;
}

/** Best-effort inline run of freshly enqueued rows, bounded to a few seconds. */
export async function runOutboxInline(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await Promise.race([
      processShopifyOutbox({ ids, limit: ids.length }),
      new Promise((resolve) => setTimeout(resolve, 4000)),
    ]);
  } catch {
    // The cron picks it up.
  }
}

export interface OutboxStats {
  pending: number;
  failed: number;
  dead: number;
  doneLast24h: number;
  oldestPendingAt: string | null;
  deadRows: Array<{ id: number; kind: string; lastError: string | null; createdAt: string }>;
}

/** Counts for Einstellungen → Shopify-Abgleich and the Eingang. */
export async function getOutboxStats(sql: Sql | null = getSql()): Promise<OutboxStats | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT
        count(*) FILTER (WHERE status IN ('pending', 'running'))::int AS pending,
        count(*) FILTER (WHERE status = 'failed')::int AS failed,
        count(*) FILTER (WHERE status = 'dead')::int AS dead,
        count(*) FILTER (WHERE status = 'done' AND done_at > now() - interval '24 hours')::int AS done24,
        min(created_at) FILTER (WHERE status IN ('pending', 'failed', 'running')) AS oldest
        FROM shopify_outbox
    `) as Array<Record<string, unknown>>;
    const dead = (await sql`
      SELECT id, kind, last_error, created_at FROM shopify_outbox
       WHERE status = 'dead' ORDER BY id DESC LIMIT 20
    `) as Array<Record<string, unknown>>;
    const r = rows[0] ?? {};
    return {
      pending: Number(r.pending ?? 0),
      failed: Number(r.failed ?? 0),
      dead: Number(r.dead ?? 0),
      doneLast24h: Number(r.done24 ?? 0),
      oldestPendingAt: r.oldest ? new Date(String(r.oldest)).toISOString() : null,
      deadRows: dead.map((d) => ({
        id: Number(d.id),
        kind: String(d.kind),
        lastError: (d.last_error as string | null) ?? null,
        createdAt: new Date(String(d.created_at)).toISOString(),
      })),
    };
  } catch (err) {
    reportError(err, { route: "lib/shopify-outbox", phase: "getOutboxStats" });
    return null;
  }
}

/** Put a dead row back into the queue (operator "Erneut versuchen"). */
export async function retryOutboxRow(id: number, sql: Sql | null = getSql()): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = await sql`
      UPDATE shopify_outbox
         SET status = 'pending', attempts = 0, next_attempt_at = now(), last_error = NULL
       WHERE id = ${id} AND status IN ('dead', 'failed')
      RETURNING id
    `;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/shopify-outbox", phase: "retryOutboxRow" });
    return false;
  }
}

/**
 * Enqueue the Shopify side of an erasure: a consent write (unsubscribed — sent
 * while SHOPIFY_CONSENT_WRITEBACK is on, so no Shopify mailer keeps writing
 * even when the erasure itself is not passed on) and the erasure request
 * (SHOPIFY_ERASURE_SYNC; it switches the consent off again first).
 */
export async function enqueueShopifyErasure(
  shopifyCustomerId: string,
  sql: Sql | null = getSql()
): Promise<number[]> {
  if (!sql) return [];
  try {
    const consentOff = JSON.stringify({ state: "unsubscribed", level: null, at: new Date().toISOString() });
    const rows = (await sql`
      INSERT INTO shopify_outbox (kind, shopify_customer_id, payload)
      VALUES ('consent_update', ${shopifyCustomerId}, ${consentOff}::jsonb),
             ('data_erasure', ${shopifyCustomerId}, '{}'::jsonb)
      RETURNING id
    `) as Array<{ id: number }>;
    return rows.map((r) => Number(r.id));
  } catch (err) {
    reportError(err, { route: "lib/shopify-outbox", phase: "enqueueShopifyErasure" });
    return [];
  }
}
