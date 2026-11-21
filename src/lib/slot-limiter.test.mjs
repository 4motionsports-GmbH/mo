// Tests for slot-limiter.mjs: the limit holds under any interleaving (the
// slot is handed over, never released and re-taken), waiters run in order,
// and a failing task passes its slot on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createSlotLimiter } from "./slot-limiter.mjs";

const tick = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A promise with its resolve function. */
function gate() {
  /** @type {(v?: unknown) => void} */
  let open = () => {};
  const promise = new Promise((resolve) => (open = resolve));
  return { promise, open };
}

/** A limiter whose tasks record how many run at once. */
function tracked(max) {
  const slots = createSlotLimiter(max);
  const stats = { running: 0, peak: 0, order: /** @type {string[]} */ ([]) };
  /** @param {string} name @param {Promise<unknown>} until */
  const task = (name, until) =>
    slots.run(async () => {
      stats.order.push(name);
      stats.running++;
      stats.peak = Math.max(stats.peak, stats.running);
      try {
        await until;
        return name;
      } finally {
        stats.running--;
      }
    });
  return { slots, stats, task };
}

test("a caller arriving in the same tick as a finishing task cannot slip past the woken waiter", async () => {
  const slots = createSlotLimiter(2);
  let peak = 0;
  /** @type {string[]} */
  const started = [];
  // Each task returns its promise directly (as a render does): the slot
  // passes on in the very microtask in which the task settles.
  const work = (/** @type {string} */ name, /** @type {Promise<unknown>} */ until) => () => {
    started.push(name);
    peak = Math.max(peak, slots.active);
    return until.then(() => name);
  };
  const a = gate();
  const A = slots.run(() => {
    started.push("A");
    return a.promise; // settles with "A" — no extra hop
  });
  const B = slots.run(work("B", tick(30)));
  const C = slots.run(work("C", tick(30))); // waits for a slot
  await tick(5);
  assert.equal(slots.active, 2);
  assert.equal(slots.waiting, 1);
  // D's request resumes from an await (e.g. the photo load) in the same
  // microtask checkpoint in which A finishes.
  const photo = gate();
  const D = (async () => {
    await photo.promise;
    return slots.run(work("D", tick(30)));
  })();
  a.open("A");
  photo.open();
  assert.deepEqual(await Promise.all([A, B, C, D]), ["A", "B", "C", "D"]);
  assert.equal(peak, 2, "never more than two at a time");
  assert.deepEqual(started, ["A", "B", "C", "D"], "the waiter goes before the late caller");
  assert.equal(slots.active, 0);
  assert.equal(slots.waiting, 0);
});

test("many tasks: at most `max` at a time, started in call order", async () => {
  const { slots, stats, task } = tracked(3);
  const names = Array.from({ length: 12 }, (_, i) => `t${i}`);
  const results = await Promise.all(names.map((n, i) => task(n, tick(2 + ((i * 7) % 5)))));
  assert.deepEqual(results, names);
  assert.equal(stats.peak, 3);
  assert.deepEqual(stats.order, names);
  assert.equal(slots.active, 0);
});

test("a failing task rejects its caller and passes its slot on", async () => {
  const slots = createSlotLimiter(1);
  const failing = slots.run(async () => {
    await tick(2);
    throw new Error("render failed");
  });
  const thrower = slots.run(() => {
    throw new Error("sync throw");
  });
  const next = slots.run(async () => "next ran");
  await assert.rejects(failing, /render failed/);
  await assert.rejects(thrower, /sync throw/);
  assert.equal(await next, "next ran");
  assert.equal(slots.active, 0);
  assert.equal(slots.waiting, 0);
});

test("a synchronous task value is returned; an odd max means one at a time", async () => {
  for (const max of [0, -2, 1.5, Number.NaN, /** @type {any} */ ("2")]) {
    const { stats, task } = tracked(max);
    await Promise.all([task("a", tick(3)), task("b", tick(3)), task("c", tick(3))]);
    assert.equal(stats.peak, 1, String(max));
  }
  assert.equal(await createSlotLimiter(2).run(() => 42), 42);
});
