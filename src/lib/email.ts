// Centralised transactional/marketing email sending via Resend.
//
// Every send here is DEFENSIVE: a failure is always logged via reportError and
// surfaced to the caller through the returned result — never silently lost. The
// caller decides how to react (e.g. a 502 to the widget, or a logged-but-
// tolerated DOI failure). When Resend isn't configured we DO NOT pretend the
// mail was sent: we return `{ ok: false, skipped: true }` so the caller can
// fall back to a local-dev log and respond honestly.
//
// The sender is the client's verified Resend sender (CONTACT_FROM_EMAIL),
// reused from the contact form so the whole backend speaks with one voice.

import { Resend } from "resend";
import { reportError } from "./observability";

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  /**
   * Our own RFC-5322 Message-ID (e.g. "<hex@motionsports.de>"). Set on the wire
   * as a custom header so the reply that comes back carries it in
   * In-Reply-To/References and threads onto the originating row. Additive —
   * callers that don't thread (e.g. the contact form) simply omit it.
   */
  messageId?: string;
  /** Tag used in error logs to identify which mail failed. */
  kind: string;
}

export type SendEmailResult =
  | { ok: true; id?: string }
  | { ok: false; skipped: true } // Resend not configured (local-dev)
  | { ok: false; skipped: false; error: unknown };

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && senderAddress());
}

/** The verified Resend sender, e.g. "motion sports <kontakt@motionsports.de>". */
export function senderAddress(): string | undefined {
  return process.env.CONTACT_FROM_EMAIL || undefined;
}

/**
 * Send one email. Returns a discriminated result; NEVER throws. On failure it
 * has already called reportError, so callers only need to decide how to surface
 * it to the user.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = senderAddress();

  if (!apiKey || !from) {
    // Local-dev fallback: there's nothing to send through. Be honest about it.
    console.log(
      `[email:${input.kind}] not sent — RESEND_API_KEY/CONTACT_FROM_EMAIL not set`,
      { to: input.to, subject: input.subject }
    );
    return { ok: false, skipped: true };
  }

  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      ...(input.messageId ? { headers: { "Message-ID": input.messageId } } : {}),
    });
    if (result.error) {
      reportError(result.error, { route: "lib/email", kind: input.kind, phase: "resend" });
      return { ok: false, skipped: false, error: result.error };
    }
    return { ok: true, id: result.data?.id };
  } catch (err) {
    reportError(err, { route: "lib/email", kind: input.kind, phase: "resend" });
    return { ok: false, skipped: false, error: err };
  }
}
