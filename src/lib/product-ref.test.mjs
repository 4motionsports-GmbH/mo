import test from "node:test";
import assert from "node:assert/strict";

import {
  formatProductRef,
  parseProductRef,
  isVariantRef,
  effectiveVariantPrice,
  productVariants,
  defaultVariant,
  resolveProductRef,
  isVariantAvailable,
  variantDisplayName,
  variantPdpUrl,
  productPriceRange,
} from "./product-ref.mjs";

const kettlebell = {
  id: "atx-kettlebell",
  name: "ATX Kettlebell",
  price: 24.9,
  inStock: true,
  shopifyUrl: "https://motionsports.de/products/atx-kettlebell",
  shopifyVariantId: "111",
  shopifyCartUrl: "https://motionsports.de/cart/111:1",
  sku: "KB-08",
  variants: [
    { id: "111", title: "8 kg", options: [{ name: "Gewicht", value: "8" }], price: 24.9, available: true, isDefault: true, sku: "KB-08" },
    { id: "222", title: "16 kg", options: [{ name: "Gewicht", value: "16" }], price: 46.9, salePrice: 39.9, available: true, isDefault: false, sku: "KB-16" },
    { id: "333", title: "24 kg", options: [{ name: "Gewicht", value: "24" }], price: 69.9, available: false, isDefault: false, sku: "KB-24" },
  ],
};

// Pre-variant catalog shape (old blob / CSV fallback): flat fields only.
const legacyProduct = {
  id: "old-bench",
  name: "Alte Bank",
  price: 99,
  salePrice: 89,
  inStock: true,
  shopifyVariantId: "999",
  shopifyCartUrl: "https://motionsports.de/cart/999:1",
  shopifyUrl: "https://motionsports.de/products/old-bench",
};

const catalog = new Map([
  [kettlebell.id, kettlebell],
  [legacyProduct.id, legacyProduct],
]);

test("formatProductRef with and without variant", () => {
  assert.equal(formatProductRef("atx-kettlebell"), "atx-kettlebell");
  assert.equal(formatProductRef("atx-kettlebell", null), "atx-kettlebell");
  assert.equal(formatProductRef("atx-kettlebell", "222"), "atx-kettlebell~222");
  assert.equal(formatProductRef("atx-kettlebell", 222), "atx-kettlebell~222");
  assert.equal(formatProductRef(""), "");
});

test("parseProductRef splits only on a numeric suffix", () => {
  assert.deepEqual(parseProductRef("atx-kettlebell~222"), {
    productId: "atx-kettlebell",
    variantId: "222",
  });
  assert.deepEqual(parseProductRef("atx-kettlebell"), {
    productId: "atx-kettlebell",
    variantId: null,
  });
  // Malformed suffix stays part of the product id → lookup fails visibly.
  assert.deepEqual(parseProductRef("atx-kettlebell~16kg"), {
    productId: "atx-kettlebell~16kg",
    variantId: null,
  });
  // Handles with unicode (real catalog has "®") pass through untouched.
  assert.deepEqual(parseProductRef("widerstandsband-set-atx®-6-level~42"), {
    productId: "widerstandsband-set-atx®-6-level",
    variantId: "42",
  });
  assert.deepEqual(parseProductRef(null), { productId: "", variantId: null });
});

test("format/parse round-trip", () => {
  const ref = formatProductRef("a-handle", "12345");
  assert.deepEqual(parseProductRef(ref), { productId: "a-handle", variantId: "12345" });
});

test("isVariantRef", () => {
  assert.equal(isVariantRef("a~1"), true);
  assert.equal(isVariantRef("a"), false);
  assert.equal(isVariantRef("a~b"), false);
});

test("effectiveVariantPrice prefers a genuine sale price", () => {
  assert.equal(effectiveVariantPrice({ price: 46.9, salePrice: 39.9 }), 39.9);
  assert.equal(effectiveVariantPrice({ price: 46.9 }), 46.9);
  assert.equal(effectiveVariantPrice({ price: 46.9, salePrice: 0 }), 46.9);
  assert.equal(effectiveVariantPrice(null), null);
});

