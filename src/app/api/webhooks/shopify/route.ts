// POST /api/webhooks/shopify — Shopify inventory + product + ORDER webhook.
//
// Shopify POSTs a product or inventory-level change here so the catalog's stock
// status is near-real-time, not just sync-fresh. Since the order-attribution
// round it ALSO receives orders/create + orders/paid: verified order payloads
// go to lib/mo-orders-store.ingestShopifyOrder, which stores ONLY orders
// carrying a Mo marker (attribution token / MS5- / MK- code) as pseudonymous
// rows — the payload's customer fields are never read. See
// docs/ORDER_ATTRIBUTION.md. We:
//   1. VERIFY the X-Shopify-Hmac-SHA256 signature over the RAW body BEFORE
//      parsing it — an unverified request never touches the catalog (mirrors the
//      Resend/Pingen HMAC-first discipline).
//   2. ROUTE the (verified) event by X-Shopify-Topic to a TARGETED single-product
//      update (flip availability / stock for that one product), NEVER a full
//      resync. Re-embeds only if the product's embedded text changed.
//   3. Idempotent + burst-guarded (see lib/catalog-mutate): a duplicate or
//      no-change delivery writes nothing; concurrent deliveries are serialized.
//   4. THROTTLE BACKPRESSURE (see lib/shopify-backpressure.mjs): a webhook storm
//      (bulk ERP stock sync → hundreds of deliveries in minutes) used to drain
//      Shopify's cost bucket concurrently, exhaust every invocation's retries and
//      500 — which made Shopify REDELIVER and fed the storm. Now, while the
//      shared throttle gate holds, deliveries don't call Shopify at all: the
//      target GID is queued (coalesced) in Redis and the delivery is ACKED 200.
//      Queued targets are drained a few at a time after later successful
//      mutations; the daily sync remains the reconciliation backstop.
//
// Same ingest contract as the other webhooks: 503 without a secret (fail closed),
// 401 on a bad signature, 500 only on a real processing failure (so Shopify
// retries safely — the update is idempotent). The daily sync remains the baseline
// reconciliation (and the catch-all for id-only hard-deletes).
//
// Setup (Shopify side): register the webhook topics against this URL — see
// docs/CATALOG_SYNC.md "Real-time stock webhook".

import { NextResponse } from "next/server";
import { verifyShopifyWebhook, planCatalogAction } from "@/lib/shopify-webhook.mjs";
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
import { ingestShopifyOrder } from "@/lib/mo-orders-store";
import { reportError } from "@/lib/observability";

// A single-product Shopify fetch + (optional) one embedding + two blob writes —
// comfortably within 60s, well above the other webhooks' 30s.
export const maxDuration = 60;

function webhookSecret(): string | undefined {
  return process.env.SHOPIFY_WEBHOOK_SECRET?.trim() || undefined;
}

export async function POST(req: Request) {
  const secret = webhookSecret();
  if (!secret) {
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
    // (2a) ORDER topics → the attribution ingest (not a catalog action).
    //      orders/create captures the order early (possibly still pending);
    //      orders/paid updates the same row's financial status/total. Every
    //      other orders/* topic is acked-ignored. The ingest is idempotent, so
    //      a 500 (→ Shopify retry) is safe on a real processing failure.
    const t = String(topic ?? "").trim().toLowerCase();
    if (t.startsWith("orders/")) {
      if (t !== "orders/create" && t !== "orders/paid") {
        return NextResponse.json({ ok: true, ignored: `unhandled-topic:${t}` });
      }
      const ingest = await ingestShopifyOrder(payload);
      if (!ingest.ok) {
        return NextResponse.json({ ok: false, error: ingest.reason }, { status: 500 });
      }
      return NextResponse.json({
        ok: true,
        topic,
        action: ingest.action,
        ...(ingest.reason ? { reason: ingest.reason } : {}),
        ...(ingest.tier ? { tier: ingest.tier } : {}),
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

    // (3) BACKPRESSURE: while the shared throttle gate holds, don't touch
    // Shopify — queue the target and ack. A refresh always re-fetches CURRENT
    // truth from Shopify (never applies this payload), so deferring is lossless.
    // When queueing isn't possible (no Redis) we fall through and try inline.
    if (await isThrottleGateActive()) {
      if (await enqueuePendingRefresh(kind, gid)) {
        return NextResponse.json({ ok: true, topic, deferred: true });
      }
    }

    // (4) Apply the TARGETED single-product update. products/update +
    // products/delete both route through refreshProductInCatalog: an eligible
    // product is upserted; one that no longer passes the catalog filters (or is
    // gone) is removed. inventory_levels/* resolves the item → its product first.
    const result =
      kind === "inventory_item"
        ? await refreshInventoryItemInCatalog(gid)
        : await refreshProductInCatalog(gid);

    if (!result.ok) {
      if (result.throttled) {
        // Persistent throttle: a 500 would only make Shopify REDELIVER into the
        // same saturated bucket. Queue + ack instead; drained once it clears.
        if (await enqueuePendingRefresh(kind, gid)) {
          return NextResponse.json({ ok: true, topic, deferred: true });
        }
        // No queue available — Shopify's spaced redelivery IS the retry then.
        return NextResponse.json(
          { ok: false, error: result.reason },
          { status: 503, headers: { "Retry-After": "30" } }
        );
      }
      // Real failure → 500 so Shopify retries (the update is idempotent).
      return NextResponse.json({ ok: false, error: result.reason }, { status: 500 });
    }

    // (5) Success ⇒ the bucket has budget again: work off a few queued targets.
    // Bounded (items + time) and never fatal to the delivery we just processed.
    let drain: { drained: number; requeued: number } | null = null;
    try {
      drain = await drainPendingRefreshes();
    } catch {
      drain = null;
    }

    return NextResponse.json({
      ok: true,
      topic,
      action: result.action,
      productId: result.productId,
      reembedded: result.reembedded,
      ...(drain && drain.drained + drain.requeued > 0 ? { drain } : {}),
    });
  } catch (err) {
    reportError(err, { route: "api/webhooks/shopify", phase: "ingest", topic: topic ?? "none" });
    return NextResponse.json({ ok: false, error: "Ingest failed" }, { status: 500 });
  }
}
