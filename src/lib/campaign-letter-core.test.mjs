import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LETTER_COST_CENTS,
  LETTER_PAGE_ONE_CHARS,
  decideCampaignLetterSend,
  letterMembership,
  letterReviewChecks,
  letterRunEstimate,
  parseLetterMode,
  shippingNameMatches,
} from "./campaign-letter-core.mjs";

const ADDRESS = {
  name: "Erika Mustermann",
  address_line_1: "Heidestraße 17",
  postal_code: "51147",
  city: "Köln",
  country: "DE",
};

const NOW = new Date("2026-11-20T10:00:00Z");

/** A letter that passes every gate. */
const ok = (over = {}) => ({
  flagApproved: true,
  pingenConfigured: true,
  campaignLive: true,
  mode: "ohne_einwilligung",
  consentSubscribed: false,
  postalObjectionAt: null,
  address: ADDRESS,
  addressSource: "purchase",
  addressInvalidAt: null,
  subject: "Black Friday bei motion sports",
  body: "Hallo Erika,\n\nschön, dass …",
  lastLetterAt: null,
  minIntervalDays: 60,
  budgetCents: null,
  spentCents: 0,
  costCents: 106,
  now: NOW,
  ...over,
});

test("parseLetterMode accepts only the three modes", () => {
  assert.equal(parseLetterMode("aus"), "aus");
  assert.equal(parseLetterMode("ohne_einwilligung"), "ohne_einwilligung");
  assert.equal(parseLetterMode("alle"), "alle");
  assert.equal(parseLetterMode("ALLE"), null);
  assert.equal(parseLetterMode(null), null);
});

test("letterMembership: completed order, no objection, no block — and never both channels in ohne_einwilligung", () => {
  const p = { mode: "ohne_einwilligung", consentSubscribed: false, blocked: false, postalObjectionAt: null, ordersCount: 2 };
  assert.deepEqual(letterMembership(p), { member: true });
  assert.deepEqual(letterMembership({ ...p, mode: "aus" }), { member: false, reason: "aus" });
  assert.deepEqual(letterMembership({ ...p, mode: "nonsense" }), { member: false, reason: "aus" });
  assert.deepEqual(letterMembership({ ...p, postalObjectionAt: "2026-01-01T00:00:00Z" }), { member: false, reason: "widerspruch" });
  assert.deepEqual(letterMembership({ ...p, blocked: true }), { member: false, reason: "gesperrt" });
  assert.deepEqual(letterMembership({ ...p, ordersCount: 0 }), { member: false, reason: "kein_kauf" });
  assert.deepEqual(letterMembership({ ...p, consentSubscribed: true }), { member: false, reason: "einwilligung" });
  // 'alle' also writes to people with the consent.
  assert.deepEqual(letterMembership({ ...p, mode: "alle", consentSubscribed: true }), { member: true });
  // The objection wins over everything.
  assert.equal(letterMembership({ ...p, postalObjectionAt: "x", ordersCount: 0 }).reason, "widerspruch");
});

test("decideCampaignLetterSend: passes and returns the normalised address", () => {
  const r = decideCampaignLetterSend(ok());
  assert.equal(r.ok, true);
  assert.equal(r.address.addressLine1, "Heidestraße 17");
});

test("decideCampaignLetterSend: each gate, in order", () => {
  const reason = (over) => {
    const r = decideCampaignLetterSend(ok(over));
    return r.ok ? "ok" : r.reason;
  };
  assert.equal(reason({ flagApproved: false, pingenConfigured: false }), "flag_off");
  assert.equal(reason({ pingenConfigured: false }), "pingen_not_configured");
  assert.equal(reason({ campaignLive: false }), "campaign_closed");
  assert.equal(reason({ postalObjectionAt: "2026-01-01T00:00:00Z", address: null }), "objection");
  assert.equal(reason({ consentSubscribed: true }), "consent_now");
  assert.equal(reason({ mode: "alle", consentSubscribed: true }), "ok");
  assert.equal(reason({ address: null }), "no_address");
  assert.equal(reason({ address: { ...ADDRESS, city: "" } }), "no_address");
  assert.equal(reason({ addressSource: "consented_capture" }), "not_purchase_address");
  assert.equal(reason({ addressSource: null }), "not_purchase_address");
  assert.equal(reason({ addressInvalidAt: "2026-10-01T00:00:00Z" }), "address_invalid");
  assert.equal(reason({ body: "  " }), "no_text");
  assert.equal(reason({ subject: "" }), "no_text");
});

test("decideCampaignLetterSend: cadence between letters", () => {
  const reason = (over) => {
    const r = decideCampaignLetterSend(ok(over));
    return r.ok ? "ok" : r.reason;
  };
  assert.equal(reason({ lastLetterAt: "2026-10-01T10:00:00Z" }), "too_soon");
  assert.equal(reason({ lastLetterAt: "2026-09-01T10:00:00Z" }), "ok");
  assert.equal(reason({ lastLetterAt: "2026-11-19T10:00:00Z", minIntervalDays: 0 }), "ok");
});

