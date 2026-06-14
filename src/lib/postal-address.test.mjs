import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeShopifyAddress, chooseLawfulAddress } from "./postal-address.mjs";

// A Customer Account API CustomerAddress (territoryCode) ...
const CA_ADDR = {
  name: "Erika Mustermann",
  address1: "Musterstraße 1",
  address2: "Hinterhaus",
  zip: "12345",
  city: "Musterstadt",
  territoryCode: "DE",
  company: "ACME",
};

// ... and an Admin API MailingAddress (countryCodeV2, firstName/lastName).
const ADMIN_ADDR = {
  firstName: "Max",
  lastName: "Mustermann",
  address1: "Beispielweg 2",
  zip: "54321",
  city: "Beispielstadt",
  countryCodeV2: "DE",
};

test("normalizeShopifyAddress: Customer Account dialect → snake_case jsonb", () => {
  assert.deepEqual(normalizeShopifyAddress(CA_ADDR), {
    name: "Erika Mustermann",
    company: "ACME",
    address_line_1: "Musterstraße 1",
    address_line_2: "Hinterhaus",
    postal_code: "12345",
    city: "Musterstadt",
    country: "DE",
  });
});

test("normalizeShopifyAddress: Admin dialect, name from first+last, country from countryCodeV2", () => {
  assert.deepEqual(normalizeShopifyAddress(ADMIN_ADDR), {
    name: "Max Mustermann",
    company: null,
    address_line_1: "Beispielweg 2",
    address_line_2: null,
    postal_code: "54321",
    city: "Beispielstadt",
    country: "DE",
  });
});

test("normalizeShopifyAddress: lowercases→uppercases ISO country", () => {
  assert.equal(normalizeShopifyAddress({ ...ADMIN_ADDR, countryCodeV2: "be" }).country, "BE");
});

test("normalizeShopifyAddress: incomplete (no zip) → null, never part-filled", () => {
  const { zip, ...noZip } = CA_ADDR;
  void zip;
  assert.equal(normalizeShopifyAddress(noZip), null);
});

test("normalizeShopifyAddress: null/garbage → null", () => {
  assert.equal(normalizeShopifyAddress(null), null);
  assert.equal(normalizeShopifyAddress({}), null);
});

test("chooseLawfulAddress: prefers a completed-order shipping address (purchase)", () => {
  const r = chooseLawfulAddress({
    orderShippingAddresses: [CA_ADDR],
    defaultAddress: ADMIN_ADDR,
  });
  assert.equal(r.source, "purchase");
  assert.equal(r.address.postal_code, "12345");
});

test("chooseLawfulAddress: skips incomplete order addresses, takes the next complete one", () => {
  const { city, ...broken } = CA_ADDR;
  void city;
  const r = chooseLawfulAddress({
    orderShippingAddresses: [broken, ADMIN_ADDR],
    defaultAddress: null,
  });
  assert.equal(r.source, "purchase");
  assert.equal(r.address.postal_code, "54321");
});

test("chooseLawfulAddress: falls back to the profile default (consented_capture)", () => {
  const r = chooseLawfulAddress({ orderShippingAddresses: [], defaultAddress: CA_ADDR });
  assert.equal(r.source, "consented_capture");
  assert.equal(r.address.city, "Musterstadt");
});

test("chooseLawfulAddress: nothing complete → null (eligibility stays disabled)", () => {
  const { zip, ...broken } = CA_ADDR;
  void zip;
  assert.equal(chooseLawfulAddress({ orderShippingAddresses: [broken], defaultAddress: null }), null);
  assert.equal(chooseLawfulAddress({}), null);
});
