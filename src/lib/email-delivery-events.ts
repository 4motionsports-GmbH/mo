// Resend delivery events — the DB side: suppress the address on hard
// bounces / complaints and stamp the campaign send the event belongs to.
// Shared by api/webhooks/resend and the inbound route (either Resend webhook
// may carry these events, depending on how it is configured).

import { unsubscribeByEmail } from "./email-capture-store";
import { stampCampaignDelivery } from "./campaign-store";
import { parseResendDeliveryEvent, suppressionReasonFor } from "./email-delivery-events.mjs";
import { reportError } from "./observability";

export interface DeliveryEventOutcome {
  kind: string;
  recipients: number;
  suppressed: number;
  campaignSendsStamped: number;
}

/**
 * Apply one verified Resend event. Returns null when it is not a delivery
 * event. Never throws — a storage hiccup must not make Resend retry forever;
 * failures are reported and the event is acknowledged.
 */
export async function applyResendDeliveryEvent(evt: unknown): Promise<DeliveryEventOutcome | null> {
  const parsed = parseResendDeliveryEvent(evt);
  if (!parsed) return null;
  let suppressed = 0;
  let stamped = 0;
  const reason = suppressionReasonFor(parsed);
  for (const email of parsed.recipients) {
    if (reason) {
      try {
        if (await unsubscribeByEmail(email, reason)) suppressed++;
      } catch (err) {
        reportError(err, { route: "lib/email-delivery-events", phase: `suppress:${reason}` });
      }
    }
  }
  try {
    stamped = await stampCampaignDelivery({
      kind: parsed.kind,
      emailId: parsed.emailId,
      recipients: parsed.recipients,
      bounceType: parsed.bounceType,
    });
  } catch (err) {
    reportError(err, { route: "lib/email-delivery-events", phase: "stamp" });
  }
  return { kind: parsed.kind, recipients: parsed.recipients.length, suppressed, campaignSendsStamped: stamped };
}
