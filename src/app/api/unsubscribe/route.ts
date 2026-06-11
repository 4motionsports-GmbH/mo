// GET /api/unsubscribe?token=... — the unsubscribe link carried by every
// marketing email. The token is a signed, email-keyed value
// (b64url(email).b64url(hmac)) so it verifies without a DB lookup and can't be
// forged to unsubscribe someone else.
//
// On a valid token we stamp unsubscribed_at, add the address to the suppression
// list, revoke marketing DOI, and render a confirmation page. Clicked as a
// top-level navigation from a mail client → no CORS/secret guard.

import { unsubscribeByEmail, verifyUnsubscribeToken } from "@/lib/email-capture-store";
import { syncCustomerConsent } from "@/lib/customer-store";
import { reportError } from "@/lib/observability";
import {
  UNSUBSCRIBE_CONFIRMED_BODY,
  UNSUBSCRIBE_CONFIRMED_HEADING,
  UNSUBSCRIBE_INVALID_BODY,
  UNSUBSCRIBE_INVALID_HEADING,
} from "@/lib/consent-copy";
import { renderResultPage } from "@/lib/result-page";

export const maxDuration = 10;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";

  try {
    const email = token.trim() ? verifyUnsubscribeToken(token) : null;
    if (!email) {
      return renderResultPage({
        status: 400,
        heading: UNSUBSCRIBE_INVALID_HEADING,
        body: UNSUBSCRIBE_INVALID_BODY,
        tone: "error",
      });
    }

    const ok = await unsubscribeByEmail(email, "unsubscribe");
    if (!ok) {
      // The signature was valid but we couldn't persist (e.g. no DB). Don't
      // claim success we can't back up.
      return renderResultPage({
        status: 503,
        heading: UNSUBSCRIBE_INVALID_HEADING,
        body: UNSUBSCRIBE_INVALID_BODY,
        tone: "error",
      });
    }

    // Mirror the unsubscribe onto the customer entity (best-effort).
    await syncCustomerConsent(email);

    return renderResultPage({
      status: 200,
      heading: UNSUBSCRIBE_CONFIRMED_HEADING,
      body: UNSUBSCRIBE_CONFIRMED_BODY,
      tone: "success",
    });
  } catch (err) {
    reportError(err, { route: "api/unsubscribe" });
    return renderResultPage({
      status: 500,
      heading: UNSUBSCRIBE_INVALID_HEADING,
      body: UNSUBSCRIBE_INVALID_BODY,
      tone: "error",
    });
  }
}
