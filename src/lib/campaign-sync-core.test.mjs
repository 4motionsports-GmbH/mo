import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isoOrNull,
  mapCustomerToContact,
  planContactStatus,
  moneyToCents,
} from "./campaign-sync-core.mjs";

// A fixture node shaped like the (mocked) GraphQL layer returns them — no live
// Shopify call anywhere in these tests.
function node(overrides = {}) {
  return {
    id: "gid://shopify/Customer/1",
    email: "Anna.Muster@Example.com ",
    firstName: "Anna",
    lastName: "Muster",
    locale: "de-DE",
    numberOfOrders: "3",
    amountSpent: { amount: "129.95", currencyCode: "EUR" },
    defaultAddress: { countryCodeV2: "DE" },
    emailMarketingConsent: {
      marketingState: "SUBSCRIBED",
      marketingOptInLevel: "CONFIRMED_OPT_IN",
      consentUpdatedAt: "2026-01-01T00:00:00Z",
    },
    ...overrides,
  };
}

test("a SUBSCRIBED customer maps to a normalized contact", () => {
  const c = mapCustomerToContact(node());
  assert.equal(c.shopifyCustomerId, "gid://shopify/Customer/1");
  assert.equal(c.email, "anna.muster@example.com"); // trimmed + lower-cased
  assert.equal(c.language, "de");
  assert.equal(c.optInLevel, "CONFIRMED_OPT_IN");
  assert.equal(c.ordersCount, 3);
  assert.equal(c.totalSpentCents, 12995);
});

test("anyone who is NOT SUBSCRIBED is never stored (fail-closed)", () => {
  for (const state of ["UNSUBSCRIBED", "PENDING", "NOT_SUBSCRIBED", "REDACTED", null]) {
    const c = mapCustomerToContact(
      node({ emailMarketingConsent: { marketingState: state, marketingOptInLevel: "SINGLE_OPT_IN" } })
    );
    assert.equal(c, null, `state ${state} must not map`);
  }
  // Missing consent block entirely → null (never "assume subscribed").
  assert.equal(mapCustomerToContact(node({ emailMarketingConsent: null })), null);
});

test("no usable email / id → not stored", () => {
  assert.equal(mapCustomerToContact(node({ email: null })), null);
  assert.equal(mapCustomerToContact(node({ email: "  " })), null);
  assert.equal(mapCustomerToContact(node({ id: null })), null);
  assert.equal(mapCustomerToContact(null), null);
});

test("unrecognised opt-in levels normalise to UNKNOWN (send-blocked default)", () => {
  const c = mapCustomerToContact(
    node({
      emailMarketingConsent: {
        marketingState: "SUBSCRIBED",
        marketingOptInLevel: "SOMETHING_NEW",
        consentUpdatedAt: null,
      },
    })
  );
  assert.equal(c.optInLevel, "UNKNOWN");
  const missing = mapCustomerToContact(
    node({
      emailMarketingConsent: { marketingState: "SUBSCRIBED", marketingOptInLevel: null },
    })
  );
  assert.equal(missing.optInLevel, "UNKNOWN");
});

test("language derivation: locale wins, country fallback, default de", () => {
  assert.equal(mapCustomerToContact(node({ locale: "en-GB" })).language, "en");
  assert.equal(
    mapCustomerToContact(node({ locale: null, defaultAddress: { countryCodeV2: "AT" } }))
      .language,
    "de"
  );
  assert.equal(
    mapCustomerToContact(node({ locale: null, defaultAddress: { countryCodeV2: "US" } }))
      .language,
    "en"
  );
  assert.equal(
    mapCustomerToContact(node({ locale: null, defaultAddress: null })).language,
    "de"
  );
});

test("moneyToCents: decimal strings, garbage, negatives", () => {
  assert.equal(moneyToCents("129.95"), 12995);
  assert.equal(moneyToCents("0"), 0);
  assert.equal(moneyToCents("abc"), 0);
  assert.equal(moneyToCents(null), 0);
  assert.equal(moneyToCents("-5"), 0);
});

test("planContactStatus: suppression marking beats everything (never deleted, marked)", () => {
  // Locally suppressed — regardless of current workflow state.
  for (const current of [null, "pending", "drafted", "sent", "skipped"]) {
    assert.equal(
      planContactStatus(current, { shopifyEligible: true, locallySuppressed: true }),
      "suppressed",
      `current ${current}`
    );
  }
  // Shopify-side no longer eligible.
  assert.equal(
    planContactStatus("pending", { shopifyEligible: false, locallySuppressed: false }),
    "suppressed"
  );
});

test("planContactStatus: idempotent upsert keeps workflow state; new rows start pending", () => {
  const ok = { shopifyEligible: true, locallySuppressed: false };
  assert.equal(planContactStatus(null, ok), "pending");
  assert.equal(planContactStatus("pending", ok), "pending");
  assert.equal(planContactStatus("drafted", ok), "drafted");
  assert.equal(planContactStatus("sent", ok), "sent");
  assert.equal(planContactStatus("skipped", ok), "skipped");
});

test("planContactStatus: a re-subscribed contact returns to pending — but a LOCAL opt-out never resurrects", () => {
  assert.equal(
    planContactStatus("suppressed", { shopifyEligible: true, locallySuppressed: false }),
    "pending"
  );
  assert.equal(
    planContactStatus("suppressed", { shopifyEligible: true, locallySuppressed: true }),
    "suppressed"
  );
});

// ── Lifecycle: last order date (migration 0052) ───────────────────────────────
// The date drives which segment a contact lands in, so a wrong value is worse
// than no value: it would pick the wrong recommendation strategy.

test("the last order date is carried through as ISO", () => {
  const c = mapCustomerToContact(node({ lastOrder: { createdAt: "2026-06-15T10:00:00Z" } }));
  assert.equal(c.lastOrderAt, "2026-06-15T10:00:00.000Z");
});

test("a customer who never ordered has no last order date", () => {
  assert.equal(mapCustomerToContact(node({ lastOrder: null })).lastOrderAt, null);
  assert.equal(mapCustomerToContact(node({})).lastOrderAt, null);
});

test("an unparseable date becomes null rather than a bogus segment", () => {
  const c = mapCustomerToContact(node({ lastOrder: { createdAt: "not-a-date" } }));
  assert.equal(c.lastOrderAt, null);
});

test("isoOrNull normalises and rejects", () => {
  assert.equal(isoOrNull("2026-01-02T03:04:05Z"), "2026-01-02T03:04:05.000Z");
  for (const bad of [null, undefined, "", "   ", "nope", 42, {}]) {
    assert.equal(isoOrNull(bad), null);
  }
});
