// POST /api/admin/catalog/search  { query }
//
// Name search over the full synced catalog, for the bundle composer's "add
// product" box (S11). Reuses the catalog data layer (loadProductCatalog) — name
// substring matching is enough. The matching itself (case-insensitive, German
// umlaut-tolerant, AND-term) lives in the pure catalog-search-core so it's
// unit-testable. Returns the picker shape each match needs (id, title, image,
// price, stock); sold-out items are returned but FLAGGED so the UI can mark them
// un-addable (S10 refuses sold-out components anyway).
//
// Read-only. Auth + CSRF via guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { loadProductCatalog } from "@/lib/catalog-store";
import { searchCatalogByName, MAX_SEARCH_RESULTS } from "@/lib/catalog-search-core.mjs";
import type { Product } from "@/lib/types";
import { reportError } from "@/lib/observability";

export const maxDuration = 15;

function effectivePrice(p: Product): number {
  return typeof p.salePrice === "number" && p.salePrice > 0 ? p.salePrice : p.price;
}

function firstImageUrl(p: Product): string | null {
  return p.images?.find((u) => typeof u === "string" && u.startsWith("https://")) ?? null;
}

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let query: string;
  try {
    const body = (await req.json()) as { query?: unknown };
    query = String(body.query ?? "").trim();
    if (!query) return adminJsonError("bad_request", "query required", 400);
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    const catalog = await loadProductCatalog();
    const hits = searchCatalogByName(catalog, query, MAX_SEARCH_RESULTS) as Product[];
    const matches = hits.map((p) => ({
      productId: p.id,
      title: p.name,
      imageUrl: firstImageUrl(p),
      unitPrice: effectivePrice(p),
      currency: p.currency ?? "EUR",
      inStock: p.inStock !== false,
    }));

    return adminJson({ products: matches });
  } catch (err) {
    reportError(err, { route: "api/admin/catalog/search" });
    return adminJsonError("internal_error", "Catalog search failed.", 500);
  }
}
