// Accessory ("Ergänzung") picking for campaign recommendations — pure, no I/O.
//
// WHY THIS EXISTS
//
// The classic campaign recommender scores EMBEDDING SIMILARITY against the
// products a contact owns. Similarity finds SUBSTITUTES: someone who bought a
// power rack gets another power rack recommended. For a customer who just
// bought, that is close to the worst possible pitch — they have solved that
// need and spent the money.
//
// The measured behaviour says the opposite is what they do: returning customers
// buy ACCESSORIES to what they already own at 3,0–4,6× the chance rate
// (docs/REPURCHASE_ANALYSIS.md). This module picks those, from the merchant's
// own curation rather than from a model: Product.compatibleWith carries the
// "Ergänzende Produkte" maintained in Shopify — 87 % of the catalogue has it,
// on average 6,9 entries per product.
//
// Ranking, in order:
//   1. accessories of the MOST RECENT purchase first — that is the product the
//      mail's prose is about, so the recommendation reads as one thought;
//   2. then how many owned products list it (an accessory that fits several
//      things they own is a safer bet than one that fits a single item);
//   3. then first-seen order, so the same input always yields the same picks.

/**
 * @param {{
 *   ownedIds: string[],
 *   recentOwnedIds?: string[],
 *   accessoryMap: Map<string, string[]>,
 *   isAvailable: (id: string) => boolean,
 *   max?: number,
 * }} input
 * @returns {string[]} catalog ids, best first
 */
export function pickComplementIds(input) {
  const owned = new Set(input?.ownedIds ?? []);
  const recent = new Set(input?.recentOwnedIds ?? []);
  const accessoryMap = input?.accessoryMap ?? new Map();
  const isAvailable = typeof input?.isAvailable === "function" ? input.isAvailable : () => true;
  const max = Number.isFinite(input?.max) ? input.max : 3;
  if (max <= 0) return [];

  /** @type {Map<string, { fromRecent: boolean, owners: number, seen: number }>} */
  const scored = new Map();
  let seen = 0;

  for (const ownedId of owned) {
    const accessories = accessoryMap.get(ownedId);
    if (!Array.isArray(accessories)) continue;
    for (const accessoryId of accessories) {
      if (typeof accessoryId !== "string" || !accessoryId) continue;
      // Something they already own is a replacement, not an expansion.
      if (owned.has(accessoryId)) continue;
      if (!isAvailable(accessoryId)) continue;
      const entry = scored.get(accessoryId);
      if (entry) {
        entry.owners += 1;
        if (recent.has(ownedId)) entry.fromRecent = true;
      } else {
        scored.set(accessoryId, {
          fromRecent: recent.has(ownedId),
          owners: 1,
          seen: seen++,
        });
      }
    }
  }

  return [...scored.entries()]
    .sort((a, b) => {
      if (a[1].fromRecent !== b[1].fromRecent) return a[1].fromRecent ? -1 : 1;
      if (a[1].owners !== b[1].owners) return b[1].owners - a[1].owners;
      return a[1].seen - b[1].seen;
    })
    .slice(0, max)
    .map(([id]) => id);
}

/**
 * Build the accessory graph from the catalogue. Products without curated
 * accessories simply do not appear — the caller then has no complement picks
 * and falls back to similarity.
 *
 * @param {Array<{ id: string, compatibleWith?: string[] }>} catalog
 * @returns {Map<string, string[]>}
 */
export function buildAccessoryMap(catalog) {
  const map = new Map();
  for (const product of catalog ?? []) {
    if (product?.id && Array.isArray(product.compatibleWith) && product.compatibleWith.length) {
      map.set(product.id, product.compatibleWith);
    }
  }
  return map;
}
