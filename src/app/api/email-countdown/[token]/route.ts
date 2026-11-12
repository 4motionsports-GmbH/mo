// GET /api/email-countdown/<token> — the LIVE offer countdown image.
//
// The recommendation mails embed this URL instead of fixed numbers: every
// time the mail is opened, the client fetches the image, and this route
// renders days / hours / minutes to the deadline AT THAT MOMENT (or "offer
// expired") — as an animated GIF that keeps ticking minute by minute for the
// next hour (email-countdown-image.mjs), because clients show the copy they
// fetched and a still image looked frozen. PUBLIC BY NECESSITY — mail clients fetch anonymously — and safe
// because the token only carries a signed deadline + language
// (email-countdown-token.mjs): nothing about the recipient, and nothing an
// outsider could use to render arbitrary content from our domain.
//
// One image per MINUTE (countdownCacheWindow): every fetch of the same token
// and variant within a minute gets the same image, drawn for the minute's
// end, so it never shows more time than is left. A Rundmail sends one URL to
// thousands of recipients and Apple Mail's privacy proxy fetches it at every
// delivery — rendering each fetch anew (~0.7 s of CPU) made the countdown the
// hot spot of a big send. The image is kept twice, both only until the minute
// ends: per server instance (concurrent fetches share ONE render) and on
// Vercel's CDN (`Vercel-CDN-Cache-Control`, which Vercel strips before the
// response leaves its network). Browsers and mail proxies still get
// `no-store` and fetch again on every open. Nothing is logged or stored per
// fetch.
//
// A template's countdown (docs/EMAIL_TEMPLATES.md) carries its colours:
// ?bg=…&tile=…&digit=…&label=… (six hex digits each) and their signature
// `cs` (email-countdown-token.mjs signCountdownColors). Only signed colours
// are drawn — an invalid value, a missing or wrong signature gives the light
// look — so nobody can make the route render colours no mail carries (each
// distinct URL would be a fresh render). The colours are part of the memo
// key; the light look stays one image per token and variant.

import { verifyCountdownToken, countdownSecret, verifyCountdownColors } from "@/lib/email-countdown-token.mjs";
import {
  COUNTDOWN_MOBILE_WIDTH,
  countdownCacheSeconds,
  countdownCacheWindow,
  countdownColorQuery,
  parseCountdownColors,
  renderCountdownImage,
  type CountdownColors,
} from "@/lib/email-countdown-image.mjs";
import { reportError } from "@/lib/observability";

export const maxDuration = 10;
export const dynamic = "force-dynamic";

/** Images of the current minute, per token, variant and colours (bounded). */
const MEMO_MAX = 100;
const memo = new Map<string, Promise<Buffer>>();
let memoWindow = -1;

function countdownGif(
  token: string,
  parsed: { expiresAt: string | Date; language: "de" | "en" },
  mobile: boolean,
  colors: CountdownColors | null,
  nowMs: number
): { gif: Promise<Buffer>; endsAt: number } {
  const window = countdownCacheWindow(nowMs);
  if (window.index !== memoWindow) {
    // A new minute: the old images are never served again (requests still
    // waiting for one keep their own reference).
    memo.clear();
    memoWindow = window.index;
  }
  const query = countdownColorQuery(colors);
  const key = `${mobile ? "m" : "d"}|${token}${query ? `|${query}` : ""}`;
  let gif = memo.get(key);
  if (!gif) {
    gif = renderCountdownImage({
      expiresAt: parsed.expiresAt,
      language: parsed.language,
      width: mobile ? COUNTDOWN_MOBILE_WIDTH : undefined,
      now: new Date(window.endsAt),
      colors,
    });
    const own = gif;
    memo.set(key, own);
    // A failed render is not kept — the next fetch tries again.
    own.catch(() => {
      if (memo.get(key) === own) memo.delete(key);
    });
    if (memo.size > MEMO_MAX) {
      const oldest = memo.keys().next().value;
      if (oldest !== undefined) memo.delete(oldest);
    }
  }
  return { gif, endsAt: window.endsAt };
}

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** The request's colours when their signature matches, else null (the light look). */
function signedColors(token: string, params: URLSearchParams, secret: string | undefined): CountdownColors | null {
  const colors = parseCountdownColors(params);
  const query = countdownColorQuery(colors);
  return query && verifyCountdownColors(token, query, params.get("cs"), secret) ? colors : null;
}

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const secret = countdownSecret();
  const parsed = verifyCountdownToken(token, secret);
  if (!parsed) return notFound();
  const params = new URL(req.url).searchParams;
  // ?w=m → the phone-width variant (the mail shows it via its mobile media
  // query); not part of the signature, it only picks a canvas size.
  const mobile = params.get("w") === "m";
  const colors = signedColors(token, params, secret);
  try {
    const { gif, endsAt } = countdownGif(token, parsed, mobile, colors, Date.now());
    const bytes = await gif;
    // Whatever is left of the minute — 0 (a render that finished after the
    // minute ended) → not kept on the CDN at all.
    const cdnSeconds = countdownCacheSeconds(endsAt, Date.now());
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "image/gif",
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        ...(cdnSeconds > 0 ? { "Vercel-CDN-Cache-Control": `max-age=${cdnSeconds}` } : {}),
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
