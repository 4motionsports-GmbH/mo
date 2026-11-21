// print.one v2 REST client — the Premium-Karte (spec §10, docs/GIFT_VOUCHERS.md).
//
// Thin and defensive, like lib/pingen.ts: every call returns a typed result and
// NEVER throws past this module; the pipeline (lib/gift-voucher-print.ts)
// decides what a failure means for a print job. The request/response details —
// body builder, status mapping, error parsing and classification — are pure and
// tested in printone-core.mjs.
//
//   createPrintOneOrder        POST /v2/orders (+ Idempotency-Key)       20 s
//   getPrintOneOrder           GET  /v2/orders/{id}                      10 s
//   cancelPrintOneOrder        POST /v2/orders/{id}/cancel               10 s
//   findPrintOneOrderByAssetToken  GET /v2/orders (newest first, ≤ 3 × 100)
//                              — finds Mo's order again by the asset token in
//                              its merge variables, after an answer was lost.
//
// Auth: header `x-api-key` (PRINTONE_API_KEY; a TEST key prints nothing). The
// key never leaves this module — not in a log, a reportError context or a
// returned message. Redirects are refused (`redirect: "error"`): fetch would
// carry the x-api-key header along to another host.
//
// Timeouts: a plain AbortController per call (the house pattern, never
// AbortSignal.timeout). A timeout on POST /v2/orders is an UNKNOWN outcome
// (kind "network"): print.one may have created the order — the pipeline looks
// it up before the next attempt, and the Idempotency-Key covers 24 h anyway.
//
// reportError gets the operation, the HTTP status, the failure kind and
// print.one's numeric error code — never print.one's message texts (they can
// echo request values such as the recipient's address).

import { isPrintOneConfiguredEnv, printOneApiBase, printOneApiKey } from "./gift-voucher-flags.mjs";
import {
  classifyPrintOneFailure,
  describePrintOneFailure,
  isValidPrintAssetToken,
  parsePrintOneError,
  parsePrintOneOrder,
  parsePrintOneOrderList,
  printOneApiUrl,
  printOneCancelPath,
  printOneOrderListQuery,
  printOneOrderPath,
  printOneOrderUsesAssetToken,
  type PrintOneFailureKind,
  type PrintOneOp,
  type PrintOneOrder,
  type PrintOneOrderBody,
} from "./printone-core.mjs";
import { reportError } from "./observability";

export type { PrintOneFailureKind, PrintOneOrder, PrintOneOrderBody };

const ROUTE = "lib/printone";
const CREATE_TIMEOUT_MS = 20_000;
const READ_TIMEOUT_MS = 10_000;
/** The lookup reads at most this many pages of the newest orders … */
const LOOKUP_PAGES = 3;
/** … of this size (max 200 per print.one's docs). */
const LOOKUP_PAGE_SIZE = 100;
/** Orders created this long before the job are certainly not its own (clock slack). */
const LOOKUP_SLACK_MS = 60 * 60_000;

export interface PrintOneFailure {
  ok: false;
  kind: PrintOneFailureKind | "unconfigured";
  /** HTTP status, null without an answer. */
  status: number | null;
  /** German, for the admin (may quote print.one — never into reportError). */
  message: string;
  /** Can a later attempt succeed? False only when print.one refused the request itself, or a cancel came too late. */
  retryable: boolean;
}

/** print.one can print: PRINTONE_API_KEY and PRINTONE_TEMPLATE_ID are set. */
export function isPrintOneConfigured(): boolean {
  return isPrintOneConfiguredEnv(process.env);
}

function failure(kind: PrintOneFailure["kind"], status: number | null, message: string): PrintOneFailure {
  return { ok: false, kind, status, message, retryable: kind !== "invalid" && kind !== "not_cancellable" };
}

function unconfigured(): PrintOneFailure {
  return failure("unconfigured", null, describePrintOneFailure("unconfigured", null));
}

/**
 * Failures worth an alert: everything except the expected answers — an
 * unknown order on read and a cancel that is too late / too early.
 */
function shouldReport(kind: PrintOneFailureKind, op: PrintOneOp): boolean {
  if (kind === "not_cancellable" || kind === "not_cancellable_yet") return false;
  if (kind === "not_found") return op === "create";
  return true;
}

type CallResult = { ok: true; status: number; json: unknown } | PrintOneFailure;

/**
 * One request. Reads the key and base URL from the env, applies the timeout to
 * the whole exchange (headers and body), classifies any failure. Never throws.
 */
