import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isTransientStatus,
  isMutation,
  transientWaitMs,
  planTransientRetry,
  TRANSIENT_MAX_RETRIES,
  TRANSIENT_BASE_WAIT_MS,
  TRANSIENT_MAX_WAIT_MS,
} from "./shopify-retry.mjs";

test("isTransientStatus matches gateway/timeout 5xx (+408), not 4xx/2xx/429", () => {
  for (const s of [408, 500, 502, 503, 504]) {
    assert.equal(isTransientStatus(s), true, `${s} should be transient`);
  }
  for (const s of [200, 201, 400, 401, 403, 404, 422]) {
    assert.equal(isTransientStatus(s), false, `${s} should NOT be transient`);
  }
  // 429 is rate limiting — owned by shopify-throttle.mjs, NOT retried here.
  assert.equal(isTransientStatus(429), false);
  assert.equal(isTransientStatus(undefined), false);
  assert.equal(isTransientStatus(null), false);
});

test("isMutation flags only documents whose operation keyword is `mutation`", () => {
  assert.equal(isMutation("mutation Foo($x: ID!) { a }"), true);
  // Leading whitespace / newlines (how the codebase's template literals start).
  assert.equal(isMutation("\n  mutation MarketingDiscountCreate { a }"), true);
  // Leading `#` comment lines are skipped before the keyword check.
  assert.equal(isMutation("# create a thing\n  mutation Foo { a }"), true);

  assert.equal(isMutation("query Foo { a }"), false);
  assert.equal(isMutation("\n  query CatalogProductsByIds($ids: [ID!]!) { a }"), false);
  // Anonymous operations are queries (reads), never mutations.
  assert.equal(isMutation("{ publications(first: 20) { nodes { id } } }"), false);
  // A query that merely mentions "mutation" in a field name is still a read.
  assert.equal(isMutation("query { mutationLog { id } }"), false);
  // subscriptions aren't writes either.
  assert.equal(isMutation("subscription { x }"), false);
  assert.equal(isMutation(undefined), false);
  assert.equal(isMutation(123), false);
});

test("transientWaitMs is exponential backoff clamped to [base, max]", () => {
  assert.equal(transientWaitMs(0), TRANSIENT_BASE_WAIT_MS); // 500
  assert.equal(transientWaitMs(1), 1000);
  assert.equal(transientWaitMs(2), 2000);
  assert.equal(transientWaitMs(3), 4000);
  assert.equal(transientWaitMs(4), TRANSIENT_MAX_WAIT_MS); // 8000 (8000 == cap)
  assert.equal(transientWaitMs(20), TRANSIENT_MAX_WAIT_MS); // clamped
  // Never below the base, even for a negative/odd attempt.
  assert.equal(transientWaitMs(-5), TRANSIENT_BASE_WAIT_MS);
});

test("a network error on an idempotent op is retried with backoff", () => {
  const plan = planTransientRetry({ networkError: true, idempotent: true, attempt: 0 });
  assert.equal(plan.retry, true);
  assert.equal(plan.reason, "network");
  assert.equal(plan.waitMs, TRANSIENT_BASE_WAIT_MS);
});

test("a transient 5xx on an idempotent op is retried (502 = the reported error)", () => {
  for (const s of [408, 500, 502, 503, 504]) {
    const plan = planTransientRetry({ httpStatus: s, idempotent: true, attempt: 1 });
    assert.equal(plan.retry, true, `${s} should retry`);
    assert.equal(plan.reason, "http-5xx");
    assert.equal(plan.waitMs, 1000);
  }
});

test("idempotent defaults to true (queries retry without an explicit flag)", () => {
  assert.equal(planTransientRetry({ httpStatus: 502, attempt: 0 }).retry, true);
});

test("a NON-idempotent op (mutation) is NEVER auto-retried — avoids a double write", () => {
  const netw = planTransientRetry({ networkError: true, idempotent: false, attempt: 0 });
  assert.equal(netw.retry, false);
  assert.equal(netw.reason, "non-idempotent");

  const http = planTransientRetry({ httpStatus: 502, idempotent: false, attempt: 0 });
  assert.equal(http.retry, false);
  assert.equal(http.reason, "non-idempotent");
});

test("a non-transient outcome is not retried (success, 4xx, and throttle's 429)", () => {
  assert.equal(planTransientRetry({ httpStatus: 200, attempt: 0 }).reason, "not-transient");
  assert.equal(planTransientRetry({ httpStatus: 400, attempt: 0 }).reason, "not-transient");
  // 429 belongs to the throttle path, so the transient policy declines it.
  assert.equal(planTransientRetry({ httpStatus: 429, attempt: 0 }).reason, "not-transient");
});

test("retries are capped — an exhausted transient failure stops (so the error surfaces)", () => {
  const plan = planTransientRetry({
    httpStatus: 502,
    idempotent: true,
    attempt: TRANSIENT_MAX_RETRIES,
  });
  assert.equal(plan.retry, false);
  assert.equal(plan.reason, "max-retries-exhausted");
  // The last allowed retry is attempt === MAX - 1.
  assert.equal(
    planTransientRetry({ httpStatus: 502, idempotent: true, attempt: TRANSIENT_MAX_RETRIES - 1 }).retry,
    true
  );
});
