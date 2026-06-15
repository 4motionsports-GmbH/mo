// POST /api/admin/bestandskunden/test-send — send ONE §7 Abs. 3 UWG existing-
// customer email to an admin-supplied TEST recipient (never a real customer),
// for verifying the §7(3) pipeline before legal sign-off.
//
// The real send gate is enforced UNCHANGED:
//   1. BESTANDSKUNDE_SENDS_APPROVED must be on (the operator's master switch),
//   2. the chosen customer must be §7(3)-eligible (a completed purchase) AND
//      must not have objected — checked via canSendBestandskundenMail().
// Only the DELIVERY address is overridden to the test inbox, so nothing reaches
// a real customer and no Korrespondenz row is written. The email still carries
// the mandatory objection notice + opt-out link, signed for the REAL customer's
// address, so the opt-out flow can be exercised too.
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { getCustomerById } from "@/lib/customer-store";
import {
  buildBestandskundeOptOutToken,
  canSendBestandskundenMail,
} from "@/lib/bestandskunden-store";
import { isBestandskundenSendsApproved } from "@/lib/bestandskunden.mjs";
import { buildBestandskundeTestEmail } from "@/lib/bestandskunde-email";
import { getBaseUrl } from "@/lib/base-url";
import { sendEmail } from "@/lib/email";
import { reportError } from "@/lib/observability";

export const maxDuration = 30;

// Deliberately loose — just enough to reject obvious garbage before we hand the
// address to Resend (the real validation is Resend's).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let customerId: number;
  let testRecipient: string;
  try {
    const body = (await req.json()) as {
      customerId?: unknown;
      testRecipient?: unknown;
    };
    customerId = Number(body.customerId);
    testRecipient =
      typeof body.testRecipient === "string" ? body.testRecipient.trim() : "";
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return adminJsonError("bad_request", "customerId required", 400);
    }
    if (!EMAIL_RE.test(testRecipient)) {
      return adminJsonError("bad_request", "A valid testRecipient email is required", 400);
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    // Gate 1 — the master switch. Distinct error so the operator knows to flip it.
    if (!isBestandskundenSendsApproved()) {
      return adminJsonError(
        "forbidden",
        "BESTANDSKUNDE_SENDS_APPROVED is off — set it (e.g. =1) to test §7(3) sends.",
        403
      );
    }

    const customer = await getCustomerById(customerId);
    if (!customer?.email) {
      return adminJsonError("not_found", "Customer not found", 404);
    }

    // Gate 2 — the real §7(3) chokepoint on the chosen customer (eligibility +
    // not-objected). Same check a real send would pass; only delivery differs.
    const allowed = await canSendBestandskundenMail(customer.email);
    if (!allowed) {
      return adminJsonError(
        "forbidden",
        "Customer is not §7(3)-eligible (no completed purchase cached) or has objected.",
        403
      );
    }

    const token = buildBestandskundeOptOutToken(customer.email);
    if (!token) {
      return adminJsonError(
        "internal_error",
        "Opt-out signing not configured (UNSUBSCRIBE_SECRET / CHAT_SHARED_SECRET).",
        500
      );
    }
    const optOutUrl = `${getBaseUrl(req)}/api/unsubscribe/bestandskunde?token=${encodeURIComponent(token)}`;

    const email = buildBestandskundeTestEmail({ optOutUrl, isTest: true });
    const result = await sendEmail({
      kind: "bestandskunde-test",
      to: testRecipient,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });

    if (result.ok) {
      return adminJson({
        ok: true,
        sentTo: testRecipient,
        customerId,
        messageId: result.id ?? null,
      });
    }
    if (result.skipped) {
      // Resend not configured (local dev) — be honest, don't claim a send.
      return adminJson({ ok: false, skipped: true, reason: "email_not_configured" });
    }
    return adminJsonError("upstream_unavailable", "Send failed", 502);
  } catch (err) {
    reportError(err, { route: "api/admin/bestandskunden/test-send" });
    return adminJsonError("internal_error", "Unexpected server error", 500);
  }
}
