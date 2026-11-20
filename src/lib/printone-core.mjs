// print.one (v2 REST) — the pure part of the Premium-Karte print pipeline
// (spec §10, docs/GIFT_VOUCHERS.md). No I/O here: lib/printone.ts does the
// HTTP, lib/gift-voucher-print.ts the pipeline, scripts/verify-printone.mjs the
// setup check — all three share these helpers (scripts cannot import TS), and
// printone-core.test.mjs pins them.
//
// Facts (OpenAPI v2 + help center, read 2026-11-20 — api.print.one itself
// could not be called from the build sandbox, so the shapes below come from
// the published schemas):
//   · base https://api.print.one, auth header `x-api-key`. A TEST key creates
//     orders that are never printed or posted (isBillable false); a LIVE key
//     prints at once and bills the prepaid balance.
//   · POST /v2/orders, one card per call: { templateId, finish, recipient,
//     mergeVariables, billingId }. mergeVariables are STRINGS and every
//     variable the template uses must be present (≤ 16 KB). Header
//     Idempotency-Key (≤ 255 characters, kept 24 h; the same key with another
//     body is an error) — Mo sends gift-voucher-print-<jobId> and builds the
//     body only from the job row, so a retry is byte-identical.
//   · GET /v2/orders/{id}; POST /v2/orders/{id}/cancel (412 = "not cancellable
//     yet" right after creation, or "anymore" once in production).
//   · Order statuses → print-job statuses (applied monotonically through
//     canAdvancePrintJobStatus, so a late or repeated update changes nothing):
//       order_created → submitted        order_pdf_queued / _created → printing
//       order_scheduled → submitted      order_pdf_delivered → sent
//       order_cancelled → cancelled      order_failed → failed
//   · Errors: v2 { statusCode, message: string[] | string }, v3 { status,
//     message, code (10001…), uri, errors? }. 5xx / 408 / 429 are temporary.
//   · Rate limit 150 requests / 10 min per endpoint, except order creation.
//   · The card: one GREETINGCARD_SQ14 template whose two pages (Outside,
//     Inside) only hold a full-bleed <img> of {{outside_url}} / {{inside_url}}.
//     Mo renders both spreads itself (3378 × 1724 px incl. 3 mm bleed, 300 dpi,
//     fold in the middle; print.one prints the address in a 77 mm circle on
//     the back panel) and serves them while the job is open at
//     /api/gift-vouchers/print-asset/<assetToken>-<outside|inside>.jpg.

import { giftVoucherAddressToJson, validatePostalAddress } from "./gift-voucher-core.mjs";

/** @typedef {"review" | "queued" | "submitting" | "submitted" | "printing" | "sent" | "failed" | "cancelled" | "done"} PrintJobStatus */
/** @typedef {"outside" | "inside"} PrintAssetSide */
/**
 * @typedef {{ name: string, address: string, addressLine2?: string, postalCode: string,
 *   city: string, country: string }} PrintOneRecipient
 */
/**
 * @typedef {{ templateId: string, finish: "MATTE" | "GLOSSY", recipient: PrintOneRecipient,
 *   mergeVariables: { outside_url: string, inside_url: string }, billingId?: string }} PrintOneOrderBody
 */
/**
 * @typedef {{ id: string, status: string | null, friendlyStatus: string | null,
 *   jobStatus: PrintJobStatus | null, errors: string[], warnings: string[],
 *   isBillable: boolean | null, format: string | null, templateId: string | null,
 *   createdAt: string | null, updatedAt: string | null, sendDate: string | null,
 *   mergeVariables: Record<string, string> }} PrintOneOrder
 */
/** @typedef {{ status: number | null, code: string | null, messages: string[] }} PrintOneError */
/**
 * network  — no answer (timeout, connection) or an unreadable 2xx: the outcome is UNKNOWN
 * server   — 5xx / 408 / 425 / 429: temporary
 * auth     — 401 / 403: key wrong or without scope
 * funds    — prepaid balance too low (10078 InsufficientFunds)
 * conflict — Idempotency-Key conflict (409 or an "idempotency" message)
 * not_found — 404 (an unknown order; on create: the template)
 * invalid  — any other 4xx: print.one refused the request itself
 * not_cancellable_yet / not_cancellable — 412 on cancel
 * @typedef {"network" | "server" | "auth" | "funds" | "conflict" | "not_found" | "invalid"
 *   | "not_cancellable_yet" | "not_cancellable"} PrintOneFailureKind
 */
