// POST /api/gift-vouchers/balance — „Guthaben prüfen“ on the voucher page
// (spec §8.7, anchor #guthaben; the QR code on every voucher points there).
//   body: { code, locale? }
//   → { ok: true, found: false }
//   → { ok: true, found: true, balanceCents, amountCents, currency: "EUR",
//       expiresOn, state: "active" | "used" | "expired" | "deactivated" }
//
// The code is looked up by its sha256 hash only (gift-voucher-core.mjs
// giftVoucherCodeHash) — never stored, logged or echoed. Only vouchers Mo
// handed out are found (issued or deactivated); an unknown code and every
// other voucher answer `found: false` and nothing else. The balance is read
// live from Shopify (bounded to 4 s, no retry) and stored; when Shopify does
// not answer in time the stored balance is shown.
//
// Works while the shop does not sell vouchers (cards bought earlier stay
// valid). guardRequest (origin + x-ms-chat-key) and the IP-keyed bucket
// `gift-voucher-balance` (10 / 10 min) — the guess guard; without the limiter
// (no KV) the route fails closed. 400 for something that is not a code, 503
// without a database.

import { corsHeaders, guardRequest, preflightResponse } from "@/lib/security";
import { checkRateLimitKeyed, clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { errorResponse, reportError } from "@/lib/observability";
import { resolveLocale } from "@/lib/locale";
import { isDbConfigured } from "@/lib/db";
import { giftVoucherCodeHash } from "@/lib/gift-voucher-core.mjs";
import {
  berlinDate,
  giftVoucherApiText,
  giftVoucherBalanceAnswer,
  parseGiftVoucherBalanceInput,
} from "@/lib/gift-voucher-storefront.mjs";
import {
  giftVoucherBodyErrorResponse,
  giftVoucherErrorResponse,
  giftVoucherJsonResponse,
  readGiftVoucherJson,
} from "@/lib/gift-voucher-storefront-io";
import { getGiftVoucherByCodeHash, updateGiftVoucherBalance } from "@/lib/gift-voucher-store";
import { getShopifyGiftCard, type ShopifyGiftCardInfo } from "@/lib/shopify-gift-cards";

export const maxDuration = 10;

const METHODS = "POST, OPTIONS";
/** The live Shopify read is bounded (no throttle wait, no retry) — else the stored balance. */
const LIVE_TIMEOUT_MS = 4_000;

export async function OPTIONS(req: Request) {
  return preflightResponse(req, METHODS);
}

export async function POST(req: Request) {
  const guard = guardRequest(req);
  if (!guard.ok) return guard.response;
  const cors = corsHeaders(guard.origin, METHODS);

  try {
    const rl = await checkRateLimitKeyed("gift-voucher-balance", `ip:${clientIp(req)}`);
    if (!rl.ok) return rateLimitResponse(rl.retryAfter, cors);

    const read = await readGiftVoucherJson(req);
    if (!read.ok) return giftVoucherBodyErrorResponse(read.reason, resolveLocale(req), cors);
    const input = parseGiftVoucherBalanceInput(read.body, resolveLocale(req));
    if (!input.ok) return giftVoucherErrorResponse("bad_request", input.message, 400, cors, input.field);

    if (!isDbConfigured()) {
      return giftVoucherErrorResponse("upstream_unavailable", giftVoucherApiText("upstream", input.locale), 503, cors);
    }

    const hash = giftVoucherCodeHash(input.code);
    const voucher = hash ? await getGiftVoucherByCodeHash(hash) : null;
    const today = berlinDate(new Date());
    if (!voucher || voucher.status !== "issued") {
      // Unknown, not handed out (found: false) — or deactivated: no live read needed.
      return giftVoucherJsonResponse(giftVoucherBalanceAnswer({ voucher, live: null, today }), 200, cors);
    }

    let live: ShopifyGiftCardInfo | null = null;
    if (voucher.shopifyGiftCardId) {
      // getShopifyGiftCard never throws and reports its own failures (never the code).
      const result = await getShopifyGiftCard(voucher.shopifyGiftCardId, { timeoutMs: LIVE_TIMEOUT_MS });
      if (result.ok && result.card) {
        live = result.card;
        // Fail-soft: the answer does not depend on storing it.
        await updateGiftVoucherBalance(voucher.id, live.balanceCents);
      }
    }

    return giftVoucherJsonResponse(giftVoucherBalanceAnswer({ voucher, live, today }), 200, cors);
  } catch (err) {
    reportError(err, { route: "api/gift-vouchers/balance" });
    return errorResponse("internal_error", "Unexpected server error", 500, cors);
  }
}
