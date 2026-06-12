import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAPTURE_ERROR_TRANSACTIONAL_REQUIRED,
  isValidEmail,
  validateCaptureRequest,
} from "./capture-validation.mjs";

// Consent copy v2: BOTH boxes start unchecked, so a submit without the
// transactional box is a real user state — the capture MUST be rejected with
// the dedicated, documented error code (HTTP 400 in the route).

test("rejects a capture without transactional consent (documented code)", () => {
  for (const transactionalConsent of [false, undefined, null, "true", 1]) {
    const res = validateCaptureRequest({
      email: "max@example.de",
      transactionalConsent,
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, CAPTURE_ERROR_TRANSACTIONAL_REQUIRED);
    assert.equal(res.code, "transactional_consent_required"); // wire-stable
    assert.ok(res.message.length > 0);
  }
});

test("accepts a capture with transactional consent strictly true", () => {
  const res = validateCaptureRequest({
    email: "max@example.de",
    transactionalConsent: true,
  });
  assert.deepEqual(res, { ok: true });
});

test("rejects an invalid email before the consent check", () => {
  const res = validateCaptureRequest({
    email: "not-an-email",
    transactionalConsent: true,
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, "bad_request");
});

test("isValidEmail matches the documented pattern", () => {
  assert.equal(isValidEmail("max@example.de"), true);
  assert.equal(isValidEmail("  max@example.de  "), true); // trimmed server-side
  assert.equal(isValidEmail("max@example"), false);
  assert.equal(isValidEmail("max example@example.de"), false);
  assert.equal(isValidEmail(""), false);
  assert.equal(isValidEmail(null), false);
});
