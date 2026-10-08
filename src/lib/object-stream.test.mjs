import { test } from "node:test";
import assert from "node:assert/strict";
import { streamObject, NoObjectGeneratedError } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { STEP_RESERVE_MS, callTimeoutWithinStep, isAbortError, settleObjectStream } from "./object-stream.mjs";

// The real ai SDK streamObject against a mock model: the regression for the
// 504 of 2026-10-08 (awaiting the result promises without reading the stream
// never settled once the model wrote its answer).

const schema = z.object({ answer: z.string(), score: z.number() });
const USAGE = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 50, text: 30, reasoning: 20 },
};
const FINISH = { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE };
const HEAD = [
  { type: "stream-start", warnings: [] },
  { type: "reasoning-start", id: "r0" },
  { type: "reasoning-delta", id: "r0", delta: "thinking" },
  { type: "reasoning-end", id: "r0" },
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: '{"answer":"he' },
  { type: "text-delta", id: "t1", delta: 'llo",' },
];
const COMPLETE = [...HEAD, { type: "text-delta", id: "t1", delta: '"score":42}' }, { type: "text-end", id: "t1" }, FINISH];

/** A model stream that emits `parts` with a gap; `close: false` stalls after them. */
function partStream(parts, { gap = 5, close = true, abortSignal, respectAbort = false } = {}) {
  return new ReadableStream({
    start(controller) {
      let i = 0;
      let done = false;
      if (respectAbort && abortSignal) {
        abortSignal.addEventListener(
          "abort",
          () => {
            if (done) return;
            done = true;
            controller.error(abortSignal.reason);
          },
          { once: true }
        );
      }
      const tick = () => {
        if (done) return;
        if (i < parts.length) {
          controller.enqueue(parts[i++]);
          setTimeout(tick, gap);
        } else if (close) {
          done = true;
          controller.close();
        }
      };
      setTimeout(tick, gap);
    },
  });
}

const start = (model) => ({ abortSignal, onError }) =>
  streamObject({ model, schema, system: "s", prompt: "p", maxRetries: 0, abortSignal, onError });

test("a complete answer settles without an outside reader (the 504 regression)", async () => {
  const model = new MockLanguageModelV3({ doStream: async () => ({ stream: partStream(COMPLETE) }) });
  const t0 = Date.now();
  const out = await settleObjectStream(start(model), { timeoutMs: 2_000, graceMs: 500 });
  assert.equal(out.status, "ok");
  assert.deepEqual(out.object, { answer: "hello", score: 42 });
  assert.equal(out.finishReason, "stop");
  assert.equal(out.usage.inputTokens, 100);
  assert.equal(out.usage.outputTokens, 50);
  assert.ok(Date.now() - t0 < 1_000, "settles right after the stream ends");
});

test("a stall mid-answer times out at the deadline when the transport honours the abort", async () => {
  const model = new MockLanguageModelV3({
    doStream: async (o) => ({ stream: partStream(HEAD, { close: false, abortSignal: o.abortSignal, respectAbort: true }) }),
  });
  const t0 = Date.now();
  const out = await settleObjectStream(start(model), { timeoutMs: 300, graceMs: 2_000 });
  const ms = Date.now() - t0;
  assert.equal(out.status, "timeout");
  assert.equal(out.watchdog, false);
  assert.ok(ms >= 280 && ms < 1_500, `settled after ${ms} ms`);
});

test("a transport that ignores the abort is cut by the watchdog", async () => {
  const model = new MockLanguageModelV3({ doStream: async () => ({ stream: partStream(HEAD, { close: false }) }) });
  const t0 = Date.now();
  const out = await settleObjectStream(start(model), { timeoutMs: 200, graceMs: 200 });
  const ms = Date.now() - t0;
  assert.equal(out.status, "timeout");
  assert.equal(out.watchdog, true);
  assert.ok(ms >= 380 && ms < 1_500, `settled after ${ms} ms`);
});

test("no response headers before the deadline → timeout", async () => {
  const model = new MockLanguageModelV3({
    doStream: (o) => new Promise((_, reject) => o.abortSignal?.addEventListener("abort", () => reject(o.abortSignal.reason), { once: true })),
  });
  const out = await settleObjectStream(start(model), { timeoutMs: 200, graceMs: 2_000 });
  assert.equal(out.status, "timeout");
  assert.equal(out.watchdog, false);
});

test("an error part mid-answer is a model error, not a timeout", async () => {
  const overloaded = Object.assign(new Error("Overloaded"), { name: "AI_APICallError" });
  const model = new MockLanguageModelV3({
    doStream: async () => ({ stream: partStream([...HEAD, { type: "error", error: overloaded }]) }),
  });
  const out = await settleObjectStream(start(model), { timeoutMs: 2_000, graceMs: 500 });
  assert.equal(out.status, "error");
  assert.ok(!isAbortError(out.error));
});

test("a complete answer that misses the schema is an error carrying NoObjectGeneratedError", async () => {
  const bad = [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: '{"answer":"x"}' },
    { type: "text-end", id: "t1" },
    FINISH,
  ];
  const model = new MockLanguageModelV3({ doStream: async () => ({ stream: partStream(bad) }) });
  const out = await settleObjectStream(start(model), { timeoutMs: 2_000, graceMs: 500 });
  assert.equal(out.status, "error");
  assert.ok(NoObjectGeneratedError.isInstance(out.error));
  assert.equal(out.error.usage?.outputTokens, 50);
});

test("a start that throws is an error, never a throw", async () => {
  const out = await settleObjectStream(
    () => {
      throw new Error("bad options");
    },
    { timeoutMs: 1_000 }
  );
  assert.equal(out.status, "error");
  assert.equal(out.error.message, "bad options");
});

test("isAbortError looks through causes", () => {
  const timeout = Object.assign(new Error("t"), { name: "TimeoutError" });
  assert.equal(isAbortError(timeout), true);
  assert.equal(isAbortError(Object.assign(new Error("wrap"), { cause: timeout })), true);
  assert.equal(isAbortError(Object.assign(new Error("x"), { name: "AbortError" })), true);
  assert.equal(isAbortError(new Error("x")), false);
  assert.equal(isAbortError(null), false);
});

test("callTimeoutWithinStep keeps the call inside the step", () => {
  const base = { maxDurationS: 300, capMs: 240_000, now: 1_000_000 };
  // Fresh step: the cap applies (300 s − 40 s reserve = 260 s > 240 s).
  assert.equal(callTimeoutWithinStep({ ...base, stepStartedAt: 1_000_000 }), 240_000);
  // 50 s of work before the call: 300 − 50 − 40 = 210 s.
  assert.equal(callTimeoutWithinStep({ ...base, stepStartedAt: 950_000 }), 300_000 - 50_000 - STEP_RESERVE_MS);
  // Way over: the floor.
  assert.equal(callTimeoutWithinStep({ ...base, stepStartedAt: 700_000 }), 30_000);
  // The floor never exceeds the cap.
  assert.equal(callTimeoutWithinStep({ ...base, capMs: 10_000, stepStartedAt: 700_000 }), 10_000);
  // A missing start counts as "now".
  assert.equal(callTimeoutWithinStep({ ...base, stepStartedAt: Number.NaN }), 240_000);
});
