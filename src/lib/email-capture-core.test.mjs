import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideCaptureDoi,
  isWithinDoiCooldown,
  isReusableDoiToken,
  recordDoiStatus,
  recordDoiCooldown,
  shouldReleaseDoiClaim,
  isDoiOptInRecorded,
  DEFAULT_DOI_EXPIRY_DAYS,
} from "./email-capture-core.mjs";
import { DEFAULT_DOI_RESEND_COOLDOWN_MINUTES } from "./doi-cooldown.mjs";

const NOW = "2026-10-05T10:00:00.000Z";
const SENT = "2026-10-01T08:00:00.000Z"; // 4 days 2 h ago: valid, outside the cooldown
const MIN = 60_000;
const ago = (ms) => new Date(Date.parse(NOW) - ms).toISOString();
const newToken = () => "tok-new";
const pending = { status: "pending", token: "tok-old", sentAt: SENT };
const confirmed = { status: "confirmed", token: "tok-c", sentAt: SENT };
const NO_FLAGS = { doiCooldown: false, doiResend: false };

const decide = (over) =>
  decideCaptureDoi({ marketingConsent: false, suppressed: false, existing: null, newToken, now: NOW, ...over });

test("marketing ticked on a fresh address → pending, new token, DOI mail due", () => {
  assert.deepEqual(decide({ marketingConsent: true }), {
    status: "pending",
    doiToken: "tok-new",
    doiSentAt: NOW,
    doiEmailRequired: true,
    marketingConsentColumn: true,
    ...NO_FLAGS,
  });
});

test("a summary-only submit keeps a pending DOI — the link in the inbox keeps working (OI1 F1)", () => {
  assert.deepEqual(decide({ existing: pending }), {
    status: "pending",
    doiToken: "tok-old",
    doiSentAt: SENT,
    doiEmailRequired: false,
    marketingConsentColumn: true,
    ...NO_FLAGS,
  });
});

test("a suppressed address drops a pending DOI", () => {
  assert.deepEqual(decide({ existing: pending, suppressed: true }), {
    status: "none",
    doiToken: null,
    doiSentAt: null,
    doiEmailRequired: false,
    marketingConsentColumn: false,
    ...NO_FLAGS,
  });
});

