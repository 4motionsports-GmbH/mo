// GET /api/email-countdown/<token> — the LIVE offer countdown image.
//
// The recommendation mails embed this URL instead of fixed numbers: every
// time the mail is opened, the client fetches the image, and this route
// renders days / hours / minutes to the deadline AT THAT MOMENT (or "offer
// expired"). PUBLIC BY NECESSITY — mail clients fetch anonymously — and safe
// because the token only carries a signed deadline + language
// (email-countdown-token.mjs): nothing about the recipient, and nothing an
// outsider could use to render arbitrary content from our domain.
//
// No-store: image proxies (Gmail, Apple Mail) must re-fetch on every open,
// otherwise the reader would see a stale count. Nothing is logged or stored
// per fetch — the route computes and answers.

import { verifyCountdownToken, countdownSecret } from "@/lib/email-countdown-token.mjs";
import { COUNTDOWN_MOBILE_WIDTH, renderCountdownImage } from "@/lib/email-countdown-image.mjs";
import { reportError } from "@/lib/observability";

export const maxDuration = 10;
export const dynamic = "force-dynamic";

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const parsed = verifyCountdownToken(token, countdownSecret());
  if (!parsed) return notFound();
  // ?w=m → the phone-width variant (the mail shows it via its mobile media
  // query); not part of the signature, it only picks a canvas size.
  const mobile = new URL(req.url).searchParams.get("w") === "m";
  try {
    const png = await renderCountdownImage({
      expiresAt: parsed.expiresAt,
      language: parsed.language,
      width: mobile ? COUNTDOWN_MOBILE_WIDTH : undefined,
    });
    return new Response(new Uint8Array(png), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
        Expires: "0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    reportError(err, { route: "api/email-countdown" });
    return notFound();
  }
}
