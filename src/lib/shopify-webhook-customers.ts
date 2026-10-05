// Customer-platform webhooks (I/O): customers/*, the consent topic, orders/*
// (ledger) and the GDPR compliance topics. Called by /api/webhooks/shopify
// after the HMAC check; the route deduplicates by X-Shopify-Webhook-Id first.
//
//   customers/create|update                 → mirror upsert (+ consent resolver)
//   customers_email_marketing_consent/update → consent resolver
//   orders/create|updated|paid|cancelled    → order ledger (mo_orders attribution
//                                             stays in lib/mo-orders-store.ts)
//   customers/delete, customers/redact      → the one erasure (trigger "shopify")
//   customers/data_request                  → Eingang item with the export
//   shop/redact                             → alert only, never a mass deletion
//
// docs/archive/CUSTOMER_PLATFORM_PLAN.md §6.2, §8.3.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import {
  mapShopifyCustomer,
  mapConsentWebhook,
  mapShopifyOrder,
  numericShopifyId,
  normalizeMirrorEmail,
} from "./shopify-customer-map.mjs";
import { upsertMirrorCustomers, customerIdForShopifyId } from "./customer-mirror-store";
import { upsertMirrorOrders } from "./customer-orders-store";
import { applyConsentAct } from "./consent-store";
import { erasePerson } from "./customer-erasure";
import { createInboxItem } from "./inbox-store";
import { erasureAlertPerHour, shopifyConsentTextVersion } from "./platform-flags.mjs";

/**
 * Record a delivery; false when this webhook id was already received
 * (Shopify retries) — the caller acks without applying it again.
 */
export async function recordWebhookDelivery(
  webhookId: string | null,
  topic: string,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql || !webhookId) return true;
  try {
    const rows = await sql`
      INSERT INTO shopify_webhook_events (webhook_id, topic) VALUES (${webhookId}, ${topic})
      ON CONFLICT (webhook_id) DO NOTHING
      RETURNING webhook_id
    `;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/shopify-webhook-customers", phase: "recordWebhookDelivery" });
    return true; // never drop a delivery because the dedupe table failed
  }
}

export async function finishWebhookDelivery(
  webhookId: string | null,
  outcome: string,
  error: string | null = null,
  sql: Sql | null = getSql()
): Promise<void> {
  if (!sql || !webhookId) return;
  try {
    await sql`
      UPDATE shopify_webhook_events
         SET processed_at = now(), outcome = ${outcome.slice(0, 120)}, error = ${error ? error.slice(0, 500) : null}
       WHERE webhook_id = ${webhookId}
    `;
  } catch (err) {
    reportError(err, { route: "lib/shopify-webhook-customers", phase: "finishWebhookDelivery" });
  }
}

/** If a delivery fails, let Shopify retry it: forget the dedupe row. */
export async function forgetWebhookDelivery(webhookId: string | null, sql: Sql | null = getSql()): Promise<void> {
  if (!sql || !webhookId) return;
  try {
    await sql`DELETE FROM shopify_webhook_events WHERE webhook_id = ${webhookId}`;
  } catch {
    // reported by the caller
  }
}

export interface WebhookOutcome {
  ok: boolean;
  action: string;
}

export async function handleCustomerWebhook(payload: unknown, webhookId: string | null): Promise<WebhookOutcome> {
  const customer = mapShopifyCustomer(payload);
  if (!customer) return { ok: true, action: "ignored:no-id" };
  const res = await upsertMirrorCustomers([customer], { origin: `webhook:${webhookId ?? "?"}` });
  if (!res) return { ok: false, action: "failed" };
  return { ok: true, action: res.skipped > 0 ? "skipped" : res.inserted > 0 ? "inserted" : "updated" };
}

export async function handleConsentWebhook(payload: unknown, webhookId: string | null): Promise<WebhookOutcome> {
  const parsed = mapConsentWebhook(payload);
  if (!parsed) return { ok: true, action: "ignored:shapeless" };
  if (parsed.consent.state === "redacted") return { ok: true, action: "ignored:redacted" };
  const customerId = await customerIdForShopifyId(parsed.shopifyId);
  // Not mirrored yet: the reconciliation imports the person with this state.
  if (!customerId) return { ok: true, action: "ignored:unknown-customer" };
  const res = await applyConsentAct({
    customerId,
    incoming: { state: parsed.consent.state, level: parsed.consent.level, at: parsed.consent.at, source: "shopify" },
    originRef: `webhook:${webhookId ?? "?"}`,
    textVersion: shopifyConsentTextVersion(),
  });
  if (!res) return { ok: false, action: "failed" };
  return { ok: true, action: `consent:${res.outcome}` };
}