/** @typedef {"create" | "read" | "cancel" | "list"} PrintOneOp */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PRINTONE_DEFAULT_API_BASE = "https://api.print.one";
export const PRINTONE_TEMPLATE_FORMAT = "GREETINGCARD_SQ14";
/** The two template variables (lower-case letters and underscores, as print.one asks). */
export const PRINTONE_MERGE_VARIABLES = Object.freeze({ outside: "outside_url", inside: "inside_url" });
export const PRINT_ASSET_SIDES = Object.freeze(/** @type {const} */ (["outside", "inside"]));
export const PRINTONE_IDEMPOTENCY_PREFIX = "gift-voucher-print-";
/** Where the print files are served (public, token in the file name). */
export const PRINT_ASSET_ROUTE = "/api/gift-vouchers/print-asset";
/** Blob prefix of the print files (= GIFT_VOUCHER_PRINT_PREFIX of the voucher core). */
export const PRINT_ASSET_PREFIX = "gift-voucher-print/";

/**
 * The SQ14 spread print.one expects per page (help center „Products“):
 * 3378 × 1724 px including 35 px (3 mm) bleed all round, 300 dpi, folded in
 * the middle; the address circle on the back panel is 77 mm = 909 px.
 */
export const PRINTONE_SQ14_SPREAD = Object.freeze({
  widthPx: 3378,
  heightPx: 1724,
  bleedPx: 35,
  dpi: 300,
  foldX: 1689,
  addressCirclePx: 909,
});

/** print.one order status → print-job status (spec §10). */
export const PRINTONE_ORDER_STATUS_MAP = Object.freeze(
  /** @type {Readonly<Record<string, PrintJobStatus>>} */ ({
    order_created: "submitted",
    order_pdf_queued: "printing",
    order_pdf_created: "printing",
    order_scheduled: "submitted",
    order_pdf_delivered: "sent",
    order_cancelled: "cancelled",
    order_failed: "failed",
  })
);

/** friendlyStatus (Processing, Success, Scheduled, Sent, Cancelled, Failed) — fallback for an unknown status. */
const FRIENDLY_STATUS_MAP = Object.freeze(
  /** @type {Readonly<Record<string, PrintJobStatus>>} */ ({
    processing: "submitted",
    success: "submitted",
    scheduled: "submitted",
    sent: "sent",
    cancelled: "cancelled",
    canceled: "cancelled",
    failed: "failed",
  })
);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** @param {unknown} v @returns {Record<string, unknown> | null} */
function asObject(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : null;
}

