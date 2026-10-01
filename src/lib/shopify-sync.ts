// Shopify → Mo sync of the customer base (I/O).
//
//   * Bulk import (once, re-runnable): two Shopify bulk operations —
//     customers, then orders with their line items. Each result file is read
//     in byte ranges (lib/shopify-bulk-core.mjs), so every step of the import
//     fits a serverless time budget and an interrupted import resumes where
//     it stopped. Driven step by step from Einstellungen → Shopify-Abgleich
//     (useStepLoop) or `npm run shopify:import`.
//   * Reconciliation (nightly cron): every customer and order Shopify changed
//     since the last run, so a lost webhook never leaves the mirror wrong.
//
// Both write through the same stores as the webhooks
// (customer-mirror-store, customer-orders-store). Gated by
// SHOPIFY_CUSTOMER_SYNC_ENABLED. docs/CUSTOMER_PLATFORM_PLAN.md §6.2.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { adminGraphql, isShopifyConfigured } from "./shopify";
import {
  splitJsonlBytes,
  groupBulkLines,
  nextImportKind,
  BULK_CHUNK_BYTES,
  IMPORT_KINDS,
} from "./shopify-bulk-core.mjs";
import { mapShopifyCustomer, mapShopifyOrder, mapShopifyLineItem, numericShopifyId } from "./shopify-customer-map.mjs";
import type { MirrorCustomer, MirrorOrder, MirrorLineItem } from "./shopify-customer-map.mjs";
import { upsertMirrorCustomers } from "./customer-mirror-store";
import { upsertMirrorOrders, appendOrderLineItems, linkOrphanOrders } from "./customer-orders-store";
import { isShopifyCustomerSyncEnabled } from "./platform-flags.mjs";

// ---------------------------------------------------------------------------
// GraphQL
// ---------------------------------------------------------------------------

const CUSTOMER_FIELDS = `
  id email firstName lastName locale state tags createdAt updatedAt
  defaultAddress { countryCodeV2 }
  emailMarketingConsent { marketingState marketingOptInLevel consentUpdatedAt }
`;

const ORDER_FIELDS = `
  id name processedAt createdAt updatedAt cancelledAt
  displayFinancialStatus displayFulfillmentStatus currencyCode
  subtotalPriceSet { shopMoney { amount } }
  currentTotalPriceSet { shopMoney { amount } }
  totalRefundedSet { shopMoney { amount } }
  discountCodes sourceName
  customer { id }
`;

const LINE_ITEM_FIELDS = `
  id title variantTitle quantity
  originalUnitPriceSet { shopMoney { amount } }
  variant { id }
  product { id handle }
`;

const BULK_QUERIES: Record<string, string> = {
  import_customers: `{ customers { edges { node { ${CUSTOMER_FIELDS} } } } }`,
  import_orders: `{ orders { edges { node { ${ORDER_FIELDS} lineItems { edges { node { ${LINE_ITEM_FIELDS} } } } } } } }`,
};

const BULK_RUN = /* GraphQL */ `
  mutation MoBulkRun($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }
`;

const BULK_STATUS = /* GraphQL */ `
  query MoBulkStatus($id: ID!) {
    node(id: $id) {
      ... on BulkOperation { id status errorCode objectCount url partialDataUrl }
    }
  }
`;

const RECONCILE_CUSTOMERS = /* GraphQL */ `
  query MoReconcileCustomers($query: String!, $cursor: String) {
    customers(first: 100, after: $cursor, query: $query, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes { ${CUSTOMER_FIELDS} }
    }
  }
`;

const RECONCILE_ORDERS = /* GraphQL */ `
  query MoReconcileOrders($query: String!, $cursor: String) {
    orders(first: 25, after: $cursor, query: $query, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes { ${ORDER_FIELDS} lineItems(first: 30) { nodes { ${LINE_ITEM_FIELDS} } } }
    }
  }
`;

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export interface SyncRun {
  id: number;
  kind: string;
  status: string;
  bulkOperationId: string | null;
  byteOffset: number;
  linesProcessed: number;
  customersUpserted: number;
  ordersUpserted: number;
  skipped: number;
  since: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  error: string | null;
}

function mapRun(r: Record<string, unknown>): SyncRun {
  const isoOrNull = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);
  return {
    id: Number(r.id),
    kind: String(r.kind),
    status: String(r.status),
    bulkOperationId: (r.bulk_operation_id as string | null) ?? null,
    byteOffset: Number(r.byte_offset ?? 0),
    linesProcessed: Number(r.lines_processed ?? 0),
    customersUpserted: Number(r.customers_upserted ?? 0),
    ordersUpserted: Number(r.orders_upserted ?? 0),
    skipped: Number(r.skipped ?? 0),
    since: isoOrNull(r.since),
    startedAt: isoOrNull(r.started_at) ?? new Date().toISOString(),
    updatedAt: isoOrNull(r.updated_at) ?? new Date().toISOString(),
    finishedAt: isoOrNull(r.finished_at),
    error: (r.error as string | null) ?? null,
  };
}

