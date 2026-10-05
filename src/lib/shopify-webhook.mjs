// Shopify webhook signature verification — the security gate in front of
// /api/webhooks/shopify. Same HMAC-FIRST discipline as the Resend
// (email-webhook.mjs) and Pingen (pingen-webhook.mjs) webhooks: verify over the
// RAW request body BEFORE parsing it, because JSON-parsing and re-serialising
// changes the bytes and invalidates the signature.
//
// Shopify signs each HTTPS webhook with the header `X-Shopify-Hmac-SHA256`,
// whose value is base64( HMAC-SHA256( rawBody, secret ) ), keyed by the app's
// webhook signing secret (SHOPIFY_WEBHOOK_SECRET). Comparison is constant-time.
// Verified against the Shopify Admin API webhook docs (pinned 2026-04).
//   https://shopify.dev/docs/apps/build/webhooks/subscribe/https
//
// Pure + dependency-free (node:crypto) so it's unit-testable without a network.

import { createHmac, timingSafeEqual } from "node:crypto";

/** Constant-time compare of two base64 signature strings. */
function constantTimeEquals(a, b) {
  const ba = Buffer.from(String(a), "utf8");
  const bb = Buffer.from(String(b), "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * True iff `hmacHeader` is a valid Shopify signature for `rawBody` under
 * `secret`. Never throws — a missing header/secret simply returns false (the
 * route fails the request).
 *
 * @param {{ rawBody: string, hmacHeader: string | null, secret: string }} args
 * @returns {boolean}
 */
export function isValidShopifyWebhook({ rawBody, hmacHeader, secret }) {
  if (!secret || !hmacHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  return constantTimeEquals(hmacHeader, expected);
}

/**
 * Verify a Shopify webhook and return the parsed event. THROWS when the secret or
 * header is missing, or the signature doesn't match — the route turns that into a
 * 401 and never touches the body. Never returns an unverified payload.
 *
 * `secret` may be a list: subscriptions made in the Shopify admin are signed
 * with the store's webhook key, those made through the app (Admin API, app
 * configuration — incl. the compliance topics) with the app's client secret.
 * A signature valid under ANY configured secret is accepted.
 *
 * @param {{ rawBody: string, hmacHeader: string | null, secret: string | Array<string | null | undefined> }} args
 * @returns {unknown} the parsed JSON payload (only after the signature checks out)
 */
export function verifyShopifyWebhook({ rawBody, hmacHeader, secret }) {
  const secrets = (Array.isArray(secret) ? secret : [secret]).filter((s) => typeof s === "string" && s.length > 0);
  if (secrets.length === 0) throw new Error("SHOPIFY_WEBHOOK_SECRET is not configured");
  if (!hmacHeader) throw new Error("Missing X-Shopify-Hmac-SHA256 header");
  if (!secrets.some((s) => isValidShopifyWebhook({ rawBody, hmacHeader, secret: s }))) {
    throw new Error("Invalid Shopify webhook signature");
  }
  return JSON.parse(rawBody);
}

/** A Shopify numeric id (e.g. 12345) → its GID, or null. */
export function toProductGid(id) {
  if (id == null) return null;
  const s = String(id).trim();
  if (!s) return null;
  if (s.startsWith("gid://")) return s;
  if (/^\d+$/.test(s)) return `gid://shopify/Product/${s}`;
  return null;
}

function toInventoryItemGid(id) {
  if (id == null) return null;
  const s = String(id).trim();
  if (!s) return null;
  if (s.startsWith("gid://")) return s;
  if (/^\d+$/.test(s)) return `gid://shopify/InventoryItem/${s}`;
  return null;
}

/**
 * Decide what a (verified) webhook means for the catalog, from its topic +
 * payload. Pure routing — the I/O wrapper (catalog-mutate.ts) executes the
 * resulting action. Returns:
 *   - { action: "refresh-product", productGid }      (products/create|update)
 *   - { action: "remove-product",  productGid }      (products/delete)
 *   - { action: "refresh-inventory", inventoryItemGid } (inventory_levels/*)
 *   - { action: "ignore", reason }                   (anything else / shapeless)
 *
 * @param {string | null} topic   the X-Shopify-Topic header (e.g. "products/update")
 * @param {any} payload           the parsed webhook body
 */
export function planCatalogAction(topic, payload) {
  const t = String(topic ?? "").trim().toLowerCase();
  const body = payload && typeof payload === "object" ? payload : {};

  if (t === "products/update" || t === "products/create") {
    const gid = toProductGid(body.admin_graphql_api_id ?? body.id);
    return gid ? { action: "refresh-product", productGid: gid } : { action: "ignore", reason: "no-product-id" };
  }
  if (t === "products/delete") {
    const gid = toProductGid(body.admin_graphql_api_id ?? body.id);
    return gid ? { action: "remove-product", productGid: gid } : { action: "ignore", reason: "no-product-id" };
  }
  if (
    t === "inventory_levels/update" ||
    t === "inventory_levels/connect" ||
    t === "inventory_levels/disconnect"
  ) {
    const gid = toInventoryItemGid(body.inventory_item_id ?? body.admin_graphql_api_id);
    return gid
      ? { action: "refresh-inventory", inventoryItemGid: gid }
      : { action: "ignore", reason: "no-inventory-item-id" };
  }
  return { action: "ignore", reason: `unhandled-topic:${t || "none"}` };
}

/**
 * Does this customer-platform webhook write to the mirror (customers, their
 * consent, the order ledger)? Those writes wait for
 * SHOPIFY_CUSTOMER_SYNC_ENABLED — the orders/* topics were registered for the
 * attribution long before the mirror, so registration alone is no gate. The
 * import and the nightly reconcile catch up once the switch is on. Deletions,
 * data requests and the shop/redact alert are always handled.
 *
 * @param {string} routeKind classifyShopifyTopic's answer
 * @returns {boolean}
 */
export function webhookNeedsCustomerSync(routeKind) {
  return routeKind === "customer" || routeKind === "consent" || routeKind === "order";
}

/**
 * Which handler a (verified) delivery belongs to. The catalog topics keep the
 * existing path; the customer-platform topics (docs/archive/CUSTOMER_PLATFORM_PLAN.md
 * §6.2, §8) are deduplicated by X-Shopify-Webhook-Id and routed to
 * lib/shopify-webhook-customers.ts.
 *
 * @param {string | null} topic
 * @returns {"catalog" | "order" | "customer" | "consent" | "customer_delete" | "compliance" | "bulk" | "other"}
 */
export function classifyShopifyTopic(topic) {
  const t = String(topic ?? "").trim().toLowerCase();
  if (t.startsWith("products/") || t.startsWith("inventory_levels/")) return "catalog";
  if (t.startsWith("orders/")) return "order";
  if (t === "customers/create" || t === "customers/update") return "customer";
  if (t === "customers_email_marketing_consent/update") return "consent";
  if (t === "customers/delete") return "customer_delete";
  if (t === "customers/redact" || t === "customers/data_request" || t === "shop/redact") return "compliance";
  if (t === "bulk_operations/finish") return "bulk";
  return "other";
}