/** @param {unknown} v @returns {string | null} */
function str(v) {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** One line, no control characters, at most `max` characters. @param {string} s @param {number} max */
function oneLine(s, max) {
  const flat = s.replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** @param {unknown} v @returns {string | null} an ISO timestamp, or null */
function isoOrNull(v) {
  if (typeof v !== "string" || !v.trim()) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * An absolute https URL (or plain http to localhost when `localHttp`), no
 * query or fragment, without a trailing slash — else null.
 * @param {unknown} raw
 * @param {{ localHttp?: boolean }} [o]
 * @returns {string | null}
 */
export function publicHttpsBaseUrl(raw, { localHttp = false } = {}) {
  const t = str(raw);
  if (!t) return null;
  let u;
  try {
    u = new URL(t);
  } catch {
    return null;
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  if (u.protocol !== "https:" && !(localHttp && local && u.protocol === "http:")) return null;
  if (u.search || u.hash || u.username || u.password) return null;
  return `${u.origin}${u.pathname}`.replace(/\/+$/, "");
}

/**
 * A full API URL: base (no trailing slash) + path + query (null / undefined /
 * "" values are left out).
 * @param {string} base
 * @param {string} path  starts with "/"
 * @param {Record<string, string | number | null | undefined>} [query]
 */
export function printOneApiUrl(base, path, query) {
  const root = String(base || PRINTONE_DEFAULT_API_BASE).replace(/\/+$/, "");
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === null || v === undefined || v === "") continue;
    params.append(k, String(v));
  }
  const qs = params.toString();
  return `${root}${path}${qs ? `?${qs}` : ""}`;
}

/** A print.one order id ("ord_…") safe to put into a URL path. @param {unknown} id @returns {id is string} */
export function isPrintOneOrderId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

/** @param {unknown} id @returns {string | null} */
export function printOneOrderPath(id) {
  return isPrintOneOrderId(id) ? `/v2/orders/${id}` : null;
}

/** @param {unknown} id @returns {string | null} */
export function printOneCancelPath(id) {
  return isPrintOneOrderId(id) ? `/v2/orders/${id}/cancel` : null;
}

/** @param {unknown} id @returns {string | null} — the order's preview PDF (verify script) */
export function printOnePreviewPath(id) {
  return isPrintOneOrderId(id) ? `/v2/storage/order/preview/${id}` : null;
}

/**
 * The Idempotency-Key of a print job: gift-voucher-print-<jobId>. Same key for
 * every attempt, so a retry after a lost answer never prints a second card.
 * @param {unknown} jobId
 * @returns {string | null}
 */
export function giftVoucherPrintIdempotencyKey(jobId) {
  return typeof jobId === "number" && Number.isSafeInteger(jobId) && jobId > 0 ? `${PRINTONE_IDEMPOTENCY_PREFIX}${jobId}` : null;
}

// ---------------------------------------------------------------------------
// Print files (assets)
// ---------------------------------------------------------------------------

/** An asset token (newOpaqueToken: base64url, 22–64 characters). @param {unknown} t @returns {t is string} */
export function isValidPrintAssetToken(t) {
  return typeof t === "string" && /^[A-Za-z0-9_-]{22,64}$/.test(t);
}

/** @param {unknown} side @returns {side is PrintAssetSide} */
export function isPrintAssetSide(side) {
  return side === "outside" || side === "inside";
}

/**
 * "<token>-<side>.jpg", or null.
 * @param {unknown} token @param {unknown} side
 * @returns {string | null}
 */
export function giftVoucherPrintAssetFile(token, side) {
  return isValidPrintAssetToken(token) && isPrintAssetSide(side) ? `${token}-${side}.jpg` : null;
}

/**
 * The private Blob pathname "gift-voucher-print/<token>-<side>.jpg", or null.
 * @param {unknown} token @param {unknown} side
 * @returns {string | null}
 */
export function giftVoucherPrintAssetPathname(token, side) {
  const file = giftVoucherPrintAssetFile(token, side);
  return file ? `${PRINT_ASSET_PREFIX}${file}` : null;
}

/**
 * Parse the public file name strictly: "<token>-outside.jpg" /
 * "<token>-inside.jpg" (lower-case extension, no separators, no encoding
 * tricks) — anything else is null, so the route never reads another file.
 * @param {unknown} file
 * @returns {{ token: string, side: PrintAssetSide } | null}
 */
export function parseGiftVoucherPrintAssetFile(file) {
  if (typeof file !== "string" || file.length > 90) return null;
  const m = file.match(/^([A-Za-z0-9_-]{22,64})-(outside|inside)\.jpg$/);
  if (!m) return null;
  return { token: m[1], side: /** @type {PrintAssetSide} */ (m[2]) };
}

/**
 * The public URL print.one loads a spread from:
 * <base>/api/gift-vouchers/print-asset/<token>-<side>.jpg — or null.
 * @param {unknown} baseUrl  publicHttpsBaseUrl(PUBLIC_BASE_URL)
 * @param {unknown} token @param {unknown} side
 * @returns {string | null}
 */
export function giftVoucherPrintAssetUrl(baseUrl, token, side) {
  const base = publicHttpsBaseUrl(baseUrl, { localHttp: true });
  const file = giftVoucherPrintAssetFile(token, side);
  return base && file ? `${base}${PRINT_ASSET_ROUTE}/${file}` : null;
}

// ---------------------------------------------------------------------------
// Order body
// ---------------------------------------------------------------------------

/**
 * The stored address (snake_case JSONB of recipient_postal_address, or the
 * store's camelCase GiftVoucherAddress) → print.one's AddressDto. addressLine2
 * is left out when empty (an empty string would be refused). Null when a
 * required part is missing.
 * @param {unknown} address
 * @returns {PrintOneRecipient | null}
 */
export function printOneRecipientFromAddress(address) {
  const a = giftVoucherAddressToJson(address);
  if (!a) return null;
  /** @type {PrintOneRecipient} */
  const recipient = {
    name: a.name,
    address: a.address_line_1,
    postalCode: a.postal_code,
    city: a.city,
    country: a.country.toUpperCase(),
  };
  const line2 = str(a.address_line_2);
  if (line2) recipient.addressLine2 = line2;
  return recipient;
}

/**
 * An absolute https URL print.one can fetch (plain http only to localhost —
 * a local test server). @param {unknown} url
 */
function isFetchableUrl(url) {
  if (typeof url !== "string" || url.length > 2000 || /\s/.test(url)) return false;
  try {
    const u = new URL(url);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
    return (u.protocol === "https:" || (u.protocol === "http:" && local)) && !u.username && !u.password;
  } catch {
    return false;
  }
}

/**
 * Build the POST /v2/orders body. Only from the job row and the env, with a
 * fixed key order — the same job always gives the same bytes, which the
 * Idempotency-Key requires. No sender (print.one uses the company's return
 * address), no sendDate (next print run), no metadata (not in the schema).
 * @param {{ templateId: unknown, finish?: unknown, billingId?: unknown, address: unknown,
 *   outsideUrl: unknown, insideUrl: unknown }} input
 * @returns {{ ok: true, body: PrintOneOrderBody } | { ok: false, reason: "template" | "address" | "urls" }}
 */
export function buildPrintOneOrderBody(input) {
  const templateId = str(input.templateId);
  if (!templateId || templateId.length > 128) return { ok: false, reason: "template" };
  const recipient = printOneRecipientFromAddress(input.address);
  if (!recipient) return { ok: false, reason: "address" };
  if (!isFetchableUrl(input.outsideUrl) || !isFetchableUrl(input.insideUrl)) return { ok: false, reason: "urls" };
  const finish = str(input.finish)?.toUpperCase() === "GLOSSY" ? "GLOSSY" : "MATTE";
  const billingId = str(input.billingId);
  /** @type {PrintOneOrderBody} */
  const body = {
    templateId,
    finish,
    recipient,
    mergeVariables: {
      outside_url: /** @type {string} */ (input.outsideUrl),
      inside_url: /** @type {string} */ (input.insideUrl),
    },
  };
  if (billingId) body.billingId = billingId.slice(0, 64);
  return { ok: true, body };
}

// ---------------------------------------------------------------------------
// Responses: orders, statuses, errors
// ---------------------------------------------------------------------------

/**
 * print.one's order status (or, for an unknown one, its friendlyStatus) → the
 * print-job status it means; null when neither is known (the job keeps its
 * status, only provider_status is recorded).
 * @param {unknown} status
 * @param {unknown} [friendlyStatus]
 * @returns {PrintJobStatus | null}
 */
export function mapPrintOneOrderStatus(status, friendlyStatus) {
  const s = str(status)?.toLowerCase();
  if (s && Object.prototype.hasOwnProperty.call(PRINTONE_ORDER_STATUS_MAP, s)) return PRINTONE_ORDER_STATUS_MAP[s];
  const f = str(friendlyStatus)?.toLowerCase();
  if (f && Object.prototype.hasOwnProperty.call(FRIENDLY_STATUS_MAP, f)) return FRIENDLY_STATUS_MAP[f];
  return null;
}

/** An order's errors / warnings (strings, or objects with a message) → at most 10 lines. @param {unknown} v @returns {string[]} */
function stringList(v) {
  if (!Array.isArray(v)) return [];
  /** @type {string[]} */
  const out = [];
  for (const item of v) {
    const message = asObject(item)?.message;
    const s = typeof item === "string" ? item : typeof message === "string" ? message : null;
    if (s && s.trim()) out.push(oneLine(s, 200));
    if (out.length >= 10) break;
  }
  return out;
}

/**
 * An order object (CreateOrderResponse: create, read, cancel, list item,
 * webhook `data`) → the fields Mo uses, or null without an id.
 * @param {unknown} json
 * @returns {PrintOneOrder | null}
 */
export function parsePrintOneOrder(json) {
  const o = asObject(json);
  const id = o ? o.id : null;
  if (!o || !isPrintOneOrderId(id)) return null;
  const status = str(o.status);
  const friendlyStatus = str(o.friendlyStatus);
  /** @type {Record<string, string>} */
  const mergeVariables = {};
  const mv = asObject(o.mergeVariables);
  if (mv) {
    for (const [k, v] of Object.entries(mv)) {
      if (typeof v === "string" && k.length <= 64) mergeVariables[k] = v;
    }
  }
  return {
    id,
    status: status ? status.slice(0, 100) : null,
    friendlyStatus: friendlyStatus ? friendlyStatus.slice(0, 100) : null,
    jobStatus: mapPrintOneOrderStatus(status, friendlyStatus),
    errors: stringList(o.errors),
    warnings: stringList(o.warnings),
    isBillable: typeof o.isBillable === "boolean" ? o.isBillable : o.isBillable === "true" ? true : o.isBillable === "false" ? false : null,
    format: str(o.format),
    templateId: str(o.templateId),
    createdAt: isoOrNull(o.createdAt),
    updatedAt: isoOrNull(o.updatedAt),
    sendDate: isoOrNull(o.sendDate),
    mergeVariables,
  };
}

/**
 * A page of GET /v2/orders (PaginatedResponseDto) → its orders and whether
 * another page exists.
 * @param {unknown} json
 * @returns {{ orders: PrintOneOrder[], hasMore: boolean }}
 */
export function parsePrintOneOrderList(json) {
  const o = asObject(json);
  const data = o && Array.isArray(o.data) ? o.data : Array.isArray(json) ? json : [];
  /** @type {PrintOneOrder[]} */
  const orders = [];
  for (const item of data) {
    const order = parsePrintOneOrder(item);
    if (order) orders.push(order);
  }
  let hasMore = false;
  if (o) {
    const page = Number(o.page);
    const pages = Number(o.pages);
    hasMore = typeof o.nextUrl === "string" && o.nextUrl.length > 0
      ? true
      : Number.isFinite(page) && Number.isFinite(pages) && page < pages;
  }
  return { orders, hasMore };
}

/**
 * Does this order carry the print files of `token` (its outside_url or
 * inside_url names "<token>-outside.jpg" / "<token>-inside.jpg")? This is how
 * Mo recognises its own order again after an answer was lost.
 * @param {PrintOneOrder | null | undefined} order
 * @param {unknown} token
 */
export function printOneOrderUsesAssetToken(order, token) {
  if (!order || !isValidPrintAssetToken(token)) return false;
  const outside = order.mergeVariables[PRINTONE_MERGE_VARIABLES.outside];
  const inside = order.mergeVariables[PRINTONE_MERGE_VARIABLES.inside];
  return (
    (typeof outside === "string" && outside.endsWith(`/${token}-outside.jpg`)) ||
    (typeof inside === "string" && inside.endsWith(`/${token}-inside.jpg`))
  );
}

/**
 * The query of one order-list page (newest first; at most 200 per page). The
 * pipeline's lookup reads it unfiltered; `billingId` narrows a listing to one
 * cost centre (documented syntax filter.billingId=$eq:<id>).
 * @param {{ page?: number, limit?: number, billingId?: string | null }} [o]
 * @returns {Record<string, string>}
 */
export function printOneOrderListQuery({ page = 1, limit = 100, billingId = null } = {}) {
  /** @type {Record<string, string>} */
  const q = {
    page: String(Math.max(1, Math.floor(page))),
    limit: String(Math.min(200, Math.max(1, Math.floor(limit)))),
    sortBy: "createdAt:DESC",
  };
  const b = str(billingId);
  if (b) q["filter.billingId"] = `$eq:${b}`;
  return q;
}

/** @param {unknown} v @returns {string | null} */
function codeOf(v) {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && /^-?\d{1,6}$/.test(v.trim())) return v.trim();
  return null;
}

/**
 * Any error body → status, print.one error code and messages (each one line,
 * ≤ 200 characters, at most 5). Understands v2 ({ statusCode, message:
 * string[] | string, error? }) and v3 ({ status, message, code, uri,
 * errors?: [{ code, message, errors? }] }); a non-JSON body (an HTML error
 * page) gives no messages.
 * @param {number | null} httpStatus
 * @param {unknown} body  parsed JSON, or the raw text
 * @returns {PrintOneError}
 */
export function parsePrintOneError(httpStatus, body) {
  const status = typeof httpStatus === "number" && Number.isFinite(httpStatus) ? httpStatus : null;
  /** @type {string[]} */
  const messages = [];
  /** @param {unknown} m */
  const add = (m) => {
    if (typeof m !== "string" || !m.trim()) return;
    const line = oneLine(m, 200);
    if (line && !messages.includes(line) && messages.length < 5) messages.push(line);
  };
  let code = null;
  const o = asObject(body);
  if (o) {
    if (Array.isArray(o.message)) o.message.forEach(add);
    else add(o.message);
    code = codeOf(o.code);
    /** @param {unknown} list @param {number} depth */
    const walk = (list, depth) => {
      if (!Array.isArray(list) || depth > 2) return;
      for (const e of list) {
        const eo = asObject(e);
        if (!eo) {
          add(e);
          continue;
        }
        add(eo.message);
        if (!code) code = codeOf(eo.code);
        walk(eo.errors, depth + 1);
      }
    };
    walk(o.errors, 0);
    if (messages.length === 0) add(o.error);
  } else if (typeof body === "string") {
    const t = body.trim();
    if (t && !t.startsWith("<")) add(t);
  }
  return { status, code, messages };
}

/**
 * What kind of failure this is (see PrintOneFailureKind) — the pipeline
 * decides retry / fail / adopt from it.
 * @param {PrintOneError} error
 * @param {PrintOneOp} [op]
 * @returns {PrintOneFailureKind}
 */
export function classifyPrintOneFailure(error, op = "create") {
  const status = error && typeof error.status === "number" ? error.status : null;
  if (status === null) return "network";
  const text = (error.messages ?? []).join(" ").toLowerCase();
  if (op === "cancel" && status === 412) {
    return /\byet\b|noch nicht/.test(text) ? "not_cancellable_yet" : "not_cancellable";
  }
  if (error.code === "10078" || status === 402 || /insufficient\s*(funds|balance|credit)|not enough (balance|credit)/.test(text)) {
    return "funds";
  }
  if (status === 409 || /idempoten/.test(text)) return "conflict";
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 408 || status === 425 || status === 429 || status >= 500) return "server";
  if (status >= 400) return "invalid";
  return "network";
}

