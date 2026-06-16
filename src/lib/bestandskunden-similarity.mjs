// §7 Abs. 3 UWG "similar products" boundary — the lawyer-approved rule, encoded.
//
// §7(3) permits existing-customer email ONLY for the trader's OWN SIMILAR goods
// (condition 2). Per the lawyer sign-off (LEGAL_READINESS_REPORT — green/amber),
// "similar" is implemented NARROWLY and ENFORCED in code, not assumed:
//
//   * derive the set of CATEGORIES the customer actually purchased (from the
//     cached Shopify order history → catalog category), then
//   * a candidate is "similar" ONLY if it is in one of those purchased
//     categories, is in stock, and is NOT something the customer already owns.
//
// Pure (no I/O) so the legal boundary is unit-tested in isolation; the route
// supplies the loaded catalog + the customer's purchase summary. Personalisation
// uses PURCHASE history only — never the consent-derived AI profile — so the
// §7(3) (legitimate-interest) basis never borrows the consent basis.

import { normalizeHandle } from "./kpi-match.mjs";

/**
 * Normalised handles of everything the customer has purchased — the "already
 * owns" set (so we never advertise back what they just bought). Catalog id ==
 * storefront handle (verified), so both sides normalise the same way.
 *
 * @param {{ orders?: Array<{ items?: Array<{ handle?: string|null }> }> } | null | undefined} purchaseSummary
 * @returns {Set<string>}
 */
export function deriveOwnedHandles(purchaseSummary) {
  const out = new Set();
  for (const order of purchaseSummary?.orders ?? []) {
    for (const item of order?.items ?? []) {
      const h = normalizeHandle(item?.handle);
      if (h) out.add(h);
    }
  }
  return out;
}

/**
 * The set of catalog CATEGORIES the customer has purchased — the §7(3) "similar"
 * scope. Each purchased line item is matched to a catalog product by normalised
 * handle; its category joins the set. Items that don't map to a current catalog
 * product contribute nothing (fail-closed: an unmappable purchase can't widen
 * the scope).
 *
 * @param {{ orders?: Array<{ items?: Array<{ handle?: string|null }> }> } | null | undefined} purchaseSummary
 * @param {Array<{ id?: string, slug?: string, category?: string }>} catalog
 * @returns {Set<string>}
 */
export function deriveOwnedCategories(purchaseSummary, catalog) {
  const byHandle = new Map();
  for (const p of catalog ?? []) {
    const key = normalizeHandle(p?.id ?? p?.slug);
    if (key && p?.category) byHandle.set(key, p.category);
  }
  const cats = new Set();
  for (const order of purchaseSummary?.orders ?? []) {
    for (const item of order?.items ?? []) {
      const cat = byHandle.get(normalizeHandle(item?.handle));
      if (cat) cats.add(cat);
    }
  }
  return cats;
}

/**
 * Select the catalog products a §7(3) email MAY advertise to this customer:
 * in-stock products in a category the customer has purchased, excluding items
 * they already own. On-sale items lead, then alphabetical; capped at `limit`.
 *
 * Returns [] when the customer has no determinable purchased category — the
 * route treats an empty result as "nothing similar to advertise" and DOES NOT
 * send (no generic blast), keeping the §7(3) boundary real.
 *
 * @param {Array<{ id?: string, category?: string, inStock?: boolean, name?: string, salePrice?: number }>} catalog
 * @param {{ ownedCategories: Set<string>, ownedHandles?: Set<string>, limit?: number }} opts
 * @returns {Array<object>}
 */
export function selectSimilarProducts(catalog, { ownedCategories, ownedHandles = new Set(), limit = 3 }) {
  if (!ownedCategories || ownedCategories.size === 0) return [];
  const candidates = (catalog ?? []).filter(
    (p) =>
      p &&
      p.inStock === true &&
      p.category &&
      ownedCategories.has(p.category) &&
      !ownedHandles.has(normalizeHandle(p.id))
  );
  candidates.sort((a, b) => {
    const aSale = typeof a.salePrice === "number" ? 0 : 1;
    const bSale = typeof b.salePrice === "number" ? 0 : 1;
    if (aSale !== bSale) return aSale - bSale;
    return String(a.name ?? "").localeCompare(String(b.name ?? ""), "de");
  });
  return candidates.slice(0, Math.max(0, limit));
}
