// GET /api/confirm-marketing?token=... — the double-opt-in confirmation link.
//
// Clicked by the user as a top-level navigation from the DOI email, so this is
// NOT a cross-origin XHR: no CORS allowlist or shared-secret guard applies. It
// validates the token, flips marketing_doi_status to 'confirmed', records
// doi_confirmed_at, and renders a simple confirmation page. Tokens expire after
// MARKETING_DOI_EXPIRY_DAYS (default 7).
//
// Until this runs, NO marketing email is permitted for the address.

import { confirmMarketingByToken } from "@/lib/email-capture-store";
import { reportError } from "@/lib/observability";
import {
  DOI_CONFIRMED_BODY,
  DOI_CONFIRMED_HEADING,
  DOI_INVALID_BODY,
  DOI_INVALID_HEADING,
} from "@/lib/consent-copy";
import { renderResultPage } from "@/lib/result-page";

export const maxDuration = 10;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";

  try {
    if (!token.trim()) {
      return renderResultPage({
        status: 400,
        heading: DOI_INVALID_HEADING,
        body: DOI_INVALID_BODY,
        tone: "error",
      });
    }

    const result = await confirmMarketingByToken(token);
    if (result.ok) {
      return renderResultPage({
        status: 200,
        heading: DOI_CONFIRMED_HEADING,
        body: DOI_CONFIRMED_BODY,
        tone: "success",
      });
    }

    return renderResultPage({
      status: result.reason === "expired" ? 410 : 400,
      heading: DOI_INVALID_HEADING,
      body: DOI_INVALID_BODY,
      tone: "error",
    });
  } catch (err) {
    reportError(err, { route: "api/confirm-marketing" });
    return renderResultPage({
      status: 500,
      heading: DOI_INVALID_HEADING,
      body: DOI_INVALID_BODY,
      tone: "error",
    });
  }
}
