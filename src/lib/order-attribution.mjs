// Pure helpers for the Mo order-attribution pipeline — the marker that ties a
// real Shopify order back to a Mo consultation, and the honest classification
// of what that marker proves. Plain .mjs (no I/O, no env) so node:test imports
// it directly; the I/O orchestration lives in lib/mo-orders-store.ts.
//
// The pipeline (docs/ORDER_ATTRIBUTION.md):
//   1. Mo-built cart permalinks carry `attributes[_mo]=<token>` (cart
//      permalinks officially accept note/attribute query params; the attribute
//      survives checkout and lands on the order as a note_attributes entry).
//      The widget can stamp the LIVE storefront cart with the same attribute
//      via POST /cart/update.js, which covers purchases assembled manually
//      (search bar, collection pages) after a consultation.
//   2. The orders/paid + orders/create webhooks deliver every order; we ingest
//      ONLY orders carrying a Mo marker (token and/or MS5-/MK- discount code)
//      and store pseudonymous order facts (never customer fields).
//   3. Each ingested order is classified into an honest attribution tier.
//
// Attribution tiers (snapshot at ingest; surfaced verbatim in the KPI tab):
//   direct     — the order redeemed a unique Mo discount code, OR it came in
//                through a cart link Mo itself built (summary email, marketing
//                email, bundle offer). The purchase path IS Mo's artifact.
//   assisted   — the widget stamped the live cart (source 'widget') and at
//                least one purchased line matches a product that was discussed
//                or selected in that session's consultation.
//   influenced — the cart carried a session stamp but no purchased line
//                matches the consultation's products (Mo consulted; the user
//                bought something else).

import { normalizeHandle } from "./kpi-match.mjs";

// ---------------------------------------------------------------------------
// Cart-link marker
// ---------------------------------------------------------------------------

/** The cart-attribute key carrying the attribution token. Leading underscore:
 * the storefront-theme convention for "internal, don't render prominently". */
export const MO_CART_ATTRIBUTE = "_mo";

/** `ref` shows up as the referral code in the Shopify order's conversion
 * summary — a human-visible secondary signal, independent of our DB. */
export const MO_CART_REF = "mo";

/**
 * Append the Mo attribution marker to a Shopify cart URL (permalink or /cart
 * page): `attributes[_mo]=<token>` + `ref=mo`. Returns the URL unchanged when
 * the token is missing, and null for a null/empty URL, so callers can pass
 * whatever the cart builder produced without re-checking.
 *
 * @param {string | null | undefined} url
 * @param {string | null | undefined} token
 * @returns {string | null}
 */
export function withCartAttribution(url, token) {
  if (url == null || String(url).trim() === "") return null;
  const u = String(url);
  const t = token == null ? "" : String(token).trim();
  if (!t) return u;
  const sep = u.includes("?") ? "&" : "?";
  return `${u}${sep}attributes[${MO_CART_ATTRIBUTE}]=${encodeURIComponent(t)}&ref=${MO_CART_REF}`;
}

// ---------------------------------------------------------------------------
// Mo discount codes
// ---------------------------------------------------------------------------

/** True for a unique single-use code minted by Mo's outbound flows: MS5-…
 * (personalised marketing email) or MK-… (campaign email). Same prefixes the
 * revenue KPI trusts (lib/kpi-revenue-store). */
export function isMoDiscountCode(code) {
  if (code == null) return false;
  return /^(ms5|mk)-/i.test(String(code).trim());
}

// ---------------------------------------------------------------------------
// Webhook payload → pseudonymous order record
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ParsedOrder
 * @property {string} shopifyOrderId    Numeric order id as a string.
 * @property {string | null} orderName  Human order name ("#1234").
 * @property {string | null} processedAt ISO timestamp (processed_at ?? created_at).
 * @property {string | null} financialStatus e.g. "paid", "pending".
 * @property {string | null} currency
 * @property {number | null} totalPrice Actually-charged total (current_total_price ?? total_price).
 * @property {string[]} discountCodes   Codes on the order (may be empty).
 * @property {Array<{title: string, quantity: number, price: number | null, variantId: string | null, productId: string | null}>} lineItems
 * @property {string | null} moToken    The attributes[_mo] value, if present.
 */

function asNumericIdString(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (/^\d+$/.test(s)) return s;
  const m = s.match(/\/(?:Order|Product|ProductVariant)\/(\d+)/);
  return m ? m[1] : null;
}

function asFiniteNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse an orders/create | orders/paid webhook payload into the PSEUDONYMOUS
 * subset this pipeline is allowed to keep. Deliberately never reads `email`,
 * `customer`, `billing_address`, `shipping_address` or any other protected
 * customer field — they are discarded with the rest of the payload.
 *
 * Returns null when the payload has no usable order id.
 *
 * @param {any} payload
 * @returns {ParsedOrder | null}
 */
