// POST /api/admin/qa/dismiss  { id }
//
// Operator decision: not a real gap / duplicate / won't answer. Terminal for
// the queue (a dismissed fingerprint may be re-drafted later). Published
// entries cannot be dismissed — they live in Shopify/Mo's context; edit and
// re-publish instead.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { dismissQaEntry } from "@/lib/qa-store";
import { isDbConfigured } from "@/lib/db";

export const maxDuration = 15;

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

  await recordAdminAccess({ action: "qa.dismiss", detail: { id } }, req);

  const ok = await dismissQaEntry(id);
  if (!ok) return adminJsonError("unavailable", "Konnte nicht verwerfen.", 500);
  return adminJson({ ok: true });
}
