// Pure, dependency-free core logic for bundle offers (S10).
//
// Everything here is side-effect-free (or takes its I/O as injected
// dependencies) so it can be unit-tested without a database or a live Shopify
// store — see bundle-offer-core.test.mjs. The TS service layer
// (bundle-offers.ts) composes these helpers with the real DB + Admin API.
//
// Money is handled as integer CENTS internally to avoid binary-float drift, and
// formatted back to a 2-decimal string for Shopify's Money fields. Component
// unit prices are SNAPSHOTTED at creation so the "statt €X" compare-at stays
// auditable after catalog prices drift (spike §2).

import {
  formatProductRef,
  parseProductRef,
  resolveProductRef,
  effectiveVariantPrice,
  isVariantAvailable,
  variantDisplayName,
} from "./product-ref.mjs";

// ── Creation modes (the seam) ────────────────────────────────────────────────

/** PRIMARY: native Shopify fixed bundle (productBundleCreate → poll → …). */
export const NATIVE_FIXED_BUNDLE = "native_fixed_bundle";
/** FALLBACK: a plain UNLISTED product priced at the bundle total (spike §6a). */
export const PLAIN_UNLISTED_PRODUCT = "plain_unlisted_product";

const BUNDLE_CREATION_MODES = [NATIVE_FIXED_BUNDLE, PLAIN_UNLISTED_PRODUCT];

/**
 * Resolve the configured creation mode from a raw env value. Defaults to the
 * native fixed bundle (the verified primary path); an unrecognised value falls
 * back to the default rather than throwing, so a typo can never wedge creation.
 *
 * @param {string | undefined | null} raw
 * @returns {typeof NATIVE_FIXED_BUNDLE | typeof PLAIN_UNLISTED_PRODUCT}
 */
export function resolveBundleCreationMode(raw) {
  const v = typeof raw === "string" ? raw.trim() : "";
  return BUNDLE_CREATION_MODES.includes(v) ? v : NATIVE_FIXED_BUNDLE;
}

/**
 * The seam dispatch: given a map of creators keyed by mode, return the one for
 * `mode`. Throws on an unknown mode (a programming error — the caller should
 * have normalised via resolveBundleCreationMode first). Kept pure so the TS
 * seam's selection logic is unit-testable with fake creators.
 *
 * @template T
 * @param {Record<string, T>} creators
 * @param {string} mode
 * @returns {T}
 */
export function pickBundleCreator(creators, mode) {
  const creator = creators?.[mode];
  if (!creator) {
    throw new Error(
      `Unknown BUNDLE_CREATION_MODE "${mode}" (expected one of: ${BUNDLE_CREATION_MODES.join(", ")})`
    );
  }
  return creator;
}

// ── Lifecycle: which offers are a deletable DRAFT vs. must be ARCHIVED ─────────

/**
 * Bundle statuses that represent a never-published DRAFT and are therefore safe
 * to hard-DELETE: `pending` (inserted, Shopify create never finalized) and
 * `failed` (the Shopify create threw — no live, purchasable product). Both are
 * unsent and never went live.
 *
 * An `active` (published) or `expired` offer is deliberately NOT here: it uses
 * the END path (archiveBundleOffer → Shopify product deleted + status='expired'),
 * which keeps the row for the expired page, audit and KPIs. Deleting the ROW is
 * only ever for the draft/unsent offers.
 */
export const DELETABLE_BUNDLE_STATUSES = ["pending", "failed"];

/**
 * True iff a bundle offer in this status is a deletable DRAFT (pending/failed).
 * The single source of truth the service layer + the SQL guard agree on.
 * @param {string} status
 * @returns {boolean}
 */
export function isDeletableBundleStatus(status) {
  return DELETABLE_BUNDLE_STATUSES.includes(status);
}

// ── Money helpers (integer cents, formatted to a 2-decimal string) ───────────

/**
 * Parse a Money-ish value (number or decimal string like "149.00" / "149,00")
 * to integer cents. Returns null when it isn't a finite, non-negative amount.
 *
 * @param {string | number | null | undefined} value
 * @returns {number | null}
 */
export function toCents(value) {
  if (value == null) return null;
  let s = String(value).trim();
  if (!s) return null;
  // Operators type prices the German way ("1.299,00 €", "149,90"); catalog
  // prices are numbers and snapshots are "149.00" strings. Drop the currency
  // sign and spaces; then a dot followed by groups of exactly three digits
  // (optionally ending in a comma decimal) is a thousands separator, and a
  // comma is the decimal separator.
  s = s.replace(/[\s\u00a0€]/g, "").replace(/EUR$/i, "");
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "");
  s = s.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/**
 * Format integer cents back to a Shopify Money string ("1234" => "12.34").
 * @param {number} cents
 * @returns {string}
 */
