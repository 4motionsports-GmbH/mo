// GET /api/r/[token] — tracked redirect for marketing email links.
//
// Two kinds of token resolve here, tried in order:
//   1. MARKETING send token  → the prefilled Shopify cart (?discount=CODE intact).
//   2. BUNDLE OFFER token     → the bundle's materialized /cart permalink.
// Either way we record the click (clicked_at / a kpi_event), then 302 to the
// real destination. The customer experiences a perfectly normal click.
//
// GDPR: this logs a click on a link the user CHOSE to click — not covert
// surveillance, and deliberately NO open-tracking pixel.
//
// Resilience: a customer clicking a real email must NEVER hit a dead page.
//   - Unknown / unresolved token  → redirect to a sensible storefront fallback.
//   - EXPIRED / archived bundle offer → a friendly branded "Angebot abgelaufen"
//     page (Shopify has no native friendly-expired page; an archived product's
//     URL 404s and a stale cart permalink drops the line — spike §5). We serve
//     the on-brand page here instead.
// Clicked as a top-level navigation from a mail client → no CORS/secret guard.

import { recordEmailClick } from "@/lib/marketing-store";
import { resolveBundleRedirect } from "@/lib/bundle-offers-store";
import { SHOP_DOMAIN } from "@/lib/shopify-cart-url.mjs";
import { reportError } from "@/lib/observability";
import { resolveLocale, type Locale } from "@/lib/locale";
import { apiMessage } from "@/lib/api-messages.mjs";

export const maxDuration = 10;

// Where to send a click we can't resolve to a real cart — the storefront cart,
// so a real customer always lands somewhere sensible rather than on an error.
const FALLBACK_URL = `${SHOP_DOMAIN}/cart`;

// A sensible storefront destination from the friendly expired page (env-
// overridable, e.g. a "current deals" collection). Defaults to the storefront.
function expiredCollectionUrl(): string {
  return process.env.BUNDLE_EXPIRED_REDIRECT_URL?.trim() || `${SHOP_DOMAIN}`;
}

/** A small branded "offer expired" page (spike §5 graceful degrade). */
function expiredOfferResponse(locale: Locale): Response {
  const shopUrl = expiredCollectionUrl();
  const html = `<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>${apiMessage("offer_expired_title", locale)}</title>
    <style>
      :root { color-scheme: light; }
      body {
        margin: 0; min-height: 100vh; display: flex; align-items: center;
        justify-content: center; background: #f5f5f4;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        color: #1c1917; padding: 24px;
      }
      .card {
        background: #fff; border-radius: 16px; padding: 40px 32px; max-width: 460px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.08); text-align: center;
      }
      h1 { font-size: 1.5rem; margin: 0 0 12px; }
      p { font-size: 1rem; line-height: 1.5; color: #44403c; margin: 0 0 24px; }
      a.btn {
        display: inline-block; background: #1c1917; color: #fff; text-decoration: none;
        padding: 12px 24px; border-radius: 9999px; font-weight: 600;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>${apiMessage("offer_expired_heading", locale)}</h1>
      <p>
        ${apiMessage("offer_expired_body", locale)}
      </p>
      <a class="btn" href="${shopUrl}">${apiMessage("offer_expired_cta", locale)}</a>
    </main>
  </body>
</html>`;
  return new Response(html, {
    status: 410, // Gone — the offer existed but is no longer available.
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  // Locale carried on the link (`&locale=`); defaults to German for legacy links.
  const locale = resolveLocale(req);

  try {
    // 1. Marketing send token (the established path).
    const marketing = await recordEmailClick(token);
    if (marketing?.destination) {
      return Response.redirect(marketing.destination, 302);
    }

    // 2. Bundle offer token.
    const bundle = await resolveBundleRedirect(token);
    if (bundle) {
      if (bundle.status === "active" && bundle.destination) {
        return Response.redirect(bundle.destination, 302);
      }
      // Expired / archived / failed / pending offer → friendly branded page,
      // never a Shopify 404 or empty cart.
      return expiredOfferResponse(locale);
    }

    // Unknown / pruned token, or a marketing row without a cart URL. Don't error
    // the customer — fall back to the storefront cart and log it.
    if (marketing) {
      console.warn("[api/r] marketing redirect token without a cart URL", {
        tokenPreview: typeof token === "string" ? token.slice(0, 8) : "",
      });
    } else {
      console.warn("[api/r] unresolved redirect token", {
        tokenPreview: typeof token === "string" ? token.slice(0, 8) : "",
      });
    }
  } catch (err) {
    // Even an unexpected failure must not break the customer's click.
    reportError(err, { route: "api/r" });
  }

  return Response.redirect(FALLBACK_URL, 302);
}