test("decideCampaignLetterSend: the budget", () => {
  const reason = (over) => {
    const r = decideCampaignLetterSend(ok(over));
    return r.ok ? "ok" : r.reason;
  };
  assert.equal(reason({ budgetCents: 10_000, spentCents: 9_894 }), "ok");
  assert.equal(reason({ budgetCents: 10_000, spentCents: 9_895 }), "budget");
  assert.equal(reason({ budgetCents: 0 }), "budget");
  assert.equal(reason({ budgetCents: null, spentCents: 1e9 }), "ok");
});

test("shippingNameMatches catches gift orders", () => {
  assert.equal(shippingNameMatches("Erika Mustermann", "Erika", "Mustermann"), true);
  assert.equal(shippingNameMatches("Dr. Erika MUSTERMANN", "", "Mustermann"), true);
  assert.equal(shippingNameMatches("Jürgen Groß", "Jurgen", "Gross"), true);
  assert.equal(shippingNameMatches("Max Beispiel", "Erika", "Mustermann"), false);
  assert.equal(shippingNameMatches("Erika Mustermann-Schulz", "Erika", "Mustermann Schulz"), true);
  assert.equal(shippingNameMatches("Erika", "Erika", null), true);
  assert.equal(shippingNameMatches("Erika Mustermann", null, null), null);
  assert.equal(shippingNameMatches("", "Erika", "Mustermann"), false);
});

test("letterReviewChecks: the gate's refusal is blocked, the rest are hints", () => {
  const clean = letterReviewChecks(ok({ firstName: "Erika", lastName: "Mustermann", language: "de" }));
  assert.deepEqual(clean, { blocked: [], hints: [] });

  const gift = letterReviewChecks(ok({ firstName: "Max", lastName: "Beispiel" }));
  assert.deepEqual(gift.hints.map((h) => h.key), ["name_mismatch"]);

  const many = letterReviewChecks(
    ok({
      address: { ...ADDRESS, country: "AT" },
      language: "en",
      subject: "x".repeat(90),
      body: "y".repeat(LETTER_PAGE_ONE_CHARS + 1),
      lastName: "Mustermann",
    })
  );
  assert.deepEqual(many.hints.map((h) => h.key).sort(), ["abroad", "english", "long_subject", "multi_page"]);

  const blocked = letterReviewChecks(ok({ addressSource: "consented_capture" }));
  assert.deepEqual(blocked.blocked.map((b) => b.key), ["not_purchase_address"]);
});

test("letterRunEstimate: postage and what the budget allows", () => {
  assert.deepEqual(letterRunEstimate({ count: 10, costCents: 106 }), {
    count: 10,
    costCents: 106,
    postageCents: 1060,
    budgetLeftCents: null,
    affordable: 10,
  });
  const capped = letterRunEstimate({ count: 10, costCents: 100, budgetCents: 1000, spentCents: 650 });
  assert.equal(capped.budgetLeftCents, 350);
  assert.equal(capped.affordable, 3);
  assert.equal(letterRunEstimate({ count: 3, costCents: null }).costCents, DEFAULT_LETTER_COST_CENTS);
  assert.equal(letterRunEstimate({ count: -2 }).count, 0);
  assert.equal(letterRunEstimate({ count: 5, budgetCents: 100, spentCents: 500 }).affordable, 0);
});

test("letterMinIntervalDays: default 60, 0 switches it off, junk falls back", async () => {
  const { letterMinIntervalDays } = await import("./campaign-letter-core.mjs");
  assert.equal(letterMinIntervalDays({}), 60);
  assert.equal(letterMinIntervalDays({ LETTER_MIN_INTERVAL_DAYS: "0" }), 0);
  assert.equal(letterMinIntervalDays({ LETTER_MIN_INTERVAL_DAYS: "90" }), 90);
  assert.equal(letterMinIntervalDays({ LETTER_MIN_INTERVAL_DAYS: "-3" }), 60);
  assert.equal(letterMinIntervalDays({ LETTER_MIN_INTERVAL_DAYS: "abc" }), 60);
});

test("letterAddressNightly: default 200, 0 off, capped at 2000", async () => {
  const { letterAddressNightly } = await import("./campaign-letter-core.mjs");
  assert.equal(letterAddressNightly({}), 200);
  assert.equal(letterAddressNightly({ CAMPAIGN_LETTER_ADDRESS_NIGHTLY: "0" }), 0);
  assert.equal(letterAddressNightly({ CAMPAIGN_LETTER_ADDRESS_NIGHTLY: "5000" }), 2000);
  assert.equal(letterAddressNightly({ CAMPAIGN_LETTER_ADDRESS_NIGHTLY: "x" }), 200);
});
