import { test } from "node:test";
import assert from "node:assert/strict";
import { liftDecision, optOutReasonLabel, optOutState } from "./marketing-optout-core.mjs";

test("unsubscribe, manual and legacy blocks can be lifted", () => {
  for (const r of ["unsubscribe", "manual", null, "something-old"]) {
    assert.deepEqual(liftDecision(r), { allowed: true, why: null }, String(r));
  }
});

test("bounce, complaint and erasure stay blocked with a reason", () => {
  for (const r of ["bounce", "complaint", "erasure"]) {
    const d = liftDecision(r);
    assert.equal(d.allowed, false, r);
    assert.ok(d.why && d.why.length > 20, r);
  }
});

test("labels are German and never empty", () => {
  assert.equal(optOutReasonLabel("unsubscribe"), "Abmeldelink in einer E-Mail");
  assert.equal(optOutReasonLabel("manual"), "Manuell im Dashboard abgemeldet");
  assert.equal(optOutReasonLabel(null), "Abgemeldet");
});

test("state: not blocked", () => {
  const s = optOutState(null, null);
  assert.equal(s.blocked, false);
  assert.equal(s.canLift, false);
});

test("state: block-list row wins for reason and date", () => {
  const s = optOutState({ reason: "unsubscribe", addedAt: "2026-09-30T10:00:00Z" }, "2026-09-30T10:00:01Z");
  assert.deepEqual(s, {
    blocked: true,
    reason: "unsubscribe",
    label: "Abmeldelink in einer E-Mail",
    since: "2026-09-30T10:00:00Z",
    canLift: true,
    liftBlockedWhy: null,
  });
});

test("state: chat unsubscribe without a block-list row counts as unsubscribe", () => {
  const s = optOutState(null, "2026-01-02T00:00:00Z");
  assert.equal(s.reason, "unsubscribe");
  assert.equal(s.since, "2026-01-02T00:00:00Z");
  assert.equal(s.canLift, true);
});

test("state: a complaint cannot be lifted", () => {
  const s = optOutState({ reason: "complaint", addedAt: "2026-09-01T00:00:00Z" }, null);
  assert.equal(s.canLift, false);
  assert.match(s.liftBlockedWhy, /Spam/);
});
