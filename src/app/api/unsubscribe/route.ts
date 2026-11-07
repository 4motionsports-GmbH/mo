// GET /api/unsubscribe?token=... — the unsubscribe link carried by every
// marketing email. The token is a signed, email-keyed value
// (b64url(email).b64url(hmac)) so it verifies without a DB lookup and can't be
// forged to unsubscribe someone else.
//
// On a valid token we stamp unsubscribed_at, add the address to the suppression
// list, revoke marketing DOI, and render a confirmation page. Clicked as a
// top-level navigation from a mail client → no CORS/secret guard.
//
// The withdrawal goes to the ONE consent (lib/consent-flows.ts) and from there
// to Shopify, so no Shopify-side mailer keeps writing to the person either.
//
// POST is the RFC 8058 ONE-CLICK unsubscribe: marketing mails carry
// `List-Unsubscribe: <this URL>` + `List-Unsubscribe-Post:
// List-Unsubscribe=One-Click` (lib/email.ts), and Gmail, Yahoo, Apple Mail …
// show their own „Abbestellen“ button, which POSTs `List-Unsubscribe=One-Click`
// here — no page, no further click. Gmail and Yahoo require it from bulk
// senders (since 2024); without it a Rundmail risks the spam folder. The
// signed token authenticates the request exactly like the GET link.

import { unsubscribeByEmail, verifyUnsubscribeToken } from "@/lib/email-capture-store";
import { markCampaignUnsubscribed } from "@/lib/campaign-store";
import { recordMoWithdrawal } from "@/lib/consent-flows";
import { reportError } from "@/lib/observability";
import { unsubscribePageCopy } from "@/lib/consent-copy";
import { resolveLocale } from "@/lib/locale";
import { renderResultPage } from "@/lib/result-page";

export const maxDuration = 10;

/** The unsubscribe itself (both methods): suppression + the one consent. */
async function unsubscribe(email: string): Promise<boolean> {
  const ok = await unsubscribeByEmail(email, "unsubscribe");
  if (!ok) return false;
  // Attribute the unsubscribe to the campaign mails of the last 30 days
  // (migration 0054) — fail-soft, the unsubscribe itself is done.
  await markCampaignUnsubscribed(email);
  // The one consent: unsubscribed in Mo and (via the outbox) in Shopify.
  await recordMoWithdrawal({ email, reason: "unsubscribe" });
  return true;
}

export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  try {
    const email = token.trim() ? verifyUnsubscribeToken(token) : null;
    if (!email) return new Response("invalid token", { status: 400, headers: { "Content-Type": "text/plain" } });
    const ok = await unsubscribe(email);
    return new Response(ok ? "unsubscribed" : "temporarily unavailable", {
      status: ok ? 200 : 503,
      headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
    });
  } catch (err) {
    reportError(err, { route: "api/unsubscribe", phase: "one-click" });
    return new Response("error", { status: 500, headers: { "Content-Type": "text/plain" } });
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  // Locale carried in the unsubscribe link (`&locale=` appended at send time);
  // defaults to German for legacy links.
  const locale = resolveLocale(req);
  const copy = unsubscribePageCopy(locale);

  try {
    const email = token.trim() ? verifyUnsubscribeToken(token) : null;
    if (!email) {
      return renderResultPage({
        status: 400,
        heading: copy.invalidHeading,
        body: copy.invalidBody,
        tone: "error",
        locale,
      });
    }

    const ok = await unsubscribe(email);
    if (!ok) {
      // The signature was valid but we couldn't persist (e.g. no DB). Don't
      // claim success we can't back up.
      return renderResultPage({
        status: 503,
        heading: copy.invalidHeading,
        body: copy.invalidBody,
        tone: "error",
        locale,
      });
    }

    return renderResultPage({
      status: 200,
      heading: copy.confirmedHeading,
      body: copy.confirmedBody,
      tone: "success",
      locale,
    });
  } catch (err) {
    reportError(err, { route: "api/unsubscribe" });
    return renderResultPage({
      status: 500,
      heading: copy.invalidHeading,
      body: copy.invalidBody,
      tone: "error",
      locale,
    });
  }
}
