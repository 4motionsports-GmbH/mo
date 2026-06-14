import { test } from "node:test";
import assert from "node:assert/strict";
import { decideMerge, numericFromCustomerGid } from "./customer-merge.mjs";

const EMAIL = "max@example.de";

test("(a) already linked to this Shopify customer → use it, no conflict", () => {
  const res = decideMerge({
    rowByShopifyId: { id: 7, email: EMAIL },
    rowByEmail: { id: 7, email: EMAIL },
    shopifyEmail: EMAIL,
  });
  assert.deepEqual(res, { action: "use", customerId: 7, conflict: null });
});

test("(b) existing tier-2 row by email → stamp it (the tier-2→3 merge)", () => {
  const res = decideMerge({
    rowByShopifyId: null,
    rowByEmail: { id: 42, email: EMAIL },
    shopifyEmail: EMAIL,
  });
  assert.equal(res.action, "stamp");
  assert.equal(res.customerId, 42);
  assert.equal(res.conflict, null);
});

test("MATCH-UP email-only → signed-in: stamp targets the existing email row (its prior DOI consent carries; nothing fused/invented)", () => {
  // A tier-2 customer who already double-opted-in under this email then signs
  // in. The merge must STAMP that exact row (id 42) and NEVER create/collide,
  // so the bind only adds identity columns and the row's existing marketing
  // consent stays put. (The DB UPDATE never touches consent — asserted by code
  // review; here we pin the decision that selects the consent-bearing row.)
  const res = decideMerge({
    rowByShopifyId: null,
    rowByEmail: { id: 42, email: EMAIL },
    shopifyEmail: EMAIL,
  });
  assert.equal(res.action, "stamp");
  assert.equal(res.customerId, 42); // the consent-anchored row, carried forward
  assert.equal(res.conflict, null); // a clean merge — no review, no fusing
});

test("(c) nothing matches → create a fresh tier-3 row", () => {
  const res = decideMerge({
    rowByShopifyId: null,
    rowByEmail: null,
    shopifyEmail: EMAIL,
  });
  assert.deepEqual(res, { action: "create", customerId: null, conflict: null });
});

test("(d) row collision: shopify-id row AND a different email row → use shopify row, log conflict, do NOT fuse", () => {
  const res = decideMerge({
    rowByShopifyId: { id: 1, email: "old@example.de" },
    rowByEmail: { id: 2, email: EMAIL },
    shopifyEmail: EMAIL,
  });
  assert.equal(res.action, "use");
  assert.equal(res.customerId, 1); // Shopify-linked identity wins
  assert.equal(res.conflict.kind, "row_collision");
  assert.equal(res.conflict.emailRowCustomerId, 2);
  assert.equal(res.conflict.shopifyRowCustomerId, 1);
});

test("(d) email mismatch: linked row's email differs from Shopify's verified email → use linked, log conflict", () => {
  const res = decideMerge({
    rowByShopifyId: { id: 5, email: "old@example.de" },
    rowByEmail: null,
    shopifyEmail: "new@example.de",
  });
  assert.equal(res.action, "use");
  assert.equal(res.customerId, 5);
  assert.equal(res.conflict.kind, "email_mismatch");
  assert.equal(res.conflict.emailRowEmail, "old@example.de");
});

test("email comparison is case/space-insensitive (no false mismatch)", () => {
  const res = decideMerge({
    rowByShopifyId: { id: 9, email: "Max@Example.DE " },
    rowByEmail: null,
    shopifyEmail: "max@example.de",
  });
  assert.equal(res.conflict, null);
  assert.equal(res.action, "use");
});

test("numericFromCustomerGid extracts the numeric id", () => {
  assert.equal(
    numericFromCustomerGid("gid://shopify/Customer/1234567890"),
    "1234567890"
  );
  assert.equal(numericFromCustomerGid("not-a-gid"), null);
  assert.equal(numericFromCustomerGid(null), null);
  assert.equal(numericFromCustomerGid(12345), null);
});
