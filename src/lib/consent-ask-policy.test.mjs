import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isConsentAskQuiet,
  isMailableEmail,
  isMarketingOptInActionable,
  CONSENT_ASK_MAX_SHOWN_SESSIONS,
  SYNTHETIC_EMAIL_PREFIX,
} from "./consent-ask-policy.mjs";

test("a decline in any session makes the ask quiet; shown in 3 sessions too", () => {
  assert.equal(CONSENT_ASK_MAX_SHOWN_SESSIONS, 3);
  assert.equal(isConsentAskQuiet({ declinedSessions: 1, shownSessions: 1 }), true);
  assert.equal(isConsentAskQuiet({ declinedSessions: 0, shownSessions: 2 }), false);
  assert.equal(isConsentAskQuiet({ declinedSessions: 0, shownSessions: 3 }), true);
  assert.equal(isConsentAskQuiet({ declinedSessions: 0, shownSessions: 0 }), false);
});

test("invalid counts fail closed (quiet)", () => {
  assert.equal(isConsentAskQuiet({ declinedSessions: "x", shownSessions: 0 }), true);
  assert.equal(isConsentAskQuiet({ declinedSessions: 0, shownSessions: -1 }), true);
  assert.equal(isConsentAskQuiet({ declinedSessions: undefined, shownSessions: undefined }), true);
});

test("isMailableEmail: a real address, never the shopify: placeholder", () => {
  assert.equal(SYNTHETIC_EMAIL_PREFIX, "shopify:");
  assert.equal(isMailableEmail("anna@example.com"), true);
  assert.equal(isMailableEmail("shopify:123"), false);
  assert.equal(isMailableEmail("shopify:a@b.de"), false);
  assert.equal(isMailableEmail("no-at-sign"), false);
  assert.equal(isMailableEmail(""), false);
  assert.equal(isMailableEmail(null), false);
});

test("isMarketingOptInActionable: real address + status none + not suppressed + not quiet", () => {
  const base = { email: "anna@example.com", marketingStatus: "none", suppressed: false, quiet: false };
  assert.equal(isMarketingOptInActionable(base), true);
  for (const status of ["pending", "confirmed", "unsubscribed", undefined]) {
    assert.equal(isMarketingOptInActionable({ ...base, marketingStatus: status }), false, String(status));
  }
  assert.equal(isMarketingOptInActionable({ ...base, email: "shopify:42" }), false);
  assert.equal(isMarketingOptInActionable({ ...base, quiet: true }), false);
});

test("isMarketingOptInActionable: any suppression_list row stops the ask; unknown fails closed", () => {
  const base = { email: "anna@example.com", marketingStatus: "none", suppressed: false, quiet: false };
  // The reason does not matter (unsubscribe, manual, complaint, bounce, erasure): the
  // store reads "is there a row", the rule only sees the boolean.
  assert.equal(isMarketingOptInActionable({ ...base, suppressed: true }), false);
  assert.equal(isMarketingOptInActionable({ ...base, suppressed: undefined }), false);
  assert.equal(isMarketingOptInActionable({ ...base, suppressed: null }), false);
  assert.equal(isMarketingOptInActionable({ ...base, suppressed: 0 }), false);
  assert.equal(isMarketingOptInActionable({ ...base, quiet: undefined }), false);
});
