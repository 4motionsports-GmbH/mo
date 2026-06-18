// Keep the catalog blob and the embeddings blob a CONSISTENT PAIR.
//
// The two blobs are written together (Part B), but they're still two files. This
// pure helper enforces the one invariant that makes them "consistent": every
// embedding vector must belong to a product that exists in the catalog. A
// catalog product MAY legitimately have no vector (it was skipped because its
// embed failed — retrieval falls back to keyword search for it), but a vector
// whose product was removed/renamed is an ORPHAN and must be dropped, or it would
// linger and mis-resolve against a catalog id that no longer exists.
//
// Used at write time in the cron sync and the webhook single-product update so a
// fresh catalog can never ship with embeddings that reference gone products.

/**
 * Drop embedding items whose id is not present in the catalog id set (orphans),
 * preserving order and de-duplicating by id (first wins).
 *
 * @param {Iterable<string>} catalogIds
 * @param {Array<{ id: string }>} items
 * @returns {Array<{ id: string }>}
 */
export function reconcileEmbeddingItems(catalogIds, items) {
  const allowed = catalogIds instanceof Set ? catalogIds : new Set(catalogIds);
  const seen = new Set();
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it.id !== "string") continue;
    if (!allowed.has(it.id) || seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

/**
 * True when the embeddings file is consistent with the catalog: every vector id
 * exists in the catalog (subset). The reverse is NOT required — products without
 * a vector are fine (keyword-search fallback).
 *
 * @param {Array<{ id: string }>} products
 * @param {{ items?: Array<{ id: string }> }} embeddings
 * @returns {boolean}
 */
export function isConsistentPair(products, embeddings) {
  const ids = new Set((Array.isArray(products) ? products : []).map((p) => p?.id));
  for (const it of embeddings?.items ?? []) {
    if (!ids.has(it?.id)) return false;
  }
  return true;
}
