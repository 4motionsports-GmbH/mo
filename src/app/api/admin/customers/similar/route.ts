// GET /api/admin/customers/similar?id=<customerId> → { items, audience }
//
// Kunden → Überblick „Ähnliche Kunden“: people with the same value tier and
// shared bought categories, plus the campaign audience that describes them
// („Als Zielgruppe verwenden“ opens the campaign editor with it). Pure DB.

import { guardAdminGet, adminJson, adminJsonError } from "@/lib/admin-api";
import { listSimilarCustomers } from "@/lib/customer-list-store";
import { recordAdminAccess } from "@/lib/admin-access-log";

export async function GET(req: Request) {
  const blocked = await guardAdminGet();
  if (blocked) return blocked;
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return adminJsonError("bad_request", "id required", 400);
  const res = await listSimilarCustomers(id);
  if (!res) return adminJsonError("internal_error", "Ähnliche Kunden konnten nicht geladen werden.", 500);
  await recordAdminAccess({ action: "customer.similar", targetCustomerId: id, detail: { shown: res.items.length } }, req);
  return adminJson(res);
}