/** The newest runs (Einstellungen → Shopify-Abgleich). */
export async function listSyncRuns(limit = 10, sql: Sql | null = getSql()): Promise<SyncRun[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT * FROM shopify_sync_runs ORDER BY started_at DESC, id DESC LIMIT ${limit}
    `) as Array<Record<string, unknown>>;
    return rows.map(mapRun);
  } catch (err) {
    reportError(err, { route: "lib/shopify-sync", phase: "listSyncRuns" });
    return [];
  }
}

async function activeImportRun(sql: Sql): Promise<SyncRun | null> {
  const rows = (await sql`
    SELECT * FROM shopify_sync_runs
     WHERE kind = ANY(${[...IMPORT_KINDS]}::text[]) AND status IN ('running', 'processing')
     ORDER BY id DESC LIMIT 1
  `) as Array<Record<string, unknown>>;
  return rows[0] ? mapRun(rows[0]) : null;
}

async function startBulk(sql: Sql, kind: string): Promise<SyncRun> {
  const data = await adminGraphql<{
    bulkOperationRunQuery: {
      bulkOperation: { id: string; status: string } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(BULK_RUN, { query: BULK_QUERIES[kind] });
  const errors = data.bulkOperationRunQuery?.userErrors ?? [];
  const op = data.bulkOperationRunQuery?.bulkOperation;
  if (errors.length > 0 || !op) {
    const message = errors.map((e) => e.message).join("; ") || "bulk operation not created";
    const rows = (await sql`
      INSERT INTO shopify_sync_runs (kind, status, error, finished_at) VALUES (${kind}, 'failed', ${message}, now())
      RETURNING *
    `) as Array<Record<string, unknown>>;
    return mapRun(rows[0]);
  }
  const rows = (await sql`
    INSERT INTO shopify_sync_runs (kind, status, bulk_operation_id) VALUES (${kind}, 'running', ${op.id})
    RETURNING *
  `) as Array<Record<string, unknown>>;
  return mapRun(rows[0]);
}

export interface ImportStepResult {
  ok: boolean;
  reason?: "disabled" | "not_configured" | "no_db" | "error";
  message?: string;
  run: SyncRun | null;
  /** True when both stages are complete (or nothing is running). */
  done: boolean;
  /** Bulk operation still running at Shopify — poll again shortly. */
  waiting: boolean;
}

/** Start a fresh import (refuses while one is active). */
export async function startCustomerImport(sql: Sql | null = getSql()): Promise<ImportStepResult> {
  if (!sql) return { ok: false, reason: "no_db", run: null, done: false, waiting: false };
  if (!isShopifyConfigured()) return { ok: false, reason: "not_configured", run: null, done: false, waiting: false };
  if (!isShopifyCustomerSyncEnabled()) return { ok: false, reason: "disabled", run: null, done: false, waiting: false };
  try {
    const active = await activeImportRun(sql);
    if (active) return { ok: true, run: active, done: false, waiting: active.status === "running" };
    const run = await startBulk(sql, IMPORT_KINDS[0]);
    return { ok: run.status !== "failed", run, done: false, waiting: true, message: run.error ?? undefined };
  } catch (err) {
    reportError(err, { route: "lib/shopify-sync", phase: "startCustomerImport" });
    return { ok: false, reason: "error", message: err instanceof Error ? err.message : String(err), run: null, done: false, waiting: false };
  }
}

async function readRange(url: string, offset: number): Promise<{ bytes: Uint8Array; atEnd: boolean }> {
  const end = offset + BULK_CHUNK_BYTES - 1;
  const res = await fetch(url, { headers: { Range: `bytes=${offset}-${end}` } });
  if (res.status === 416) return { bytes: new Uint8Array(0), atEnd: true };
  if (!res.ok) throw new Error(`bulk result HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (res.status === 200) {
    // Range ignored: we got the whole file.
    const slice = buf.subarray(offset, Math.min(buf.length, offset + BULK_CHUNK_BYTES));
    return { bytes: slice, atEnd: offset + slice.length >= buf.length };
  }
  const total = Number((res.headers.get("content-range") ?? "").split("/")[1]);
  const atEnd = Number.isFinite(total) ? offset + buf.length >= total : buf.length < BULK_CHUNK_BYTES;
  return { bytes: buf, atEnd };
}