export function centsToMoney(cents) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

// ── Component snapshot + sum ──────────────────────────────────────────────────

/**
 * The most units of ONE item a set may contain. Both composers (Kampagne set
 * dialog, Kunden composer) offer 1…this, and the server refuses more
 * (`bad_quantity`) — an unbounded count would also overflow the NUMERIC(10,2)
 * sum columns.
 */
export const BUNDLE_QUANTITY_MAX = 10;

/**
 * Compute the TRUE component sum (the PAngV "statt €X" reference) from a list of
 * snapshotted components, as a Money string. Each component contributes
 * unitPrice * quantity. Throws if any component's unitPrice can't be parsed —
 * an unpriceable component must never silently drop out of the sum.
 *
 * @param {Array<{ unitPrice: string | number, quantity?: number }>} components
 * @returns {string}  decimal Money string, e.g. "298.00"
 */
export function computeComponentsSum(components) {
  let cents = 0;
  for (const c of components ?? []) {
    const unit = toCents(c?.unitPrice);
    if (unit == null) {
      throw new Error(`Component has an invalid unitPrice: ${JSON.stringify(c)}`);
    }
    const qty = Number.isFinite(c?.quantity) && c.quantity > 0 ? Math.floor(c.quantity) : 1;
    cents += unit * qty;
  }
  return centsToMoney(cents);
}

/**
 * PAngV-safe compare-at rule (spike §2): the "statt €X" strike price is only set
 * when the bundle genuinely costs LESS than buying the parts separately. So:
 *   - bundlePrice <  componentsSum  → compareAtPrice = componentsSum (a real saving)
 *   - bundlePrice >= componentsSum  → NO compareAtPrice (never invent a strike price)
 *
 * Returns the compare-at Money string, or null when none should be set.
 *
 * @param {string | number} bundlePrice
 * @param {string | number} componentsSum
 * @returns {string | null}
 */
export function computeCompareAtPrice(bundlePrice, componentsSum) {
  const priceCents = toCents(bundlePrice);
  const sumCents = toCents(componentsSum);
  if (priceCents == null || sumCents == null) {
    throw new Error("computeCompareAtPrice: bundlePrice/componentsSum must be valid amounts");
  }
  return priceCents < sumCents ? centsToMoney(sumCents) : null;
}

/**
 * Validate + snapshot the requested components against the (sync-fresh) catalog.
 *
 * Native fixed bundles silently die when a component hits 0 stock (spike §4), so
 * we REFUSE at compose time if ANY requested component is sold out, listing the
 * offenders. Unknown product ids and a too-small/empty component set are also
 * rejected. On success returns the snapshot the offer is built + persisted from.
 *
 * Pure: takes the catalog as a Map (productId -> catalog product) so it needs no
 * I/O. `unitPrice` is the component's effective current price — the sale price
 * when on sale, else the list price — i.e. what a customer pays for it alone.
 *
 * Variant-aware: an input may pin a specific variant via `variantId` (numeric
 * Shopify id, the picker's selection). Without one, the product's default
 * variant is used — exactly the pre-variant behaviour. A pinned variant that
 * no longer exists in the catalog is a hard refusal (`variant_not_found`),
 * NEVER silently downgraded to the default (the operator approved a concrete
 * price — see product-ref.mjs module doc).
 *
 * @param {Map<string, { id: string, name?: string, price?: number, salePrice?: number,
 *   currency?: string, shopifyVariantId?: string, inStock?: boolean,
 *   variants?: Array<object> }>} catalogById
 * A `productId` may also arrive as a ref ("handle~123", the shape stored in
 * campaign_drafts.recommended_product_ids): it is split here, so a
 * variant-pinned recommendation resolves instead of reading as unknown.
 *
 * Every refusal carries the offenders of its class plus `titles` — offender →
 * catalog name for the ones the catalog knows — so the admin can say WHICH
 * item is the problem.
 *
 * @param {Array<{ productId: string, variantId?: string|null, quantity?: number }>} inputs
 * @returns {{ ok: true, components: Array<object> } |
 *   { ok: false, reason: "empty" | "unknown_products" | "sold_out" | "no_variant" | "variant_not_found" | "bad_quantity",
 *     unknown?: string[], soldOut?: string[], noVariant?: string[], variantNotFound?: string[],
 *     badQuantity?: string[], titles?: Record<string, string> }}
 */
