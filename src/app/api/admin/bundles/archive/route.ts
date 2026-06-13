// POST /api/admin/bundles/archive  { id }
//
// Manually archive a bundle offer (S11 UI): archives the Shopify product
// (ARCHIVED, never deleted — preserves order history, reversible) and flips the
// row to expired. Late clicks then hit the friendly "Angebot abgelaufen" page.
//
// Auth + CSRF via guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { archiveBundleOffer } from "@/lib/bundle-offers";
import { reportError } from "@/lib/observability";

export const maxDuration = 30;

const STATUS_BY_REASON: Record<string, number> = {
  not_found: 404,
  not_active: 409,
  archive_failed: 502,
};

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

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

  try {
    const result = await archiveBundleOffer(id);
    if (result.ok) {
      return adminJson({ ok: true, offer: result.offer });
    }
    const status = STATUS_BY_REASON[result.reason] ?? 400;
    return adminJsonError(result.reason, result.message, status);
  } catch (err) {
    reportError(err, { route: "api/admin/bundles/archive" });
    return adminJsonError("internal_error", "Archive failed.", 500);
  }
}