async function processChunk(
  sql: Sql,
  run: SyncRun,
  lines: string[]
): Promise<{ customers: number; orders: number; skipped: number }> {
  const groups = groupBulkLines(lines);
  let customers = 0;
  let orders = 0;
  let skipped = groups.invalid;
  if (run.kind === "import_customers") {
    const mapped = groups.customers.map(mapShopifyCustomer).filter((c): c is MirrorCustomer => c !== null);
    for (let i = 0; i < mapped.length; i += 500) {
      const res = await upsertMirrorCustomers(mapped.slice(i, i + 500), { origin: `import:${run.id}` }, sql);
      if (!res) throw new Error("customer upsert failed");
      customers += res.inserted + res.updated + res.stamped;
      skipped += res.skipped;
    }
  } else {
    const mapped = groups.orders.map((o) => mapShopifyOrder(o, [])).filter((o): o is MirrorOrder => o !== null);
    for (let i = 0; i < mapped.length; i += 500) {
      const res = await upsertMirrorOrders(mapped.slice(i, i + 500), { lineItems: "keep" }, sql);
      if (!res) throw new Error("order upsert failed");
      orders += res.upserted;
      skipped += res.skipped;
    }
    const items = new Map<string, MirrorLineItem[]>();
    for (const [parent, nodes] of groups.lineItemsByOrder) {
      const orderId = numericShopifyId(parent);
      if (!orderId) continue;
      items.set(orderId, nodes.map(mapShopifyLineItem).filter((li): li is MirrorLineItem => li !== null));
    }
    const entries = [...items.entries()];
    for (let i = 0; i < entries.length; i += 500) {
      await appendOrderLineItems(new Map(entries.slice(i, i + 500)), sql);
    }
  }
  return { customers, orders, skipped };
}

/**
 * One bounded step of the import: poll the bulk operation, or process the
 * next byte range of its result, or start the next stage. Never throws.
 */
export async function runCustomerImportStep(
  opts: { deadlineMs?: number } = {},
  sql: Sql | null = getSql()
): Promise<ImportStepResult> {
  if (!sql) return { ok: false, reason: "no_db", run: null, done: false, waiting: false };
  if (!isShopifyConfigured()) return { ok: false, reason: "not_configured", run: null, done: false, waiting: false };
  if (!isShopifyCustomerSyncEnabled()) return { ok: false, reason: "disabled", run: null, done: false, waiting: false };
  let run: SyncRun | null = null;
  try {
    run = await activeImportRun(sql);
    if (!run) return { ok: true, run: null, done: true, waiting: false };

    if (run.status === "running") {
      const data = await adminGraphql<{
        node: { status: string; errorCode: string | null; url: string | null; partialDataUrl: string | null } | null;
      }>(BULK_STATUS, { id: run.bulkOperationId });
      const op = data.node;
      if (!op) throw new Error("bulk operation not found");
      if (op.status === "COMPLETED") {
        if (!op.url) {
          // No objects at all — this stage is done.
          await sql`UPDATE shopify_sync_runs SET status = 'done', finished_at = now(), updated_at = now() WHERE id = ${run.id}`;
          return await advanceStage(sql, run);
        }
        const rows = (await sql`
          UPDATE shopify_sync_runs SET status = 'processing', result_url = ${op.url}, updated_at = now()
           WHERE id = ${run.id} RETURNING *
        `) as Array<Record<string, unknown>>;
        return { ok: true, run: mapRun(rows[0]), done: false, waiting: false };
      }
      if (["FAILED", "CANCELED", "EXPIRED"].includes(op.status)) {
        await sql`
          UPDATE shopify_sync_runs SET status = 'failed', error = ${op.errorCode ?? op.status},
                 finished_at = now(), updated_at = now()
           WHERE id = ${run.id}
        `;
        return { ok: false, reason: "error", message: op.errorCode ?? op.status, run, done: false, waiting: false };
      }
      return { ok: true, run, done: false, waiting: true };
    }

    // processing: read and apply byte ranges until the deadline.
    const urlRows = (await sql`SELECT result_url FROM shopify_sync_runs WHERE id = ${run.id}`) as Array<{ result_url: string | null }>;
    const url = urlRows[0]?.result_url;
    if (!url) throw new Error("result url missing");
    let offset = run.byteOffset;
    for (;;) {
      const { bytes, atEnd } = await readRange(url, offset);
      const { lines, consumedBytes } = splitJsonlBytes(bytes, atEnd);
      const counts = await processChunk(sql, run, lines);
      offset += consumedBytes;
      const rows = (await sql`
        UPDATE shopify_sync_runs
           SET byte_offset = ${offset},
               lines_processed = lines_processed + ${lines.length},
               customers_upserted = customers_upserted + ${counts.customers},
               orders_upserted = orders_upserted + ${counts.orders},
               skipped = skipped + ${counts.skipped},
               status = CASE WHEN ${atEnd} THEN 'done' ELSE status END,
               finished_at = CASE WHEN ${atEnd} THEN now() ELSE finished_at END,
               updated_at = now()
         WHERE id = ${run.id}
        RETURNING *
      `) as Array<Record<string, unknown>>;
      run = mapRun(rows[0]);
      if (atEnd) return await advanceStage(sql, run);
      if (consumedBytes === 0) throw new Error("bulk line longer than one chunk");
      if (!opts.deadlineMs || Date.now() > opts.deadlineMs) {
        return { ok: true, run, done: false, waiting: false };
      }
    }
  } catch (err) {
    reportError(err, { route: "lib/shopify-sync", phase: "runCustomerImportStep" });
    const message = err instanceof Error ? err.message.slice(0, 500) : String(err);
    if (run) {
      try {
        await sql`UPDATE shopify_sync_runs SET error = ${message}, updated_at = now() WHERE id = ${run.id}`;
      } catch {
        // reported above
      }
    }
    return { ok: false, reason: "error", message, run, done: false, waiting: false };
  }
}

