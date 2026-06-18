import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isThrottledResponse,
  throttleWaitMs,
  planThrottleRetry,
  THROTTLE_MAX_RETRIES,
  THROTTLE_MIN_WAIT_MS,
  THROTTLE_MAX_WAIT_MS,
} from "./shopify-throttle.mjs";

// A realistic Shopify THROTTLED body: HTTP 200, errors[] code THROTTLED, plus the
// top-level cost block with the leaky-bucket state.
const throttledBody = (currentlyAvailable = 1000, requestedQueryCost = 1550, restoreRate = 100) => ({
  errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
  extensions: {
    cost: {
      requestedQueryCost,
      actualQueryCost: null,
      throttleStatus: { maximumAvailable: 2000, currentlyAvailable, restoreRate },
    },
  },
});

test("isThrottledResponse detects a THROTTLED errors[] entry", () => {
  assert.equal(isThrottledResponse(throttledBody()), true);
  assert.equal(isThrottledResponse({ errors: [{ message: "Throttled" }] }), true); // by message
  assert.equal(isThrottledResponse({ errors: [{ message: "Field 'x' doesn't exist" }] }), false);
  assert.equal(isThrottledResponse({ data: { ok: true } }), false);
  assert.equal(isThrottledResponse(null), false);
});

test("a THROTTLED response triggers a backoff+retry rather than an immediate throw/fallback", () => {
  const plan = planThrottleRetry({ json: throttledBody(), httpStatus: 200, attempt: 0 });
  assert.equal(plan.retry, true);
  assert.equal(plan.reason, "throttled");
  assert.ok(plan.waitMs > 0, "should wait before retrying");
});

test("the wait is derived from throttleStatus (deficit ÷ restoreRate)", () => {
  // deficit = requested(1550) - currentlyAvailable(1000) = 550; / restoreRate(100)
  // = 5.5s → 5500ms + buffer. Comfortably inside the cap.
  const ms = throttleWaitMs(throttledBody(1000, 1550, 100).extensions.cost, 0);
  assert.ok(ms >= 5500 && ms <= 6000, `expected ~5.5s, got ${ms}ms`);
});

test("the wait is clamped to [min, max]", () => {
  // Huge deficit, slow restore → would be enormous, but capped.
  const big = throttleWaitMs({ requestedQueryCost: 100000, throttleStatus: { currentlyAvailable: 0, restoreRate: 1 } }, 0);
  assert.equal(big, THROTTLE_MAX_WAIT_MS);
  // No deficit → clamped up to the minimum (still a small pause before retry).
  const small = throttleWaitMs({ requestedQueryCost: 10, throttleStatus: { currentlyAvailable: 100, restoreRate: 100 } }, 0);
  assert.equal(small, THROTTLE_MIN_WAIT_MS);
});

test("falls back to exponential backoff when no throttleStatus is present", () => {
  assert.equal(throttleWaitMs(undefined, 0), 1000);
  assert.equal(throttleWaitMs(undefined, 1), 2000);
  assert.equal(throttleWaitMs(undefined, 2), 4000);
  // capped
  assert.equal(throttleWaitMs(undefined, 20), THROTTLE_MAX_WAIT_MS);
});

test("a bare HTTP 429 (no body) is retried via backoff", () => {
  const plan = planThrottleRetry({ json: null, httpStatus: 429, attempt: 0 });
  assert.equal(plan.retry, true);
  assert.equal(plan.waitMs, 1000);
});

test("retries are capped — an exhausted throttle does NOT retry (so it can fall back)", () => {
  const plan = planThrottleRetry({ json: throttledBody(), httpStatus: 200, attempt: THROTTLE_MAX_RETRIES });
  assert.equal(plan.retry, false);
  assert.equal(plan.reason, "max-retries-exhausted");
});

test("a non-throttle GraphQL error is NOT retried (throws immediately)", () => {
  const plan = planThrottleRetry({
    json: { errors: [{ message: "Access denied", extensions: { code: "ACCESS_DENIED" } }] },
    httpStatus: 200,
    attempt: 0,
  });
  assert.equal(plan.retry, false);
  assert.equal(plan.reason, "not-throttled");
});
