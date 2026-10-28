// POST /api/webhooks/shopify — Shopify inventory + product + ORDER webhook.
//
// Shopify POSTs a product or inventory-level change here so the catalog's stock
// status is near-real-time, not just sync-fresh. Since the order-attribution
// round it ALSO receives orders/create + orders/paid: verified order payloads
// go to lib/mo-orders-store.ingestShopifyOrder, which stores ONLY orders
// carrying a Mo marker (attribution token / MS5- / MK- code) as pseudonymous
// rows — the payload's customer fields are never read. A marked order no
// consultation can claim (unknown token, outside the window) is counted once,
// on orders/create after the delivery was recorded, as the session-less event
// mo_order_marker_unresolved {reason, source?} (noteUnresolvedMarker; once per
// X-Shopify-Event-Id when Shopify sends it). orders/updated + orders/cancelled
// refresh the money of an order already stored (refunds, cancellations after
// payment; never back from refunded to paid). See docs/ORDER_ATTRIBUTION.md. We:
//   1. VERIFY the X-Shopify-Hmac-SHA256 signature over the RAW body BEFORE
//      parsing it — an unverified request never touches the catalog (mirrors the
//      Resend/Pingen HMAC-first discipline).
//   2. ROUTE the (verified) event by X-Shopify-Topic to a TARGETED single-product
//      update (flip availability / stock for that one product), NEVER a full
//      resync. Re-embeds only if the product's embedded text changed.
//   3. Idempotent + burst-guarded (see lib/catalog-mutate): a duplicate or
//      no-change delivery writes nothing; concurrent deliveries are serialized.
//      Since 2026-10-28 a catalog delivery is ACKED at once and refreshed after
//      the response (next/server after()) — Shopify fails a delivery whose
//      answer takes longer than 5 s; a failed refresh is queued (step 4).
//   4. THROTTLE BACKPRESSURE (see lib/shopify-backpressure.mjs): a webhook storm
//      (bulk ERP stock sync → hundreds of deliveries in minutes) used to drain
//      Shopify's cost bucket concurrently, exhaust every invocation's retries and
//      500 — which made Shopify REDELIVER and fed the storm. Now, while the
//      shared throttle gate holds, deliveries don't call Shopify at all: the
//      target GID is queued (coalesced) in Redis and the delivery is ACKED 200.
//      Queued targets are drained a few at a time after later successful
//      mutations; the daily sync remains the reconciliation backstop.
//
// CUSTOMER PLATFORM (docs/archive/CUSTOMER_PLATFORM_PLAN.md §6.2, §8.3): customers/*,
// the e-mail-marketing consent topic, the order ledger (orders/create|updated|
// paid|cancelled) and the GDPR compliance topics are routed to
// lib/shopify-webhook-customers.ts — deduplicated by X-Shopify-Webhook-Id, so a
// Shopify retry never applies a delivery twice.
//
// Same ingest contract as the other webhooks: 503 without a secret (fail closed),
// 401 on a bad signature, 500 only on a real processing failure of a customer /
// order topic (so Shopify retries safely — those are deduplicated); catalog
// topics answer 200 before their refresh runs. The daily sync remains the
// baseline reconciliation (and the catch-all for id-only hard-deletes).
//
// Setup (Shopify side): register the webhook topics against this URL — see
// docs/CATALOG_SYNC.md "Real-time stock webhook".

import { NextResponse, after } from "next/server";
import {
  verifyShopifyWebhook,
  planCatalogAction,
  classifyShopifyTopic,
  webhookNeedsCustomerSync,
} from "@/lib/shopify-webhook.mjs";
import { isShopifyCustomerSyncEnabled } from "@/lib/platform-flags.mjs";
import {
  recordWebhookDelivery,
  finishWebhookDelivery,
  forgetWebhookDelivery,
  handleCustomerWebhook,
  handleConsentWebhook,
  handleOrderLedgerWebhook,
  handleErasureWebhook,
  handleDataRequestWebhook,
  handleShopRedactWebhook,
  type WebhookOutcome,
} from "@/lib/shopify-webhook-customers";
import {
  refreshProductInCatalog,
  refreshInventoryItemInCatalog,
  drainPendingRefreshes,
} from "@/lib/catalog-mutate";
import {
  isThrottleGateActive,
  enqueuePendingRefresh,
  type PendingKind,
} from "@/lib/shopify-throttle-gate";
import { ingestShopifyOrder, noteUnresolvedMarker } from "@/lib/mo-orders-store";
import { reportError } from "@/lib/observability";