async function advanceStage(sql: Sql, finished: SyncRun): Promise<ImportStepResult> {
  const next = nextImportKind(finished.kind);
  if (!next) {
    await linkOrphanOrders(sql);
    return { ok: true, run: finished, done: true, waiting: false };
  }
  const run = await startBulk(sql, next);
  return { ok: run.status !== "failed", run, done: false, waiting: true, message: run.error ?? undefined };
}

/** Cancel an active import (operator). */
export async function cancelCustomerImport(sql: Sql | null = getSql()): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = await sql`
      UPDATE shopify_sync_runs SET status = 'cancelled', finished_at = now(), updated_at = now()
       WHERE kind = ANY(${[...IMPORT_KINDS]}::text[]) AND status IN ('running', 'processing')
      RETURNING id
    `;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/shopify-sync", phase: "cancelCustomerImport" });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export interface ReconcileResult {
  ok: boolean;
  reason?: "disabled" | "not_configured" | "no_db" | "no_import" | "error";
  since: string | null;
  customers: number;
  orders: number;
  complete: boolean;
}

/**
 * Re-read every customer and order Shopify changed since the last complete
 * reconciliation (minus one hour of overlap). Incomplete runs (deadline)
 * leave the floor unchanged, so the next run repeats — upserts are idempotent.
 */
export async function reconcileShopifyCustomers(
  opts: { deadlineMs: number },
  sql: Sql | null = getSql()
): Promise<ReconcileResult> {
  const empty = { since: null, customers: 0, orders: 0, complete: false };
  if (!sql) return { ok: false, reason: "no_db", ...empty };
  if (!isShopifyConfigured()) return { ok: false, reason: "not_configured", ...empty };
  if (!isShopifyCustomerSyncEnabled()) return { ok: false, reason: "disabled", ...empty };
  try {
    const last = (await sql`
      SELECT
        (SELECT max(started_at) FROM shopify_sync_runs WHERE kind = 'reconcile' AND status = 'done') AS last_reconcile,
        (SELECT max(started_at) FROM shopify_sync_runs WHERE kind = 'import_customers' AND status = 'done') AS import_done
    `) as Array<{ last_reconcile: string | null; import_done: string | null }>;
    const floor = last[0]?.last_reconcile ?? last[0]?.import_done;
    if (!floor) return { ok: false, reason: "no_import", ...empty };
    const since = new Date(new Date(floor).getTime() - 3_600_000).toISOString();
    const runRows = (await sql`
      INSERT INTO shopify_sync_runs (kind, status, since) VALUES ('reconcile', 'running', ${since}) RETURNING id
    `) as Array<{ id: number }>;
    const runId = Number(runRows[0].id);
    const query = `updated_at:>='${since}'`;

    let customers = 0;
    let orders = 0;
    let complete = true;

    let cursor: string | null = null;
    for (;;) {
      if (Date.now() > opts.deadlineMs) {
        complete = false;
        break;
      }
      const data: { customers: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: unknown[] } } =
        await adminGraphql(RECONCILE_CUSTOMERS, { query, cursor });
      const mapped = data.customers.nodes.map(mapShopifyCustomer).filter((c): c is MirrorCustomer => c !== null);
      const res = await upsertMirrorCustomers(mapped, { origin: `reconcile:${runId}` }, sql);
      customers += res ? res.inserted + res.updated + res.stamped : 0;
      if (!data.customers.pageInfo.hasNextPage) break;
      cursor = data.customers.pageInfo.endCursor;
    }

    cursor = null;
    while (complete) {
      if (Date.now() > opts.deadlineMs) {
        complete = false;
        break;
      }
      const data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: unknown[] } } =
        await adminGraphql(RECONCILE_ORDERS, { query, cursor });
      const mapped = data.orders.nodes.map((o) => mapShopifyOrder(o)).filter((o): o is MirrorOrder => o !== null);
      const res = await upsertMirrorOrders(mapped, { lineItems: "replace" }, sql);
      orders += res?.upserted ?? 0;
      if (!data.orders.pageInfo.hasNextPage) break;
      cursor = data.orders.pageInfo.endCursor;
    }
    if (complete) await linkOrphanOrders(sql);

    await sql`
      UPDATE shopify_sync_runs
         SET status = ${complete ? "done" : "failed"},
             error = ${complete ? null : "deadline — repeats next run"},
             customers_upserted = ${customers}, orders_upserted = ${orders},
             finished_at = now(), updated_at = now()
       WHERE id = ${runId}
    `;
    return { ok: true, since, customers, orders, complete };
  } catch (err) {
    reportError(err, { route: "lib/shopify-sync", phase: "reconcileShopifyCustomers" });
    return { ok: false, reason: "error", ...empty };
  }
}

