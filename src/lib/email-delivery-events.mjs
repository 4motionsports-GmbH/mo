// Resend delivery events (email.delivered / email.bounced / email.complained /
// email.delivery_delayed) — the pure part: turn a verified webhook payload
// into one normalised record and decide what it means for the address.
//
//   hard bounce  → suppress (reason 'bounce'): the mailbox does not exist
//   complaint    → suppress (reason 'complaint'): the reader hit "spam"
//   soft bounce  → stamp only (full mailbox, greylisting — retry-able)
//   delivered    → stamp only
//
// Resend's payload (2026): { type, created_at, data: { email_id, to: [...],
// bounce?: { type: 'Permanent'|'Transient'|'Undetermined', subType, message },
// ... } }. Tested; the DB side lives in email-delivery-events.ts.

export const DELIVERY_EVENT_TYPES = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.delivery_delayed": "delayed",
};

const normalizeEmail = (s) => String(s ?? "").trim().toLowerCase();

/**
 * @param {unknown} evt a verified Resend webhook event
 * @returns {{ kind: "delivered" | "bounced" | "complained" | "delayed", emailId: string | null, recipients: string[], bounceType: "hard" | "soft" | null, message: string | null, occurredAt: string | null } | null}
 *   null when the event is not a delivery event (e.g. email.received, email.sent)
 */
export function parseResendDeliveryEvent(evt) {
  const type = typeof evt?.type === "string" ? evt.type : "";
  const kind = DELIVERY_EVENT_TYPES[type];
  if (!kind) return null;
  const data = evt?.data && typeof evt.data === "object" ? evt.data : {};
  const to = Array.isArray(data.to) ? data.to : typeof data.to === "string" ? [data.to] : [];
  const recipients = [...new Set(to.map(normalizeEmail).filter((e) => e.includes("@")))];
  let bounceType = null;
  let message = null;
  if (kind === "bounced") {
    const b = data.bounce && typeof data.bounce === "object" ? data.bounce : {};
    const t = String(b.type ?? "").toLowerCase();
    // Resend: Permanent = hard, Transient/Undetermined = soft (retry-able).
    bounceType = t === "permanent" ? "hard" : "soft";
    message = typeof b.message === "string" ? b.message.slice(0, 500) : null;
  }
  return {
    kind,
    emailId: typeof data.email_id === "string" && data.email_id ? data.email_id : null,
    recipients,
    bounceType,
    message,
    occurredAt: typeof evt?.created_at === "string" ? evt.created_at : null,
  };
}

/**
 * Which suppression reason (if any) an event earns the address.
 * @param {{ kind: string, bounceType: string | null }} parsed
 * @returns {"bounce" | "complaint" | null}
 */
export function suppressionReasonFor(parsed) {
  if (parsed.kind === "complained") return "complaint";
  if (parsed.kind === "bounced" && parsed.bounceType === "hard") return "bounce";
  return null;
}