test("productVariants returns the real array when present", () => {
  assert.equal(productVariants(kettlebell).length, 3);
});

test("productVariants synthesizes a default variant for legacy products", () => {
  const variants = productVariants(legacyProduct);
  assert.equal(variants.length, 1);
  const v = variants[0];
  assert.equal(v.id, "999");
  assert.equal(v.price, 99);
  assert.equal(v.salePrice, 89);
  assert.equal(v.available, true);
  assert.equal(v.isDefault, true);
  assert.equal(v.cartUrl, "https://motionsports.de/cart/999:1");
});

test("defaultVariant picks the isDefault entry", () => {
  assert.equal(defaultVariant(kettlebell).id, "111");
  assert.equal(defaultVariant(legacyProduct).id, "999");
});

test("resolveProductRef: bare id → default variant", () => {
  const res = resolveProductRef(catalog, "atx-kettlebell");
  assert.equal(res.product.id, "atx-kettlebell");
  assert.equal(res.variant.id, "111");
  assert.equal(res.missingVariant, false);
  assert.equal(res.variantId, null);
});

test("resolveProductRef: pinned variant", () => {
  const res = resolveProductRef(catalog, "atx-kettlebell~222");
  assert.equal(res.variant.id, "222");
  assert.equal(res.variant.title, "16 kg");
  assert.equal(res.missingVariant, false);
});

test("resolveProductRef: unknown product → null", () => {
  assert.equal(resolveProductRef(catalog, "nope"), null);
  assert.equal(resolveProductRef(catalog, "nope~123"), null);
  assert.equal(resolveProductRef(catalog, ""), null);
});

test("resolveProductRef: gone variant → missingVariant, NOT default fallback", () => {
  const res = resolveProductRef(catalog, "atx-kettlebell~77777");
  assert.equal(res.product.id, "atx-kettlebell");
  assert.equal(res.variant, null);
  assert.equal(res.missingVariant, true);
  assert.equal(res.variantId, "77777");
});

test("resolveProductRef: variant ref against a legacy product resolves its default id", () => {
  const res = resolveProductRef(catalog, "old-bench~999");
  assert.equal(res.variant.id, "999");
  assert.equal(res.missingVariant, false);
});

test("isVariantAvailable combines variant and product stock", () => {
  const [v8, , v24] = kettlebell.variants;
  assert.equal(isVariantAvailable(kettlebell, v8), true);
  assert.equal(isVariantAvailable(kettlebell, v24), false);
  assert.equal(isVariantAvailable({ ...kettlebell, inStock: false }, v8), false);
});

test("variantDisplayName appends a meaningful title", () => {
  const res = resolveProductRef(catalog, "atx-kettlebell~222");
  assert.equal(variantDisplayName(res.product, res.variant), "ATX Kettlebell – 16 kg");
  assert.equal(variantDisplayName(legacyProduct, defaultVariant(legacyProduct)), "Alte Bank");
});

test("variantPdpUrl deep-links the variant", () => {
  const res = resolveProductRef(catalog, "atx-kettlebell~222");
  assert.equal(
    variantPdpUrl(res.product, res.variant),
    "https://motionsports.de/products/atx-kettlebell?variant=222"
  );
  // No numeric variant id → plain PDP url.
  assert.equal(
    variantPdpUrl(kettlebell, { id: null, title: "x" }),
    "https://motionsports.de/products/atx-kettlebell"
  );
});

test("productPriceRange spans effective prices", () => {
  assert.deepEqual(productPriceRange(kettlebell), { min: 24.9, max: 69.9 });
  assert.deepEqual(productPriceRange(legacyProduct), { min: 89, max: 89 });
  assert.equal(productPriceRange({ variants: [] , price: 0 }), null);
});
