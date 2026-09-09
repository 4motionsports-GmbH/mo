// GET /api/admin/customers/detail?id=<customerId> — one customer's full detail
// for the Kunden screen (loaded when the operator opens a customer, instead of
// shipping every customer's detail with the list). Read-only.

import { guardAdminGet, adminJson, adminJsonError } from "@/lib/admin-api";
import { loadCustomerDetail } from "@/lib/customer-detail";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const blocked = await guardAdminGet();
  if (blocked) return blocked;

  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return adminJsonError("bad_request", "id erforderlich.", 400);
  }
  const customer = await loadCustomerDetail(id);
  if (!customer) return adminJsonError("not_found", "Kunde nicht gefunden.", 404);
  return adminJson({ customer });
}
