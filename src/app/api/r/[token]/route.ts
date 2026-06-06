// GET /api/r/[token] — tracked redirect for the marketing email's cart link.
//
// The marketing email links here instead of straight to Shopify. We resolve the
// token to its marketing_sends row, record the click (clicked_at = FIRST click,
// plus a 'marketing_email_clicked' kpi_event), then 302-redirect to the real
// prefilled Shopify cart (the ?discount=CODE param stays intact). The customer
// experiences a perfectly normal click.
//
// GDPR: this logs a click on a link the user CHOSE to click — not covert
// surveillance, and deliberately NO open-tracking pixel.
//
// Resilience: a customer clicking a real email must NEVER hit a dead page. If the
// token can't be resolved (unknown / expired / pruned), or has no stored cart, we
// STILL redirect to a sensible storefront fallback and log the anomaly. Clicked
// as a top-level navigation from a mail client → no CORS/secret guard.

import { recordEmailClick } from "@/lib/marketing-store";
import { SHOP_DOMAIN } from "@/lib/shopify-cart-url.mjs";
import { reportError } from "@/lib/observability";

export const maxDuration = 10;

// Where to send a click we can't resolve to a real cart — the storefront cart,
// so a real customer always lands somewhere sensible rather than on an error.
const FALLBACK_URL = `${SHOP_DOMAIN}/cart`;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;

  let destination = FALLBACK_URL;
  try {
    const resolved = await recordEmailClick(token);
    if (resolved?.destination) {
      destination = resolved.destination;
    } else {
      // Unknown/expired/pruned token, or a sent row without a cart URL. Don't
      // error the customer — fall back to the storefront cart and log it.
      console.warn("[api/r] unresolved marketing redirect token", {
        tokenPreview: typeof token === "string" ? token.slice(0, 8) : "",
      });
    }
  } catch (err) {
    // Even an unexpected failure must not break the customer's click.
    reportError(err, { route: "api/r" });
  }

  return Response.redirect(destination, 302);
}
