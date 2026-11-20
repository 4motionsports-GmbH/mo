// Geschenkgutscheine — the I/O half of the storefront API (spec §8): what the
// public routes under /api/gift-vouchers/* share. The rules are pure in
// gift-voucher-storefront.mjs (tested); this file gathers their inputs (env
// flags, the admin settings, migration 0083), reads request bodies with a hard
// cap and builds the JSON answers.
//
// Every answer carries the caller's CORS headers (the routes pass them in),
// errors use the house envelope { error: { code, message } } — plus `field`
// for a validation error, so the voucher page can mark the input.

import { isDbConfigured } from "./db";
import { isShopifyConfigured } from "./shopify";
import type { ErrorCode } from "./observability";
import { isGiftVoucherBlobConfigured } from "./gift-voucher-blob";
import { getCachedGiftVoucherSettings, giftVoucherTablesExist } from "./gift-voucher-store";
import { DEFAULT_GIFT_VOUCHER_SETTINGS } from "./gift-voucher-settings.mjs";
import {
  configuredGiftVoucherPrintProvider,
  isGiftVoucherPrintSendsApproved,
  isGiftVouchersEnabled,
} from "./gift-voucher-flags.mjs";
import { isPrintOneConfigured } from "./printone";
import {
  GIFT_VOUCHER_JSON_MAX_BYTES,
  giftVoucherApiText,
  giftVoucherErrorBody,
  giftVoucherStorefrontState,
  parseContentLength,
} from "./gift-voucher-storefront.mjs";

export type GiftVoucherStorefrontState = ReturnType<typeof giftVoucherStorefrontState>;
type Headers = Record<string, string>;

// Migration 0083 rarely changes state: a positive answer is kept 10 minutes
// per instance, a negative one a minute (so running the migration shows up
// quickly). giftVoucherTablesExist never throws (an unknown answer is "yes").
const TABLES_READY_TTL_MS = 10 * 60_000;
const TABLES_MISSING_TTL_MS = 60_000;
let tablesCheck: { at: number; ready: boolean } | null = null;

async function voucherTablesReady(): Promise<boolean> {
  const now = Date.now();
  if (tablesCheck && now - tablesCheck.at < (tablesCheck.ready ? TABLES_READY_TTL_MS : TABLES_MISSING_TTL_MS)) {
    return tablesCheck.ready;
  }
  const ready = await giftVoucherTablesExist();
  tablesCheck = { at: now, ready };
  return ready;
}

/**
 * Does the shop sell vouchers right now, and which features may the page
 * offer (gift-voucher-storefront.mjs giftVoucherStorefrontState)? Switched
 * off, nothing is read from the database. Never throws (the settings and the
 * table check are fail-soft).
 */
export async function loadGiftVoucherStorefrontState(): Promise<GiftVoucherStorefrontState> {
  const enabled = isGiftVouchersEnabled();
  const dbConfigured = isDbConfigured();
  const [settings, tablesReady] =
    enabled && dbConfigured
      ? await Promise.all([getCachedGiftVoucherSettings(), voucherTablesReady()])
      : [{ ...DEFAULT_GIFT_VOUCHER_SETTINGS }, false];
  return giftVoucherStorefrontState({
    enabled,
    settings,
    shopifyConfigured: isShopifyConfigured(),
    dbConfigured,
    tablesReady,
    blobConfigured: isGiftVoucherBlobConfigured(),
    // The same rule as every AI helper: no key, no model call.
    aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    printProvider: configuredGiftVoucherPrintProvider(),
    printOneConfigured: isPrintOneConfigured(),
    printSendsApproved: isGiftVoucherPrintSendsApproved(),
  });
}

/**
 * Read a request body, but never more than `max` bytes: a declared
 * Content-Length above it is refused before reading, a chunked body (no
 * header) is cut off while reading. Null when it is larger.
 */
export async function readGiftVoucherBody(req: Request, max: number): Promise<Buffer | null> {
  const declared = parseContentLength(req.headers.get("content-length"));
  if (declared !== null && declared > max) return null;
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

export type GiftVoucherJsonBody = { ok: true; body: unknown } | { ok: false; reason: "too_large" | "invalid" };

/** A JSON request body of at most 16 KB (a draft is well under 2 KB). */
export async function readGiftVoucherJson(req: Request): Promise<GiftVoucherJsonBody> {
  const bytes = await readGiftVoucherBody(req, GIFT_VOUCHER_JSON_MAX_BYTES);
  if (!bytes) return { ok: false, reason: "too_large" };
  try {
    return { ok: true, body: JSON.parse(bytes.toString("utf8")) };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

/** A JSON answer of a storefront route — never cached (it may carry a token or a balance). */
export function giftVoucherJsonResponse(body: unknown, status: number, headers: Headers): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

/** An error answer: { error: { code, message, field? } }. */
export function giftVoucherErrorResponse(
  code: ErrorCode,
  message: string,
  status: number,
  headers: Headers,
  field: string | null = null
): Response {
  return giftVoucherJsonResponse(giftVoucherErrorBody(code, message, field), status, headers);
}

/** The answer to an oversized (413) or unreadable (400) JSON body. */
export function giftVoucherBodyErrorResponse(reason: "too_large" | "invalid", locale: "de" | "en", headers: Headers): Response {
  return reason === "too_large"
    ? giftVoucherErrorResponse("payload_too_large", giftVoucherApiText("body_too_large", locale), 413, headers)
    : giftVoucherErrorResponse("bad_request", giftVoucherApiText("invalid_json", locale), 400, headers, "body");
}

/** The shop does not sell vouchers right now (switched off or not set up): 409. */
export function giftVoucherUnavailableResponse(locale: "de" | "en", headers: Headers): Response {
  return giftVoucherErrorResponse("bad_request", giftVoucherApiText("unavailable", locale), 409, headers);
}