export function validateAndSnapshotComponents(catalogById, inputs) {
  const list = Array.isArray(inputs) ? inputs : [];
  if (list.length === 0) return { ok: false, reason: "empty" };

  const unknown = [];
  const soldOut = [];
  const noVariant = [];
  const variantNotFound = [];
  const badQuantity = [];
  /** @type {Record<string, string>} */
  const titles = {};
  const components = [];

  for (const input of list) {
    const parsed = parseProductRef(String(input?.productId ?? "").trim());
    const productId = parsed.productId;
    const explicitVariantId =
      input?.variantId != null && String(input.variantId).trim() !== ""
        ? String(input.variantId).trim()
        : null;
    const requestedVariantId = explicitVariantId ?? parsed.variantId;
    const rawQuantity = Number(input?.quantity);
    const quantity = Number.isFinite(rawQuantity) && rawQuantity > 0 ? Math.floor(rawQuantity) : 1;
    const product = productId ? catalogById.get(productId) : undefined;
    if (!product) {
      unknown.push(productId || "(empty)");
      continue;
    }
    if (product.name) titles[productId] = product.name;
    if (quantity > BUNDLE_QUANTITY_MAX) {
      badQuantity.push(productId);
      continue;
    }
    const resolved = resolveProductRef(
      catalogById,
      formatProductRef(productId, requestedVariantId)
    );
    if (!resolved || resolved.missingVariant) {
      const ref = formatProductRef(productId, requestedVariantId);
      if (product.name) titles[ref] = product.name;
      variantNotFound.push(ref);
      continue;
    }
    const variant = resolved.variant;
    // Sync-fresh stock gate, per chosen variant: a sold-out component would
    // make the native bundle unbuyable the moment it's created — refuse now
    // (spike §4 mitigation 1).
    if (!isVariantAvailable(product, variant)) {
      const name = variantDisplayName(product, variant);
      if (name) titles[productId] = name;
      soldOut.push(productId);
      continue;
    }
    const variantId = variant?.id ?? null;
    if (!variantId) {
      noVariant.push(productId);
      continue;
    }
    const unitCents = toCents(effectiveVariantPrice(variant));
    if (unitCents == null) {
      // Treat an unpriceable component like a missing variant — it can't be a
      // defensible "statt" contributor.
      noVariant.push(productId);
      continue;
    }
    const variantTitle = (variant?.title ?? "").trim();
    components.push({
      productId: product.id,
      title: variantDisplayName(product, variant) || product.id,
      ...(variantTitle ? { variantTitle } : {}),
      variantId,
      numericVariantId: parseNumericVariantId(variantId),
      quantity,
      unitPrice: centsToMoney(unitCents),
      currency: product.currency ?? "EUR",
    });
  }

  if (unknown.length) return { ok: false, reason: "unknown_products", unknown, titles };
  if (variantNotFound.length) return { ok: false, reason: "variant_not_found", variantNotFound, titles };
  if (soldOut.length) return { ok: false, reason: "sold_out", soldOut, titles };
  if (badQuantity.length) return { ok: false, reason: "bad_quantity", badQuantity, titles };
  if (noVariant.length) return { ok: false, reason: "no_variant", noVariant, titles };
  return { ok: true, components };
}

/**
 * Local copy of the numeric-variant-id parse so this module stays
 * dependency-free (the canonical impl lives in shopify-cart-url.mjs; this
 * mirrors it for snapshots).
 * @param {string | number | null | undefined} idOrGid
 * @returns {string | null}
 */
export function parseNumericVariantId(idOrGid) {
  if (idOrGid == null) return null;
  const s = String(idOrGid).trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return s;
  const m = s.match(/\/ProductVariant\/(\d+)/);
  return m ? m[1] : null;
}

// ── Expiry ───────────────────────────────────────────────────────────────────

/**
 * Whether an offer is past its deadline at `now`.
 * @param {{ expiresAt?: string | Date | null }} offer
 * @param {number} now  epoch ms
 * @returns {boolean}
 */
export function isExpired(offer, now = Date.now()) {
  if (!offer?.expiresAt) return false;
  const t = new Date(offer.expiresAt).getTime();
  return Number.isFinite(t) && t < now;
}

