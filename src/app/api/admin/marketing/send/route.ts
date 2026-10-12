// POST /api/admin/marketing/send  { sendId, ignoreContactFrequency? }
//
// Approve & send the (possibly edited) draft THROUGH THE SYSTEM. All the legal
// guarantees live in approveAndSend (lib/marketing-email): the address must be
// DOI-confirmed and not suppressed, a working unsubscribe link is always
// appended, the discount + cart come from the stored row, and the status flips
// to 'sent' with a timestamp. The admin never sends from a personal client.
//
// Contact frequency (lib/contact-frequency.mjs, a warning — not a gate): when
// the person already received the configured number of marketing mails in the
// window, the route answers 409 code 'contact_frequency' with the numbers
// unless the body carries `ignoreContactFrequency: true` (Kunden → Marketing
// asks first). A failed count never stops a send.
//
// Auth + CSRF via guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { approveAndSend } from "@/lib/marketing-email";
import { contactFrequencyWarningForMarketingSend } from "@/lib/admin-settings-store";
import { contactFrequencyConflict } from "@/lib/contact-frequency.mjs";
import { reportError } from "@/lib/observability";

export const maxDuration = 30;

// Map the domain refusal reasons to HTTP statuses.
const STATUS_BY_REASON: Record<string, number> = {
  not_found: 404,
  already_sent: 409,
  not_eligible: 409,
  too_soon: 429,
  no_unsubscribe: 503,
  claim_failed: 409,
  discount_mismatch: 409,
  discount_failed: 502,
  email_not_configured: 503,
  send_failed: 502,
};

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let sendId: number;
  let ignoreContactFrequency = false;
  try {
    const json = (await req.json()) as { sendId?: unknown; ignoreContactFrequency?: unknown };
    sendId = Number(json.sendId);
    ignoreContactFrequency = json.ignoreContactFrequency === true;
    if (!Number.isInteger(sendId) || sendId <= 0) {
      return adminJsonError("bad_request", "sendId required", 400);
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    if (!ignoreContactFrequency) {
      const warning = await contactFrequencyWarningForMarketingSend(sendId);
      if (warning) return adminJson(contactFrequencyConflict(warning), 409);
    }
    const result = await approveAndSend(sendId);
    if (result.ok) {
      return adminJson({ ok: true, sentTo: result.sentTo });
    }
    const status = STATUS_BY_REASON[result.reason] ?? 400;
    return adminJsonError(result.reason, result.message, status);
  } catch (err) {
    reportError(err, { route: "api/admin/marketing/send" });
    return adminJsonError("internal_error", "Send failed.", 500);
  }
}
