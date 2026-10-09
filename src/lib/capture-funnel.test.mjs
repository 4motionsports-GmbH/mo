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
  doiCooldownField,
  isDoiMailSent,
  OPT_IN_OUTCOMES,
} from "./capture-funnel.mjs";

const r = (o) => ({ marketingConsent: true, suppressed: false, doiEmailRequired: false, marketingDoiStatus: "none", subscribedElsewhere: false, ...o });

test("optInOutcome: the full matrix", () => {
  assert.equal(optInOutcome(r({ marketingConsent: false })), null);
  assert.equal(optInOutcome(r({ marketingConsent: false, marketingDoiStatus: "pending", pendingElsewhere: true })), null);
  assert.equal(optInOutcome(r({ suppressed: true, marketingDoiStatus: "confirmed" })), "suppressed");
  assert.equal(optInOutcome(r({ doiEmailRequired: true, marketingDoiStatus: "pending" })), "doi_required");
  assert.equal(optInOutcome(r({ marketingDoiStatus: "confirmed" })), "already_confirmed");
  assert.equal(optInOutcome(r({ subscribedElsewhere: true })), "already_subscribed");
  assert.equal(optInOutcome(r({ pendingElsewhere: true })), "shopify_pending");
  assert.equal(optInOutcome(r({ marketingDoiStatus: "pending" })), "doi_pending");
  assert.equal(optInOutcome(r({})), null);
});

test("optInOutcome: precedence of the new outcomes (T2.1 doi_pending, C.29 shopify_pending)", () => {
  // Ticked + pending + subscribed elsewhere stays already_subscribed (not doi_pending).
  assert.equal(optInOutcome(r({ marketingDoiStatus: "pending", subscribedElsewhere: true })), "already_subscribed");
  // A Mo DOI pending + the shop's mail out → shopify_pending (no Mo mail either way).
  assert.equal(optInOutcome(r({ marketingDoiStatus: "pending", pendingElsewhere: true })), "shopify_pending");
  // Suppressed, a Mo send and a Mo confirmation beat the shop's pending mail.
  assert.equal(optInOutcome(r({ suppressed: true, pendingElsewhere: true })), "suppressed");
  assert.equal(optInOutcome(r({ doiEmailRequired: true, marketingDoiStatus: "pending", pendingElsewhere: true })), "doi_required");
  assert.equal(optInOutcome(r({ marketingDoiStatus: "confirmed", pendingElsewhere: true })), "already_confirmed");
  // Subscribed beats pending elsewhere.
  assert.equal(optInOutcome(r({ subscribedElsewhere: true, pendingElsewhere: true })), "already_subscribed");
  assert.ok(OPT_IN_OUTCOMES.includes("doi_pending"));
  assert.ok(OPT_IN_OUTCOMES.includes("shopify_pending"));
});

test("isAlreadyConfirmedAnswer: a suppressed address is never 'already subscribed' (F2)", () => {
  assert.equal(isAlreadyConfirmedAnswer("already_confirmed"), true);
  assert.equal(isAlreadyConfirmedAnswer("already_subscribed"), true);
  assert.equal(isAlreadyConfirmedAnswer("suppressed"), false);
  assert.equal(isAlreadyConfirmedAnswer("doi_required"), false);
  assert.equal(isAlreadyConfirmedAnswer("doi_pending"), false);
  assert.equal(isAlreadyConfirmedAnswer("shopify_pending"), false);
  assert.equal(isAlreadyConfirmedAnswer(null), false);
});