export async function handleOrderLedgerWebhook(payload: unknown): Promise<WebhookOutcome> {
  const order = mapShopifyOrder(payload);
  if (!order) return { ok: true, action: "ignored:no-id" };
  const res = await upsertMirrorOrders([order], { lineItems: "replace" });
  if (!res) return { ok: false, action: "failed" };
  return { ok: true, action: res.upserted > 0 ? "ledger:stored" : "ledger:skipped" };
}

/** Raise an alert when unusually many erasures arrive from Shopify in one hour. */
async function checkErasureRate(sql: Sql): Promise<void> {
  const threshold = erasureAlertPerHour();
  if (threshold <= 0) return;
  const rows = (await sql`
    SELECT count(*)::int AS n FROM shopify_webhook_events
     WHERE topic IN ('customers/redact', 'customers/delete') AND received_at > now() - interval '1 hour'
  `) as Array<{ n: number }>;
  const n = Number(rows[0]?.n ?? 0);
  if (n > threshold) {
    reportError(new Error(`${n} Shopify erasures in the last hour (alert threshold ${threshold})`), {
      route: "lib/shopify-webhook-customers",
      phase: "erasure-rate",
    });
    const hour = new Date().toISOString().slice(0, 13);
    await createInboxItem({
      kind: "abgleich_konflikt",
      customerId: null,
      priority: 90,
      title: "Ungewöhnlich viele Löschungen aus Shopify",
      reason: `${n} Löschungen in der letzten Stunde (Schwelle ${threshold}). Bitte prüfen, ob das gewollt war — die Löschungen wurden ausgeführt.`,
      evidence: { count: n, threshold },
      dedupeKey: `erasure-rate:${hour}`,
    });
  }
}

export async function handleErasureWebhook(topic: string, payload: unknown, webhookId: string | null): Promise<WebhookOutcome> {
  const sql = getSql();
  const body = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const customer = (topic === "customers/delete" ? body : (body.customer as Record<string, unknown> | undefined)) ?? {};
  const shopifyId = numericShopifyId(customer.admin_graphql_api_id ?? customer.id);
  const email = normalizeMirrorEmail(customer.email);
  if (!shopifyId && !email) return { ok: true, action: "ignored:no-identity" };
  const res = await erasePerson({ shopifyCustomerId: shopifyId, email, trigger: "shopify" });
  if (!res) return { ok: false, action: "failed" };
  if (sql) {
    try {
      await checkErasureRate(sql);
    } catch (err) {
      reportError(err, { route: "lib/shopify-webhook-customers", phase: "checkErasureRate", webhookId });
    }
  }
  return { ok: true, action: res.customerDeleted ? "erased" : "erased:nothing-stored" };
}

export async function handleDataRequestWebhook(payload: unknown): Promise<WebhookOutcome> {
  const body = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const customer = (body.customer as Record<string, unknown> | undefined) ?? {};
  const shopifyId = numericShopifyId(customer.id);
  const request = (body.data_request as Record<string, unknown> | undefined) ?? {};
  const customerId = shopifyId ? await customerIdForShopifyId(shopifyId) : null;
  const deadline = new Date(Date.now() + 30 * 86_400_000).toISOString();
  await createInboxItem({
    kind: "datenauskunft",
    customerId,
    priority: 95,
    title: "Datenauskunft angefordert (Shopify)",
    reason: customerId
      ? "Shopify hat eine Datenauskunft für diese Person weitergeleitet. Export herunterladen und fristgerecht beantworten."
      : "Shopify hat eine Datenauskunft weitergeleitet; Mo hält zu dieser Person keine Daten.",
    evidence: {
      dataRequestId: request.id ?? null,
      shopifyCustomerId: shopifyId,
      ordersRequested: Array.isArray(body.orders_requested) ? body.orders_requested.length : 0,
      deadline,
    },
    dedupeKey: `data-request:${request.id ?? shopifyId ?? Date.now()}`,
    expiresAt: deadline,
  });
  return { ok: true, action: customerId ? "inbox:created" : "inbox:created-no-data" };
}

export async function handleShopRedactWebhook(payload: unknown): Promise<WebhookOutcome> {
  const body = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  reportError(new Error("shop/redact received — app uninstalled? No automatic mass deletion was performed."), {
    route: "lib/shopify-webhook-customers",
    phase: "shop-redact",
  });
  await createInboxItem({
    kind: "abgleich_konflikt",
    customerId: null,
    priority: 100,
    title: "Shopify meldet shop/redact",
    reason:
      "Shopify fordert das Löschen aller Shop-Daten an (meist nach der Deinstallation der App). Mo löscht dabei nichts automatisch — bitte das dokumentierte Vorgehen in docs/CUSTOMERS.md befolgen.",
    evidence: { shopDomain: body.shop_domain ?? null },
    dedupeKey: `shop-redact:${body.shop_id ?? "shop"}`,
  });
  return { ok: true, action: "alerted" };
}