test("confirmed stays confirmed with token and send time, ticked or not, suppressed or not", () => {
  for (const over of [
    {},
    { marketingConsent: true },
    { suppressed: true },
    { marketingConsent: true, alreadySubscribed: true },
    { marketingConsent: true, pendingElsewhere: true },
  ]) {
    assert.deepEqual(decide({ existing: confirmed, ...over }), {
      status: "confirmed",
      doiToken: "tok-c",
      doiSentAt: SENT,
      doiEmailRequired: false,
      marketingConsentColumn: true,
      ...NO_FLAGS,
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
    ...NO_FLAGS,
  });
  assert.deepEqual(decide({ marketingConsent: true, alreadySubscribed: true, existing: pending }), {
    status: "pending",
    doiToken: "tok-old",
    doiSentAt: SENT,
    doiEmailRequired: false,
    marketingConsentColumn: true,
    ...NO_FLAGS,
  });
});

test("C.29: the shop's confirmation mail is out → no Mo token or mail; a pending Mo DOI is never overwritten", () => {
  assert.deepEqual(decide({ marketingConsent: true, pendingElsewhere: true }), {
    status: "none",
    doiToken: null,
    doiSentAt: null,
    doiEmailRequired: false,
    marketingConsentColumn: true,
    ...NO_FLAGS,
  });
  // Pending outside and inside the cooldown, and a released claim: kept as is, no cooldown flag.
  for (const existing of [pending, { ...pending, sentAt: ago(5 * MIN) }, { ...pending, sentAt: null }]) {
    assert.deepEqual(decide({ marketingConsent: true, pendingElsewhere: true, existing }), {
      status: "pending",
      doiToken: "tok-old",
      doiSentAt: existing.sentAt,
      doiEmailRequired: false,
      marketingConsentColumn: true,
      ...NO_FLAGS,
    });
  }
  // A suppressed address wins: nothing pending, the tick recorded.
  const s = decide({ marketingConsent: true, pendingElsewhere: true, suppressed: true, existing: pending });
  assert.equal(s.status, "none");
  assert.equal(s.doiToken, null);
  assert.equal(s.doiEmailRequired, false);
  // Not ticked: pendingElsewhere changes nothing.
  assert.deepEqual(decide({ pendingElsewhere: true }), decide({}));
});

test("ticked within the cooldown → token and send time kept, no mail, doiCooldown", () => {
  const recent = { ...pending, sentAt: ago(5 * MIN) };
  assert.deepEqual(decide({ marketingConsent: true, existing: recent }), {
    status: "pending",
    doiToken: "tok-old",
    doiSentAt: recent.sentAt,
    doiEmailRequired: false,
    marketingConsentColumn: true,
    doiCooldown: true,
    doiResend: false,
  });
});

test("cooldown boundary: 29:59 keeps, 30:00 sends again", () => {
  const keep = decide({ marketingConsent: true, existing: { ...pending, sentAt: ago(30 * MIN - 1000) } });
  assert.equal(keep.doiEmailRequired, false);
  assert.equal(keep.doiCooldown, true);
  const send = decide({ marketingConsent: true, existing: { ...pending, sentAt: ago(30 * MIN) } });
  assert.equal(send.doiEmailRequired, true);
  assert.equal(send.doiCooldown, false);
  assert.equal(send.doiToken, "tok-old");
});

test("ticked again after the cooldown → the SAME token, mailed again, its expiry restarts (doiResend)", () => {
  assert.deepEqual(decide({ marketingConsent: true, existing: pending }), {
    status: "pending",
    doiToken: "tok-old",
    doiSentAt: NOW,
    doiEmailRequired: true,
    marketingConsentColumn: true,
    doiCooldown: false,
    doiResend: true,
  });
});

test("an expired pending token is replaced by a new one", () => {
  const old = { ...pending, sentAt: ago(DEFAULT_DOI_EXPIRY_DAYS * 86_400_000 + 1000) };
  const d = decide({ marketingConsent: true, existing: old });
  assert.equal(d.doiEmailRequired, true);
  assert.equal(d.doiToken, "tok-new");
  assert.equal(d.doiResend, false);
  // A shorter configured expiry counts.
  const d2 = decide({ marketingConsent: true, existing: { ...pending, sentAt: ago(2 * 86_400_000) }, expiryDays: 1 });
  assert.equal(d2.doiToken, "tok-new");
});

test("a released claim (sentAt null — its send failed) → sends at once with the same token", () => {
  const d = decide({ marketingConsent: true, existing: { ...pending, sentAt: null } });
  assert.equal(d.doiEmailRequired, true);
  assert.equal(d.doiCooldown, false);
  assert.equal(d.doiToken, "tok-old");
  assert.equal(d.doiResend, true);
  assert.equal(d.doiSentAt, NOW);
});

test("the cooldown never applies to confirmed, tokenless, none or suppressed rows; subscribed elsewhere wins", () => {
  const recent = ago(MIN);
  assert.equal(decide({ marketingConsent: true, existing: { ...confirmed, sentAt: recent } }).doiCooldown, false);
  const tokenless = decide({ marketingConsent: true, existing: { status: "pending", token: null, sentAt: recent } });
  assert.equal(tokenless.doiEmailRequired, true);
  assert.equal(tokenless.doiToken, "tok-new");
  const none = decide({ marketingConsent: true, existing: { status: "none", token: "tok-stale", sentAt: recent } });
  assert.equal(none.doiEmailRequired, true);
  assert.equal(none.doiToken, "tok-new");
  assert.equal(none.doiResend, false);
  const suppressed = decide({ marketingConsent: true, suppressed: true, existing: { ...pending, sentAt: recent } });
  assert.equal(suppressed.doiCooldown, false);
  assert.equal(suppressed.status, "none");
  const elsewhere = decide({ marketingConsent: true, alreadySubscribed: true, existing: { ...pending, sentAt: recent } });
  assert.equal(elsewhere.doiCooldown, false);
  assert.equal(elsewhere.doiEmailRequired, false);
});

test("not ticked + pending within the cooldown → kept, no doiCooldown flag", () => {
  const recent = { ...pending, sentAt: ago(MIN) };
  assert.deepEqual(decide({ existing: recent }), {
    status: "pending",
    doiToken: "tok-old",
    doiSentAt: recent.sentAt,
    doiEmailRequired: false,
    marketingConsentColumn: true,
    ...NO_FLAGS,
  });
});

test("defaults: cooldown 30 min and expiry 7 days when not passed; a configured cooldown counts", () => {
  assert.equal(DEFAULT_DOI_RESEND_COOLDOWN_MINUTES, 30);
  assert.equal(DEFAULT_DOI_EXPIRY_DAYS, 7);
  const at45 = { ...pending, sentAt: ago(45 * MIN) };
  assert.equal(decide({ marketingConsent: true, existing: at45 }).doiEmailRequired, true);
  assert.equal(decide({ marketingConsent: true, existing: at45, cooldownMinutes: 60 }).doiCooldown, true);
  const at6d = { ...pending, sentAt: ago(6 * 86_400_000) };
  assert.equal(decide({ marketingConsent: true, existing: at6d }).doiToken, "tok-old");
});

test("nothing ticked, nothing pending → none; ticked but suppressed → none, the tick still recorded", () => {
  assert.equal(decide({}).status, "none");
  assert.equal(decide({ existing: { status: "none", token: null, sentAt: null } }).marketingConsentColumn, false);
  const s = decide({ marketingConsent: true, suppressed: true });
  assert.equal(s.status, "none");
  assert.equal(s.doiEmailRequired, false);
  assert.equal(s.marketingConsentColumn, true);
});

test("isWithinDoiCooldown / isReusableDoiToken: the matrix", () => {
  const cd = 30 * MIN;
  const ex = 7 * 86_400_000;
  const p = (sentAt, over = {}) => ({ status: "pending", token: "t", sentAt, ...over });
  assert.equal(isWithinDoiCooldown(p(ago(MIN)), NOW, cd), true);
  assert.equal(isWithinDoiCooldown(p(ago(cd)), NOW, cd), false);
  assert.equal(isWithinDoiCooldown(p(null), NOW, cd), false);
  assert.equal(isWithinDoiCooldown(p("not a date"), NOW, cd), false);
  assert.equal(isWithinDoiCooldown(p(ago(MIN), { token: null }), NOW, cd), false);
  assert.equal(isWithinDoiCooldown(p(ago(MIN), { status: "confirmed" }), NOW, cd), false);
  assert.equal(isWithinDoiCooldown(null, NOW, cd), false);
  assert.equal(isReusableDoiToken(p(ago(MIN)), NOW, ex), true);
  assert.equal(isReusableDoiToken(p(null), NOW, ex), true);
  assert.equal(isReusableDoiToken(p(ago(ex)), NOW, ex), false);
  assert.equal(isReusableDoiToken(p("not a date"), NOW, ex), false);
  assert.equal(isReusableDoiToken(p(ago(MIN), { token: null }), NOW, ex), false);
  assert.equal(isReusableDoiToken(p(ago(MIN), { status: "none" }), NOW, ex), false);
  assert.equal(isReusableDoiToken(undefined, NOW, ex), false);
});

test("recordDoiStatus: the RECORD write never clobbers a claim or reverts a confirmation", () => {
  assert.equal(recordDoiStatus("confirmed", false), "confirmed");
  assert.equal(recordDoiStatus("confirmed", true), "confirmed");
  assert.equal(recordDoiStatus("pending", false), "pending");
  assert.equal(recordDoiStatus("pending", true), "none");
  assert.equal(recordDoiStatus("none", false), "none");
  assert.equal(recordDoiStatus(null, false), "none");
  // It equals decideCaptureDoi's non-send outcomes for every current status.
  for (const status of ["none", "pending", "confirmed"]) {
    for (const suppressed of [false, true]) {
      const existing = { status, token: status === "none" ? null : "t", sentAt: ago(MIN) };
      assert.equal(recordDoiStatus(status, suppressed), decide({ existing, suppressed }).status);
    }
  }
});

test("recordDoiCooldown: only a ticked, unblocked, not-elsewhere accept on a pending row in the cooldown", () => {
  const r = (o) => ({ marketingConsent: true, suppressed: false, status: "pending", inCooldown: true, ...o });
  assert.equal(recordDoiCooldown(r({})), true);
  assert.equal(recordDoiCooldown(r({ marketingConsent: false })), false);
  assert.equal(recordDoiCooldown(r({ suppressed: true })), false);
  assert.equal(recordDoiCooldown(r({ alreadySubscribed: true })), false);
  assert.equal(recordDoiCooldown(r({ pendingElsewhere: true })), false);
  assert.equal(recordDoiCooldown(r({ status: "confirmed" })), false);
  assert.equal(recordDoiCooldown(r({ inCooldown: false })), false);
});

test("after the send: release a claim whose mail did not go out; record the pending act only when it did (or dev skip)", () => {
  assert.equal(shouldReleaseDoiClaim(true, "none"), true);
  assert.equal(shouldReleaseDoiClaim(true, "failed"), true);
  assert.equal(shouldReleaseDoiClaim(true, "sent"), false);
  assert.equal(shouldReleaseDoiClaim(true, "skipped"), false);
  assert.equal(shouldReleaseDoiClaim(false, "none"), false);
  assert.equal(isDoiOptInRecorded(true, "sent"), true);
  assert.equal(isDoiOptInRecorded(true, "skipped"), true);
  assert.equal(isDoiOptInRecorded(true, "failed"), false);
  assert.equal(isDoiOptInRecorded(true, "none"), false);
  assert.equal(isDoiOptInRecorded(false, "sent"), false);
});
