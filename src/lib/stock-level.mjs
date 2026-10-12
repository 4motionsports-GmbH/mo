// How much of a recommended product is in stock, as the operator should see
// it on the Kampagne desk (Empfehlungen, set dialog) and in the catalog
// picker. Pure, so the rules are tested in one place (stock-level.test.mjs).
//
// The catalog's stock numbers come from Shopify (docs/CATALOG_SYNC.md) and
// are only meaningful when inventory is tracked: an untracked product reports
// 0 or nothing, a "continue selling" variant can go negative. So a number is
// shown ONLY when it is positive and tracking is not known to be off — every
// other case reads as "unknown" (no number), never as "0 auf Lager".
// Availability itself (Ausverkauft) stays the catalog's availableForSale flag
// (availability.mjs), which already accounts for overselling.

import { num } from "./admin-format.mjs";
import { productVariants } from "./product-ref.mjs";

/**
 * A displayable stock quantity, or null when it is unknown or meaningless.
 * @param {unknown} value  inventoryQuantity / totalInventory
 * @param {boolean | null | undefined} tracked  Product.tracksInventory (undefined = unknown)
 * @returns {number | null}
 */
export function stockQuantity(value, tracked) {
  if (tracked === false) return null;
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

/**
 * The stock figures of one recommendation ref.
 *
 * - `stock`: what the Empfehlungen list shows. For a ref pinned to a variant
 *   (or a product with one variant) that variant's quantity; for a bare ref
 *   of a multi-variant product the product total (`stockScope: "product"`),
 *   because the mail links to the product page where the customer picks.
 * - `unitStock`: the quantity of the variant a SET would use (the pinned one,
 *   else the default variant) — the set dialog caps the count with it.
 *
 * @param {object | null | undefined} product  catalog Product
 * @param {object | null | undefined} variant  the resolved variant (pinned or default)
 * @param {{ pinned?: boolean }} [opts]
 * @returns {{ stock: number | null, stockScope: "variant" | "product", unitStock: number | null }}
 */
export function recommendationStock(product, variant, { pinned = false } = {}) {
  if (!product) return { stock: null, stockScope: "variant", unitStock: null };
  const tracked = typeof product.tracksInventory === "boolean" ? product.tracksInventory : undefined;
  const single = productVariants(product).length <= 1;
  const variantQty = stockQuantity(variant?.inventoryQuantity, tracked);
  const productQty = stockQuantity(product.inventoryQuantity, tracked);
  const unitStock = variantQty ?? (single ? productQty : null);
  if (pinned || single) return { stock: unitStock, stockScope: "variant", unitStock };
  return { stock: productQty, stockScope: "product", unitStock };
}

/**
 * @param {boolean | null | undefined} available  view flag: null = not in the catalog
 * @returns {"available" | "sold_out" | "missing"}
 */
export function stockStatus(available) {
  if (available == null) return "missing";
  return available ? "available" : "sold_out";
}

/**
 * The short German stock text for a row, or null when there is nothing to
 * say (available, quantity unknown).
 * @param {{ available: boolean | null | undefined, stock?: number | null, stockScope?: "variant" | "product" }} view
 * @returns {string | null}
 */
export function stockLabel({ available, stock, stockScope }) {
  const status = stockStatus(available);
  if (status === "sold_out") return "Ausverkauft";
  if (status === "missing") return "Nicht im Katalog";
  if (stock == null) return null;
  return stockScope === "product" ? `${num(stock)} auf Lager (gesamt)` : `${num(stock)} auf Lager`;
}

/**
 * The highest count the set dialog offers for one item: the known stock of
 * the variant the set uses, capped by the set's per-item maximum; the cap
 * alone when the stock is unknown.
 * @param {number | null | undefined} unitStock
 * @param {number} cap
 * @returns {number}
 */
export function maxSetQuantity(unitStock, cap) {
  const limit = Math.max(1, Math.floor(cap));
  if (unitStock == null || !Number.isFinite(unitStock)) return limit;
  return Math.max(1, Math.min(limit, Math.floor(unitStock)));
}
