import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyStepFailure, GATEWAY_RETRY_MAX } from "./step-loop-retry.mjs";

test("a dropped connection is a network failure", () => {
  assert.equal(classifyStepFailure({ status: 0, code: "network", details: new TypeError("Failed to fetch") }), "network");
  assert.equal(classifyStepFailure({ status: 0 }), "network");
});

test("the platform's error pages are gateway failures (the 504 of 2026-10-08)", () => {
  // Vercel FUNCTION_INVOCATION_TIMEOUT: text body → adminFetch details null.
  assert.equal(classifyStepFailure({ status: 504, code: null, details: null }), "gateway");
  assert.equal(classifyStepFailure({ status: 502, code: null, details: null }), "gateway");
  assert.equal(classifyStepFailure({ status: 503, code: null, details: null }), "gateway");
  // FUNCTION_INVOCATION_FAILED (crash) — 500 with an HTML page.
  assert.equal(classifyStepFailure({ status: 500, code: null, details: null }), "gateway");
  assert.equal(classifyStepFailure({ status: 429, code: null, details: null }), "gateway");
  // A 504 is never the route's own answer.
  assert.equal(classifyStepFailure({ status: 504, code: null, details: { error: "x" } }), "gateway");
});

test("the route's own refusals stop the loop", () => {
  assert.equal(classifyStepFailure({ status: 503, code: "no_db", details: { error: { code: "no_db", message: "No database configured" } } }), "fatal");
  assert.equal(classifyStepFailure({ status: 500, code: null, details: { error: "boom" } }), "fatal");
  assert.equal(classifyStepFailure({ status: 400, code: "bad_request", details: null }), "fatal");
  assert.equal(classifyStepFailure({ status: 401, code: null, details: null }), "fatal");
  assert.equal(classifyStepFailure({ status: 404, code: null, details: {} }), "fatal");
  assert.equal(classifyStepFailure({ status: 409, code: null, details: null }), "fatal");
  assert.equal(classifyStepFailure(null), "fatal");
  assert.equal(classifyStepFailure({}), "fatal");
});

test("the gateway budget stays small (each platform timeout is a full step)", () => {
  assert.ok(GATEWAY_RETRY_MAX >= 1 && GATEWAY_RETRY_MAX <= 5);
});