// A single-product Shopify fetch + (optional) one embedding + two blob writes,
// plus a bounded drain — run after the response (after()), within 60 s.
export const maxDuration = 60;

// Admin-made subscriptions are signed with the store's webhook key
// (SHOPIFY_WEBHOOK_SECRET), app-made ones — Admin API, app configuration, the
// compliance topics — with the app's client secret. Either verifies.
function webhookSecrets(): string[] {
  return [process.env.SHOPIFY_WEBHOOK_SECRET?.trim(), process.env.SHOPIFY_CLIENT_SECRET?.trim()].filter(
    (s): s is string => Boolean(s)
  );
}

export async function POST(req: Request) {
  const secret = webhookSecrets();
  if (secret.length === 0) {
    // No signing secret ⇒ we cannot trust ANY payload. Fail closed.
    return NextResponse.json(
      { ok: false, error: "Shopify webhook not configured" },
      { status: 503 }
    );
  }

  // (1) RAW body first — verification must run over the exact bytes Shopify
  // signed; JSON-parsing + re-serialising would invalidate the signature.
  const rawBody = await req.text();
  const hmacHeader = req.headers.get("x-shopify-hmac-sha256");
  const topic = req.headers.get("x-shopify-topic");

  let payload: unknown;
  try {
    payload = verifyShopifyWebhook({ rawBody, hmacHeader, secret });
  } catch (err) {
    // Bad/missing signature — reject. Do NOT log the body; just the failure.
    reportError(err, { route: "api/webhooks/shopify", phase: "verify", topic: topic ?? "none" });
    return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
  }

  try {
    const t = String(topic ?? "").trim().toLowerCase();
    const routeKind = classifyShopifyTopic(t);

    // (2a) CUSTOMER PLATFORM topics (incl. the order ledger): deduplicated.
    if (routeKind !== "catalog" && routeKind !== "other") {
      const webhookId = req.headers.get("x-shopify-webhook-id");
      if (!(await recordWebhookDelivery(webhookId, t))) {
        return NextResponse.json({ ok: true, duplicate: true });
      }
      let outcome: WebhookOutcome;
      let attribution: Awaited<ReturnType<typeof ingestShopifyOrder>> | null = null;
      // Mirror writes wait for SHOPIFY_CUSTOMER_SYNC_ENABLED (the import and
      // the reconcile catch up); the attribution below does not.
      const syncOff = webhookNeedsCustomerSync(routeKind) && !isShopifyCustomerSyncEnabled();
      if (routeKind === "order") {
        if (!["orders/create", "orders/updated", "orders/paid", "orders/cancelled"].includes(t)) {
          outcome = { ok: true, action: `ignored:${t}` };
        } else {
          outcome = syncOff ? { ok: true, action: "ledger:sync-off" } : await handleOrderLedgerWebhook(payload);
          // orders/create + orders/paid also feed the pseudonymous attribution
          // pipeline exactly as before (Mo-marked orders only); orders/updated
          // + orders/cancelled refresh an order already in it (refunds,
          // cancellations after payment) and never attribute a new one.
          if (t === "orders/create" || t === "orders/paid") {
            attribution = await ingestShopifyOrder(payload);
            if (!attribution.ok) outcome = { ok: false, action: `attribution:${attribution.reason}` };
          } else {
            attribution = await ingestShopifyOrder(payload, { updateOnly: true });
            if (!attribution.ok) outcome = { ok: false, action: `attribution:${attribution.reason}` };
          }
        }
      } else if (syncOff) {
        outcome = { ok: true, action: "ignored:sync-off" };
      } else if (routeKind === "customer") {
        outcome = await handleCustomerWebhook(payload, webhookId);
      } else if (routeKind === "consent") {
        outcome = await handleConsentWebhook(payload, webhookId);
      } else if (routeKind === "customer_delete" || t === "customers/redact") {
        outcome = await handleErasureWebhook(t, payload, webhookId);
      } else if (t === "customers/data_request") {
        outcome = await handleDataRequestWebhook(payload);
      } else if (t === "shop/redact") {
        outcome = await handleShopRedactWebhook(payload);
      } else {
        // bulk_operations/finish: the import's next step polls the operation itself.
        outcome = { ok: true, action: "noted" };
      }
      if (!outcome.ok) {
        // Let Shopify retry: forget the delivery so the retry is applied.
        await forgetWebhookDelivery(webhookId);
        return NextResponse.json({ ok: false, error: outcome.action }, { status: 500 });
      }
      await finishWebhookDelivery(webhookId, outcome.action);
      if (attribution) await noteUnresolvedMarker(t, attribution, req.headers.get("x-shopify-event-id"));
      return NextResponse.json({
        ok: true,
        topic,
        action: outcome.action,
        ...(attribution?.tier ? { tier: attribution.tier } : {}),
      });
    }

    // (2b) Decide what this event means for the catalog (pure routing).
    const plan = planCatalogAction(topic, payload);

    let kind: PendingKind | null = null;
    let gid: string | null = null;
    if (plan.action === "refresh-inventory" && plan.inventoryItemGid) {
      kind = "inventory_item";
      gid = plan.inventoryItemGid;
    } else if (
      (plan.action === "refresh-product" || plan.action === "remove-product") &&
      plan.productGid
    ) {
      kind = "product";
      gid = plan.productGid;
    } else {
      // A non-catalog / shapeless event — ack so Shopify stops retrying.
      return NextResponse.json({ ok: true, ignored: plan.reason ?? plan.action });
    }

    // (3) ACK AT ONCE, refresh after the response (2026-10-28). Shopify counts
    // a delivery as failed when the answer takes longer than 5 s — and a
    // refresh reads and writes the catalog + embeddings blobs (~35 MB) behind
    // a lock, then drains queued targets: a product edit or a stock burst
    // failed in Shopify's log and was redelivered into the same load. The
    // refresh re-fetches CURRENT truth from Shopify (never applies this
    // payload), so running it after the answer is lossless; one that fails is
    // queued for a later drain (Shopify no longer redelivers an acked
    // delivery), the daily sync remains the backstop. after() keeps the
    // function alive for it (Vercel waitUntil, within maxDuration).
    after(() => applyCatalogRefresh(kind, gid, topic));
    return NextResponse.json({ ok: true, topic, accepted: true });
  } catch (err) {
    reportError(err, { route: "api/webhooks/shopify", phase: "ingest", topic: topic ?? "none" });
    return NextResponse.json({ ok: false, error: "Ingest failed" }, { status: 500 });
  }
}

