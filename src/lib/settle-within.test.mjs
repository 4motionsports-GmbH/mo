import { test } from "node:test";
import assert from "node:assert/strict";
import { settleWithin } from "./settle-within.mjs";

const later = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

test("work that settles in time passes its value through", async () => {
  assert.deepEqual(await settleWithin(later(5, "ok"), 200), { ok: true, value: "ok" });
});

test("work that takes too long is given up on", async () => {
  const started = Date.now();
  assert.deepEqual(await settleWithin(later(500, "late"), 20), { ok: false, reason: "timeout" });
  assert.ok(Date.now() - started < 400);
});

test("a rejection is an outcome, not a throw", async () => {
  const error = new Error("boom");
  assert.deepEqual(await settleWithin(Promise.reject(error), 200), { ok: false, reason: "error", error });
});

test("no limit waits for the work", async () => {
  assert.deepEqual(await settleWithin(later(5, 1), 0), { ok: true, value: 1 });
  assert.deepEqual(await settleWithin(later(5, 2), undefined), { ok: true, value: 2 });
});
