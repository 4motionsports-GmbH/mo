// GET /api/confirm-marketing?token=... — the double-opt-in confirmation link.
//
// Clicked by the user as a top-level navigation from the DOI email, so this is
// NOT a cross-origin XHR: no CORS allowlist or shared-secret guard applies. It
// validates the token, flips marketing_doi_status to 'confirmed', records
// doi_confirmed_at, and renders a simple confirmation page. Tokens expire after
// MARKETING_DOI_EXPIRY_DAYS (default 7), counted from the last time the link
// was mailed.
//
// Until this runs, NO marketing email is permitted for the address.
//
// The flip is conditional and happens once (OPTIN_REWARD T2.3): only the
// click that flips the row reports the confirmation to the ONE consent
// (lib/consent-flows.ts) — the person is subscribed with a provable double
// opt-in, in Mo and, through the outbox, in Shopify (a Mo-only subscriber
// becomes a Shopify customer with that consent;
// docs/archive/CUSTOMER_PLATFORM_PLAN.md §7.4) — and writes the KPI. Further
// clicks, also simultaneous ones, see the same success page and record
// nothing. A link whose address unsubscribed or was blocked since → the
// invalid page (an old link never re-subscribes).

import { confirmMarketingByToken } from "@/lib/email-capture-store";
import { recordDoiConfirmed } from "@/lib/consent-flows";
import { confirmationSource } from "@/lib/capture-funnel.mjs";
import { normalizePlacement, SIGNIN_VARIANT_ID_RE } from "@/lib/consent-variants.mjs";
import { reportError } from "@/lib/observability";
import { doiPageCopy } from "@/lib/consent-copy";
import { resolveLocale } from "@/lib/locale";
import { renderResultPage } from "@/lib/result-page";
import {
  KPI_EMAIL_CAPTURE_MARKETING_CONFIRMED,
  latestDoiOptIn,
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
      // Only the click that flipped the row (never a repeated or parallel
      // one): the one consent — subscribed in Mo and (via the outbox) in
      // Shopify, origin email_capture:<id> — and the funnel telemetry: each
      // DOI confirmation once, keyed by the pseudonymous session the capture
      // came from (no email in the event), with the surface it confirms (the
      // session's DOI opt-in, else the pending consent row's surface, OI1 §4)
      // and that opt-in's sign-in placement / variant (T6). The row is
      // confirmed already, so a failure here is reported, not shown.
      if (!result.alreadyConfirmed) {
        try {
          const pendingSource = await recordDoiConfirmed({ email: result.email, captureId: result.captureId });
          const optIn = await latestDoiOptIn(result.sessionId ?? null);
          const placement = normalizePlacement(optIn?.placement);
          const variant = optIn?.variant && SIGNIN_VARIANT_ID_RE.test(optIn.variant) ? optIn.variant : null;
          await recordKpiEvent({
            sessionId: result.sessionId,
            event: KPI_EMAIL_CAPTURE_MARKETING_CONFIRMED,
            data: {
              source: confirmationSource({ sessionSource: optIn?.source ?? null, pendingSource }),
              ...(placement ? { placement } : {}),
              ...(variant ? { variant } : {}),
            },
          });
        } catch (err) {
          reportError(err, { route: "api/confirm-marketing", phase: "record_confirmed" });
        }
      }
      return renderResultPage({
        status: 200,
        heading: copy.confirmedHeading,
        body: copy.confirmedBody,
        tone: "success",
        locale,
      });
    }

    // expired → 410; unknown, withdrawn or blocked since → 400; no database
    // or a failed statement → 503 (the click can simply be repeated).
    return renderResultPage({
      status: result.reason === "expired" ? 410 : result.reason === "unavailable" ? 503 : 400,
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