/**
 * Idempotent expiry-sweep orchestrator (the cron's core). Pure: all I/O is
 * injected, so it is fully unit-testable.
 *
 * Two passes:
 *   1. EXPIRE — for every due offer (active AND past expiry — `fetchDueOffers`
 *      is responsible for that filter) it DELETES the Shopify product (a set
 *      that ran out must not linger in the Shopify admin), then flips the row to
 *      `expired` and stamps the product as removed. A removal failure is logged
 *      LOUDLY via `onError` and does NOT mark the row expired, so the next run
 *      retries it (the offer stays active+due).
 *   2. CLEAN UP — `fetchLeftoverProducts` (optional) lists ended offers whose
 *      Shopify product still exists: a manual end whose delete failed, or sets
 *      that ended while products were only archived. Each is deleted and
 *      stamped; a failure stays on the list for the next run.
 *
 * Idempotency: `fetchDueOffers` only returns status='active' rows and
 * `markExpired` is guarded (… WHERE status='active'); `markProductRemoved` is
 * guarded the same way, and `removeProduct` treats an already-deleted product
 * as success (see isProductGoneUserError).
 *
 * @param {{
 *   fetchDueOffers: () => Promise<Array<{ id: number|string, shopifyProductId?: string|null }>>,
 *   removeProduct: (shopifyProductId: string) => Promise<void>,
 *   markExpired: (id: number|string) => Promise<void>,
 *   markProductRemoved?: (id: number|string) => Promise<void>,
 *   fetchLeftoverProducts?: () => Promise<Array<{ id: number|string, shopifyProductId: string }>>,
 *   onError?: (err: unknown, offer: object) => void,
 * }} deps
 * @returns {Promise<{ expired: number, removed: number, failed: number, scanned: number }>}
 */
export async function runBundleExpirySweep(deps) {
  const due = (await deps.fetchDueOffers()) ?? [];
  let expired = 0;
  let removed = 0;
  let failed = 0;
  for (const offer of due) {
    try {
      // Only the Shopify side can fail; a never-created (failed) offer with no
      // product id just gets its row flipped.
      if (offer.shopifyProductId) {
        await deps.removeProduct(offer.shopifyProductId);
      }
      await deps.markExpired(offer.id);
      if (offer.shopifyProductId) {
        if (deps.markProductRemoved) await deps.markProductRemoved(offer.id);
        removed++;
      }
      expired++;
    } catch (err) {
      failed++;
      if (deps.onError) deps.onError(err, offer);
    }
  }

  const leftovers = deps.fetchLeftoverProducts ? ((await deps.fetchLeftoverProducts()) ?? []) : [];
  for (const offer of leftovers) {
    try {
      await deps.removeProduct(offer.shopifyProductId);
      if (deps.markProductRemoved) await deps.markProductRemoved(offer.id);
      removed++;
    } catch (err) {
      failed++;
      if (deps.onError) deps.onError(err, offer);
    }
  }
  return { expired, removed, failed, scanned: due.length + leftovers.length };
}

/**
 * Whether a `productDelete` userErrors list only says the product is already
 * gone — the idempotent case (a retry after a timeout, a manual delete in the
 * Shopify admin). Anything else is a real failure.
 *
 * @param {Array<{ message?: string | null }> | null | undefined} errors
 * @returns {boolean}
 */
export function isProductGoneUserError(errors) {
  if (!Array.isArray(errors) || errors.length === 0) return false;
  return errors.every((e) =>
    /does ?n[o']t exist|not found|could ?n[o']t be found/i.test(String(e?.message ?? ""))
  );
}

// ── Set contents as a counted list ───────────────────────────────────────────

/**
 * The set's contents as one entry per distinct item with how many of it the
 * set contains — the shape every customer-facing view renders as a bullet
 * list ("2× Kettlebell – 16 kg"). Entries with the same name (same product
 * and variant: pinned variants carry their variant in the name) are merged
 * and their quantities added; order follows the first appearance. A missing
 * or invalid quantity counts as 1.
 *
 * @param {Array<{ name?: string | null, title?: string | null, quantity?: number | null }> | null | undefined} components
 * @returns {Array<{ name: string, quantity: number }>}
 */
export function bundleItemList(components) {
  const items = [];
  const byName = new Map();
  for (const c of components ?? []) {
    const name = String(c?.name ?? c?.title ?? "").trim();
    if (!name) continue;
    const qty = Number.isFinite(c?.quantity) && c.quantity > 0 ? Math.floor(c.quantity) : 1;
    const existing = byName.get(name);
    if (existing) {
      existing.quantity += qty;
    } else {
      const item = { name, quantity: qty };
      byName.set(name, item);
      items.push(item);
    }
  }
  return items;
}

/**
 * One bullet's text: "2× Name".
 * @param {{ name: string, quantity: number }} item
 * @returns {string}
 */
export function bundleItemLabel(item) {
  return `${item.quantity}× ${item.name}`;
}

function escapeHtmlText(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The Shopify product description of a set: an intro line and the contents
 * as a bullet list with counts — what the customer sees on the set's product
 * page, and what fulfilment reads on the fallback path.
 *
 * @param {Array<{ title?: string | null, name?: string | null, quantity?: number | null }>} components
 * @returns {string}
 */
export function bundleDescriptionHtml(components) {
  const items = bundleItemList(components)
    .map((item) => `<li>${escapeHtmlText(bundleItemLabel(item))}</li>`)
    .join("");
  return `<p>Dieses Set enthält:</p><ul>${items}</ul>`;
}
