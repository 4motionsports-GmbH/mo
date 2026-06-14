// POST /api/account/marketing-opt-in — the AT-SIGN-IN marketing opt-in.
//
// PRESENTATION-MAXIMISED, FULLY LAWFUL. A signed-in (tier-3) customer opts into
// marketing without re-typing their email: we already hold their VERIFIED
// Shopify address, so the account removes ONLY the "type your email" step. The
// consent itself is unchanged from the in-chat capture flow:
//
//   * NO auto-enrol / NO pre-tick — the widget renders an UNCHECKED box and the
//     customer must actively tick it. We still require `marketingConsent: true`
//     in the body; without it we refuse (a Shopify account NEVER implies
//     consent).
//   * runs the EXISTING double-opt-in: this only sets DOI 'pending' and sends
//     the confirmation email. NO marketing is permitted until the customer
//     clicks that link (GET /api/confirm-marketing).
//   * stores the exact label + footer shown verbatim as `consent_text_shown`
//     with the same `consent_copy_version` stamp (v3), so the Art. 7 audit is
//     identical to the typed-email path. Withdrawable via the same unsubscribe.
//
// Gated by the standard signed-in guard (origin + secret + live access token).

import { requireSignedInCustomer, readSession } from "@/lib/account-guard";
import { preflightResponse } from "@/lib/security";
import { errorResponse, reportError } from "@/lib/observability";
import { resolveConsentCopyVersion } from "@/lib/consent-copy-version.mjs";
import { upsertEmailCapture } from "@/lib/email-capture-store";
import { getCustomerById, linkCustomerOnEmailCapture } from "@/lib/customer-store";
import { sendEmail } from "@/lib/email";
import { getBaseUrl } from "@/lib/base-url";
import {
  DOI_EMAIL_SUBJECT,
  doiEmailBody,
  signInMarketingConsentCopy,
} from "@/lib/consent-copy";
import {
  KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN,
  KPI_EMAIL_CAPTURE_SUBMITTED,
  recordKpiEvent,
} from "@/lib/kpi-events";

export const maxDuration = 30;

const ALLOWED_METHODS = "POST, OPTIONS";

// A synthetic placeholder email (no verified address — sign-in without an email
// claim) can't receive a real DOI / marketing mail; refuse the opt-in for it.
const SYNTHETIC_EMAIL_PREFIX = "shopify:";

interface OptInPayload {
  marketingConsent?: unknown;
  consentTextShown?: unknown;
}

export async function OPTIONS(req: Request) {
  return preflightResponse(req, ALLOWED_METHODS);
}

function okJson(body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

export async function POST(req: Request) {
  const guard = await requireSignedInCustomer(req, ALLOWED_METHODS);
  if (!guard.ok) return guard.response;
  const headers = guard.headers;

  try {
    let payload: OptInPayload;
    try {
      payload = (await req.json()) as OptInPayload;
    } catch {
      return errorResponse("bad_request", "Ungültiger JSON-Body", 400, headers);
    }

    // Explicit affirmative act required — the endpoint NEVER enrols on its own.
    if (payload.marketingConsent !== true) {
      return errorResponse(
        "marketing_consent_required",
        "Bitte bestätige die Einwilligung aktiv (das Häkchen ist standardmäßig nicht gesetzt).",
        400,
        headers
      );
    }

    // Use the customer's VERIFIED, consent-anchored email — the whole point is
    // that the signed-in customer never re-types it.
    const customer = await getCustomerById(guard.customerId);
    if (!customer) {
      return errorResponse("not_found", "Kunde nicht gefunden", 404, headers);
    }
    const email = customer.email;
    if (!email || email.startsWith(SYNTHETIC_EMAIL_PREFIX)) {
      return errorResponse(
        "no_verified_email",
        "Für dieses Konto liegt keine verifizierte E-Mail-Adresse vor.",
        422,
        headers
      );
    }

    const sessionId = readSession(req);
    const consentTextShown =
      typeof payload.consentTextShown === "string" ? payload.consentTextShown : null;

    // Attest the v3 sign-in copy only when the echoed text is byte-identical to
    // the canonical SIGN-IN string (label + footer); anything else → NULL
    // (honest "unattested"; the verbatim text stays authoritative).
    const consentCopyVersion = resolveConsentCopyVersion(
      consentTextShown,
      signInMarketingConsentCopy().consentTextShown
    );

    // Same upsert + DOI machinery as /api/capture-email — only the email source
    // differs. transactionalConsent stays false (no summary requested here); the
    // DB OR-merges it so an existing transactional consent is never downgraded.
    const capture = await upsertEmailCapture({
      sessionId,
      email,
      transactionalConsent: false,
      marketingConsent: true,
      consentTextShown,
      consentCopyVersion,
    });
    if (!capture) {
      return errorResponse(
        "upstream_unavailable",
        "Einwilligung konnte nicht gespeichert werden — bitte später erneut versuchen.",
        503,
        headers
      );
    }

    // Attach the current conversation + sync the customer's mirrored consent.
    // GREATEST(identity_tier, 2) never downgrades this signed-in (tier-3) row.
    await linkCustomerOnEmailCapture({ email, sessionId });

    // Funnel telemetry (pseudonymous, session-keyed — NO email in the data),
    // tagged so the opt-in surface can be split out from the in-chat capture.
    await recordKpiEvent({
      sessionId,
      event: KPI_EMAIL_CAPTURE_SUBMITTED,
      data: { marketingConsent: true, trigger: "signin_optin" },
    });
    await recordKpiEvent({
      sessionId,
      event: KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN,
      data: { doiStatus: capture.marketingDoiStatus, trigger: "signin_optin" },
    });

    // Send the DOI confirmation email — only when newly pending (an already
    // confirmed address re-opting in doesn't re-send). NO marketing until the
    // link is clicked.
    let doiEmailSent = false;
    if (capture.doiEmailRequired && capture.doiToken) {
      const confirmUrl = `${getBaseUrl(req)}/api/confirm-marketing?token=${encodeURIComponent(capture.doiToken)}`;
      const body = doiEmailBody(confirmUrl);
      const doiResult = await sendEmail({
        to: email,
        subject: DOI_EMAIL_SUBJECT,
        text: body.text,
        html: body.html,
        kind: "doi",
      });
      doiEmailSent = doiResult.ok;
      if (!doiResult.ok && !doiResult.skipped) {
        // The pending consent is stored; the user just didn't get the link. Log
        // it (they can re-request) rather than failing the whole opt-in.
        reportError(doiResult.error, {
          route: "api/account/marketing-opt-in",
          phase: "doi_send",
        });
      }
    }

    return okJson(
      {
        ok: true,
        marketing: {
          status: capture.marketingDoiStatus,
          doiEmailSent,
          // True when the address was already confirmed (re-opt-in) — no DOI needed.
          alreadyConfirmed:
            capture.marketingDoiStatus === "confirmed" && !capture.doiEmailRequired,
        },
      },
      headers
    );
  } catch (err) {
    reportError(err, { route: "api/account/marketing-opt-in" });
    return errorResponse("internal_error", "Unexpected server error", 500, headers);
  }
}