export function parseOrderWebhook(payload) {
  const body = payload && typeof payload === "object" ? payload : {};
  const shopifyOrderId =
    asNumericIdString(body.id) ?? asNumericIdString(body.admin_graphql_api_id);
  if (!shopifyOrderId) return null;

  const discountCodes = Array.isArray(body.discount_codes)
    ? body.discount_codes
        .map((d) => (d && typeof d === "object" ? String(d.code ?? "").trim() : ""))
        .filter(Boolean)
    : [];

  // Cart attributes arrive as note_attributes: [{name, value}].
  let moToken = null;
  if (Array.isArray(body.note_attributes)) {
    for (const attr of body.note_attributes) {
      if (!attr || typeof attr !== "object") continue;
      if (String(attr.name ?? "").trim() === MO_CART_ATTRIBUTE) {
        const v = String(attr.value ?? "").trim();
        if (v) moToken = v;
      }
    }
  }

  const lineItems = Array.isArray(body.line_items)
    ? body.line_items
        .filter((li) => li && typeof li === "object")
        .map((li) => ({
          title: String(li.title ?? "").trim(),
          quantity: Math.max(1, Math.floor(asFiniteNumber(li.quantity) ?? 1)),
          price: asFiniteNumber(li.price),
          variantId: asNumericIdString(li.variant_id),
          productId: asNumericIdString(li.product_id),
        }))
    : [];

  return {
    shopifyOrderId,
    orderName: body.name != null ? String(body.name) : null,
    processedAt:
      (typeof body.processed_at === "string" && body.processed_at) ||
      (typeof body.created_at === "string" && body.created_at) ||
      null,
    financialStatus:
      body.financial_status != null ? String(body.financial_status) : null,
    currency: body.currency != null ? String(body.currency) : null,
    totalPrice:
      asFiniteNumber(body.current_total_price) ?? asFiniteNumber(body.total_price),
    discountCodes,
    lineItems,
    moToken,
  };
}

/** An order is worth ingesting ONLY when it carries a Mo marker (data
 * minimisation — unmarked orders are never stored). */
export function hasMoMarker(parsed) {
  if (!parsed) return false;
  return Boolean(parsed.moToken) || parsed.discountCodes.some(isMoDiscountCode);
}

// ---------------------------------------------------------------------------
// Line-item → catalog matching
// ---------------------------------------------------------------------------

/**
 * Match parsed line items to catalog products (catalog id === storefront
 * handle). Two rules, in order:
 *   1. exact numeric variant id against the catalog's default-variant
 *      shopifyVariantId;
 *   2. normalised title against the normalised catalog id — Shopify derives
 *      the handle from the title, and normalizeHandle (kpi-match.mjs) strips
 *      exactly the characters Shopify strips (®, casing, separators), so this
 *      holds for non-default variants too.
 * Unmatched lines keep handle: null (never guessed).
 *
 * @param {ParsedOrder["lineItems"]} lineItems
 * @param {ReadonlyArray<{ id: string, shopifyVariantId?: string }>} catalog
 * @returns {{ items: Array<ParsedOrder["lineItems"][number] & { handle: string | null }>, matchedHandles: string[] }}
 */
export function matchOrderLineItems(lineItems, catalog) {
  const byVariant = new Map();
  const byNormalizedId = new Map();
  for (const p of catalog ?? []) {
    if (!p || typeof p.id !== "string") continue;
    if (p.shopifyVariantId) byVariant.set(String(p.shopifyVariantId), p.id);
    const key = normalizeHandle(p.id);
    if (key) byNormalizedId.set(key, p.id);
  }

  const items = [];
  const matched = new Set();
  for (const li of lineItems ?? []) {
    let handle = null;
    if (li.variantId && byVariant.has(li.variantId)) {
      handle = byVariant.get(li.variantId);
    } else {
      const key = normalizeHandle(li.title);
      if (key && byNormalizedId.has(key)) handle = byNormalizedId.get(key);
    }
    if (handle) matched.add(handle);
    items.push({ ...li, handle });
  }
  return { items, matchedHandles: [...matched] };
}

// ---------------------------------------------------------------------------
// Tier classification + attribution window
// ---------------------------------------------------------------------------

/** Token sources whose cart link was built BY Mo — a click on Mo's own
 * artifact, so the resulting order counts as 'direct' even without a code. */
const DIRECT_LINK_SOURCES = new Set(["summary_email", "marketing_email", "bundle"]);

/**
 * Classify an ingested order into its honest attribution tier.
 * Returns null when nothing attributable remains (e.g. an unresolvable token
 * and no Mo code) — callers should then skip the order entirely.
 *
 * @param {{ hasMoCode: boolean, tokenSource: string | null, hasOverlap: boolean }} args
 * @returns {"direct" | "assisted" | "influenced" | null}
 */
export function classifyAttributionTier({ hasMoCode, tokenSource, hasOverlap }) {
  if (hasMoCode) return "direct";
  if (tokenSource == null) return null;
  if (DIRECT_LINK_SOURCES.has(tokenSource)) return "direct";
  // Live-cart stamp ('widget' — or any future session-scoped source): the
  // consultation is linked, the purchase path was the user's own.
  return hasOverlap ? "assisted" : "influenced";
}

/**
 * True when the order falls inside the attribution window measured from the
 * token's minting. Fail-closed: missing/invalid timestamps → false (an
 * unverifiable window must not inflate the KPI).
 *
 * @param {string | Date | null | undefined} orderAt
 * @param {string | Date | null | undefined} tokenCreatedAt
 * @param {number} windowDays
 * @returns {boolean}
 */
export function isWithinAttributionWindow(orderAt, tokenCreatedAt, windowDays) {
  const order = orderAt instanceof Date ? orderAt.getTime() : Date.parse(orderAt ?? "");
  const minted =
    tokenCreatedAt instanceof Date
      ? tokenCreatedAt.getTime()
      : Date.parse(tokenCreatedAt ?? "");
  if (!Number.isFinite(order) || !Number.isFinite(minted)) return false;
  if (!Number.isFinite(windowDays) || windowDays <= 0) return false;
  const ageMs = order - minted;
  // Small negative tolerance for clock skew between Shopify and our DB.
  return ageMs >= -3_600_000 && ageMs <= windowDays * 86_400_000;
}
