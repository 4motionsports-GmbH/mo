// Tests for the §7(3) Bestandskunden plain-text assembler. The load-bearing
// rule is legal: every existing-customer email must carry the free, anytime
// objection notice (§7 Abs. 3 Nr. 4 UWG). These guard that the assembler can
// never drop it.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bestandskundeEmailSubject,
  bestandskundeEmailText,
  TEST_SUBJECT_PREFIX,
} from "./bestandskunde-email-core.mjs";

test("subject is marked in test mode, plain otherwise", () => {
  assert.ok(bestandskundeEmailSubject({ isTest: true }).startsWith(TEST_SUBJECT_PREFIX));
  assert.ok(!bestandskundeEmailSubject({ isTest: false }).startsWith(TEST_SUBJECT_PREFIX));
  assert.ok(!bestandskundeEmailSubject().startsWith(TEST_SUBJECT_PREFIX));
});

test("the §7(3) objection notice is always the final block", () => {
  const notice = "Du kannst jederzeit kostenlos widersprechen: https://example.test/opt-out?token=abc";
  const body = bestandskundeEmailText({
    intro: "Hallo,",
    marketingLines: ["Neue, ähnliche Produkte für dich im Shop."],
    optOutNoticeText: notice,
  });
  assert.ok(body.includes("Hallo,"));
  assert.ok(body.includes("Neue, ähnliche Produkte für dich im Shop."));
  assert.ok(body.includes("https://example.test/opt-out?token=abc"), "opt-out URL present");
  assert.ok(body.trimEnd().endsWith(notice), "notice must be the last block");
});

test("intro and marketing lines are optional but the notice is not", () => {
  const notice = "Widerspruch: https://example.test/opt-out";
  assert.equal(bestandskundeEmailText({ intro: "", optOutNoticeText: notice }), notice);
  assert.throws(
    () => bestandskundeEmailText({ intro: "Hi", optOutNoticeText: "" }),
    /mandatory/
  );
  assert.throws(
    () => bestandskundeEmailText({ intro: "Hi", optOutNoticeText: "   " }),
    /mandatory/
  );
});
