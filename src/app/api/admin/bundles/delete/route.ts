// POST /api/admin/bundles/delete  { id }
//
// DELETE a draft/unsent bundle offer (S11 UI). STRICT counterpart to the
// archive path: ONLY the never-published DRAFT states (pending/failed) are
// deletable. An active/published or expired offer is refused (409 not_deletable)
// and must go through /api/admin/bundles/archive instead — archive keeps the
// Shopify product ARCHIVED and the row for audit/KPIs. A (pending/failed) row
// that somehow already minted a Shopify product has that product archived first
// rather than orphaned. See deleteDraftBundleOffer (lib/bundle-offers).
//
// Auth + CSRF via guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { deleteDraftBundleOffer } from "@/lib/bundle-offers";
import { reportError } from "@/lib/observability";

export const maxDuration = 30;

const STATUS_BY_REASON: Record<string, number> = {
  not_found: 404,
  not_deletable: 409,
  delete_failed: 502,
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
    const result = await deleteDraftBundleOffer(id);
    if (result.ok) {
      return adminJson({ ok: true, offer: result.offer });
    }
    const status = STATUS_BY_REASON[result.reason] ?? 400;
    return adminJsonError(result.reason, result.message, status);
  } catch (err) {
    reportError(err, { route: "api/admin/bundles/delete" });
    return adminJsonError("internal_error", "Delete failed.", 500);
  }
}