/**
 * What is wrong with the sync, in plain German (the Eingang card); empty =
 * all good. Thresholds: no webhook for two days, no reconcile for 36 hours.
 */
export function describeSyncProblems(
  health: SyncHealth | null,
  deadOutbox: number,
  opts: { syncEnabled: boolean; now?: number }
): string[] {
  const now = opts.now ?? Date.now();
  const out: string[] = [];
  if (opts.syncEnabled && health) {
    if (!health.importDone) out.push("Der erste Import des Shopify-Kundenstamms steht noch aus.");
    if (health.lastWebhookAt && now - new Date(health.lastWebhookAt).getTime() > 2 * 86_400_000) {
      out.push("Seit über zwei Tagen kam kein Shopify-Webhook an.");
    }
    if (health.importDone && (!health.lastReconcileAt || now - new Date(health.lastReconcileAt).getTime() > 1.5 * 86_400_000)) {
      out.push("Der nächtliche Abgleich ist seit über 36 Stunden nicht durchgelaufen.");
    }
  }
  if (deadOutbox > 0) {
    out.push(deadOutbox === 1 ? "1 Übertragung an Shopify wurde aufgegeben." : `${deadOutbox} Übertragungen an Shopify wurden aufgegeben.`);
  }
  return out;
}

/** Sync health for Einstellungen + the Eingang system items. */
export interface SyncHealth {
  importDone: boolean;
  lastImportAt: string | null;
  lastReconcileAt: string | null;
  lastWebhookAt: string | null;
  webhooksLast24h: number;
  mirroredCustomers: number;
  ledgerOrders: number;
}

export async function getSyncHealth(sql: Sql | null = getSql()): Promise<SyncHealth | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT
        (SELECT max(finished_at) FROM shopify_sync_runs WHERE kind = 'import_orders' AND status = 'done') AS import_at,
        (SELECT max(finished_at) FROM shopify_sync_runs WHERE kind = 'reconcile' AND status = 'done') AS reconcile_at,
        (SELECT max(received_at) FROM shopify_webhook_events) AS webhook_at,
        (SELECT count(*)::int FROM shopify_webhook_events WHERE received_at > now() - interval '24 hours') AS webhooks24,
        (SELECT count(*)::int FROM customers WHERE shopify_customer_id IS NOT NULL) AS mirrored,
        (SELECT count(*)::int FROM customer_orders) AS orders
    `) as Array<Record<string, unknown>>;
    const r = rows[0] ?? {};
    const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);
    return {
      importDone: Boolean(r.import_at),
      lastImportAt: iso(r.import_at),
      lastReconcileAt: iso(r.reconcile_at),
      lastWebhookAt: iso(r.webhook_at),
      webhooksLast24h: Number(r.webhooks24 ?? 0),
      mirroredCustomers: Number(r.mirrored ?? 0),
      ledgerOrders: Number(r.orders ?? 0),
    };
  } catch (err) {
    reportError(err, { route: "lib/shopify-sync", phase: "getSyncHealth" });
    return null;
  }
}
