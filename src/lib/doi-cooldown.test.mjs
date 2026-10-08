import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DOI_RESEND_COOLDOWN_MINUTES, parseDoiResendCooldownMinutes } from "./doi-cooldown.mjs";

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
