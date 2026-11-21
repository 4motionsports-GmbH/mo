// POST /api/gift-vouchers/drafts — save what the customer designed, right
// before „Jetzt kaufen“ / „In den Warenkorb“ (spec §8.6).
//   body: { designKey, amountCents, recipientName, senderName, message, photoId?,
//           delivery: "pdf" | "print",
//           address?: { name, line1, line2?, postalCode, city, country }, locale }
//   → { ok: true, token, textRemoved }
//   400 → { error: { code: "bad_request", message, field } }
//
// The page then adds the voucher variant (and, for the Premium-Karte, the
// print add-on) to the cart, both lines with the private property
// `_mo_gv=<token>`. On orders/paid the issuing pipeline finds the draft by that
// token and copies design, texts, photo and address into the voucher. The
// token only links the design: the amount and the price always come from the
// ordered variant, never from the draft.
//
// Validation (gift-voucher-core.mjs validateGiftVoucherDraftInput): a design
// from the list, the photo design only with a photo id while photos are on,
// texts made printable (emoji etc. removed → `textRemoved`) and within their
// limits, the Premium-Karte only while it can be fulfilled and with a valid
// address in an allowed country. Messages in the body's language. Like the
// preview, the photo must still be in the Blob store (hasGiftVoucherPhotoBytes)
// — else 400 with field `photoId` („bitte lade es noch einmal hoch“): a draft
// with a deleted photo would give a voucher that can never be delivered.
//
// guardRequest (origin + x-ms-chat-key), buckets `gift-voucher` (session) and
// `gift-voucher-ip`. 503 `upstream_unavailable` without a database, 409 while
// the shop does not sell vouchers.

import { corsHeaders, guardRequest, preflightResponse } from "@/lib/security";
import { checkRateLimit, checkRateLimitKeyed, clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { errorResponse, reportError } from "@/lib/observability";
import { resolveLocale } from "@/lib/locale";
import { isDbConfigured } from "@/lib/db";
import { giftVoucherPhotoPathname, hasGiftVoucherPhotoBytes, validateGiftVoucherDraftInput } from "@/lib/gift-voucher-core.mjs";
import { getGiftVoucherBlob } from "@/lib/gift-voucher-blob";
import { giftVoucherPrintCountries } from "@/lib/gift-voucher-flags.mjs";
import { giftVoucherApiText, withGiftVoucherLocale } from "@/lib/gift-voucher-storefront.mjs";
import {
  giftVoucherBodyErrorResponse,
  giftVoucherErrorResponse,
  giftVoucherJsonResponse,
  giftVoucherUnavailableResponse,
  loadGiftVoucherStorefrontState,
  readGiftVoucherJson,
} from "@/lib/gift-voucher-storefront-io";
import { createGiftVoucherDraft } from "@/lib/gift-voucher-store";

export const maxDuration = 10;

const METHODS = "POST, OPTIONS";

export async function OPTIONS(req: Request) {
  return preflightResponse(req, METHODS);
}

export async function POST(req: Request) {
  const guard = guardRequest(req);
  if (!guard.ok) return guard.response;
  const cors = corsHeaders(guard.origin, METHODS);

  try {
    const rl = await checkRateLimit(req, "gift-voucher");
    if (!rl.ok) return rateLimitResponse(rl.retryAfter, cors);
    const ipRl = await checkRateLimitKeyed("gift-voucher-ip", `ip:${clientIp(req)}`);
    if (!ipRl.ok) return rateLimitResponse(ipRl.retryAfter, cors);

    const read = await readGiftVoucherJson(req);
    if (!read.ok) return giftVoucherBodyErrorResponse(read.reason, resolveLocale(req), cors);
    const body = withGiftVoucherLocale(read.body, resolveLocale(req));
    const locale = resolveLocale(req, (body as { locale?: unknown } | null)?.locale);

    if (!isDbConfigured()) {
      return giftVoucherErrorResponse("upstream_unavailable", giftVoucherApiText("upstream", locale), 503, cors);
    }
    const state = await loadGiftVoucherStorefrontState();
    if (!state.available) return giftVoucherUnavailableResponse(locale, cors);

    const input = validateGiftVoucherDraftInput(body, {
      allowPhoto: state.features.photo,
      allowPrint: state.features.print,
      countries: giftVoucherPrintCountries(),
    });
    if (!input.ok) return giftVoucherErrorResponse("bad_request", input.message, 400, cors, input.field);
    const v = input.value;

    if (v.designKey === "photo") {
      const pathname = giftVoucherPhotoPathname(v.photoId);
      const photo = pathname ? await getGiftVoucherBlob(pathname) : null;
      if (!hasGiftVoucherPhotoBytes(photo?.bytes)) {
        return giftVoucherErrorResponse("bad_request", giftVoucherApiText("photo_missing", v.locale), 400, cors, "photoId");
      }
    }

    const draft = await createGiftVoucherDraft({
      designKey: v.designKey,
      amountCents: v.amountCents,
      recipientName: v.recipientName,
      senderName: v.senderName,
      message: v.message,
      photoId: v.photoId,
      delivery: v.delivery,
      address: v.address,
      locale: v.locale,
    });
    // The store reports its own failures (never with the texts or the address).
    if (!draft) return giftVoucherErrorResponse("upstream_unavailable", giftVoucherApiText("upstream", v.locale), 503, cors);

    return giftVoucherJsonResponse({ ok: true, token: draft.token, textRemoved: v.textRemoved }, 200, cors);
  } catch (err) {
    reportError(err, { route: "api/gift-vouchers/drafts" });
    return errorResponse("internal_error", "Unexpected server error", 500, cors);
  }
}
