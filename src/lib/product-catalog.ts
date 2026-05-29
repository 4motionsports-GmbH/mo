// Thin re-export for backwards compatibility. The real loader lives in
// catalog-store.ts and handles Blob + bundled-JSON fallback with caching.
import { loadProductCatalog } from "./catalog-store";
import type { Product } from "./types";

export { loadProductCatalog };

export async function getProductById(id: string): Promise<Product | undefined> {
  const catalog = await loadProductCatalog();
  return catalog.find((p) => p.id === id);
}

export async function getProductsByIds(ids: string[]): Promise<Product[]> {
  const catalog = await loadProductCatalog();
  return ids
    .map((id) => catalog.find((p) => p.id === id))
    .filter((p): p is Product => p !== undefined);
}
