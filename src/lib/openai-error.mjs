// Classify an OpenAI embeddings error so the catalog sync can react correctly and
// log a BILLING problem DISTINCTLY from a transient one.
//
// The diagnosis flags insufficient_quota (a freshly-created client OpenAI account
// with no credits) as the most likely real cause of the 503. That is a billing
// fix, not a code bug — so we (a) mark it FATAL, so embed-resilience stops
// hammering the API with ~1000 doomed sub-calls, and (b) label it so the log line
// names it for what it is. Rate-limits / 5xx / bad-input are NOT fatal (retrying
// or subdividing can still make progress).
//
// Pure + dependency-free so it's unit-testable and usable from the .mjs cores.

/**
 * @param {unknown} err
 * @returns {{ label: string, quota: boolean, fatal: boolean, status: number|null, message: string }}
 */
export function classifyOpenAiError(err) {
  const e = /** @type {any} */ (err) || {};
  const status = typeof e.status === "number" ? e.status : typeof e.statusCode === "number" ? e.statusCode : null;
  const code = String(e.code ?? e.error?.code ?? e.type ?? e.error?.type ?? "").toLowerCase();
  const message = String(e.message ?? e.error?.message ?? e ?? "");
  const lower = message.toLowerCase();

  const isQuota =
    code.includes("insufficient_quota") ||
    code === "billing_hard_limit_reached" ||
    lower.includes("insufficient_quota") ||
    lower.includes("exceeded your current quota") ||
    lower.includes("billing");

  if (isQuota) {
    return { label: "insufficient_quota", quota: true, fatal: true, status, message };
  }
  // Auth / permission — also unrecoverable within this run.
  if (status === 401 || status === 403 || code.includes("invalid_api_key")) {
    return { label: "auth_error", quota: false, fatal: true, status, message };
  }
  if (status === 429) {
    return { label: "rate_limit", quota: false, fatal: false, status, message };
  }
  if (status != null && status >= 500) {
    return { label: "server_error", quota: false, fatal: false, status, message };
  }
  if (status === 400) {
    return { label: "bad_request", quota: false, fatal: false, status, message };
  }
  return { label: "unknown", quota: false, fatal: false, status, message };
}
