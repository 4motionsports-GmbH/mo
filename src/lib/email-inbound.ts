// Inbound-email configuration + the outbound threading seam.
//
// The inbound address (INBOUND_EMAIL_ADDRESS) is read from ENV and NEVER
// hardcoded, so switching it is env-only. A customer's reply must end up at
// Resend Inbound (the webhook /api/inbound/resend) with its headers intact, so
// it threads back onto the originating row by In-Reply-To / References. Two
// setups work:
//   - the Resend receiving address on a dedicated subdomain (MX at Resend),
//     e.g. hello@reply.motionsports.de — stamped as the Reply-To;
//   - the public address, e.g. mo@motionsports.de, when the corporate mail
//     server REDIRECTS it unchanged to that receiving address (a redirect keeps
//     From and the threading headers; a „Weiterleitung“/forward does not and
//     arrives From Mo itself — the webhook then reports phase 'own-address').
//     When it equals the From address, no Reply-To is set (replyToFor).
// Never move the root domain's MX to Resend: Resend receiving takes ALL mail
// of the domain, the corporate mailboxes included.

import { senderAddress } from "./email";
import { generateMessageId, sanitizeDomain } from "./email-inbound-core.mjs";
import { replyToFor } from "./email-sender.mjs";

/**
 * Where customer replies go: the Resend receiving address on a dedicated
 * subdomain (`hello@reply.motionsports.de`), or the public address
 * (`mo@motionsports.de`) that the corporate mail server redirects unchanged to
 * it. Read from ENV; undefined when inbound isn't configured yet. Outbound mail
 * carries it as Reply-To unless it is unset or equal to the From address
 * (email-sender.mjs replyToFor).
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
  /**
   * Reply-To pointing at the inbound address — undefined when not configured
   * or when it is the From address itself (email-sender.mjs replyToFor).
   */
  replyTo: string | undefined;
}

/**
 * The threading fields for a NEW outbound mail (transactional/marketing): a
 * freshly-minted Message-ID plus the inbound Reply-To. The send site passes
 * `messageId` to sendEmail (so it ships on the wire) AND to recordSentMessage
 * (so the stored row's message_id matches what went out, and the eventual reply
 * threads back). Reply-To is included only when an inbound address is set
 * and differs from the From address.
 */
export function outboundThreading(): OutboundThreading {
  return {
    messageId: generateMessageId(outboundMessageIdDomain()),
    replyTo: replyToFor(inboundEmailAddress(), senderAddress()),
  };
}
