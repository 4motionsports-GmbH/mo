// POST /api/admin/correspondence/send
//   { customerId, subject, body, inReplyToMessageId? }
//
// Compose / reply from the per-customer Korrespondenz panel (§5). REUSE, don't
// fork: it goes through the EXISTING sendEmail() choke-point (sender, logging,
// failure handling are centralised there) and the existing 10D-1 mirror-write
// (recordSentMessage) logs the 'sent' row. A reply sets In-Reply-To/References
// from the message being answered and a Reply-To of our inbound address so the
// NEXT reply threads back; it adopts the parent's thread_id so the sent row
// lands in the same conversation. A fresh compose starts its own thread.
//
// This is plain correspondence — it does NOT touch marketing eligibility /
// lockout / send-guarantees. It does not mint discounts or append a campaign
// footer; it sends exactly the operator's text.
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { getCustomerById } from "@/lib/customer-store";
import { getMessageHeaders, recordSentMessage } from "@/lib/email-messages-store";
import { sendEmail, senderAddress, isEmailConfigured } from "@/lib/email";
import { outboundThreading } from "@/lib/email-inbound";
import {
  buildReplyReferences,
  ensureAngle,
  replySubject,
} from "@/lib/email-inbound-core.mjs";
import { reportError } from "@/lib/observability";

export const maxDuration = 30;

const MAX_BODY = 20_000;
const MAX_SUBJECT = 300;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let customerId: number;
  let subject: string;
  let body: string;
  let inReplyToMessageId: number | null;
  try {
    const parsed = (await req.json()) as {
      customerId?: unknown;
      subject?: unknown;
      body?: unknown;
      inReplyToMessageId?: unknown;
    };
    customerId = Number(parsed.customerId);
    subject = typeof parsed.subject === "string" ? parsed.subject.trim() : "";
    body = typeof parsed.body === "string" ? parsed.body : "";
    inReplyToMessageId =
      parsed.inReplyToMessageId == null ? null : Number(parsed.inReplyToMessageId);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return adminJsonError("bad_request", "customerId required", 400);
    }
    if (!body.trim()) {
      return adminJsonError("bad_request", "Nachrichtentext darf nicht leer sein.", 400);
    }
    if (inReplyToMessageId != null && !Number.isInteger(inReplyToMessageId)) {
      return adminJsonError("bad_request", "inReplyToMessageId invalid", 400);
    }
    body = body.slice(0, MAX_BODY);
    subject = subject.slice(0, MAX_SUBJECT);
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  if (!isEmailConfigured()) {
    return adminJsonError(
      "email_not_configured",
      "E-Mail-Versand ist nicht konfiguriert (RESEND_API_KEY / Absender).",
      503
    );
  }

  try {
    const customer = await getCustomerById(customerId);
    if (!customer) return adminJsonError("not_found", "Kunde nicht gefunden.", 404);

    // Reply threading: pull the parent's Message-ID / References / thread / subject.
    let inReplyTo: string | undefined;
    let references: string[] = [];
    let threadId: string | null = null;
    if (inReplyToMessageId != null) {
      const parent = await getMessageHeaders(inReplyToMessageId);
      if (!parent) return adminJsonError("not_found", "Bezugsnachricht nicht gefunden.", 404);
      if (parent.customerId !== customerId) {
        return adminJsonError(
          "bad_request",
          "Die Bezugsnachricht gehört zu einem anderen Kunden.",
          400
        );
      }
      inReplyTo = ensureAngle(parent.messageId) || undefined;
      // Stored (bracket-stripped) reference chain for the row…
      references = buildReplyReferences(parent.references, parent.messageId);
      threadId = parent.threadId;
      if (!subject) subject = replySubject(parent.subject ?? "");
    }
    if (!subject) subject = "motion sports";

    // Our own Message-ID + the inbound Reply-To so the next reply threads back.
    const threading = outboundThreading();
    const { text, html } = renderCorrespondenceEmail(body);

    const result = await sendEmail({
      to: customer.email,
      subject,
      text,
      html,
      kind: "correspondence",
      messageId: threading.messageId,
      replyTo: threading.replyTo,
      inReplyTo,
      // Angle-bracket the stored chain for the wire.
      references: references.length > 0 ? references.map((r) => ensureAngle(r)) : undefined,
    });

    if (!result.ok) {
      if (result.skipped) {
        return adminJsonError(
          "email_not_configured",
          "E-Mail-Versand ist nicht konfiguriert.",
          503
        );
      }
      return adminJsonError("send_failed", "E-Mail konnte nicht gesendet werden.", 502);
    }

    // MIRROR-WRITE (additive, fail-soft): log the 'sent' row, joined to the
    // parent's thread when this was a reply.
    await recordSentMessage({
      toAddress: customer.email,
      fromAddress: senderAddress() ?? "",
      subject,
      bodyText: text,
      bodyHtml: html,
      messageId: threading.messageId,
      customerId,
      inReplyTo: inReplyTo ?? null,
      references,
      threadId: threadId ?? threading.messageId,
    });

    return adminJson({ ok: true, sentTo: customer.email, threaded: inReplyToMessageId != null });
  } catch (err) {
    reportError(err, { route: "api/admin/correspondence/send" });
    return adminJsonError("internal_error", "Senden fehlgeschlagen.", 500);
  }
}

// A DELIBERATELY minimal text+HTML pair for correspondence — NOT the marketing
// template (no cart button, no discount, no unsubscribe footer). The body is the
// operator's plain text; the HTML escapes it and turns newlines into <br/> so
// there is no HTML-injection surface (mirrors the sanitized-render discipline of
// the admin Markdown renderer). The reply still reads the inbound Reply-To.
function renderCorrespondenceEmail(body: string): { text: string; html: string } {
  const escaped = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const html =
    `<div style="font-family:system-ui,Segoe UI,Helvetica,Arial,sans-serif;` +
    `font-size:15px;line-height:1.6;color:#111;white-space:pre-wrap;">` +
    escaped +
    `</div>`;
  return { text: body, html };
}
