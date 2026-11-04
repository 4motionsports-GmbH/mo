import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DISCOUNT_SCOPE,
  DISCOUNT_SCOPES,
  EDITABLE_DISCOUNT_SCOPES,
  NEW_DISCOUNT_SCOPE,
  NON_COMBINABLE_DISCOUNT,
  discountItemsInput,
  discountScopeLabel,
  discountScopePhrase,
  discountSelectionTargets,
  parseDiscountScope,
  parseEditableDiscountScope,
  productVariantGid,
  retiredDiscountScopeMessage,
} from "./discount-scope.mjs";

test("parseDiscountScope accepts the three scopes (history included) and reads a missing value as all", () => {
  for (const s of DISCOUNT_SCOPES) assert.equal(parseDiscountScope(s), s);
  assert.equal(parseDiscountScope("set"), "set");
  assert.equal(parseDiscountScope("everything"), "all");
  assert.equal(parseDiscountScope(null), "all");
  assert.equal(parseDiscountScope(undefined), DEFAULT_DISCOUNT_SCOPE);
});

test("new drafts and campaigns only scope a code to the individual selection", () => {
  assert.equal(NEW_DISCOUNT_SCOPE, "recommendations");
  assert.deepEqual([...EDITABLE_DISCOUNT_SCOPES], ["recommendations"]);
  assert.equal(parseEditableDiscountScope("recommendations"), "recommendations");
  // The whole order and the set are history.
  assert.equal(parseEditableDiscountScope("all"), null);
  assert.equal(parseEditableDiscountScope("set"), null);
  assert.equal(parseEditableDiscountScope("everything"), null);
  assert.equal(parseEditableDiscountScope(undefined), null);
});

test("the phrase after the percentage names the scope, per language", () => {
  assert.equal(discountScopePhrase("recommendations"), "auf deine individuelle Auswahl");
  assert.equal(discountScopePhrase("recommendations", "en"), "off your personal selection");
  // History still reads as it was sent.
  assert.equal(discountScopePhrase("all"), "auf deine gesamte Bestellung");
  assert.equal(discountScopePhrase("set"), "auf dein persönliches Set");
  assert.equal(discountScopePhrase("all", "en"), "off your entire order");
  assert.equal(discountScopePhrase("set", "en"), "off your personal set");
  assert.equal(discountScopePhrase(undefined), "auf deine gesamte Bestellung");
});

test("desk labels (history still reads)", () => {
  assert.equal(discountScopeLabel("recommendations"), "Individuelle Auswahl");
  assert.equal(discountScopeLabel("set"), "Nur das Set-Angebot");
  assert.equal(discountScopeLabel("nope"), "Gesamte Bestellung");
});

test("a stored whole-order or set scope with a code can no longer be sent", () => {
  assert.equal(retiredDiscountScopeMessage("recommendations", 10), null);
  assert.match(retiredDiscountScopeMessage("all", 10), /individuelle Auswahl/);
  assert.match(retiredDiscountScopeMessage("set", 10), /Set/);
  // Without a code the scope means nothing.
  assert.equal(retiredDiscountScopeMessage("all", 0), null);
  assert.equal(retiredDiscountScopeMessage("set", null), null);
});

test("discountSelectionTargets: all variants → the product, pinned → that variant", () => {
  assert.deepEqual(
    discountSelectionTargets([
      { handle: "kettlebell" },
      { handle: "band", variantId: "42" },
      { handle: "band", variantId: "43" },
      { handle: "kettlebell", variantId: "7" }, // covered by the whole product
      { handle: "kettlebell" },
      { handle: "" },
      { handle: "shaker", variantId: "abc" }, // malformed → the product
    ]),
    { handles: ["kettlebell", "shaker"], variantIds: ["42", "43"] }
  );
  assert.deepEqual(discountSelectionTargets(null), { handles: [], variantIds: [] });
});

test("productVariantGid", () => {
  assert.equal(productVariantGid("123"), "gid://shopify/ProductVariant/123");
  assert.equal(productVariantGid("gid://shopify/ProductVariant/9"), "gid://shopify/ProductVariant/9");
  assert.equal(productVariantGid("16kg"), null);
  assert.equal(productVariantGid(null), null);
});

test("discountItemsInput: products and variants, else the whole order", () => {
  assert.deepEqual(discountItemsInput({}), { all: true });
  assert.deepEqual(discountItemsInput({ productIds: ["nope"] }), { all: true });
  assert.deepEqual(
    discountItemsInput({
      productIds: ["gid://shopify/Product/1", "gid://shopify/Product/1"],
      productVariantIds: ["gid://shopify/ProductVariant/5", "gid://shopify/Product/2"],
    }),
    {
      products: {
        productsToAdd: ["gid://shopify/Product/1"],
        productVariantsToAdd: ["gid://shopify/ProductVariant/5"],
      },
    }
  );
  assert.deepEqual(discountItemsInput({ productVariantIds: ["gid://shopify/ProductVariant/5"] }), {
    products: { productVariantsToAdd: ["gid://shopify/ProductVariant/5"] },
  });
});

test("the code combines with nothing", () => {
  assert.deepEqual({ ...NON_COMBINABLE_DISCOUNT }, {
    orderDiscounts: false,
    productDiscounts: false,
    shippingDiscounts: false,
  });
});
