// GET /api/unsubscribe/bestandskunde?token=... — the SEPARATE §7 Abs. 3 UWG
// objection link carried by every existing-customer email.
//
// This is NOT the DOI marketing unsubscribe. It records an objection to §7(3)
// existing-customer mail ONLY (bestandskunden_suppression_list), leaving any
// DOI marketing consent untouched — the two lawful bases have separate opt-outs
// honoured independently. The token is domain-separated from the DOI
// unsubscribe token, so one can never be replayed as the other.
//
// Clicked as a top-level navigation from a mail client → no CORS/secret guard;
// the signed, email-keyed token is the protection.

import {
  suppressBestandskunde,
  verifyBestandskundeOptOutToken,
} from "@/lib/bestandskunden-store";
import { reportError } from "@/lib/observability";
import {
  BESTANDSKUNDE_OPT_OUT_CONFIRMED_BODY,
  BESTANDSKUNDE_OPT_OUT_CONFIRMED_HEADING,
  BESTANDSKUNDE_OPT_OUT_INVALID_BODY,
  BESTANDSKUNDE_OPT_OUT_INVALID_HEADING,
} from "@/lib/consent-copy";
import { renderResultPage } from "@/lib/result-page";

export const maxDuration = 10;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";

  try {
    const email = token.trim() ? verifyBestandskundeOptOutToken(token) : null;
    if (!email) {
      return renderResultPage({
        status: 400,
        heading: BESTANDSKUNDE_OPT_OUT_INVALID_HEADING,
        body: BESTANDSKUNDE_OPT_OUT_INVALID_BODY,
        tone: "error",
      });
    }

    const ok = await suppressBestandskunde(email, "bestandskunde_opt_out");
    if (!ok) {
      // Valid signature but we couldn't persist (e.g. no DB) — don't claim a
      // success we can't back up.
      return renderResultPage({
        status: 503,
        heading: BESTANDSKUNDE_OPT_OUT_INVALID_HEADING,
        body: BESTANDSKUNDE_OPT_OUT_INVALID_BODY,
        tone: "error",
      });
    }

    return renderResultPage({
      status: 200,
      heading: BESTANDSKUNDE_OPT_OUT_CONFIRMED_HEADING,
      body: BESTANDSKUNDE_OPT_OUT_CONFIRMED_BODY,
      tone: "success",
    });
  } catch (err) {
    reportError(err, { route: "api/unsubscribe/bestandskunde" });
    return renderResultPage({
      status: 500,
      heading: BESTANDSKUNDE_OPT_OUT_INVALID_HEADING,
      body: BESTANDSKUNDE_OPT_OUT_INVALID_BODY,
      tone: "error",
    });
  }
}
