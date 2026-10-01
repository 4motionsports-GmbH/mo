// POST /api/admin/customers/ask  { customerId, question } → { answer, confident, citations, sourcesTotal, sourcesUsed }
//
// „Frag Mo“ (Kunden → Aktivität): a question about one customer, answered
// from that person's record with the sources cited. Writer tier, one call.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { askAboutCustomer } from "@/lib/customer-ask";
import { recordAdminAccess } from "@/lib/admin-access-log";

export const maxDuration = 60;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  let body: { customerId?: unknown; question?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }
  const customerId = Number(body.customerId);
  if (!Number.isInteger(customerId) || customerId <= 0) return adminJsonError("bad_request", "customerId required", 400);
  if (typeof body.question !== "string") return adminJsonError("bad_request", "question required", 400);
  const res = await askAboutCustomer(customerId, body.question);
  if (res.ok) await recordAdminAccess({ action: "customer.ask", targetCustomerId: customerId }, req);
  if (!res.ok) return adminJsonError(res.status === 400 ? "bad_request" : res.status === 404 ? "not_found" : "upstream_unavailable", res.message, res.status);
  return adminJson(res);
}
