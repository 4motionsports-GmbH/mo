import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FILTER,
  activeFilterCount,
  filterCustomers,
  isFilterActive,
  presetFilter,
  sendState,
} from "./admin-customer-filter.mjs";

const row = (overrides) => ({
  id: 1,
  email: "a@x.de",
  name: null,
  identityTier: 2,
  firstSeenAt: "2026-05-01T00:00:00Z",
  lastSeenAt: "2026-09-01T00:00:00Z",
  marketingStatus: "confirmed",
  purchaseState: "unknown",
  sendStatus: null,
  sessionCount: 1,
  ...overrides,
});

const rows = [
  row({ id: 1, email: "anna@x.de", name: "Anna Neumann", purchaseState: "purchased", sendStatus: "sent", lastSeenAt: "2026-09-05T00:00:00Z", sessionCount: 3 }),
  row({ id: 2, email: "ben@x.de", purchaseState: "no_purchase", sendStatus: "draft", lastSeenAt: "2026-09-07T00:00:00Z", firstSeenAt: "2026-01-01T00:00:00Z" }),
  row({ id: 3, email: "cara@x.de", marketingStatus: "pending", identityTier: 3, lastSeenAt: null }),
  row({ id: 4, email: "dan@x.de", marketingStatus: "unsubscribed", identityTier: 1, lastSeenAt: "2026-08-01T00:00:00Z", firstSeenAt: null }),
];

test("presetFilter seeds the Übersicht deep links", () => {
  assert.deepEqual(presetFilter("no_purchase"), { ...DEFAULT_FILTER, marketing: "confirmed", kauf: "no_purchase" });
  assert.deepEqual(presetFilter("marketing"), { ...DEFAULT_FILTER, marketing: "confirmed" });
  assert.deepEqual(presetFilter("draft"), { ...DEFAULT_FILTER, send: "draft" });
  assert.deepEqual(presetFilter(undefined), { ...DEFAULT_FILTER });
  assert.deepEqual(presetFilter("nope"), { ...DEFAULT_FILTER });
});

test("sendState collapses approved into draft", () => {
  assert.equal(sendState(row({ sendStatus: null })), "none");
  assert.equal(sendState(row({ sendStatus: "draft" })), "draft");
  assert.equal(sendState(row({ sendStatus: "approved" })), "draft");
  assert.equal(sendState(row({ sendStatus: "sent" })), "sent");
});

test("filterCustomers searches name and email case-insensitively", () => {
  assert.deepEqual(filterCustomers(rows, { ...DEFAULT_FILTER, query: "NEUMANN" }).map((c) => c.id), [1]);
  assert.deepEqual(filterCustomers(rows, { ...DEFAULT_FILTER, query: "@x.de" }).length, 4);
});

test("filterCustomers applies tier, marketing, purchase and send filters", () => {
  assert.deepEqual(filterCustomers(rows, { ...DEFAULT_FILTER, tier: "3" }).map((c) => c.id), [3]);
  assert.deepEqual(filterCustomers(rows, { ...DEFAULT_FILTER, marketing: "unsubscribed" }).map((c) => c.id), [4]);
  assert.deepEqual(filterCustomers(rows, presetFilter("no_purchase")).map((c) => c.id), [2]);
  assert.deepEqual(filterCustomers(rows, { ...DEFAULT_FILTER, kauf: "purchased" }).map((c) => c.id), [1]);
  assert.deepEqual(filterCustomers(rows, { ...DEFAULT_FILTER, send: "draft" }).map((c) => c.id), [2]);
  assert.deepEqual(filterCustomers(rows, { ...DEFAULT_FILTER, send: "none" }).map((c) => c.id), [4, 3]);
});

test("filterCustomers sorts: recent (nulls last), name, first_seen, sessions", () => {
  assert.deepEqual(filterCustomers(rows, DEFAULT_FILTER).map((c) => c.id), [2, 1, 4, 3]);
  assert.deepEqual(filterCustomers(rows, { ...DEFAULT_FILTER, sort: "name" }).map((c) => c.id), [1, 2, 3, 4]);
  assert.deepEqual(filterCustomers(rows, { ...DEFAULT_FILTER, sort: "first_seen" }).map((c) => c.id), [2, 1, 3, 4]);
  assert.deepEqual(filterCustomers(rows, { ...DEFAULT_FILTER, sort: "sessions" }).map((c) => c.id), [1, 2, 4, 3]);
});

test("filterCustomers does not mutate its input", () => {
  const copy = rows.map((r) => ({ ...r }));
  filterCustomers(rows, { ...DEFAULT_FILTER, sort: "name" });
  assert.deepEqual(rows, copy);
});

test("activeFilterCount / isFilterActive count non-default filters", () => {
  assert.equal(activeFilterCount(DEFAULT_FILTER), 0);
  assert.equal(isFilterActive(DEFAULT_FILTER), false);
  assert.equal(activeFilterCount({ ...DEFAULT_FILTER, query: " x ", tier: "2", sort: "name" }), 2);
  assert.equal(isFilterActive({ ...DEFAULT_FILTER, send: "sent" }), true);
});
