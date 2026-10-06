import { test } from "node:test";
import assert from "node:assert/strict";
import {
  storedOfferTrigger,
  normaliseTrigger,
  optInOutcome,
  isAlreadyConfirmedAnswer,
  eventOutcome,
  eventSource,
  confirmationSource,
  optInAnswer,
  doiSentField,
  isDoiMailSent,
} from "./capture-funnel.mjs";

const r = (o) => ({ marketingConsent: true, suppressed: false, doiEmailRequired: false, marketingDoiStatus: "none", subscribedElsewhere: false, ...o });

test("optInOutcome: the full matrix", () => {
  assert.equal(optInOutcome(r({ marketingConsent: false })), null);
  assert.equal(optInOutcome(r({ suppressed: true, marketingDoiStatus: "confirmed" })), "suppressed");
  assert.equal(optInOutcome(r({ doiEmailRequired: true, marketingDoiStatus: "pending" })), "doi_required");
  assert.equal(optInOutcome(r({ marketingDoiStatus: "confirmed" })), "already_confirmed");
  assert.equal(optInOutcome(r({ subscribedElsewhere: true })), "already_subscribed");
  assert.equal(optInOutcome(r({})), null);
});

test("isAlreadyConfirmedAnswer: a suppressed address is never 'already subscribed' (F2)", () => {
  assert.equal(isAlreadyConfirmedAnswer("already_confirmed"), true);
  assert.equal(isAlreadyConfirmedAnswer("already_subscribed"), true);
  assert.equal(isAlreadyConfirmedAnswer("suppressed"), false);
  assert.equal(isAlreadyConfirmedAnswer("doi_required"), false);
  assert.equal(isAlreadyConfirmedAnswer(null), false);
});

test("eventOutcome / eventSource: legacy mappings; a forged echo never moves a row", () => {
  assert.equal(eventOutcome("suppressed", "confirmed"), "suppressed");
  assert.equal(eventOutcome(undefined, "pending"), "doi_required");
  assert.equal(eventOutcome(undefined, "confirmed"), "already_confirmed");
  assert.equal(eventOutcome(undefined, "none"), "unknown");
  assert.equal(eventSource("mo_capture_form", "signin_optin"), "mo_capture_form");
  assert.equal(eventSource("", "signin_optin"), "mo_signin");
  assert.equal(eventSource(undefined, "chat_gate"), "mo_chat_gate");
  assert.equal(eventSource(undefined, "buying_intent"), "mo_capture_form");
  assert.equal(eventSource("evil", undefined), "mo_capture_form");
});

test("triggers: only tool values are stored; reading bounds everything", () => {
  assert.equal(storedOfferTrigger("buying_intent"), "buying_intent");
  assert.equal(storedOfferTrigger("signin_optin"), null);
  assert.equal(storedOfferTrigger("x".repeat(40)), null);
  assert.equal(normaliseTrigger(""), "none");
  assert.equal(normaliseTrigger("foo"), "other");
  assert.equal(normaliseTrigger("unspecified"), "unspecified");
});

test("confirmationSource: session first, then pending, else mo", () => {
  assert.equal(confirmationSource({ sessionSource: "mo_signin", pendingSource: "mo_capture_form" }), "mo_signin");
  assert.equal(confirmationSource({ sessionSource: null, pendingSource: "mo_capture_form" }), "mo_capture_form");
  assert.equal(confirmationSource({}), "mo");
});

const a = (o) => ({ suppressed: false, subscribedElsewhere: false, marketingDoiStatus: "pending", doiEmailRequired: true, doiEmailSent: true, ...o });

test("optInAnswer: a suppressed address never reads as subscribed or as 'DOI mail sent'", () => {
  for (const marketingDoiStatus of ["none", "pending", "confirmed"]) {
    for (const doiEmailSent of [true, false]) {
      assert.deepEqual(optInAnswer(a({ suppressed: true, marketingDoiStatus, doiEmailSent, subscribedElsewhere: true })), {
        status: "none",
        doiEmailSent: false,
        alreadyConfirmed: false,
      });
    }
  }
});

test("optInAnswer: new DOI, failed send, already confirmed, subscribed elsewhere", () => {
  assert.deepEqual(optInAnswer(a({})), { status: "pending", doiEmailSent: true, alreadyConfirmed: false });
  assert.deepEqual(optInAnswer(a({ doiEmailSent: false })), { status: "pending", doiEmailSent: false, alreadyConfirmed: false });
  assert.deepEqual(optInAnswer(a({ marketingDoiStatus: "confirmed", doiEmailRequired: false, doiEmailSent: false })), {
    status: "confirmed",
    doiEmailSent: false,
    alreadyConfirmed: true,
  });
  assert.deepEqual(optInAnswer(a({ subscribedElsewhere: true, marketingDoiStatus: "none", doiEmailRequired: false, doiEmailSent: false })), {
    status: "confirmed",
    doiEmailSent: false,
    alreadyConfirmed: true,
  });
  // The alreadyConfirmed answer equals the outcome-based reconstruction for every non-suppressed branch.
  for (const x of [
    a({}),
    a({ marketingDoiStatus: "confirmed", doiEmailRequired: false }),
    a({ subscribedElsewhere: true, marketingDoiStatus: "none", doiEmailRequired: false }),
  ]) {
    const outcome = optInOutcome({ marketingConsent: true, ...x });
    assert.equal(optInAnswer(x).alreadyConfirmed, isAlreadyConfirmedAnswer(outcome));
  }
});

test("doiSentField: only for doi_required; true only for a successful send (F3)", () => {
  assert.deepEqual(doiSentField("doi_required", true), { doiSent: true });
  assert.deepEqual(doiSentField("doi_required", false), { doiSent: false });
  assert.deepEqual(doiSentField("doi_required", undefined), { doiSent: false });
  for (const o of ["already_confirmed", "already_subscribed", "suppressed", null]) {
    assert.deepEqual(doiSentField(o, true), {});
  }
});

test("isDoiMailSent: counts sent DOI mails; legacy rows without doiSent count as before (F3)", () => {
  assert.equal(isDoiMailSent("doi_required", "pending", true), true);
  assert.equal(isDoiMailSent("doi_required", "pending", "true"), true);
  assert.equal(isDoiMailSent("doi_required", "pending", false), false);
  assert.equal(isDoiMailSent("doi_required", "pending", "false"), false);
  // Before F3: no doiSent → counted as sent (as the KPI always did).
  assert.equal(isDoiMailSent("doi_required", "pending", undefined), true);
  assert.equal(isDoiMailSent(undefined, "pending", undefined), true);
  // No DOI mail was due: never counted.
  assert.equal(isDoiMailSent("already_confirmed", "confirmed", undefined), false);
  assert.equal(isDoiMailSent("suppressed", "confirmed", undefined), false);
  assert.equal(isDoiMailSent(undefined, "none", undefined), false);
  // The write side and the read side agree.
  for (const sent of [true, false]) {
    assert.equal(isDoiMailSent("doi_required", "pending", doiSentField("doi_required", sent).doiSent), sent);
  }
});
