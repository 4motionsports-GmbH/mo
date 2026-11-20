// GET /api/gift-vouchers/config?locale=de|en — what the voucher page
// (/pages/gutschein, theme section ms-gift-voucher) loads first (spec §8.1,
// docs/GIFT_VOUCHERS.md).
//
// Whether the shop sells vouchers right now (`available` +
// `unavailableReason`), the designs with their decorative backgrounds for the
// live preview, which features the page may offer (AI texts, own photo,
// Premium-Karte), the text limits, occasions and tones for „Mit Mo
// formulieren“, the print countries, the validity and the URL of the
// handwriting font. The amounts and prices are NOT here: they are the
// variants of the voucher product, which the theme renders from Liquid.
//
// Public shop data only: origin allowlist + the `products` rate limit, no
// secret (like the configurator's offer route), cached 60 s. A change of the
// admin switches reaches it within the settings cache (60 s per instance)
// plus that max-age.

import { corsHeaders, guardOriginOnly, preflightResponse } from "@/lib/security";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { errorResponse, reportError } from "@/lib/observability";
import { resolveLocale } from "@/lib/locale";
import { getBaseUrl } from "@/lib/base-url";
import { GIFT_VOUCHER_DESIGNS, giftVoucherBackgroundSvg } from "@/lib/gift-voucher-designs.mjs";
import { giftVoucherPrintCountries, giftVoucherTermsUrl, giftVoucherValidityYears } from "@/lib/gift-voucher-flags.mjs";
import { buildGiftVoucherConfig } from "@/lib/gift-voucher-storefront.mjs";
import { loadGiftVoucherStorefrontState } from "@/lib/gift-voucher-storefront-io";

export const maxDuration = 10;

const METHODS = "GET, OPTIONS";

export async function OPTIONS(req: Request) {
  return preflightResponse(req, METHODS);
}

export async function GET(req: Request) {
  const guard = guardOriginOnly(req);
  if (!guard.ok) return guard.response;
  const cors = corsHeaders(guard.origin, METHODS);

  try {
    const rl = await checkRateLimit(req, "products");
    if (!rl.ok) return rateLimitResponse(rl.retryAfter, cors);

    const config = buildGiftVoucherConfig({
      locale: resolveLocale(req),
      state: await loadGiftVoucherStorefrontState(),
      designs: GIFT_VOUCHER_DESIGNS,
      backgroundSvg: giftVoucherBackgroundSvg,
      validityYears: giftVoucherValidityYears(),
      printCountries: giftVoucherPrintCountries(),
      termsUrl: giftVoucherTermsUrl(),
      apiBase: getBaseUrl(req),
      now: new Date(),
    });

    return new Response(JSON.stringify(config), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60",
        ...cors,
      },
    });
  } catch (err) {
    reportError(err, { route: "api/gift-vouchers/config" });
    return errorResponse("internal_error", "Unexpected server error", 500, cors);
  }
}
