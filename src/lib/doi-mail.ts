// The marketing DOI confirmation mail — one send path for the three opt-in
// routes (/api/capture-email, /api/account/marketing-opt-in,
// /api/chat-marketing-opt-in). Only a request whose upsert CLAIMED the send
// (upsertEmailCapture → doiEmailRequired) calls it; the route releases the
// claim afterwards when the mail did not go out (email-capture-core.mjs →
// shouldReleaseDoiClaim, email-capture-store.ts → releaseDoiClaim).

import { sendEmail, senderAddress } from "./email";
import { outboundThreading } from "./email-inbound";
import { recordSentMessage } from "./email-messages-store";
import { doiEmailBody, doiEmailSubject } from "./consent-copy";
import { withEmailDesign } from "./email-design-context";
import { getCachedEmailDesignForKind } from "./email-design-store";
import { reportError } from "./observability";
import type { Locale } from "./locale";

/** none = never ran; skipped = no mail provider configured (local dev). */
export type DoiSendState = "none" | "sent" | "skipped" | "failed";

/**
 * Render and send the DOI mail for `token`. Never throws for a provider
 * failure (sendEmail reports it; this adds the route's `doi_send` report);
 * a successful send is logged as correspondence (email_messages). NO
 * marketing is permitted until the link is clicked.
 */
export async function sendDoiMail(input: {
  email: string;
  token: string;
  locale: Locale;
  /** getBaseUrl(req) — the confirm link's origin. */
  baseUrl: string;
  /** The calling route, for the error report. */
  route: string;
}): Promise<Exclude<DoiSendState, "none">> {
  // Carry the locale on the confirmation link so the confirm page renders in
  // the same language as the email.
  const confirmUrl = `${input.baseUrl}/api/confirm-marketing?token=${encodeURIComponent(input.token)}&locale=${input.locale}`;
  // Render inside the design selected for this email type (admin
  // Einstellungen); null → classic built-ins. The lawyer-approved DOI copy
  // itself is untouched — only the design around it changes.
  const emailDesign = await getCachedEmailDesignForKind("doi");
  const body = withEmailDesign(emailDesign, () => doiEmailBody(confirmUrl, input.locale));
  const subject = doiEmailSubject(input.locale);
  const threading = outboundThreading();
  const result = await sendEmail({
    to: input.email,
    subject,
    text: body.text,
    html: body.html,
    kind: "doi",
    messageId: threading.messageId,
    replyTo: threading.replyTo,
  });
  if (result.ok) {
    // MIRROR-WRITE (additive, fail-soft): log the DOI mail in the unified mail
    // log. It's correspondence, NOT marketing consent — the consent record
    // still lives only in email_captures.
    await recordSentMessage({
      toAddress: input.email,
      fromAddress: senderAddress() ?? "",
      subject,
      bodyText: body.text,
      bodyHtml: body.html,
      messageId: threading.messageId,
    });
    return "sent";
  }
  if (result.skipped) return "skipped";
  // A real send failure: the opt-in is stored, the route releases the claim,
  // and the next accept mails the link again at once.
  reportError(result.error, { route: input.route, phase: "doi_send" });
  return "failed";
}
