// POST /api/admin/physical/send  { sendId }
//
// "Brief senden" — submit a PHYSICAL letter for an existing per-customer
// marketing draft. All gates live in sendPhysicalLetterForSend (lib/physical-mail):
// the PHYSICAL_MAIL_SENDS_APPROVED flag (Pingen is a new processor → CH → DP), a
// COMPLETE lawfully-held postal address (never part-filled), the SAME
// personalised content as the email draft rendered to a letter PDF, and the
// Pingen uploadAndCreate submit (Idempotency-Key keyed by the row).
//
// Auth + CSRF via guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { sendPhysicalLetterForSend } from "@/lib/physical-mail";
import { reportError } from "@/lib/observability";

export const maxDuration = 30;

// Map the domain refusal reasons to HTTP statuses.
const STATUS_BY_REASON: Record<string, number> = {
  not_found: 404,
  flag_off: 403,
  no_address: 409,
  incomplete_address: 409,
  pingen_not_configured: 503,
  submit_failed: 502,
  store_failed: 500,
};

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let sendId: number;
  try {
    const json = (await req.json()) as { sendId?: unknown };
    sendId = Number(json.sendId);
    if (!Number.isInteger(sendId) || sendId <= 0) {
      return adminJsonError("bad_request", "sendId required", 400);
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    const result = await sendPhysicalLetterForSend(sendId);
    if (result.ok) {
      return adminJson({
        ok: true,
        letterId: result.letterId,
        providerLetterId: result.providerLetterId,
        status: result.status,
      });
    }
    const status = STATUS_BY_REASON[result.reason] ?? 400;
    return adminJsonError(result.reason, result.message, status);
  } catch (err) {
    reportError(err, { route: "api/admin/physical/send" });
    return adminJsonError("internal_error", "Versand fehlgeschlagen.", 500);
  }
}