/**
 * The admin-facing German text of a failure (stored as the print job's error;
 * never sent to reportError — print.one's messages may echo request values).
 * @param {PrintOneFailureKind | "unconfigured"} kind
 * @param {PrintOneError | null} error
 * @param {PrintOneOp} [op]
 * @returns {string}
 */
export function describePrintOneFailure(kind, error, op = "create") {
  const status = error?.status ?? null;
  const http = status !== null ? ` (HTTP ${status})` : "";
  const details = error && error.messages.length > 0 ? `: ${error.messages.join(" · ")}` : "";
  /** @type {string} */
  let text;
  switch (kind) {
    case "unconfigured":
      text = "print.one ist nicht eingerichtet (PRINTONE_API_KEY / PRINTONE_TEMPLATE_ID).";
      break;
    case "network":
      text = "print.one ist nicht erreichbar (Zeitüberschreitung oder Netzwerkfehler).";
      break;
    case "server":
      text = `print.one meldet einen vorübergehenden Fehler${http}${details}`;
      break;
    case "auth":
      text = `print.one lehnt den Zugriff ab${http} — PRINTONE_API_KEY prüfen${details}`;
      break;
    case "funds":
      text = `Das Guthaben bei print.one reicht nicht — bitte im print.one-Portal aufladen${details}`;
      break;
    case "conflict":
      text = `print.one meldet einen Konflikt mit dem Idempotency-Key${http} — der Auftrag wird abgeglichen${details}`;
      break;
    case "not_found":
      text =
        op === "create"
          ? `print.one findet die Vorlage nicht${http} — PRINTONE_TEMPLATE_ID prüfen${details}`
          : `print.one kennt diesen Auftrag nicht${http}${details}`;
      break;
    case "not_cancellable_yet":
      text = "print.one kann den Auftrag noch nicht stornieren — bitte in ein paar Minuten noch einmal versuchen.";
      break;
    case "not_cancellable":
      text = "print.one kann den Auftrag nicht mehr stornieren — die Karte ist schon in Produktion.";
      break;
    case "invalid":
    default:
      text = `print.one hat die Anfrage abgelehnt${http}${details}`;
      break;
  }
  const out = text.endsWith(".") || text.endsWith("…") ? text : `${text}.`;
  return out.length > 480 ? `${out.slice(0, 479)}…` : out;
}

