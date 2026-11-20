// print.one webhooks — the signature check and the event interpretation in
// front of /api/webhooks/printone (pure; tests in printone-webhook.test.mjs).
//
// print.one signs every webhook: header x-webhook-hmac-sha256 =
// base64( HMAC-SHA256(secret, rawBody) ), the secret used as a UTF-8 string
// (official SDK, PrintOne.isValidWebhook). The body is
// { data: <order>, event: "order_status_update", created_at } (the SDK types
// say createdAt — both are read).
//
// HMAC FIRST: the route hands the RAW bytes in, the signature is checked
// before anything is parsed, and the 32-byte digests are compared in constant
// time. Only the body is signed — the x-webhook-event header is not, so the
// event name is taken from the body and the header is only a fallback.
//
// No timestamp, no event id: a captured request could be replayed. The ingest
// is therefore idempotent and monotonic — a repeated or older status never
// changes a print job (canAdvancePrintJobStatus), and an update only ever
// applies to a job whose print.one order id Mo stored itself.
//
// ROTATION: PRINTONE_WEBHOOK_SECRET may hold several secrets separated by
// commas or whitespace; a request signed with ANY of them is accepted, so a
// new secret can go in before the old one comes out.
//
// Nothing here throws — every function answers a typed result.

import { createHmac, timingSafeEqual } from "node:crypto";
import { parsePrintOneOrder } from "./printone-core.mjs";

/** @typedef {import("./printone-core.mjs").PrintOneOrder} PrintOneOrder */

export const PRINTONE_SIGNATURE_HEADER = "x-webhook-hmac-sha256";
export const PRINTONE_EVENT_HEADER = "x-webhook-event";
export const PRINTONE_ORDER_STATUS_EVENT = "order_status_update";
/** Largest webhook body the route reads (an order is a few KB). */
export const PRINTONE_WEBHOOK_MAX_BYTES = 256 * 1024;

/**
 * PRINTONE_WEBHOOK_SECRET → the individual secrets (comma / whitespace list,
 * blanks and duplicates dropped, at most 5).
 * @param {unknown} raw
 * @returns {string[]}
 */
export function parsePrintOneWebhookSecrets(raw) {
  if (typeof raw !== "string") return [];
  const out = [];
  for (const s of raw.split(/[\s,]+/)) {
    const t = s.trim();
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= 5) break;
  }
  return out;
}

/**
 * The signature print.one sends for this body (tests, local tooling).
 * @param {string | Uint8Array} rawBody
 * @param {string} secret
 */
export function signPrintOneWebhookBody(rawBody, secret) {
  return createHmac("sha256", secret).update(rawBody).digest("base64");
}

/**
 * The two print.one headers from a Headers object (case-insensitive) or a
 * plain object with lower-case keys.
 * @param {{ get(name: string): string | null } | Record<string, string | string[] | undefined> | null | undefined} headers
 * @returns {{ signature: string | null, event: string | null }}
 */
export function readPrintOneWebhookHeaders(headers) {
  /** @param {string} name @returns {string | null} */
  const read = (name) => {
    if (!headers) return null;
    if (typeof headers.get === "function") {
      const v = /** @type {{ get(name: string): string | null }} */ (headers).get(name);
      return typeof v === "string" ? v : null;
    }
    const v = /** @type {Record<string, string | string[] | undefined>} */ (headers)[name];
    return typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : null;
  };
  return { signature: read(PRINTONE_SIGNATURE_HEADER), event: read(PRINTONE_EVENT_HEADER) };
}

/** base64 of a 32-byte digest: 43 characters + "=". */
const DIGEST_B64 = /^[A-Za-z0-9+/]{43}=$/;

/**
 * Check the signature over the RAW body against every configured secret, in
 * constant time per comparison.
 * @param {{ rawBody: string | Uint8Array, signature: string | null | undefined, secret: string | readonly string[] | null | undefined }} input
 *   `secret`: the env value (a list is split) or the parsed list
 * @returns {{ ok: true } | { ok: false, reason: "no_secret" | "missing_signature" | "malformed_signature" | "invalid_signature" }}
 */
export function verifyPrintOneWebhookSignature({ rawBody, signature, secret }) {
  const secrets = Array.isArray(secret)
    ? secret.filter((s) => typeof s === "string" && s.length > 0)
    : parsePrintOneWebhookSecrets(secret);
  if (secrets.length === 0) return { ok: false, reason: "no_secret" };
  if (typeof signature !== "string" || !signature.trim()) return { ok: false, reason: "missing_signature" };
  const provided = signature.trim().replace(/^sha256=/i, "");
  if (!DIGEST_B64.test(provided)) return { ok: false, reason: "malformed_signature" };
  const providedBytes = Buffer.from(provided, "base64");
  if (providedBytes.length !== 32) return { ok: false, reason: "malformed_signature" };
  if (typeof rawBody !== "string" && !(rawBody instanceof Uint8Array)) return { ok: false, reason: "invalid_signature" };
  let match = false;
  for (const s of secrets) {
    const expected = createHmac("sha256", s).update(rawBody).digest();
    // Every secret is compared (no early exit) — the answer does not reveal which one matched.
    if (expected.length === providedBytes.length && timingSafeEqual(expected, providedBytes)) match = true;
  }
  return match ? { ok: true } : { ok: false, reason: "invalid_signature" };
}

/**
 * Parse the (verified) body as JSON — never throws.
 * @param {string | Uint8Array} rawBody
 * @returns {{ ok: true, payload: unknown } | { ok: false }}
 */
export function parsePrintOneWebhookPayload(rawBody) {
  try {
    const text = typeof rawBody === "string" ? rawBody : Buffer.from(rawBody).toString("utf8");
    return { ok: true, payload: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** @param {unknown} v @returns {string | null} */
function isoOrNull(v) {
  if (typeof v !== "string" || !v.trim()) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * What a verified webhook means for Mo. Only `order_status_update` with an
 * order that has an id is acted on; every other event (template previews,
 * batches, coupons, QR scans — the latter also carries an order) is ignored.
 * @param {unknown} payload
 * @param {{ eventHeader?: string | null }} [o]
 * @returns {{ kind: "order_status", order: PrintOneOrder, eventAt: string | null }
 *   | { kind: "ignored", reason: "event" | "shape" }}
 */
export function interpretPrintOneWebhook(payload, { eventHeader = null } = {}) {
  const p = payload && typeof payload === "object" && !Array.isArray(payload) ? /** @type {Record<string, unknown>} */ (payload) : null;
  if (!p) return { kind: "ignored", reason: "shape" };
  const bodyEvent = typeof p.event === "string" ? p.event.trim() : "";
  const event = bodyEvent || (typeof eventHeader === "string" ? eventHeader.trim() : "");
  if (event !== PRINTONE_ORDER_STATUS_EVENT) return { kind: "ignored", reason: "event" };
  const order = parsePrintOneOrder(p.data);
  if (!order) return { kind: "ignored", reason: "shape" };
  return { kind: "order_status", order, eventAt: isoOrNull(p.created_at) ?? isoOrNull(p.createdAt) };
}
