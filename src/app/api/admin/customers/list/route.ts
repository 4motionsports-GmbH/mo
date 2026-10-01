// GET /api/admin/customers/list?kq=&kview=&…  → { items, total, page, pageSize }
//
// The Kunden list as JSON (the same URL parameters as the screen,
// lib/admin-customer-filter.mjs) — for pickers and the Eingang. The screen
// itself renders the list on the server.

import { guardAdminGet, adminJson } from "@/lib/admin-api";
import { listCustomers } from "@/lib/customer-list-store";
import { CUSTOMER_PAGE_SIZE, parseCustomerFilter } from "@/lib/admin-customer-filter.mjs";

export async function GET(req: Request) {
  const blocked = await guardAdminGet();
  if (blocked) return blocked;
  const filter = parseCustomerFilter(new URL(req.url).searchParams);
  const page = await listCustomers(filter);
  return adminJson({ ...page, page: filter.page, pageSize: CUSTOMER_PAGE_SIZE });
}
