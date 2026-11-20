// POST /api/gift-vouchers/suggest — „Mit Mo formulieren“ (spec §8.4).
//   body: { occasion, tone, locale }  (occasion/tone from the config's lists)
//   → { ok: true, suggestions: [string, …] }  (three, at least one)
//
// Three short card texts from the bulk tier (lib/gift-voucher-message.ts). No
// personal data goes to the model — only the occasion, the tone and the
// language; the texts carry the placeholders {{fuer}} / {{von}}, which the
// page fills in. The page shows them as „KI-Vorschlag“.
//
// guardRequest (origin + x-ms-chat-key), buckets `gift-voucher-ai` (session)
// and `gift-voucher-ip`. 409 while the shop does not sell vouchers, 503 while
// the suggestions are switched off (admin) or no ANTHROPIC_API_KEY is set,
// 502 when the model fails.

import { corsHeaders, guardRequest, preflightResponse } from "@/lib/security";
import { checkRateLimit, checkRateLimitKeyed, clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { errorResponse, reportError } from "@/lib/observability";
import { resolveLocale } from "@/lib/locale";
import { giftVoucherApiText, parseGiftVoucherSuggestInput } from "@/lib/gift-voucher-storefront.mjs";
import {
  giftVoucherBodyErrorResponse,
  giftVoucherErrorResponse,
  giftVoucherJsonResponse,
  giftVoucherUnavailableResponse,
  loadGiftVoucherStorefrontState,
  readGiftVoucherJson,
} from "@/lib/gift-voucher-storefront-io";
import { suggestGiftVoucherMessages } from "@/lib/gift-voucher-message";

// One model call with a 20 s timeout (lib/gift-voucher-message.ts) and one retry.
export const maxDuration = 30;

const METHODS = "POST, OPTIONS";

export async function OPTIONS(req: Request) {
  return preflightResponse(req, METHODS);
}

export async function POST(req: Request) {
  const guard = guardRequest(req);
  if (!guard.ok) return guard.response;
  const cors = corsHeaders(guard.origin, METHODS);

  try {
    const rl = await checkRateLimit(req, "gift-voucher-ai");
    if (!rl.ok) return rateLimitResponse(rl.retryAfter, cors);
    const ipRl = await checkRateLimitKeyed("gift-voucher-ip", `ip:${clientIp(req)}`);
    if (!ipRl.ok) return rateLimitResponse(ipRl.retryAfter, cors);

    const read = await readGiftVoucherJson(req);
    if (!read.ok) return giftVoucherBodyErrorResponse(read.reason, resolveLocale(req), cors);
    const input = parseGiftVoucherSuggestInput(read.body, resolveLocale(req));
    const locale = input.ok ? input.value.locale : input.locale;

    const state = await loadGiftVoucherStorefrontState();
    if (!state.available) return giftVoucherUnavailableResponse(locale, cors);
    if (!state.features.ai) {
      return giftVoucherErrorResponse("upstream_unavailable", giftVoucherApiText("ai_off", locale), 503, cors);
    }
    if (!input.ok) return giftVoucherErrorResponse("bad_request", input.message, 400, cors, input.field);

    const result = await suggestGiftVoucherMessages(input.value);
    if (!result.ok) return giftVoucherErrorResponse("upstream_unavailable", result.message, result.status, cors);
    return giftVoucherJsonResponse({ ok: true, suggestions: result.suggestions }, 200, cors);
  } catch (err) {
    reportError(err, { route: "api/gift-vouchers/suggest" });
    return errorResponse("internal_error", "Unexpected server error", 500, cors);
  }
}
