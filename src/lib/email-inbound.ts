// Inbound-email configuration + the outbound threading seam.
//
// The inbound address is read from ENV (currently a TEST address) and NEVER
// hardcoded, so the production swap is env-only. It is the `Reply-To` we stamp
// on outbound mail so a customer's reply routes to Resend Inbound and threads
// back onto the originating row (see /api/inbound/resend + the mirror-writes).

import { senderAddress } from "./email";
import { generateMessageId, sanitizeDomain } from "./email-inbound-core.mjs";

/**
 * The address Resend Inbound receives replies on, e.g.
 * `bot@chat.motionsports.de` (a DEDICATED inbound subdomain — never the
 * corporate MX). Read from ENV; undefined when inbound isn't configured yet, in
 * which case outbound mail simply omits the Reply-To (no behaviour change).
 */
export function inboundEmailAddress(): string | undefined {
  return process.env.INBOUND_EMAIL_ADDRESS?.trim() || undefined;
}

/** The Svix signing secret for the inbound webhook (whsec_…). */
export function inboundWebhookSecret(): string | undefined {
  return process.env.RESEND_WEBHOOK_SECRET?.trim() || undefined;
}

/** Domain used to mint our outbound Message-IDs — taken from the verified sender. */
function outboundMessageIdDomain(): string {
  return sanitizeDomain(senderAddress() ?? "") || "motionsports.de";
}

export interface OutboundThreading {
  /** The Message-ID we set on the outbound mail AND store on the 'sent' row. */
  messageId: string;
  /** Reply-To pointing at the inbound address — undefined when not configured. */
  replyTo: string | undefined;
}

/**
 * The threading fields for a NEW outbound mail (transactional/marketing): a
 * freshly-minted Message-ID plus the inbound Reply-To. The send site passes
 * `messageId` to sendEmail (so it ships on the wire) AND to recordSentMessage
 * (so the stored row's message_id matches what went out, and the eventual reply
 * threads back). Reply-To is included only when an inbound address is set.
 */
export function outboundThreading(): OutboundThreading {
  return {
    messageId: generateMessageId(outboundMessageIdDomain()),
    replyTo: inboundEmailAddress(),
  };
}
