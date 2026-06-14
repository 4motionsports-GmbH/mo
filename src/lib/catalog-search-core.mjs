// Pure, dependency-free core for the bundle composer's "add product" search
// (S11). Side-effect-free so the matching rules — case-insensitive, German
// umlaut-tolerant, AND-term name search over the synced catalog — are
// unit-testable without a catalog blob. The route (api/admin/catalog/search)
// composes this with loadProductCatalog() and maps the hits to the picker shape.

/** Default cap on returned matches (the picker only needs enough to choose). */
export const MAX_SEARCH_RESULTS = 20;

/**
 * Fold German text for tolerant, case-insensitive matching:
 *   - NFD-decompose then strip combining marks. This folds BOTH precomposed
 *     umlauts (ä) and decomposed ones (a +  ̈ ), the latter of which appear in
 *     the synced catalog (e.g. "Hantelstangen Ständer") and defeat a naive
 *     `replaceAll("ä", "a")`.
 *   - ß → ss (ß has no decomposition).
 *   - lowercase.
 * Matching only — never for display.
 *
 * @param {unknown} s
 * @returns {string}
 */
export function foldGerman(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss") // ß
    .replace(/ẞ/g, "ss") // ẞ (capital ß)
    .toLowerCase();
}

/**
 * Name-first catalog search for the composer's add-product box. Pure: takes the
 * catalog + raw query, returns the matched products (a subset of the input,
 * in-stock first then by name, capped at `max`). Every whitespace-separated
 * term must appear (AND) somewhere in name/brand/category — a focused name
 * search, not fuzzy recall. Single-character terms are dropped unless that's all
 * the operator typed, so "ab" still narrows while a stray "a" beside a real word
 * doesn't widen the match back to everything.
 *
 * @param {Array<{ name?: string, brand?: string, category?: string, inStock?: boolean }>} catalog
 * @param {unknown} query
 * @param {number} [max]
 * @returns {Array<object>}
 */
export function searchCatalogByName(catalog, query, max = MAX_SEARCH_RESULTS) {
  const list = Array.isArray(catalog) ? catalog : [];
  const folded = foldGerman(query).trim();
  if (!folded) return [];

  let terms = folded.split(/\s+/).filter((t) => t.length > 1);
  if (terms.length === 0) terms = folded.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  return list
    .filter((p) => {
      const haystack = foldGerman(`${p?.name ?? ""} ${p?.brand ?? ""} ${p?.category ?? ""}`);
      return terms.every((t) => haystack.includes(t));
    })
    .sort((a, b) => {
      const aIn = a?.inStock !== false;
      const bIn = b?.inStock !== false;
      if (aIn !== bIn) return aIn ? -1 : 1;
      return String(a?.name ?? "").localeCompare(String(b?.name ?? ""), "de");
    })
    .slice(0, max);
}