/**
 * The German error text of an order print.one itself marked failed.
 * @param {PrintOneOrder} order
 */
export function describePrintOneOrderFailure(order) {
  const details = order.errors.length > 0 ? `: ${order.errors.slice(0, 5).join(" · ")}` : "";
  const text = `print.one meldet den Auftrag als fehlgeschlagen${details}`;
  const out = text.endsWith(".") ? text : `${text}.`;
  return out.length > 480 ? `${out.slice(0, 479)}…` : out;
}

/**
 * Minutes until the next submission attempt after `attempts` failed ones —
 * the voucher plan (1, 2, 5, 15, 30, 60, 120, 240, 480, 720) and then every
 * 12 hours. A print job is never failed for a temporary problem: the outcome of
 * an attempt without an answer is unknown, so the next attempt first looks the
 * order up at print.one. Only print.one's own refusal (kind `invalid`) fails it.
 * @param {number} attempts  failed attempts so far, including the one just made
 * @param {(n: number) => number | null} planRetry  planGiftVoucherRetry
 * @returns {number}
 */
export function planPrintJobRetryMinutes(attempts, planRetry) {
  const n = Number.isFinite(attempts) && attempts > 0 ? Math.floor(attempts) : 1;
  const planned = planRetry(n);
  return typeof planned === "number" && planned > 0 ? Math.min(planned, 720) : 720;
}

