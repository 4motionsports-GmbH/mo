// POST /api/admin/correspondence/assign-prospect  { messageId } → { customerId, itemId }
//
// „Als Interessent anlegen“ in the Eingang card „E-Mails nicht zugeordnet“:
// the sender is nobody in the customer base yet (a new enquiry, someone
// writing from another address), so the operator takes them on — a prospect
// is created from the sender address (findOrCreateProspect: no consent, an
// existing customer is reused), the mail moves into their Korrespondenz and
// opens the Eingang item „E-Mail beantworten“ with the reply draft.
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { findOrCreateProspect } from "@/lib/customer-store";
import { assignInboundToCustomer, getMessageHeaders } from "@/lib/email-messages-store";
import { extractEmailAddress } from "@/lib/email-inbound-core.mjs";
import { noteInboundMail } from "@/lib/inbox-mail";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  let messageId: number;
  try {
    messageId = Number(((await req.json()) as { messageId?: unknown }).messageId);
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }
  if (!Number.isInteger(messageId) || messageId <= 0) return adminJsonError("bad_request", "messageId required", 400);

  try {
    const headers = await getMessageHeaders(messageId);
    if (!headers) return adminJsonError("not_found", "Nachricht nicht gefunden.", 404);
    if (headers.customerId != null) {
      return adminJsonError("conflict", "Diese Nachricht ist bereits einem Kunden zugeordnet.", 409);
    }
    const email = extractEmailAddress(headers.fromAddress) || headers.fromAddress;
    const customerId = await findOrCreateProspect({ email });
    if (customerId == null) return adminJsonError("bad_request", "Die Absenderadresse ist ungültig.", 400);

    const result = await assignInboundToCustomer(messageId, customerId);
    if (!result.ok) {
      if (result.reason === "not_unmatched") {
        return adminJsonError("conflict", "Diese Nachricht ist bereits einem Kunden zugeordnet.", 409);
      }
      return adminJsonError("internal_error", "Zuordnung fehlgeschlagen.", 500);
    }
    const itemId = await noteInboundMail({
      customerId,
      emailMessageId: messageId,
      subject: result.subject,
      snippet: result.snippet,
      occurredAt: result.occurredAt,
      source: result.provider === "kontaktformular" ? "kontaktformular" : "email",
    });
    await recordAdminAccess({ action: "correspondence.assign_prospect", targetCustomerId: customerId, detail: { messageId } }, req);
    return adminJson({ ok: true, customerId, itemId });
  } catch (err) {
    reportError(err, { route: "api/admin/correspondence/assign-prospect" });
    return adminJsonError("internal_error", "Anlegen fehlgeschlagen.", 500);
  }
}
