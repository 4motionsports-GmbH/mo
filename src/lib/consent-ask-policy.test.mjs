import { test } from "node:test";
import assert from "node:assert/strict";
import { isConsentAskQuiet, CONSENT_ASK_MAX_SHOWN_SESSIONS } from "./consent-ask-policy.mjs";

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
