import { test } from "node:test";
import assert from "node:assert/strict";
import { decideCaptureDoi } from "./email-capture-core.mjs";

const NOW = "2026-10-05T10:00:00.000Z";
const SENT = "2026-10-01T08:00:00.000Z";
const newToken = () => "tok-new";
const pending = { status: "pending", token: "tok-old", sentAt: SENT };
const confirmed = { status: "confirmed", token: "tok-c", sentAt: SENT };

const decide = (over) =>
  decideCaptureDoi({ marketingConsent: false, suppressed: false, existing: null, newToken, now: NOW, ...over });

test("marketing ticked on a fresh address → pending, new token, DOI mail due", () => {
  assert.deepEqual(decide({ marketingConsent: true }), {
    status: "pending",
    doiToken: "tok-new",
    doiSentAt: NOW,
    doiEmailRequired: true,
    marketingConsentColumn: true,
  });
});

test("a summary-only submit keeps a pending DOI — the link in the inbox keeps working (OI1 F1)", () => {
  assert.deepEqual(decide({ existing: pending }), {
    status: "pending",
    doiToken: "tok-old",
    doiSentAt: SENT,
    doiEmailRequired: false,
    marketingConsentColumn: true,
  });
});

test("a suppressed address drops a pending DOI", () => {
  assert.deepEqual(decide({ existing: pending, suppressed: true }), {
    status: "none",
    doiToken: null,
    doiSentAt: null,
    doiEmailRequired: false,
    marketingConsentColumn: false,
  });
});

test("confirmed stays confirmed with token and send time, ticked or not, suppressed or not", () => {
  for (const over of [{}, { marketingConsent: true }, { suppressed: true }, { marketingConsent: true, alreadySubscribed: true }]) {
    assert.deepEqual(decide({ existing: confirmed, ...over }), {
      status: "confirmed",
      doiToken: "tok-c",
      doiSentAt: SENT,
      doiEmailRequired: false,
      marketingConsentColumn: true,
    });
  }
});

test("ticked but already subscribed elsewhere → no new token or mail; a pending DOI is kept", () => {
  assert.deepEqual(decide({ marketingConsent: true, alreadySubscribed: true }), {
    status: "none",
    doiToken: null,
    doiSentAt: null,
    doiEmailRequired: false,
    marketingConsentColumn: true,
  });
  assert.deepEqual(decide({ marketingConsent: true, alreadySubscribed: true, existing: pending }), {
    status: "pending",
    doiToken: "tok-old",
    doiSentAt: SENT,
    doiEmailRequired: false,
    marketingConsentColumn: true,
  });
});

test("ticked again while pending → a fresh token and mail (re-request)", () => {
  const d = decide({ marketingConsent: true, existing: pending });
  assert.equal(d.status, "pending");
  assert.equal(d.doiToken, "tok-new");
  assert.equal(d.doiSentAt, NOW);
  assert.equal(d.doiEmailRequired, true);
});

test("nothing ticked, nothing pending → none; ticked but suppressed → none, the tick still recorded", () => {
  assert.equal(decide({}).status, "none");
  assert.equal(decide({ existing: { status: "none", token: null, sentAt: null } }).marketingConsentColumn, false);
  const s = decide({ marketingConsent: true, suppressed: true });
  assert.equal(s.status, "none");
  assert.equal(s.doiEmailRequired, false);
  assert.equal(s.marketingConsentColumn, true);
});
