import { test } from "node:test";
import assert from "node:assert/strict";
import { planOutboxRetry, isPermanentUserError, OUTBOX_MAX_ATTEMPTS, outboxKindLabel } from "./outbox-core.mjs";

const NOW = new Date("2026-10-01T10:00:00.000Z");

test("success is done", () => {
  assert.deepEqual(planOutboxRetry({ attempts: 1, ok: true, now: NOW }), { status: "done", nextAttemptAt: null });
});

test("failures back off and finally turn dead", () => {
  assert.deepEqual(planOutboxRetry({ attempts: 1, ok: false, now: NOW }), {
    status: "failed",
    nextAttemptAt: "2026-10-01T10:01:00.000Z",
  });
  assert.equal(planOutboxRetry({ attempts: 3, ok: false, now: NOW }).nextAttemptAt, "2026-10-01T10:15:00.000Z");
  assert.equal(planOutboxRetry({ attempts: 7, ok: false, now: NOW }).nextAttemptAt, "2026-10-01T14:00:00.000Z");
  assert.equal(planOutboxRetry({ attempts: OUTBOX_MAX_ATTEMPTS, ok: false, now: NOW }).status, "dead");
});

test("permanent errors are dead at once", () => {
  assert.equal(planOutboxRetry({ attempts: 1, ok: false, permanent: true, now: NOW }).status, "dead");
});

test("permanent user errors are recognised", () => {
  assert.equal(isPermanentUserError([{ message: "Customer does not exist" }]), true);
  assert.equal(isPermanentUserError([{ code: "NOT_FOUND" }]), true);
  assert.equal(isPermanentUserError([{ message: "Email has already been taken" }]), true);
  assert.equal(isPermanentUserError([{ message: "Throttled" }]), false);
  assert.equal(isPermanentUserError([]), false);
});

test("labels", () => {
  assert.equal(outboxKindLabel("data_erasure"), "Löschung in Shopify beantragen");
});
