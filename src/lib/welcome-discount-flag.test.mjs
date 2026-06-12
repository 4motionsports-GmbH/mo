import { test } from "node:test";
import assert from "node:assert/strict";
import { isWelcomeDiscountEnabled } from "./welcome-discount-flag.mjs";

// WELCOME_DISCOUNT_ENABLED gates the ENTIRE welcome-code issuance path:
// issueWelcomeCodeOnDoiConfirmation (src/lib/welcome-discount.ts) checks this
// flag as GATE 0, before any claim/mint/send, and returns
// { issued: false, reason: "disabled" } when it is false. These tests pin the
// fail-closed flag semantics that gate relies on.

test("issuance is blocked by default (flag unset)", () => {
  assert.equal(isWelcomeDiscountEnabled({}), false);
  assert.equal(isWelcomeDiscountEnabled({ WELCOME_DISCOUNT_ENABLED: undefined }), false);
});

test("explicit false-y and garbage values keep issuance blocked", () => {
  for (const v of ["false", "0", "no", "off", "", "  ", "FALSE", "enabled?", "ja bitte"]) {
    assert.equal(
      isWelcomeDiscountEnabled({ WELCOME_DISCOUNT_ENABLED: v }),
      false,
      `value ${JSON.stringify(v)} must not enable issuance`
    );
  }
});

test("only an explicit opt-in value enables issuance", () => {
  for (const v of ["true", "TRUE", " true ", "1", "yes", "on"]) {
    assert.equal(
      isWelcomeDiscountEnabled({ WELCOME_DISCOUNT_ENABLED: v }),
      true,
      `value ${JSON.stringify(v)} should enable issuance`
    );
  }
});

test("reads process.env by default", () => {
  const prev = process.env.WELCOME_DISCOUNT_ENABLED;
  try {
    delete process.env.WELCOME_DISCOUNT_ENABLED;
    assert.equal(isWelcomeDiscountEnabled(), false);
    process.env.WELCOME_DISCOUNT_ENABLED = "true";
    assert.equal(isWelcomeDiscountEnabled(), true);
  } finally {
    if (prev === undefined) delete process.env.WELCOME_DISCOUNT_ENABLED;
    else process.env.WELCOME_DISCOUNT_ENABLED = prev;
  }
});
