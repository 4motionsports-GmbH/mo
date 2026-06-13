import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeMarketingTargets,
  recentConfirmedContacts,
} from "./admin-overview.mjs";

const target = (email, confirmedAt, status) => ({
  email,
  confirmedAt,
  purchase: { status },
});

test("summarizeMarketingTargets buckets by purchase status", () => {
  const targets = [
    target("a@x.de", "2026-06-01T00:00:00Z", "no_purchase"),
    target("b@x.de", "2026-06-02T00:00:00Z", "purchased"),
    target("c@x.de", "2026-06-03T00:00:00Z", "unknown"),
    target("d@x.de", "2026-06-04T00:00:00Z", "no_purchase"),
  ];
  assert.deepEqual(summarizeMarketingTargets(targets), {
    eligible: 4,
    notPurchased: 2,
    purchased: 1,
    unknown: 1,
  });
});

test("summarizeMarketingTargets counts unrecognised/absent status as unknown", () => {
  const targets = [
    { email: "a@x.de", confirmedAt: null, purchase: { status: "weird" } },
    { email: "b@x.de", confirmedAt: null, purchase: {} },
    { email: "c@x.de", confirmedAt: null },
  ];
  assert.deepEqual(summarizeMarketingTargets(targets), {
    eligible: 3,
    notPurchased: 0,
    purchased: 0,
    unknown: 3,
  });
});

test("summarizeMarketingTargets handles empty / non-array input", () => {
  const zero = { eligible: 0, notPurchased: 0, purchased: 0, unknown: 0 };
  assert.deepEqual(summarizeMarketingTargets([]), zero);
  assert.deepEqual(summarizeMarketingTargets(null), zero);
  assert.deepEqual(summarizeMarketingTargets(undefined), zero);
});

test("recentConfirmedContacts sorts newest-first and caps to the limit", () => {
  const targets = [
    target("old@x.de", "2026-06-01T00:00:00Z", "no_purchase"),
    target("new@x.de", "2026-06-10T00:00:00Z", "purchased"),
    target("mid@x.de", "2026-06-05T00:00:00Z", "unknown"),
  ];
  const recent = recentConfirmedContacts(targets, 2);
  assert.deepEqual(
    recent.map((r) => r.email),
    ["new@x.de", "mid@x.de"]
  );
});

test("recentConfirmedContacts drops entries without a parseable date or email", () => {
  const targets = [
    target("ok@x.de", "2026-06-05T00:00:00Z", "no_purchase"),
    target("", "2026-06-06T00:00:00Z", "no_purchase"),
    target("nodate@x.de", null, "no_purchase"),
    target("baddate@x.de", "not-a-date", "no_purchase"),
  ];
  const recent = recentConfirmedContacts(targets, 5);
  assert.deepEqual(
    recent.map((r) => r.email),
    ["ok@x.de"]
  );
});

test("recentConfirmedContacts defaults to a sane limit and tolerates bad input", () => {
  assert.deepEqual(recentConfirmedContacts(null), []);
  assert.deepEqual(recentConfirmedContacts([], 0), []);
});
