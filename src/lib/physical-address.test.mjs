import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateFullAddress,
  decidePhysicalEligibility,
  REQUIRED_ADDRESS_FIELDS,
} from "./physical-address.mjs";

const FULL = {
  name: "Erika Mustermann",
  address_line_1: "Musterstraße 1",
  postal_code: "12345",
  city: "Musterstadt",
  country: "DE",
};

test("validateFullAddress: a complete address normalises", () => {
  const r = validateFullAddress({ ...FULL, company: "ACME", address_line_2: "c/o Foo" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.address, {
    name: "Erika Mustermann",
    company: "ACME",
    addressLine1: "Musterstraße 1",
    addressLine2: "c/o Foo",
    postalCode: "12345",
    city: "Musterstadt",
    country: "DE",
  });
});

test("validateFullAddress: null/empty reports ALL required fields missing", () => {
  const r = validateFullAddress(null);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing.sort(), [...REQUIRED_ADDRESS_FIELDS].sort());
});

test("validateFullAddress: a missing field is reported, never part-filled", () => {
  const { postal_code, ...noZip } = FULL;
  void postal_code;
  const r = validateFullAddress(noZip);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ["postal_code"]);
});

test("validateFullAddress: a malformed country is unusable", () => {
  const r = validateFullAddress({ ...FULL, country: "Germany" });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ["country"]);
});

test("validateFullAddress: optional company/line2 are not required", () => {
  const r = validateFullAddress(FULL);
  assert.equal(r.ok, true);
  assert.equal(r.address.company, null);
  assert.equal(r.address.addressLine2, null);
});

test("decide: no address held → disabled with the product-blocker reason", () => {
  const d = decidePhysicalEligibility({ flagApproved: true, pingenConfigured: true, address: null });
  assert.equal(d.eligible, false);
  assert.equal(d.reasonCode, "no_address");
  assert.equal(d.address, null);
});

test("decide: incomplete address → incomplete_address, never part-filled", () => {
  const { city, ...noCity } = FULL;
  void city;
  const d = decidePhysicalEligibility({
    flagApproved: true,
    pingenConfigured: true,
    address: noCity,
  });
  assert.equal(d.eligible, false);
  assert.equal(d.reasonCode, "incomplete_address");
  assert.equal(d.address, null);
});

test("decide: address present but Pingen unconfigured → pingen_not_configured", () => {
  const d = decidePhysicalEligibility({
    flagApproved: true,
    pingenConfigured: false,
    address: FULL,
  });
  assert.equal(d.eligible, false);
  assert.equal(d.reasonCode, "pingen_not_configured");
});

test("decide: address + config present but flag off → flag_off (fail-closed)", () => {
  const d = decidePhysicalEligibility({
    flagApproved: false,
    pingenConfigured: true,
    address: FULL,
  });
  assert.equal(d.eligible, false);
  assert.equal(d.reasonCode, "flag_off");
});

test("decide: everything present → eligible with the normalised recipient", () => {
  const d = decidePhysicalEligibility({
    flagApproved: true,
    pingenConfigured: true,
    address: FULL,
  });
  assert.equal(d.eligible, true);
  assert.equal(d.reasonCode, null);
  assert.equal(d.address.city, "Musterstadt");
});
