// POST /api/admin/correspondence/assign  { messageId, customerId }
//
// The "Unmatched inbound" queue's only action (§5): attach a received message
// from an unknown address to a customer. Sets customer_id and re-threads (adopts
// the referenced conversation's thread_id when we hold it), so the message moves
// out of the global queue and into that customer's Korrespondenz panel.
//
// Korrespondenz only — no consent gate touched.
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { getCustomerById } from "@/lib/customer-store";
import { assignInboundToCustomer } from "@/lib/email-messages-store";
import { reportError } from "@/lib/observability";

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let messageId: number;
  let customerId: number;
  try {
    const body = (await req.json()) as { messageId?: unknown; customerId?: unknown };
    messageId = Number(body.messageId);
    customerId = Number(body.customerId);
    if (!Number.isInteger(messageId) || messageId <= 0) {
      return adminJsonError("bad_request", "messageId required", 400);
    }
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return adminJsonError("bad_request", "customerId required", 400);
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    const customer = await getCustomerById(customerId);
    if (!customer) return adminJsonError("not_found", "Kunde nicht gefunden.", 404);

    const result = await assignInboundToCustomer(messageId, customerId);
    if (!result.ok) {
      if (result.reason === "not_found") {
        return adminJsonError("not_found", "Nachricht nicht gefunden.", 404);
      }
      if (result.reason === "not_unmatched") {
        return adminJsonError(
          "conflict",
          "Diese Nachricht ist bereits einem Kunden zugeordnet.",
          409
        );
      }
      return adminJsonError("internal_error", "Zuordnung fehlgeschlagen.", 500);
    }

    return adminJson({ ok: true, customerId, customerEmail: customer.email });
  } catch (err) {
    reportError(err, { route: "api/admin/correspondence/assign" });
    return adminJsonError("internal_error", "Zuordnung fehlgeschlagen.", 500);
  }
}