/**
 * The catalog refresh of one delivery, run after the response:
 *   1. BACKPRESSURE — while the shared throttle gate holds, don't touch Shopify:
 *      queue the target (a coalescing set) for a later drain.
 *   2. The TARGETED single-product update. products/update + products/delete
 *      both route through refreshProductInCatalog: an eligible product is
 *      upserted; one that no longer passes the catalog filters (or is gone) is
 *      removed. inventory_levels/* resolves the item → its product first.
 *   3. Throttled or a real failure (already warned / reported by the mutation):
 *      queue the target so a later delivery's drain retries it.
 *   4. Success ⇒ the bucket has budget again: work off a few queued targets
 *      (bounded by items + time).
 * Never throws — an error is reported, the daily sync reconciles.
 */
async function applyCatalogRefresh(kind: PendingKind, gid: string, topic: string | null): Promise<void> {
  try {
    if ((await isThrottleGateActive()) && (await enqueuePendingRefresh(kind, gid))) return;
    const result =
      kind === "inventory_item"
        ? await refreshInventoryItemInCatalog(gid)
        : await refreshProductInCatalog(gid);
    if (!result.ok) {
      if (!(await enqueuePendingRefresh(kind, gid))) {
        console.warn(`[webhooks/shopify] refresh of ${gid} failed and could not be queued — the daily sync reconciles it`);
      }
      return;
    }
    await drainPendingRefreshes();
  } catch (err) {
    reportError(err, { route: "api/webhooks/shopify", phase: "refresh-after-ack", topic: topic ?? "none" });
  }
}
