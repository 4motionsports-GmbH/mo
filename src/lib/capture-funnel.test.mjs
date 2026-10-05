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
