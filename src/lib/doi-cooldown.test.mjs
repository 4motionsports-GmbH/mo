import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DOI_RESEND_COOLDOWN_MINUTES, effectiveDoiResendCooldownMinutes, parseDoiResendCooldownMinutes } from "./doi-cooldown.mjs";

test("parseDoiResendCooldownMinutes: default, whole minutes, never 0", () => {
  assert.equal(DEFAULT_DOI_RESEND_COOLDOWN_MINUTES, 30);
  assert.equal(parseDoiResendCooldownMinutes(undefined), 30);
  assert.equal(parseDoiResendCooldownMinutes(""), 30);
  assert.equal(parseDoiResendCooldownMinutes(" 45 "), 45);
  assert.equal(parseDoiResendCooldownMinutes("1"), 1);
  assert.equal(parseDoiResendCooldownMinutes("0"), 30);
  assert.equal(parseDoiResendCooldownMinutes("-5"), 30);
  assert.equal(parseDoiResendCooldownMinutes("1.5"), 30);
  assert.equal(parseDoiResendCooldownMinutes("abc"), 30);
  assert.equal(parseDoiResendCooldownMinutes("10080"), 10080);
  assert.equal(parseDoiResendCooldownMinutes("10081"), 30);
});

test("effectiveDoiResendCooldownMinutes: never as long as the link's life", () => {
  assert.equal(effectiveDoiResendCooldownMinutes(30, 7), 30);
  assert.equal(effectiveDoiResendCooldownMinutes(10080, 7), 10079);
  assert.equal(effectiveDoiResendCooldownMinutes(2880, 1), 1439);
  assert.equal(effectiveDoiResendCooldownMinutes(30, 0), 30); // unusable expiry → the 7-day default
  assert.equal(effectiveDoiResendCooldownMinutes(Number.NaN, 7), 30);
  assert.equal(effectiveDoiResendCooldownMinutes(1, 7), 1);
});