async function call(
  op: PrintOneOp,
  method: "GET" | "POST",
  path: string,
  opts: { query?: Record<string, string>; body?: unknown; idempotencyKey?: string; timeoutMs: number }
): Promise<CallResult> {
  const key = printOneApiKey();
  if (!key) return unconfigured();
  const url = printOneApiUrl(printOneApiBase(), path, opts.query);
  const headers: Record<string, string> = { "x-api-key": key, Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), opts.timeoutMs);
  let status: number;
  let ok: boolean;
  let text: string;
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: abort.signal,
      redirect: "error",
      cache: "no-store",
    });
    status = res.status;
    ok = res.ok;
    text = await res.text();
  } catch (err) {
    // No (complete) answer: timeout, connection, TLS, a redirect. Outcome unknown.
    reportError(err, { route: ROUTE, phase: op, kind: "network" });
    return failure("network", null, describePrintOneFailure("network", null, op));
  } finally {
    clearTimeout(timer);
  }

  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (ok) return { ok: true, status, json };

  const error = parsePrintOneError(status, json ?? text);
  const kind = classifyPrintOneFailure(error, op);
  if (shouldReport(kind, op)) {
    const code = error.code ? ` code ${error.code}` : "";
    reportError(new Error(`print.one ${op} failed: HTTP ${status} (${kind})${code}`), {
      route: ROUTE,
      phase: op,
      kind,
      status,
    });
  }
  return failure(kind, status, describePrintOneFailure(kind, error, op));
}

/** A 2xx whose body carries no readable order: on create the order may exist (outcome unknown). */
function unreadableAnswer(op: PrintOneOp, status: number): PrintOneFailure {
  reportError(new Error(`print.one ${op}: unreadable answer (HTTP ${status})`), { route: ROUTE, phase: op, kind: "network", status });
  return failure("network", status, "print.one hat ohne lesbare Auftragsdaten geantwortet.");
}

/**
 * Create one order (one card). `idempotencyKey` = gift-voucher-print-<jobId>-<created ms>;
 * the caller must send the identical body for the same key (print.one refuses
 * the same key with another body for 24 h).
 */
export async function createPrintOneOrder(
  body: PrintOneOrderBody,
  idempotencyKey: string
): Promise<{ ok: true; order: PrintOneOrder } | PrintOneFailure> {
  if (!isPrintOneConfigured()) return unconfigured();
  if (typeof idempotencyKey !== "string" || !idempotencyKey || idempotencyKey.length > 255) {
    return failure("invalid", null, "Interner Fehler: ungültiger Idempotency-Key.");
  }
  const res = await call("create", "POST", "/v2/orders", { body, idempotencyKey, timeoutMs: CREATE_TIMEOUT_MS });
  if (!res.ok) return res;
  const order = parsePrintOneOrder(res.json);
  return order ? { ok: true, order } : unreadableAnswer("create", res.status);
}

/** Read one order (status, errors). */
export async function getPrintOneOrder(orderId: string): Promise<{ ok: true; order: PrintOneOrder } | PrintOneFailure> {
  const path = printOneOrderPath(orderId);
  if (!path) return failure("not_found", null, "Ungültige print.one-Auftragsnummer.");
  const res = await call("read", "GET", path, { timeoutMs: READ_TIMEOUT_MS });
  if (!res.ok) return res;
  const order = parsePrintOneOrder(res.json);
  return order ? { ok: true, order } : unreadableAnswer("read", res.status);
}

/**
 * Cancel an order. 412 comes back as kind "not_cancellable" (already in
 * production) or "not_cancellable_yet" (just created — try again in a few
 * minutes). The order in the answer is returned when readable.
 */
export async function cancelPrintOneOrder(orderId: string): Promise<{ ok: true; order: PrintOneOrder | null } | PrintOneFailure> {
  const path = printOneCancelPath(orderId);
  if (!path) return failure("not_found", null, "Ungültige print.one-Auftragsnummer.");
  const res = await call("cancel", "POST", path, { body: {}, timeoutMs: READ_TIMEOUT_MS });
  if (!res.ok) return res;
  return { ok: true, order: parsePrintOneOrder(res.json) };
}

/**
 * Find the order that carries the print files of `token` among print.one's
 * newest orders (no filter: the order sought was created moments or a few
 * retries ago, and a filter on PRINTONE_BILLING_ID would miss it once that
 * setting changed). Stops at orders older than `createdAfter` minus an hour, or
 * after LOOKUP_PAGES pages. ok + null = not found in what was read.
 */
export async function findPrintOneOrderByAssetToken(input: {
  token: string;
  createdAfter: string | null;
}): Promise<{ ok: true; order: PrintOneOrder | null } | PrintOneFailure> {
  if (!isValidPrintAssetToken(input.token)) return { ok: true, order: null };
  const after = input.createdAfter ? Date.parse(input.createdAfter) : NaN;
  const cutoff = Number.isFinite(after) ? after - LOOKUP_SLACK_MS : null;
  for (let page = 1; page <= LOOKUP_PAGES; page++) {
    const res = await call("list", "GET", "/v2/orders", {
      query: printOneOrderListQuery({ page, limit: LOOKUP_PAGE_SIZE }),
      timeoutMs: READ_TIMEOUT_MS,
    });
    if (!res.ok) return res;
    const { orders, hasMore } = parsePrintOneOrderList(res.json);
    const match = orders.find((o) => printOneOrderUsesAssetToken(o, input.token));
    if (match) return { ok: true, order: match };
    const reachedOlder =
      cutoff !== null && orders.some((o) => o.createdAt !== null && Date.parse(o.createdAt) < cutoff);
    if (!hasMore || reachedOlder || orders.length === 0) break;
  }
  return { ok: true, order: null };
}
