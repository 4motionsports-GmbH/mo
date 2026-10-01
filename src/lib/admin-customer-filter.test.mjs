import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCustomerFilter,
  customerFilterParams,
  customerQueryParams,
  activeCustomerFilterCount,
  defaultCustomerFilter,
  CUSTOMER_PAGE_SIZE,
  CUSTOMER_VIEWS,
} from "./admin-customer-filter.mjs";

test("empty params give the default filter", () => {
  assert.deepEqual(parseCustomerFilter({}), defaultCustomerFilter());
  assert.deepEqual(parseCustomerFilter(new URLSearchParams()), defaultCustomerFilter());
});

test("a view seeds its fields; explicit params refine it", () => {
  const f = parseCustomerFilter({ kview: "top", kmo: "yes" });
  assert.equal(f.view, "top");
  assert.equal(f.minSpentEur, 1500);
  assert.equal(f.sort, "revenue");
  assert.equal(f.mo, "yes");
});

test("unknown values are dropped, never guessed", () => {
  const f = parseCustomerFilter({ kview: "nope", kconsent: "maybe", kseg: "x", ksort: "random", kpage: "-2", kpersona: "DROP TABLE" });
  assert.deepEqual(f, defaultCustomerFilter());
});

test("round trip through the URL keeps only what differs", () => {
  const f = parseCustomerFilter({ kview: "einwilligung", kq: " Anna ", kseg: "ausbauen", kpage: "3" });
  const params = customerFilterParams(f);
  assert.equal(params.get("kview"), "einwilligung");
  assert.equal(params.get("kq"), "Anna");
  assert.equal(params.get("kseg"), "ausbauen");
  assert.equal(params.get("kpage"), "3");
  // The view's own consent value is implied, not repeated.
  assert.equal(params.get("kconsent"), null);
  assert.deepEqual(parseCustomerFilter(params), f);
});

test("query params: nullable predicates, escaped search, paging", () => {
  const now = new Date("2026-10-01T00:00:00.000Z");
  const f = parseCustomerFilter({ kview: "neu", kq: "50%_off", kpage: "2" });
  const p = customerQueryParams(f, now);
  assert.equal(p.q, "%50\\%\\_off%");
  assert.equal(p.mo, null);
  assert.equal(p.newSince, "2026-09-01T00:00:00.000Z");
  assert.equal(p.offset, CUSTOMER_PAGE_SIZE);
  assert.equal(p.limit, CUSTOMER_PAGE_SIZE);
  const leads = customerQueryParams(parseCustomerFilter({ kview: "interessenten" }), now);
  assert.equal(leads.shop, "lead");
  assert.equal(customerQueryParams(parseCustomerFilter({ kview: "aufgaben" }), now).tasks, true);
});

test("active filter count ignores what the view sets", () => {
  assert.equal(activeCustomerFilterCount(parseCustomerFilter({ kview: "mo" })), 0);
  assert.equal(activeCustomerFilterCount(parseCustomerFilter({ kview: "mo", kq: "x", kvalue: "klein" })), 2);
});

test("every view has a label and an explanation", () => {
  for (const [key, v] of Object.entries(CUSTOMER_VIEWS)) {
    assert.ok(v.label && v.info.length > 10, key);
  }
});

test("parseCustomerFilter: old ?filter= presets land on the closest view", () => {
  const marketing = parseCustomerFilter({ filter: "marketing" });
  assert.equal(marketing.view, "einwilligung");
  assert.equal(marketing.consent, "subscribed");
  const noPurchase = parseCustomerFilter({ filter: "no_purchase" });
  assert.equal(noPurchase.consent, "subscribed");
  assert.equal(noPurchase.segment, "keine_bestellung");
  assert.equal(parseCustomerFilter({ filter: "draft" }).view, "alle");
  // An explicit view wins over the old preset.
  assert.equal(parseCustomerFilter({ kview: "mo", filter: "marketing" }).view, "mo");
});
