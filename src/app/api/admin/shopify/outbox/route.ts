// POST /api/admin/shopify/outbox  { id } → { ok }
//
// „Erneut versuchen“ for a write-back to Shopify that gave up (dead) —
// Einstellungen → Shopify-Abgleich. The 5-minute cron runs it.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { retryOutboxRow } from "@/lib/shopify-outbox";

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  let id: number;
  try {
    id = Number(((await req.json()) as { id?: unknown }).id);
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }
  if (!Number.isInteger(id) || id <= 0) return adminJsonError("bad_request", "id required", 400);
  const ok = await retryOutboxRow(id);
  if (!ok) return adminJsonError("not_found", "Eintrag nicht gefunden oder nicht wiederholbar.", 404);
  return adminJson({ ok: true });
}
