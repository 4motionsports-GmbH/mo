// POST /api/admin/customers/marketing-optout
//   { customerId } | { contactId }, action: "optout" | "lift", confirm: true
//
// Manual control over a person's marketing opt-out (lib/marketing-optout.ts):
// "Abmelden" on the person's request, or "Abmeldung aufheben" when an
// unsubscribe was a mistake or has been taken back. Works for a customer
// (Kunden) and a Kampagne contact. Sends no e-mail in either direction.
// Bounces, spam complaints and erasures cannot be lifted (409).
//
// Auth + CSRF: guardAdminPost. Audit-logged as customer.optout /
// customer.optout.lift with the numeric id only.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { getCustomerById } from "@/lib/customer-store";
import { getContactById } from "@/lib/campaign-store";
import { liftOptOut, optOutManually } from "@/lib/marketing-optout";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";

export const maxDuration = 15;

function positiveInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let customerId: number | null;
  let contactId: number | null;
  let action: "optout" | "lift";
  try {
    const body = (await req.json()) as {
      customerId?: unknown;
      contactId?: unknown;
      action?: unknown;
      confirm?: unknown;
    };
    customerId = positiveInt(body.customerId);
    contactId = positiveInt(body.contactId);
    if (!customerId && !contactId) {
      return adminJsonError("bad_request", "customerId or contactId required", 400);
    }
    if (body.action !== "optout" && body.action !== "lift") {
      return adminJsonError("bad_request", "action must be optout or lift", 400);
    }
    action = body.action;
    if (body.confirm !== true) {
      return adminJsonError("not_confirmed", "Die Änderung muss bestätigt werden.", 400);
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    let email: string | null = null;
    let targetCustomerId = customerId;
    if (customerId) {
      email = (await getCustomerById(customerId))?.email ?? null;
    } else if (contactId) {
      const contact = await getContactById(contactId);
      if (contact?.isTest) {
        return adminJsonError("test_contact", "Testkontakte sind von Abmeldungen ausgenommen.", 400);
      }
      email = contact?.email ?? null;
      targetCustomerId = contact?.customerId ?? null;
    }
    if (!email) return adminJsonError("not_found", "Person nicht gefunden.", 404);
    if (email.startsWith("shopify:")) {
      return adminJsonError("no_email", "Für diesen Kunden ist keine E-Mail-Adresse bekannt.", 400);
    }

    await recordAdminAccess(
      {
        action: action === "lift" ? "customer.optout.lift" : "customer.optout",
        targetCustomerId,
        detail: contactId ? { contactId } : {},
      },
      req
    );

    if (action === "optout") {
      const state = await optOutManually(email);
      if (!state) return adminJsonError("unavailable", "Abmelden fehlgeschlagen — es wurde nichts geändert.", 503);
      return adminJson({ ok: true, state });
    }

    const result = await liftOptOut(email);
    if (!result.ok) {
      const status = result.reason === "unavailable" ? 503 : 409;
      return adminJsonError(result.reason, result.message, status);
    }
    const contactStatus = contactId ? ((await getContactById(contactId))?.status ?? null) : null;
    return adminJson({
      ok: true,
      state: result.state,
      restoredContacts: result.restoredContacts,
      contactStatus,
    });
  } catch (err) {
    reportError(err, { route: "api/admin/customers/marketing-optout" });
    return adminJsonError("internal_error", "Änderung fehlgeschlagen.", 500);
  }
}
