import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isCompletedPurchaseStatus,
  isBestandskundeEligible,
  isBestandskundenSendsApproved,
  BESTANDSKUNDE_COMPLETED_STATUSES,
} from "./bestandskunden.mjs";

// ⚠️ This is the SEPARATE §7 Abs. 3 UWG lawful basis — never the DOI-consent
// path. These tests pin the "completed purchase" boundary and the fail-closed
// send gate; the consent/DOI logic is tested elsewhere.

test("PAID and PARTIALLY_REFUNDED are the only completed-purchase statuses", () => {
  assert.equal(isCompletedPurchaseStatus("PAID"), true);
  assert.equal(isCompletedPurchaseStatus("PARTIALLY_REFUNDED"), true);
  // Case/space-insensitive.
  assert.equal(isCompletedPurchaseStatus("  paid "), true);
  // Not completed: no captured payment, or the sale was reversed/cancelled.
  for (const s of ["PENDING", "AUTHORIZED", "EXPIRED", "VOIDED", "REFUNDED"]) {
    assert.equal(isCompletedPurchaseStatus(s), false, s);
  }
  // Unknown / missing → fail-closed.
  assert.equal(isCompletedPurchaseStatus(null), false);
  assert.equal(isCompletedPurchaseStatus(undefined), false);
  assert.equal(isCompletedPurchaseStatus(""), false);
  assert.equal(isCompletedPurchaseStatus(42), false);
  assert.deepEqual(
    [...BESTANDSKUNDE_COMPLETED_STATUSES].sort(),
    ["PAID", "PARTIALLY_REFUNDED"]
  );
});

test("a customer with at least one completed order is §7(3)-eligible", () => {
  assert.equal(
    isBestandskundeEligible({
      orders: [
        { financialStatus: "PENDING" },
        { financialStatus: "PAID" },
      ],
    }),
    true
  );
});

test("an account with only non-completed orders is NOT eligible", () => {
  assert.equal(
    isBestandskundeEligible({
      orders: [{ financialStatus: "VOIDED" }, { financialStatus: "REFUNDED" }],
    }),
    false
  );
});

test("no purchase history at all → NOT eligible (account alone never qualifies)", () => {
  // Empty order list = the query succeeded and found nothing.
  assert.equal(isBestandskundeEligible({ orders: [] }), false);
  // Null = "we don't know" — fail-closed, never flag.
  assert.equal(isBestandskundeEligible(null), false);
  assert.equal(isBestandskundeEligible(undefined), false);
  // Malformed blob.
  assert.equal(isBestandskundeEligible({}), false);
  assert.equal(isBestandskundeEligible({ orders: "nope" }), false);
});

test("§7(3) real sends are gated OFF unless explicitly approved", () => {
  // Default-closed: absent / empty / unrecognised → false.
  assert.equal(isBestandskundenSendsApproved({}), false);
  assert.equal(isBestandskundenSendsApproved({ BESTANDSKUNDE_SENDS_APPROVED: "" }), false);
  assert.equal(isBestandskundenSendsApproved({ BESTANDSKUNDE_SENDS_APPROVED: "maybe" }), false);
  assert.equal(isBestandskundenSendsApproved({ BESTANDSKUNDE_SENDS_APPROVED: "0" }), false);
  // Only an explicit truthy opt-in flips it on.
  for (const v of ["1", "true", "TRUE", "yes", "on", "  On "]) {
    assert.equal(isBestandskundenSendsApproved({ BESTANDSKUNDE_SENDS_APPROVED: v }), true, v);
  }
});
