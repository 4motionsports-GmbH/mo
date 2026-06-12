// Browsing context — the small in-browser trail (recently viewed products /
// categories) the widget MAY attach when the USER opens a chat or sends a
// message. PRIVACY: this is conversation input the visitor brings along, not
// background tracking — it only ever reaches the backend as part of a chat
// request the user initiated, it shapes the live conversation exactly like the
// existing single-product context, and it is never stored as a profile.
//
// Everything here crosses a public network boundary, so the raw payload is
// untrusted: products are validated against the live catalog by id (canonical
// catalog name wins over the client-supplied one), categories are kept only
// when the label demonstrably corresponds to something we sell, and the whole
// trail is capped small. Unknown ids/labels are ignored gracefully — a stale
// or forged trail can never inject bogus items into the prompt, and never
// causes an error.

import { loadProductCatalog } from "./catalog-store";

export interface BrowsingProductRef {
  id: string;
  name: string;
  // Carried so the greeting respects the sold-out rules from the first word —
  // Mo must not enthuse over (or checkout) a product that isn't available.
  inStock: boolean;
}

export interface BrowsingCategoryRef {
  name: string;
}

export interface BrowsingContext {
  /** Catalog-validated recently viewed products, capped, canonical names. */
  products: BrowsingProductRef[];
  /** Catalog-validated recently viewed category labels, capped. */
  categories: BrowsingCategoryRef[];
}

// Keep the context small and the greeting tasteful: at most the few most
// recent items, regardless of how long a trail the client sends.
export const MAX_BROWSING_PRODUCTS = 3;
export const MAX_BROWSING_CATEGORIES = 2;
// Hard bound on how much of an oversized/abusive trail we even look at.
const MAX_TRAIL_ITEMS_SCANNED = 20;
const MAX_CATEGORY_LABEL_LENGTH = 80;

// Lower-case, fold German umlauts, collapse everything non-alphanumeric.
// Used purely for matching — never for display.
function normalizeLabel(s: string): string {
  return s
    .toLowerCase()
    .replaceAll("ä", "a")
    .replaceAll("ö", "o")
    .replaceAll("ü", "u")
    .replaceAll("ß", "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// German storefront labels are usually plural ("Laufbänder", "Matten") while
// product names carry the singular — fold the common plural endings so the
// label can still be matched against the catalog.
function wordVariants(word: string): string[] {
  const variants = [word];
  if (word.length > 4) {
    for (const suffix of ["en", "er", "e", "n", "s"]) {
      if (word.endsWith(suffix)) variants.push(word.slice(0, -suffix.length));
    }
  }
  return variants;
}

// A category label is "ours" when at least one catalog product matches every
// significant word of it (with plural folding). This validates German
// storefront collection titles against an English-taxonomy catalog without a
// collection table: "Laufbänder" matches because product names contain
// "Laufband"; "Gartenmöbel" matches nothing and is dropped.
function labelMatchesCatalog(normLabel: string, haystacks: string[]): boolean {
  const words = normLabel.split(" ").filter((w) => w.length >= 3);
  if (words.length === 0) return false;
  const variantSets = words.map(wordVariants);
  return haystacks.some((h) =>
    variantSets.every((variants) => variants.some((v) => h.includes(v)))
  );
}

/**
 * Validate the widget-supplied `context.recentlyViewed` trail against the
 * catalog. Returns undefined when nothing in the trail is valid — the request
 * then behaves exactly as if no browsing context was sent (no error).
 *
 * `excludeProductId` drops the single-product context's product from the
 * trail so a product-page open doesn't list the same product twice.
 */
export async function resolveBrowsingContext(
  raw: unknown,
  opts: { excludeProductId?: string } = {}
): Promise<BrowsingContext | undefined> {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;

  const catalog = await loadProductCatalog();
  const productsById = new Map(catalog.map((p) => [p.id, p]));
  // Canonical category names, keyed by normalized label for exact matches.
  const categoryByNorm = new Map<string, string>();
  for (const p of catalog) {
    if (p.category) categoryByNorm.set(normalizeLabel(p.category), p.category);
  }
  // Per-product haystack for the fuzzy label match (built lazily — only
  // needed when a label isn't an exact category name).
  let haystacks: string[] | null = null;

  const products: BrowsingProductRef[] = [];
  const categories: BrowsingCategoryRef[] = [];
  const seenProductIds = new Set<string>(
    opts.excludeProductId ? [opts.excludeProductId] : []
  );
  const seenCategoryNorms = new Set<string>();

  for (const entry of raw.slice(0, MAX_TRAIL_ITEMS_SCANNED)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as { type?: unknown; id?: unknown; name?: unknown };

    if (e.type === "product") {
      if (products.length >= MAX_BROWSING_PRODUCTS) continue;
      const id = typeof e.id === "string" ? e.id.trim() : "";
      if (!id || seenProductIds.has(id)) continue;
      const product = productsById.get(id);
      if (!product) continue; // unknown id — ignore gracefully
      seenProductIds.add(id);
      // Trust the catalog's canonical name over the client-supplied one.
      products.push({ id: product.id, name: product.name, inStock: product.inStock });
    } else if (e.type === "category") {
      if (categories.length >= MAX_BROWSING_CATEGORIES) continue;
      const label =
        typeof e.name === "string"
          ? e.name.replace(/[\r\n\t`]/g, " ").trim().slice(0, MAX_CATEGORY_LABEL_LENGTH)
          : "";
      if (!label) continue;
      const norm = normalizeLabel(label);
      if (!norm || seenCategoryNorms.has(norm)) continue;
      const canonical = categoryByNorm.get(norm);
      if (canonical) {
        seenCategoryNorms.add(norm);
        categories.push({ name: canonical });
        continue;
      }
      haystacks ??= catalog.map((p) => normalizeLabel(`${p.name} ${p.category}`));
      if (labelMatchesCatalog(norm, haystacks)) {
        seenCategoryNorms.add(norm);
        categories.push({ name: label });
      }
      // No match → not something we sell → ignored gracefully.
    }
    // Unknown entry types are ignored gracefully.
  }

  if (products.length === 0 && categories.length === 0) return undefined;
  return { products, categories };
}
