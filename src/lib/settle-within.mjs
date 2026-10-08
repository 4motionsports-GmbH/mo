// Wait for best-effort work at most `ms` — for a side step whose own timeouts
// are longer than the caller can afford (e.g. the Shopify purchase refresh
// before a customer profile: throttle and transient retries take ~100 s).
// The work itself is not cancelled; it may still finish in the background.

/**
 * Resolve with `{ ok: true, value }` when `promise` settles in time,
 * `{ ok: false, reason: "timeout" }` when it does not, and
 * `{ ok: false, reason: "error", error }` when it rejects. Never rejects.
 * A missing or non-positive `ms` waits without limit.
 *
 * @template T
 * @param {PromiseLike<T>} promise
 * @param {number | null | undefined} ms
 * @returns {Promise<{ ok: true, value: T } | { ok: false, reason: "timeout" } | { ok: false, reason: "error", error: unknown }>}
 */
export function settleWithin(promise, ms) {
  return new Promise((resolve) => {
    const limit = Number(ms);
    const timer = Number.isFinite(limit) && limit > 0 ? setTimeout(() => resolve({ ok: false, reason: "timeout" }), limit) : null;
    Promise.resolve(promise).then(
      (value) => {
        if (timer) clearTimeout(timer);
        resolve({ ok: true, value });
      },
      (error) => {
        if (timer) clearTimeout(timer);
        resolve({ ok: false, reason: "error", error });
      }
    );
  });
}
