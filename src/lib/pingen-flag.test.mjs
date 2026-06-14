import { test } from "node:test";
import assert from "node:assert/strict";
import { isPhysicalMailSendsApproved } from "./pingen-flag.mjs";

test("defaults to FALSE (fail-closed) when unset/blank/unknown", () => {
  assert.equal(isPhysicalMailSendsApproved({}), false);
  assert.equal(isPhysicalMailSendsApproved({ PHYSICAL_MAIL_SENDS_APPROVED: "" }), false);
  assert.equal(isPhysicalMailSendsApproved({ PHYSICAL_MAIL_SENDS_APPROVED: "maybe" }), false);
  assert.equal(isPhysicalMailSendsApproved({ PHYSICAL_MAIL_SENDS_APPROVED: undefined }), false);
});

test("accepts the documented truthy tokens (case/space-insensitive)", () => {
  for (const v of ["1", "true", "TRUE", "yes", "on", "  On  "]) {
    assert.equal(isPhysicalMailSendsApproved({ PHYSICAL_MAIL_SENDS_APPROVED: v }), true, v);
  }
});

test("'false'/'0'/'off' stay OFF", () => {
  for (const v of ["false", "0", "off", "no"]) {
    assert.equal(isPhysicalMailSendsApproved({ PHYSICAL_MAIL_SENDS_APPROVED: v }), false, v);
  }
});
