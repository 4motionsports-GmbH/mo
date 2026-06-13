// POST /api/admin/catalog/search  { query }
//
// Name search over the full synced catalog, for the bundle composer's "add
// product" box (S11). Reuses the catalog data layer (loadProductCatalog) — name
// substring matching is enough. Returns the picker shape each match needs
// (id, title, image, price, stock); sold-out items are returned but FLAGGED so
// the UI can mark them un-addable (S10 refuses sold-out components anyway).
//
// Read-only. Auth + CSRF via guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { loadProductCatalog } from "@/lib/catalog-store";
import type { Product } from "@/lib/types";
import { reportError } from "@/lib/observability";

export const maxDuration = 15;

const MAX_RESULTS = 20;

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
    query = String(body.query ?? "").trim().toLowerCase();
    if (!query) return adminJsonError("bad_request", "query required", 400);
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    const catalog = await loadProductCatalog();
    const terms = query.split(/\s+/).filter((t) => t.length > 1);

    const matches = catalog
      .filter((p) => {
        const haystack = `${p.name} ${p.brand ?? ""} ${p.category ?? ""}`.toLowerCase();
        // Every term must appear (AND) — a focused name search, not fuzzy recall.
        return terms.every((t) => haystack.includes(t));
      })
      // In-stock first (the addable ones), then by name.
      .sort((a, b) => {
        if (a.inStock !== b.inStock) return a.inStock ? -1 : 1;
        return a.name.localeCompare(b.name, "de");
      })
      .slice(0, MAX_RESULTS)
      .map((p) => ({
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
