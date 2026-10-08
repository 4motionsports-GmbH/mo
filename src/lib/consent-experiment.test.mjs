import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONSENT_REWARD_EXPERIMENT,
  isValidConsentExperiment,
  servedCopyFacts,
  summariseConsentExperiment,
  variantDefinesReward,
} from "./consent-experiment.mjs";
import { isKnownSigninVariant } from "./consent-variants.mjs";

const known = (id) => ["a", "b", "c"].includes(id);
const EXP = Object.freeze({
  start: "2026-11-01",
  variants: ["a", "b"],
  control: "a",
  locale: "de",
  primary: "confirmedPerEligible",
  targetPerArm: 400,
});

/** One closed, in-population row. */
function row(arm, sessions, confirmed, extra = {}) {
  return { arm, locale: "de", mixed: false, afterStart: true, windowClosed: true, sessions, optedIn: confirmed * 2, doiSent: confirmed * 2, confirmed, alreadySubscribed: 0, ...extra };
}

test("the pre-registration is null until the flip, and valid with known variants once set", () => {
  if (CONSENT_REWARD_EXPERIMENT === null) {
    assert.equal(CONSENT_REWARD_EXPERIMENT, null);
  } else {
    assert.equal(isValidConsentExperiment(CONSENT_REWARD_EXPERIMENT), true);
    for (const v of CONSENT_REWARD_EXPERIMENT.variants) assert.equal(isKnownSigninVariant(v), true, v);
  }
});

test("isValidConsentExperiment rejects incomplete pre-registrations", () => {
  assert.equal(isValidConsentExperiment(EXP), true);
  assert.equal(isValidConsentExperiment({ ...EXP, locale: null }), true);
  assert.equal(isValidConsentExperiment(null), false);
  assert.equal(isValidConsentExperiment({ ...EXP, start: "01.11.2026" }), false);
  assert.equal(isValidConsentExperiment({ ...EXP, variants: ["a"] }), false);
  assert.equal(isValidConsentExperiment({ ...EXP, variants: ["a", "a"] }), false);
  assert.equal(isValidConsentExperiment({ ...EXP, control: "z" }), false);
  assert.equal(isValidConsentExperiment({ ...EXP, primary: "accepted" }), false);
  assert.equal(isValidConsentExperiment({ ...EXP, targetPerArm: 0 }), false);
  assert.equal(isValidConsentExperiment({ ...EXP, locale: "fr" }), false);
});

test("no experiment → no comparison, only the arms seen", () => {
  const s = summariseConsentExperiment([row("a", 50, 5), row("b", 40, 6), row("zz", 3, 0)], null, known);
  assert.equal(s.experiment, null);
  assert.deepEqual(s.comparisons, []);
  assert.equal(s.progress, null);
  assert.deepEqual(s.armsSeen, ["a", "b"]);
  assert.equal(s.sessions, 93);
  assert.deepEqual(s.arms, {});
});

test("the known example: 60/400 vs 40/400 is significant, CI ≈ [0.0043, 0.0957]", () => {
  const s = summariseConsentExperiment([row("a", 400, 40), row("b", 400, 60)], EXP, known);
  assert.equal(s.comparisons.length, 1);
  const c = s.comparisons[0];
  assert.equal(c.variant, "b");
  assert.equal(c.appliedRate, 0.15);
  assert.equal(c.holdoutRate, 0.1);
  assert.ok(Math.abs(c.diff - 0.05) < 1e-12);
  assert.ok(Math.abs(c.ciLow - 0.0043) < 1e-4, String(c.ciLow));
  assert.ok(Math.abs(c.ciHigh - 0.0957) < 1e-4, String(c.ciHigh));
  assert.equal(c.significant, true);
  assert.ok(Math.abs(c.relLift - 0.5) < 1e-12);
  assert.equal(c.progress.reached, true);
  assert.deepEqual(s.progress, { reached: true, n: 800, target: 800 });
});

test("missing control → null rates, no significance, progress not reached", () => {
  const s = summariseConsentExperiment([row("b", 400, 60)], EXP, known);
  const c = s.comparisons[0];
  assert.equal(c.holdoutRate, null);
  assert.equal(c.diff, null);
  assert.equal(c.significant, false);
  assert.equal(c.progress.reached, false);
  assert.equal(s.arms.a.closed, 0);
});

test("mixed, other-locale, before-start, open-window and unknown sessions are excluded, each once", () => {
  const s = summariseConsentExperiment(
    [
      row("a", 10, 1),
      row("b", 10, 2),
      row("b", 3, 1, { mixed: true }),
      row("b", 4, 1, { locale: "en" }),
      row("b", 5, 1, { afterStart: false }),
      row("a", 6, 1, { windowClosed: false }),
      row("zz", 7, 1),
      row("c", 2, 1), // known, but not in this test
      row("", 1, 0),
      row("b", 9, 1, { mixed: true, locale: "en" }), // counted once, as mixed
    ],
    EXP,
    known
  );
  assert.deepEqual(s.excluded, { unknownVariant: 10, mixed: 12, otherLocale: 4, beforeStart: 5, windowOpen: 6 });
  assert.deepEqual(s.arms.a, { eligible: 16, closed: 10, optedIn: 2, doiSent: 2, confirmed: 1, alreadySubscribed: 0 });
  assert.deepEqual(s.arms.b, { eligible: 10, closed: 10, optedIn: 4, doiSent: 4, confirmed: 2, alreadySubscribed: 0 });
  assert.equal(s.sessions, 57);
  assert.deepEqual(s.armsSeen, ["a", "b", "c"]);
  assert.equal(s.progress?.reached, false);
  assert.equal(s.progress?.n, 20);
});

test("an invalid pre-registration compares nothing", () => {
  const s = summariseConsentExperiment([row("a", 400, 40), row("b", 400, 60)], /** @type {any} */ ({ ...EXP, control: "z" }), known);
  assert.equal(s.experiment, null);
  assert.deepEqual(s.comparisons, []);
});

test("servedCopyFacts: reward and value moment only when served valid and approved", () => {
  const base = { variant: "b", lawyerApproved: true };
  assert.deepEqual(servedCopyFacts(base), { variant: "b", reward: false, valueMoment: false, mode: "popup" });
  assert.deepEqual(servedCopyFacts({ ...base, reward: { badge: "x", terms: "y" } }), { variant: "b", reward: true, valueMoment: false, mode: "popup" });
  assert.deepEqual(
    servedCopyFacts({ ...base, reward: { badge: "x", terms: "y" }, valueMoment: { lead: "z" } }),
    { variant: "b", reward: true, valueMoment: true, mode: "value_moment" }
  );
  assert.equal(servedCopyFacts({ ...base, reward: { badge: " ", terms: "y" } }).reward, false);
  assert.equal(servedCopyFacts({ ...base, reward: ["x"] }).reward, false);
  assert.equal(servedCopyFacts({ ...base, valueMoment: { lead: "" } }).mode, "popup");
  assert.deepEqual(
    servedCopyFacts({ variant: "b", lawyerApproved: false, reward: { badge: "x", terms: "y" }, valueMoment: { lead: "z" } }),
    { variant: "b", reward: false, valueMoment: false, mode: "popup" }
  );
  assert.equal(servedCopyFacts({ variant: "<script>", lawyerApproved: true }).variant, null);
  assert.equal(servedCopyFacts(null).variant, null);
});

test("variantDefinesReward: no shipped variant defines a reward before T3; forged ids never do", () => {
  assert.equal(variantDefinesReward("a"), false);
  assert.equal(variantDefinesReward("zz"), false);
  assert.equal(variantDefinesReward(42), false);
});
