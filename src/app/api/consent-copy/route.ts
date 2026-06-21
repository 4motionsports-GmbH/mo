// GET /api/consent-copy[?surface=signin] — canonical consent copy for the widget.
//
// The checkbox labels, the marketing benefit hint, and the pre-composed
// `consentTextShown` audit string are legally load-bearing (Art. 7 proof of
// consent), so the widget must never hard-code them in the theme snapshot.
// The `offer_email_summary` tool result already carries this payload for the
// tool-triggered path; this endpoint serves the same strings for capture
// forms NOT triggered by the tool (e.g. a proactive share-form entry point),
// and lets the widget refresh its copy without a theme release.
//
// Two surfaces, ONE version stamp (v3):
//   * default            — the in-chat capture form (email + two checkboxes).
//   * ?surface=signin    — the AT-SIGN-IN marketing opt-in for a signed-in
//                          customer (one UNCHECKED benefit-framed box, no email
//                          field — we already hold the verified address). The
//                          widget POSTs the tick to /api/account/marketing-opt-in.
//
// Public read-only strings already shown to every form user, so no
// shared-secret auth is required — origin allowlist + rate limit are the
// guardrails, same as /api/products.

import {
  corsHeaders,
  guardOriginOnly,
  preflightResponse,
} from "@/lib/security";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { errorResponse, reportError } from "@/lib/observability";
import { captureConsentCopy, signInMarketingConsentCopy } from "@/lib/consent-copy";
import { resolveLocale } from "@/lib/locale";

export const maxDuration = 10;

const ALLOWED_METHODS = "GET, OPTIONS";

export async function OPTIONS(req: Request) {
  return preflightResponse(req, ALLOWED_METHODS);
}

export async function GET(req: Request) {
  const guard = guardOriginOnly(req);
  if (!guard.ok) return guard.response;
  const cors = corsHeaders(guard.origin, ALLOWED_METHODS);

  try {
    const rl = await checkRateLimit(req, "products");
    if (!rl.ok) return rateLimitResponse(rl.retryAfter, cors);

    const surface = new URL(req.url).searchParams.get("surface");
    // Storefront-selected language via ?locale= (default German). The widget on
    // /en requests ?locale=en so the form, the audit string, and the version
    // stamp all match the language the user will be shown.
    const locale = resolveLocale(req);
    const copy =
      surface === "signin"
        ? signInMarketingConsentCopy(locale)
        : captureConsentCopy(locale);

    // Short cache only: a lawyer copy change must propagate to live widgets
    // quickly, since the served strings ARE the audit-trail text.
    return new Response(JSON.stringify(copy), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        ...cors,
      },
    });
  } catch (err) {
    reportError(err, { route: "api/consent-copy" });
    return errorResponse("internal_error", "Unexpected server error", 500, cors);
  }
}