// ---------------------------------------------------------------------------
// The submission gate
// ---------------------------------------------------------------------------

/** How long a job may stay 'submitting' before the sweep takes it over (lost process). */
export const PRINT_SUBMIT_STALE_MS = 5 * 60_000;

/**
 * The gates that hold back EVERY print.one submission (the sweep checks them
 * before it claims anything): the legal gate GIFT_VOUCHER_PRINT_SENDS_APPROVED
 * (fail-closed), print.one configured, provider printone, a public https
 * PUBLIC_BASE_URL. Null = open.
 * @param {{ gateApproved: boolean, printOneConfigured: boolean, configuredProvider: string, baseUrl: string | null }} input
 * @returns {{ code: "gate_off" | "not_configured" | "manual", message: string } | null}
 */
export function giftVoucherPrintGlobalBlock(input) {
  if (!input.gateApproved) {
    return {
      code: "gate_off",
      message: "Der Kartendruck über print.one ist noch nicht freigegeben (GIFT_VOUCHER_PRINT_SENDS_APPROVED).",
    };
  }
  if (!input.printOneConfigured) {
    return { code: "not_configured", message: "print.one ist nicht eingerichtet (PRINTONE_API_KEY / PRINTONE_TEMPLATE_ID)." };
  }
  if (input.configuredProvider === "manual") {
    return { code: "manual", message: "Der Kartendruck läuft gerade von Hand (GIFT_VOUCHER_PRINT_PROVIDER=manual)." };
  }
  if (!input.baseUrl) {
    return {
      code: "not_configured",
      message: "PUBLIC_BASE_URL fehlt oder ist keine https-Adresse — print.one könnte die Druckdateien nicht laden.",
    };
  }
  return null;
}