test("eventOutcome / eventSource: legacy mappings; a forged echo never moves a row", () => {
  assert.equal(eventOutcome("doi_pending", "pending"), "doi_pending");
  assert.equal(eventOutcome("shopify_pending", "none"), "shopify_pending");
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

test("optInAnswer: within the cooldown / a lost race → pending + doiEmailSent (a valid mail is out, T2.1)", () => {
  const cd = a({ doiEmailRequired: false, doiEmailSent: false, doiCooldown: true });
  assert.deepEqual(optInAnswer(cd), { status: "pending", doiEmailSent: true, alreadyConfirmed: false });
  // The winner's claim was released already (its send failed): no mail is out.
  assert.deepEqual(optInAnswer(a({ doiEmailRequired: false, doiEmailSent: false, doiCooldown: false })), {
    status: "pending",
    doiEmailSent: false,
    alreadyConfirmed: false,
  });
  // A suppressed address stays neutral; a confirmed row or a subscription elsewhere is unaffected.
  assert.deepEqual(optInAnswer({ ...cd, suppressed: true }), { status: "none", doiEmailSent: false, alreadyConfirmed: false });
  assert.deepEqual(optInAnswer({ ...cd, marketingDoiStatus: "confirmed" }), {
    status: "confirmed",
    doiEmailSent: false,
    alreadyConfirmed: true,
  });
  assert.deepEqual(optInAnswer({ ...cd, subscribedElsewhere: true }), {
    status: "confirmed",
    doiEmailSent: false,
    alreadyConfirmed: true,
  });
  // doiCooldown never turns a failed send of THIS request into „sent“.
  assert.deepEqual(optInAnswer(a({ doiEmailSent: false, doiCooldown: true })), {
    status: "pending",
    doiEmailSent: false,
    alreadyConfirmed: false,
  });
  // A summary-only submit on a pending row (not ticked, no cooldown flag): unchanged.
  assert.deepEqual(optInAnswer(a({ doiEmailRequired: false, doiEmailSent: false })), {
    status: "pending",
    doiEmailSent: false,
    alreadyConfirmed: false,
  });
});

test("optInAnswer: the shop's confirmation mail is out (C.29) → pending + doiEmailSent, never for a blocked address", () => {
  const se = a({ marketingDoiStatus: "none", doiEmailRequired: false, doiEmailSent: false, pendingElsewhere: true });
  assert.deepEqual(optInAnswer(se), { status: "pending", doiEmailSent: true, alreadyConfirmed: false });
  assert.deepEqual(optInAnswer({ ...se, marketingDoiStatus: "pending" }), { status: "pending", doiEmailSent: true, alreadyConfirmed: false });
  assert.deepEqual(optInAnswer({ ...se, suppressed: true }), { status: "none", doiEmailSent: false, alreadyConfirmed: false });
  assert.deepEqual(optInAnswer({ ...se, marketingDoiStatus: "confirmed" }), { status: "confirmed", doiEmailSent: false, alreadyConfirmed: true });
  assert.deepEqual(optInAnswer({ ...se, subscribedElsewhere: true }), { status: "confirmed", doiEmailSent: false, alreadyConfirmed: true });
  // The answer agrees with the outcome for every branch.
  for (const x of [se, { ...se, marketingDoiStatus: "pending" }, a({ doiEmailRequired: false, doiEmailSent: false, doiCooldown: true })]) {
    const outcome = optInOutcome({ marketingConsent: true, ...x });
    assert.equal(optInAnswer(x).alreadyConfirmed, isAlreadyConfirmedAnswer(outcome));
  }
});

test("doiSentField: only for doi_required; true only for a successful send (F3)", () => {
  assert.deepEqual(doiSentField("doi_required", true), { doiSent: true });
  assert.deepEqual(doiSentField("doi_required", false), { doiSent: false });
  assert.deepEqual(doiSentField("doi_required", undefined), { doiSent: false });
  for (const o of ["already_confirmed", "already_subscribed", "suppressed", "doi_pending", "shopify_pending", null]) {
    assert.deepEqual(doiSentField(o, true), {});
  }
});

test("doiCooldownField: only doi_pending with the cooldown flag (T2.1)", () => {
  assert.deepEqual(doiCooldownField("doi_pending", true), { doiCooldown: true });
  assert.deepEqual(doiCooldownField("doi_pending", false), {});
  assert.deepEqual(doiCooldownField("doi_pending", undefined), {});
  for (const o of ["doi_required", "already_confirmed", "already_subscribed", "suppressed", "shopify_pending", null]) {
    assert.deepEqual(doiCooldownField(o, true), {});
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
  // No DOI mail was due: never counted — also not a cooldown answer or the shop's mail (T2.1, C.29).
  assert.equal(isDoiMailSent("doi_pending", "pending", undefined), false);
  assert.equal(isDoiMailSent("shopify_pending", "none", undefined), false);
  assert.equal(isDoiMailSent("shopify_pending", "pending", undefined), false);
  assert.equal(isDoiMailSent("already_confirmed", "confirmed", undefined), false);
  assert.equal(isDoiMailSent("suppressed", "confirmed", undefined), false);
  assert.equal(isDoiMailSent(undefined, "none", undefined), false);
  // The write side and the read side agree.
  for (const sent of [true, false]) {
    assert.equal(isDoiMailSent("doi_required", "pending", doiSentField("doi_required", sent).doiSent), sent);
  }
});
