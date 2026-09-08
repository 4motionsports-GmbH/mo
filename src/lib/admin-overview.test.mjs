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

test("recentConfirmedContacts accepts Date objects (driver output) and normalises to ISO", () => {
  const targets = [
    { email: "date@x.de", confirmedAt: new Date("2026-06-07T10:00:00Z") },
    { email: "iso@x.de", confirmedAt: "2026-06-06T10:00:00Z" },
    { email: "bad@x.de", confirmedAt: new Date("nope") },
  ];
  assert.deepEqual(recentConfirmedContacts(targets, 5), [
    { email: "date@x.de", confirmedAt: "2026-06-07T10:00:00.000Z" },
    { email: "iso@x.de", confirmedAt: "2026-06-06T10:00:00.000Z" },
  ]);
});

test("mergeRecentSends interleaves campaign + marketing sends newest first", async () => {
  const { mergeRecentSends } = await import("./admin-overview.mjs");
  const campaign = [
    { id: 1, email: "a@x.de", subject: "A", sentAt: "2026-09-01T10:00:00Z" },
    { id: 2, email: "b@x.de", subject: "B", sentAt: null },
  ];
  const marketing = [
    { id: 7, email: "c@x.de", subject: "C", sentAt: "2026-09-02T10:00:00Z" },
    { id: 8, email: "d@x.de", subject: "D", sentAt: "2026-09-01T10:00:00Z" },
  ];
  const merged = mergeRecentSends(campaign, marketing, 3);
  assert.deepEqual(
    merged.map((s) => `${s.source}:${s.id}`),
    ["marketing:7", "campaign:1", "marketing:8"]
  );
  assert.equal(mergeRecentSends(campaign, marketing, 10).at(-1).id, 2, "no timestamp sorts last");
  assert.deepEqual(mergeRecentSends(null, undefined), []);
});

test("todayItems maps counts to four deep-linked cards", async () => {
  const { todayItems } = await import("./admin-overview.mjs");
  const items = todayItems({
    campaign: { pending: 20, drafted: 18, sentToday: 1 },
    unmatchedInbound: 3,
    qaOpen: 0,
    runningReports: 0,
    runningImprovementRuns: 1,
  });
  assert.deepEqual(
    items.map((i) => [i.key, i.value, i.attention, i.href]),
    [
      ["kampagne", 18, true, "/admin?tab=kampagne"],
      ["posteingang", 3, true, "/admin?tab=kunden"],
      ["wissen", 0, false, "/admin?tab=wissen"],
      ["analysen", 1, true, "/admin?tab=verbesserung"],
    ]
  );
  assert.equal(items[0].hint, "20 offen · 1 heute gesendet");
  assert.equal(items[1].hint, "E-Mails ohne Kundenzuordnung");
});

test("todayItems tolerates missing counts", async () => {
  const { todayItems } = await import("./admin-overview.mjs");
  const items = todayItems({ campaign: null });
  assert.deepEqual(items.map((i) => i.value), [0, 0, 0, 0]);
  assert.ok(items.every((i) => i.attention === false));
  assert.equal(items[3].href, "/admin?tab=analyse");
});
