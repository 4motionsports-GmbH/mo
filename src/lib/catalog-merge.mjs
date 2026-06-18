// Pure, dependency-free core for the TARGETED single-product catalog update
// (Part E webhook). Side-effect-free so the merge rules — idempotent no-op on an
// unchanged product (the burst guard), correct upsert/remove, and "re-embed only
// when the embedded text actually changed" — are unit-testable without Blob,
// Shopify, or OpenAI. The TS wrapper (catalog-mutate.ts) composes these with the
// live blobs + a single-product embed call.

/** Deep value-equality via canonical JSON (catalog products are plain JSON). */
function sameProduct(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Upsert one product into the catalog list. Replaces the existing entry with the
 * same id, or appends a new one, keeping the list sorted by name (de) to match
 * the full-sync output. Returns the (new) list and whether anything CHANGED — an
 * identical product is a no-op (idempotent; absorbs duplicate webhook bursts).
 *
 * @param {Array<{ id: string, name?: string }>} catalog
 * @param {{ id: string, name?: string }} product
 * @returns {{ catalog: Array<object>, changed: boolean, existed: boolean }}
 */
export function upsertProductInCatalog(catalog, product) {
  const list = Array.isArray(catalog) ? catalog : [];
  const idx = list.findIndex((p) => p && p.id === product.id);
  if (idx >= 0 && sameProduct(list[idx], product)) {
    return { catalog: list, changed: false, existed: true };
  }
  const next = idx >= 0 ? list.map((p, i) => (i === idx ? product : p)) : [...list, product];
  next.sort((a, b) => String(a?.name ?? "").localeCompare(String(b?.name ?? ""), "de"));
  return { catalog: next, changed: true, existed: idx >= 0 };
}

/**
 * Remove a product (by id) from the catalog list.
 * @param {Array<{ id: string }>} catalog
 * @param {string} id
 * @returns {{ catalog: Array<object>, changed: boolean }}
 */
export function removeProductFromCatalog(catalog, id) {
  const list = Array.isArray(catalog) ? catalog : [];
  const next = list.filter((p) => p && p.id !== id);
  return { catalog: next, changed: next.length !== list.length };
}

/**
 * Should we re-embed this product, or can we reuse its stored vector? Reuse only
 * when the stored vector matches the CURRENT embedded text exactly: same doc
 * version AND same per-item docHash AND a vector is actually present. Anything
 * else (new product, missing vector, version bump, changed text) ⇒ re-embed.
 * This is what makes a webhook that only changed STOCK skip the OpenAI call.
 *
 * @param {object} args
 * @param {number | undefined} args.fileDocVersion   docVersion of the stored blob
 * @param {number} args.currentDocVersion            EMBEDDING_DOC_VERSION now
 * @param {{ vector?: number[], docHash?: string } | undefined} args.existingItem
 * @param {string} args.newDocHash                   hash of the product's new doc
 * @returns {boolean}
 */
export function shouldReembed({ fileDocVersion, currentDocVersion, existingItem, newDocHash }) {
  if (!existingItem || !Array.isArray(existingItem.vector) || existingItem.vector.length === 0) {
    return true;
  }
  if (fileDocVersion !== currentDocVersion) return true;
  return existingItem.docHash !== newDocHash;
}

/**
 * Upsert one embedding item (by id) into the items list, preserving order
 * (replace in place, else append).
 * @param {Array<{ id: string }>} items
 * @param {{ id: string, vector: number[], docHash?: string }} item
 * @returns {Array<object>}
 */
export function upsertEmbeddingItem(items, item) {
  const list = Array.isArray(items) ? items : [];
  const idx = list.findIndex((it) => it && it.id === item.id);
  if (idx >= 0) return list.map((it, i) => (i === idx ? item : it));
  return [...list, item];
}

/** Remove one embedding item (by id). */
export function removeEmbeddingItem(items, id) {
  return (Array.isArray(items) ? items : []).filter((it) => it && it.id !== id);
}
