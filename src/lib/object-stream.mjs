// Settling one streamed structured-output call (ai SDK `streamObject`) inside
// a serverless step — the pure core of strategist-call.ts.
//
// Two traps it closes:
//   · ai@6 resolves `object`, `usage` and `finishReason` only while someone
//     READS the result stream (backpressure). Awaiting the promises alone
//     hangs as soon as the model writes its first answer token — and the
//     AbortSignal cannot rescue it, so the function ran until the platform
//     killed it at maxDuration (the 504 on /api/admin/analytics/step,
//     2026-10-08). This core reads `fullStream` to its end, then the promises.
//   · the AbortSignal only reaches the provider's fetch; a transport that
//     ignores it would still hang. A watchdog settles the call `graceMs` after
//     the deadline whatever the SDK does.
//
// Never throws. The caller maps the outcome (strategist-call.ts).

/** Extra time after the abort before the watchdog gives up on the SDK. */
export const OBJECT_STREAM_GRACE_MS = 10_000;

/** True for an abort/timeout error, also when wrapped as a `cause`. */
export function isAbortError(err, depth = 0) {
  if (!err || typeof err !== "object" || depth > 5) return false;
  const name = String(err.name ?? "");
  if (name === "AbortError" || name === "TimeoutError") return true;
  return err.cause ? isAbortError(err.cause, depth + 1) : false;
}

/**
 * A readable message for anything a stream can fail with — an SSE `error`
 * event arrives as a plain object ({ type, error: { type, message } }), not an
 * Error, and would read "[object Object]".
 */
export function describeStreamError(err) {
  if (err instanceof Error) return err.message || err.name;
  if (err && typeof err === "object") {
    const inner = /** @type {{ message?: unknown, error?: { message?: unknown, type?: unknown }, type?: unknown }} */ (err);
    const message = inner.message ?? inner.error?.message;
    const type = inner.error?.type ?? inner.type;
    if (typeof message === "string" && message) return typeof type === "string" && type ? `${type}: ${message}` : message;
    try {
      return JSON.stringify(err).slice(0, 300);
    } catch {
      return "Unbekannter Fehler";
    }
  }
  return String(err);
}

function timeoutReason(timeoutMs) {
  const err = new Error(`Zeitlimit von ${Math.round(timeoutMs / 1000)} s erreicht.`);
  err.name = "TimeoutError";
  return err;
}

/**
 * Run `start({ abortSignal, onError })` — which must return a streamObject
 * result — and settle it within `timeoutMs` (+ `graceMs` for the watchdog).
 *
 * @template T
 * @param {(ctx: { abortSignal: AbortSignal, onError: (e: { error: unknown }) => void }) => {
 *   fullStream: AsyncIterable<{ type?: string, error?: unknown }>,
 *   object: PromiseLike<T>, usage: PromiseLike<unknown>, finishReason: PromiseLike<unknown>,
 * }} start
 * @param {{ timeoutMs: number, graceMs?: number }} opts
 * @returns {Promise<
 *   | { status: "ok", object: T, usage: unknown, finishReason: unknown }
 *   | { status: "timeout", error: unknown, watchdog: boolean }
 *   | { status: "error", error: unknown }
 * >}
 */
export async function settleObjectStream(start, { timeoutMs, graceMs = OBJECT_STREAM_GRACE_MS }) {
  const controller = new AbortController();
  let streamError = null;
  const abortTimer = setTimeout(() => controller.abort(timeoutReason(timeoutMs)), Math.max(0, timeoutMs));
  let watchdogTimer = null;
  const watchdog = new Promise((resolve) => {
    watchdogTimer = setTimeout(
      () => resolve({ status: "timeout", error: streamError ?? timeoutReason(timeoutMs), watchdog: true }),
      Math.max(0, timeoutMs) + Math.max(0, graceMs)
    );
  });

  const work = (async () => {
    try {
      const result = start({
        abortSignal: controller.signal,
        onError: ({ error }) => {
          if (streamError == null) streamError = error;
        },
      });
      // Reading the stream is what drives it: the SDK resolves its promises
      // on the 'finish' part and rejects them on an error, but only while the
      // stream is consumed.
      try {
        for await (const part of result.fullStream) {
          if (part && part.type === "error" && streamError == null) streamError = part.error;
        }
      } catch (err) {
        if (streamError == null) streamError = err;
      }
      const [object, usage, finishReason] = await Promise.all([result.object, result.usage, result.finishReason]);
      return { status: "ok", object, usage, finishReason };
    } catch (err) {
      const cause = streamError ?? err;
      if (controller.signal.aborted || isAbortError(cause) || isAbortError(err)) {
        return { status: "timeout", error: cause, watchdog: false };
      }
      // Keep the SDK's own error (NoObjectGeneratedError carries usage and
      // finishReason); the stream error is the better message otherwise.
      return { status: "error", error: err ?? cause };
    }
  })();

  const outcome = await Promise.race([work, watchdog]);
  clearTimeout(abortTimer);
  if (watchdogTimer) clearTimeout(watchdogTimer);
  // An abandoned or failed call may still hold a fetch — cut it.
  if (outcome.status !== "ok" && !controller.signal.aborted) controller.abort(timeoutReason(timeoutMs));
  return outcome;
}

// ── Step deadline ─────────────────────────────────────────────────────────────

/**
 * What a step keeps back after a model call: the watchdog grace plus the
 * database writes that record the outcome (usage, progress, claim release).
 */
export const STEP_RESERVE_MS = 40_000;

/**
 * The abort timeout for a model call inside a step that started at
 * `stepStartedAt` (epoch ms): `capMs`, shortened when the work before the call
 * took long, so call + grace + the writes after it stay inside the route's
 * `maxDurationS`. Never below `floorMs` (nor above `capMs`).
 *
 * @param {{ stepStartedAt: number, maxDurationS: number, capMs: number, reserveMs?: number, floorMs?: number, now?: number }} p
 * @returns {number}
 */
export function callTimeoutWithinStep({ stepStartedAt, maxDurationS, capMs, reserveMs = STEP_RESERVE_MS, floorMs = 30_000, now = Date.now() }) {
  const cap = Math.max(0, Number(capMs) || 0);
  const started = Number.isFinite(stepStartedAt) ? stepStartedAt : now;
  const left = Number(maxDurationS) * 1000 - Math.max(0, now - started) - reserveMs;
  const floor = Math.min(cap, Math.max(0, floorMs));
  return Math.max(floor, Math.min(cap, Number.isFinite(left) ? left : cap));
}
