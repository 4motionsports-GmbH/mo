// POST /api/admin/qa/unpublish  { id }
//
// "Zurückziehen": the inverse of publish, making every Q&A fully reversible
// (e.g. a test answer, or one that turned out wrong).
//   - product-linked → remove the pair from the product's custom.qa metafield
//     (fingerprint match; idempotent — an already-gone pair or a deleted
//     product still succeeds) and refresh that product in Mo's catalog so he
//     forgets it immediately.
//   - general → drop it from Mo's prompt knowledge base (cache invalidated;
//     other warm instances follow within the 5-minute TTL).
// The entry returns to status 'answered', so it can be edited, re-published,
// or dismissed.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { recordAdminAccess } from "@/lib/admin-access-log";
import {
  getQaEntry,
  markQaUnpublished,
  invalidateGeneralQaCache,
} from "@/lib/qa-store";
import { unpublishQaFromProduct } from "@/lib/shopify-qa";
import { isShopifyConfigured } from "@/lib/shopify";
import { isDbConfigured } from "@/lib/db";

export const maxDuration = 60;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  if (!isDbConfigured()) {
    return adminJsonError("unavailable", "No database configured", 503);
  }

  let id: number;
  try {
    const body = (await req.json()) as { id?: unknown };
    id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return adminJsonError("bad_request", "id required", 400);
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  const entry = await getQaEntry(id);
  if (!entry) return adminJsonError("not_found", "Eintrag nicht gefunden.", 404);
  if (entry.status !== "published") {
    return adminJsonError("not_published", "Nur veröffentlichte Einträge können zurückgezogen werden.", 409);
  }

  await recordAdminAccess(
    { action: "qa.unpublish", detail: { id, productId: entry.productId } },
    req
  );

  let removed = false;
  let catalogRefreshed = false;
  if (entry.productId) {
    if (!isShopifyConfigured()) {
      return adminJsonError(
        "shopify_unconfigured",
        "Shopify ist nicht konfiguriert — Produkt-Q&A kann nicht zurückgezogen werden.",
        503
      );
    }
    const res = await unpublishQaFromProduct({
      handle: entry.productId,
      question: entry.question,
    });
    if (!res.ok) {
      return adminJsonError(`unpublish_${res.reason}`, res.message, 502);
    }
    removed = res.removed;
    catalogRefreshed = res.catalogRefreshed;
  }

  const updated = await markQaUnpublished(id);
  if (!updated) {
    return adminJsonError("unavailable", "Status konnte nicht aktualisiert werden.", 500);
  }
  invalidateGeneralQaCache();
  return adminJson({ entry: updated, removed, catalogRefreshed });
}
