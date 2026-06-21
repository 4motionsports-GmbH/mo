// GET /api/account/export — the signed-in (tier-3) customer's full data export.
//
// The machine-readable Art. 15 (access) / Art. 20 (portability) companion to the
// per-thread PDF summary: a single JSON document of EVERYTHING this system holds
// about the caller — profile, consent records, conversations + transcripts,
// correspondence, letters, marketing sends, bundle offers, feedback, suppression
// status. Delivered as a downloadable attachment.
//
// Gated by the CA-1 signed-in resolver (origin + secret + a LIVE access token);
// scoped strictly to the resolved customer id, so an anonymous / tier-2 / foreign
// request fails closed (401). See LEGAL_READINESS_REPORT §8 OQ-11.

import { preflightResponse } from "@/lib/security";
import { errorResponse, reportError } from "@/lib/observability";
import { requireSignedInCustomer } from "@/lib/account-guard";
import { buildCustomerDataExport } from "@/lib/account-export";
import { resolveLocale } from "@/lib/locale";
import { apiMessage } from "@/lib/api-messages.mjs";

export const runtime = "nodejs";
export const maxDuration = 30;

const METHODS = "GET, OPTIONS";

export async function OPTIONS(req: Request) {
  return preflightResponse(req, METHODS);
}

export async function GET(req: Request) {
  const guard = await requireSignedInCustomer(req, METHODS);
  if (!guard.ok) return guard.response;

  const locale = resolveLocale(req);

  try {
    const data = await buildCustomerDataExport(guard.customerId);
    if (!data) {
      return errorResponse(
        "upstream_unavailable",
        apiMessage("export_failed", locale),
        503,
        guard.headers
      );
    }
    const body = JSON.stringify(data, null, 2);
    const filename =
      locale === "en" ? "motionsports-my-data.json" : "motionsports-meine-daten.json";
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        ...guard.headers,
      },
    });
  } catch (err) {
    reportError(err, { route: "api/account/export" });
    return errorResponse("internal_error", "Unexpected server error", 500, guard.headers);
  }
}
