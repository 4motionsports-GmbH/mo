// POST /api/admin/physical/send  { customerId }
//
// "Brief senden" — submit a PHYSICAL letter for a customer using their SEPARATE
// letter draft (distinct from the email). All gates live in sendPhysicalLetter
// (lib/physical-mail): the PHYSICAL_MAIL_SENDS_APPROVED flag (Pingen is a new
// processor → CH → DP), a COMPLETE lawfully-held postal address (never
// part-filled), a generated letter draft, then the Pingen uploadAndCreate submit
// (Idempotency-Key keyed by the row).
//
// Auth + CSRF via guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { sendPhysicalLetter } from "@/lib/physical-mail";
import { reportError } from "@/lib/observability";

export const maxDuration = 30;

// Map the domain refusal reasons to HTTP statuses.
const STATUS_BY_REASON: Record<string, number> = {
  not_found: 404,
  no_draft: 409,
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

  let customerId: number;
  try {
    const json = (await req.json()) as { customerId?: unknown };
    customerId = Number(json.customerId);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return adminJsonError("bad_request", "customerId required", 400);
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    const result = await sendPhysicalLetter(customerId);
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
