// POST /api/admin/customers/erase  { customerId } | { contactId }, confirm: true
//
// "Kunde vollständig löschen" — the operator's side of the one erasure path
// (lib/customer-erasure.ts), the same deletion the widget button and the
// mail-footer link run. Accepts a customer (Kunden detail) or a Kampagne
// contact (Kampagne card; its customer goes with it). Irreversible, so the UI
// confirms first and the body must carry confirm: true.
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*). The
// action is written to the admin access log BEFORE the erasure (numeric id
// only — the log must not keep the personal data we are deleting).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { erasePerson } from "@/lib/customer-erasure";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";

export const maxDuration = 30;

function positiveInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let customerId: number | null;
  let contactId: number | null;
  try {
    const body = (await req.json()) as { customerId?: unknown; contactId?: unknown; confirm?: unknown };
    customerId = positiveInt(body.customerId);
    contactId = positiveInt(body.contactId);
    if (!customerId && !contactId) {
      return adminJsonError("bad_request", "customerId or contactId required", 400);
    }
    if (body.confirm !== true) {
      return adminJsonError("not_confirmed", "Löschen muss bestätigt werden.", 400);
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    await recordAdminAccess(
      {
        action: "customer.erase",
        targetCustomerId: customerId,
        detail: contactId ? { contactId } : {},
      },
      req
    );
    const result = await erasePerson({ customerId, campaignContactId: contactId });
    if (!result) {
      return adminJsonError("erase_failed", "Löschen fehlgeschlagen — es wurde nichts gelöscht.", 503);
    }
    return adminJson({ ok: true, ...result });
  } catch (err) {
    reportError(err, { route: "api/admin/customers/erase" });
    return adminJsonError("internal_error", "Löschen fehlgeschlagen.", 500);
  }
}
