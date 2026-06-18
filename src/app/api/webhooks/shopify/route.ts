// POST /api/webhooks/shopify — Shopify inventory + product webhook (Part E).
//
// Shopify POSTs a product or inventory-level change here so the catalog's stock
// status is near-real-time, not just sync-fresh. We:
//   1. VERIFY the X-Shopify-Hmac-SHA256 signature over the RAW body BEFORE
//      parsing it — an unverified request never touches the catalog (mirrors the
//      Resend/Pingen HMAC-first discipline).
//   2. ROUTE the (verified) event by X-Shopify-Topic to a TARGETED single-product
//      update (flip availability / stock for that one product), NEVER a full
//      resync. Re-embeds only if the product's embedded text changed.
//   3. Idempotent + burst-guarded (see lib/catalog-mutate): a duplicate or
//      no-change delivery writes nothing; concurrent deliveries are serialized.
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
import { refreshProductInCatalog, refreshInventoryItemInCatalog } from "@/lib/catalog-mutate";
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
    // (2) Decide what this event means for the catalog (pure routing).
    const plan = planCatalogAction(topic, payload);

    // (3) Apply the TARGETED single-product update. products/update +
    // products/delete both route through refreshProductInCatalog: an eligible
    // product is upserted; one that no longer passes the catalog filters (or is
    // gone) is removed. inventory_levels/* resolves the item → its product first.
    let result;
    if (plan.action === "refresh-inventory" && plan.inventoryItemGid) {
      result = await refreshInventoryItemInCatalog(plan.inventoryItemGid);
    } else if (
      (plan.action === "refresh-product" || plan.action === "remove-product") &&
      plan.productGid
    ) {
      result = await refreshProductInCatalog(plan.productGid);
    } else {
      // A non-catalog / shapeless event — ack so Shopify stops retrying.
      return NextResponse.json({ ok: true, ignored: plan.reason ?? plan.action });
    }

    if (!result.ok) {
      // Real failure → 500 so Shopify retries (the update is idempotent).
      return NextResponse.json({ ok: false, error: result.reason }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      topic,
      action: result.action,
      productId: result.productId,
      reembedded: result.reembedded,
    });
  } catch (err) {
    reportError(err, { route: "api/webhooks/shopify", phase: "ingest", topic: topic ?? "none" });
    return NextResponse.json({ ok: false, error: "Ingest failed" }, { status: 500 });
  }
}