/**
 * May this print job go to print.one now? The gate of spec §10, in this order:
 * the job exists; a job already at print.one is simply reported (idempotent);
 * GIFT_VOUCHER_PRINT_SENDS_APPROVED (legal gate, fail-closed); print.one
 * configured; provider printone (job and configuration); PUBLIC_BASE_URL (the
 * files must be reachable); the job is queued (or a lost 'submitting' one the
 * sweep recovers); the voucher is issued; the address is valid.
 *
 * `scope` tells the sweep what to do with a blocked job: "global" (nothing is
 * submitted at all), "job" (try this job again later), "voucher_ended" (the
 * voucher was deactivated / cancelled / rejected — cancel the job).
 *
 * @param {{
 *   job: { provider: string, status: string } | null,
 *   voucher: { status: string } | null,
 *   gateApproved: boolean,
 *   printOneConfigured: boolean,
 *   configuredProvider: string,
 *   baseUrl: string | null,
 *   address: unknown,
 *   countries?: readonly string[],
 *   recovering?: boolean,
 * }} input
 * @returns {{ action: "submit" }
 *   | { action: "already", status: PrintJobStatus }
 *   | { action: "block", code: "not_found" | "gate_off" | "not_configured" | "manual" | "review" | "not_ready",
 *       scope: "global" | "job" | "voucher_ended", message: string }}
 */
export function decideGiftVoucherPrintSubmission(input) {
  const job = input.job;
  /**
   * @param {"not_found" | "gate_off" | "not_configured" | "manual" | "review" | "not_ready"} code
   * @param {"global" | "job" | "voucher_ended"} scope
   * @param {string} message
   */
  const block = (code, scope, message) => ({ action: /** @type {const} */ ("block"), code, scope, message });
  if (!job) return block("not_found", "job", "Druckauftrag nicht gefunden.");
  if (job.status === "submitted" || job.status === "printing" || job.status === "sent") {
    return { action: /** @type {const} */ ("already"), status: /** @type {PrintJobStatus} */ (job.status) };
  }
  if (job.provider === "manual") {
    return block("manual", "job", "Dieser Druckauftrag wird von Hand gedruckt (Druckwarteschlange).");
  }
  const global = giftVoucherPrintGlobalBlock(input);
  if (global) return block(global.code, "global", global.message);
  if (job.status === "review") return block("review", "job", "Der Druckauftrag muss erst freigegeben werden.");
  if (job.status === "submitting" && !input.recovering) {
    return block("not_ready", "job", "Der Druckauftrag wird gerade an print.one übermittelt.");
  }
  if (job.status !== "queued" && job.status !== "submitting") {
    return block("not_ready", "job", "Der Druckauftrag ist bereits abgeschlossen.");
  }
  const voucher = input.voucher;
  if (!voucher) return block("not_found", "job", "Der Gutschein zu diesem Druckauftrag fehlt.");
  if (voucher.status === "deactivated" || voucher.status === "cancelled" || voucher.status === "rejected") {
    return block("not_ready", "voucher_ended", "Der Gutschein ist gesperrt, storniert oder abgelehnt — die Karte wird nicht gedruckt.");
  }
  if (voucher.status !== "issued") return block("not_ready", "job", "Der Gutschein ist noch nicht ausgestellt.");
  const checked = validatePostalAddress(input.address, { countries: input.countries ?? ["DE"], locale: "de" });
  if (!checked.ok) {
    return block("not_ready", "job", `Die Empfängeradresse fehlt oder ist ungültig: ${checked.message}`);
  }
  return { action: /** @type {const} */ ("submit") };
}

