// A small concurrency limiter — pure, no I/O (slot-limiter.test.mjs).
//
// At most `max` tasks run at a time; the others wait in order. A finished
// task hands its slot straight to the first waiter instead of releasing it:
// with release-then-wake, a caller arriving in the same microtask checkpoint
// (another request resuming from an await) saw a free slot and took it before
// the woken waiter counted itself — one task too many. Used by the voucher
// renderer (lib/gift-voucher-render.ts: two rasterisations at a time, each
// 150–250 MB).

/**
 * @typedef {{
 *   run<T>(fn: () => T | Promise<T>): Promise<T>,
 *   readonly active: number,
 *   readonly waiting: number,
 * }} SlotLimiter
 */

/**
 * A limiter for `max` concurrent tasks (a non-positive or non-integer `max`
 * means 1). `run(fn)` resolves or rejects like `fn`; its slot passes on
 * either way.
 * @param {number} max
 * @returns {SlotLimiter}
 */
export function createSlotLimiter(max) {
  const limit = Number.isSafeInteger(max) && max > 0 ? max : 1;
  let active = 0;
  /** @type {Array<() => void>} */
  const queue = [];
  return {
    async run(fn) {
      // A waiter is woken with the slot already counted for it.
      if (active >= limit) await new Promise((resolve) => queue.push(() => resolve(undefined)));
      else active++;
      try {
        return await fn();
      } finally {
        const next = queue.shift();
        if (next) next();
        else active--;
      }
    },
    get active() {
      return active;
    },
    get waiting() {
      return queue.length;
    },
  };
}
