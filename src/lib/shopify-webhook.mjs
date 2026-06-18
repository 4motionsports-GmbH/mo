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
 * @param {{ rawBody: string, hmacHeader: string | null, secret: string }} args
 * @returns {unknown} the parsed JSON payload (only after the signature checks out)
 */
export function verifyShopifyWebhook({ rawBody, hmacHeader, secret }) {
  if (!secret) throw new Error("SHOPIFY_WEBHOOK_SECRET is not configured");
  if (!hmacHeader) throw new Error("Missing X-Shopify-Hmac-SHA256 header");
  if (!isValidShopifyWebhook({ rawBody, hmacHeader, secret })) {
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

export function toInventoryItemGid(id) {
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