// ---------------------------------------------------------------------------
// The template (verify script: --create-template, template check)
// ---------------------------------------------------------------------------

/**
 * One template page: nothing but the spread as a full-bleed image. `{{x}}`
 * is print.one's escaped text merge (an https URL survives it unchanged).
 * @param {"outside_url" | "inside_url"} variable
 */
export function printOneTemplatePageHtml(variable) {
  return (
    "<style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#ffffff}" +
    "img.mo-gv-spread{display:block;width:100%;height:100%;object-fit:cover;object-position:center}</style>" +
    `<img class="mo-gv-spread" src="{{${variable}}}" alt="">`
  );
}

/**
 * POST /v2/templates body: GREETINGCARD_SQ14 with page 1 = Outside, page 2 =
 * Inside.
 * @param {{ name?: string }} [o]
 */
export function buildPrintOneTemplateBody({ name = "Mo Geschenkgutschein (SQ14, Bild außen/innen)" } = {}) {
  return {
    name,
    format: PRINTONE_TEMPLATE_FORMAT,
    labels: ["Mo", "Geschenkgutschein"],
    pages: [
      { content: printOneTemplatePageHtml(PRINTONE_MERGE_VARIABLES.outside) },
      { content: printOneTemplatePageHtml(PRINTONE_MERGE_VARIABLES.inside) },
    ],
  };
}

/**
 * A template (GenericTemplateV2Dto) → the fields the setup check needs.
 * @param {unknown} json
 * @returns {{ id: string, name: string | null, format: string | null, version: number | null,
 *   mergeVariables: string[], pages: number | null } | null}
 */
export function parsePrintOneTemplate(json) {
  const o = asObject(json);
  const id = o ? str(o.id) : null;
  if (!o || !id) return null;
  const version = Number(o.version);
  return {
    id,
    name: str(o.name),
    format: str(o.format),
    version: Number.isFinite(version) ? version : null,
    mergeVariables: Array.isArray(o.mergeVariables) ? o.mergeVariables.filter((v) => typeof v === "string") : [],
    pages: Array.isArray(o.pages) ? o.pages.length : null,
  };
}

/**
 * What is wrong with the template for Mo (German, empty = fine): the format,
 * exactly the two merge variables, two pages.
 * @param {ReturnType<typeof parsePrintOneTemplate>} template
 * @returns {string[]}
 */
export function printOneTemplateIssues(template) {
  if (!template) return ["Vorlage nicht lesbar."];
  /** @type {string[]} */
  const issues = [];
  if (template.format !== PRINTONE_TEMPLATE_FORMAT) {
    issues.push(`Format ist ${template.format ?? "unbekannt"}, erwartet ${PRINTONE_TEMPLATE_FORMAT}.`);
  }
  const wanted = [PRINTONE_MERGE_VARIABLES.outside, PRINTONE_MERGE_VARIABLES.inside];
  const missing = wanted.filter((v) => !template.mergeVariables.includes(v));
  const extra = template.mergeVariables.filter((v) => !wanted.includes(/** @type {any} */ (v)));
  if (missing.length) issues.push(`Variable(n) fehlen: ${missing.join(", ")}.`);
  if (extra.length) issues.push(`Zusätzliche Variable(n), die Mo nicht füllt (der Auftrag würde scheitern): ${extra.join(", ")}.`);
  if (template.pages !== null && template.pages !== 2) issues.push(`${template.pages} Seite(n), erwartet 2 (außen, innen).`);
  return issues;
}

/**
 * Does a key look like a LIVE key? print.one documents no key format, so this
 * only catches a key whose name says "live"; the verify script additionally
 * asks print.one (a live-only endpoint) and checks isBillable afterwards.
 * @param {unknown} key
 */
export function printOneKeyLooksLive(key) {
  return typeof key === "string" && /live/i.test(key) && !/test/i.test(key);
}
