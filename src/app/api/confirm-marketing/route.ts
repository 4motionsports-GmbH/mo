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
// The confirmation is reported to the ONE consent (lib/consent-flows.ts): the
// person is subscribed with a provable double opt-in, in Mo and — through the
// outbox — in Shopify (a Mo-only subscriber becomes a Shopify customer with
// that consent). docs/CUSTOMER_PLATFORM_PLAN.md §7.4.

import { confirmMarketingByToken } from "@/lib/email-capture-store";
import { recordDoiConfirmed } from "@/lib/consent-flows";
import { confirmationSource } from "@/lib/capture-funnel.mjs";
import { reportError } from "@/lib/observability";
import { doiPageCopy } from "@/lib/consent-copy";
import { resolveLocale } from "@/lib/locale";
import { renderResultPage } from "@/lib/result-page";
import {
  KPI_EMAIL_CAPTURE_MARKETING_CONFIRMED,
  latestDoiOptInSource,
  recordKpiEvent,
} from "@/lib/kpi-events";

// Confirmation flips the DOI status, mirrors consent onto the customer entity,
// and records the funnel KPI — a little headroom over the platform default.
export const maxDuration = 30;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  // Locale carried in the DOI link (`&locale=` appended at send time from the
  // stored capture locale); defaults to German for legacy links.
  const locale = resolveLocale(req);
  const copy = doiPageCopy(locale);

  try {
    if (!token.trim()) {
      return renderResultPage({
        status: 400,
        heading: copy.invalidHeading,
        body: copy.invalidBody,
        tone: "error",
        locale,
      });
    }

    const result = await confirmMarketingByToken(token);
    if (result.ok) {
      // The one consent: subscribed in Mo and (via the outbox) in Shopify.
      // Funnel telemetry: count each unique DOI confirmation once, keyed by
      // the pseudonymous session the capture came from (no email in the
      // event), with the surface it confirms: the session's DOI opt-in, else
      // the pending consent row's surface (OI1 §4).
      if (!result.alreadyConfirmed) {
        const pendingSource = await recordDoiConfirmed({ email: result.email });
        const sessionSource = await latestDoiOptInSource(result.sessionId ?? null);
        await recordKpiEvent({
          sessionId: result.sessionId,
          event: KPI_EMAIL_CAPTURE_MARKETING_CONFIRMED,
          data: { source: confirmationSource({ sessionSource, pendingSource }) },
        });
      }
      return renderResultPage({
        status: 200,
        heading: copy.confirmedHeading,
        body: copy.confirmedBody,
        tone: "success",
        locale,
      });
    }

    return renderResultPage({
      status: result.reason === "expired" ? 410 : 400,
      heading: copy.invalidHeading,
      body: copy.invalidBody,
      tone: "error",
      locale,
    });
  } catch (err) {
    reportError(err, { route: "api/confirm-marketing" });
    return renderResultPage({
      status: 500,
      heading: copy.invalidHeading,
      body: copy.invalidBody,
      tone: "error",
      locale,
    });
  }
}
