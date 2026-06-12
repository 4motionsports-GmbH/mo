// GET /api/confirm-marketing?token=... — the double-opt-in confirmation link.
//
// Clicked by the user as a top-level navigation from the DOI email, so this is
// NOT a cross-origin XHR: no CORS allowlist or shared-secret guard applies. It
// validates the token, flips marketing_doi_status to 'confirmed', records
// doi_confirmed_at, and renders a simple confirmation page. Tokens expire after
// MARKETING_DOI_EXPIRY_DAYS (default 7).
//
// Until this runs, NO marketing email is permitted for the address.
//
// A FIRST-TIME confirmation additionally issues the one-time welcome discount
// code (lib/welcome-discount.ts) — IF AND ONLY IF WELCOME_DISCOUNT_ENABLED is
// set (default OFF; the gate lives inside issueWelcomeCodeOnDoiConfirmation,
// which then returns { issued: false, reason: "disabled" } and this page
// renders the plain confirmation body with no welcome-gift reference). When
// enabled: the freely-chosen DOI click — not the marketing checkbox — is the
// trigger, the customer row's welcome_issued_at claim guarantees once-ever
// per email, and the code is delivered in the welcome email right after this
// page renders. Best-effort: a welcome failure never breaks the confirmation
// itself.

import { confirmMarketingByToken } from "@/lib/email-capture-store";
import { syncCustomerConsent } from "@/lib/customer-store";
import { issueWelcomeCodeOnDoiConfirmation } from "@/lib/welcome-discount";
import { reportError } from "@/lib/observability";
import {
  DOI_CONFIRMED_BODY,
  DOI_CONFIRMED_HEADING,
  DOI_CONFIRMED_WELCOME_BODY,
  DOI_INVALID_BODY,
  DOI_INVALID_HEADING,
} from "@/lib/consent-copy";
import { renderResultPage } from "@/lib/result-page";
import {
  KPI_EMAIL_CAPTURE_MARKETING_CONFIRMED,
  recordKpiEvent,
} from "@/lib/kpi-events";

// Confirmation + (first time only) welcome-code minting via Shopify and the
// welcome email via Resend — needs more headroom than the bare confirm.
export const maxDuration = 30;

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
      // Mirror the confirmed state onto the customer entity (best-effort).
      await syncCustomerConsent(result.email);
      // Funnel telemetry: count each unique DOI confirmation once, keyed by
      // the pseudonymous session the capture came from (no email in the event).
      let welcomeDelivered = false;
      if (!result.alreadyConfirmed) {
        await recordKpiEvent({
          sessionId: result.sessionId,
          event: KPI_EMAIL_CAPTURE_MARKETING_CONFIRMED,
        });
        // First-time confirmation → issue the one-time welcome code and email
        // it. Flag-gated inside (WELCOME_DISCOUNT_ENABLED, default off →
        // reason "disabled" and welcomeDelivered stays false, so the page
        // below never mentions a gift). Once-ever/suppression/opt-out
        // guarantees live inside too; a repeated click of the same token
        // never reaches this branch (alreadyConfirmed), and a re-signup later
        // is blocked by the customer's welcome claim.
        const welcome = await issueWelcomeCodeOnDoiConfirmation(result.email);
        welcomeDelivered = welcome.issued && welcome.emailSent;
      }
      return renderResultPage({
        status: 200,
        heading: DOI_CONFIRMED_HEADING,
        // Mention the welcome email only when it actually went out.
        body: welcomeDelivered ? DOI_CONFIRMED_WELCOME_BODY : DOI_CONFIRMED_BODY,
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
