import { test } from "node:test";
import assert from "node:assert/strict";
import { SHOP_URL, couponCopy, couponText, discountRedeemUrl } from "./discount-coupon.mjs";

test("discountRedeemUrl is Shopify's /discount/<code> link on the shop", () => {
  assert.equal(discountRedeemUrl("MK-ABC123"), "https://motionsports.de/discount/MK-ABC123");
  assert.equal(discountRedeemUrl(" MK-X "), `${SHOP_URL}/discount/MK-X`);
  assert.equal(discountRedeemUrl("A B/C", "https://shop.example/"), "https://shop.example/discount/A%20B%2FC");
  assert.equal(discountRedeemUrl(""), null);
  assert.equal(discountRedeemUrl(null), null);
});

test("couponCopy states value and terms per language", () => {
  const de = couponCopy("de", { percent: 5, expiresLabel: "21.09.2026" });
  assert.equal(de.kicker, "Dein persönlicher Code");
  assert.equal(de.benefit, "5 % auf deine gesamte Bestellung");
  assert.equal(de.terms, "Einmalig einlösbar · gültig bis 21.09.2026");
  assert.equal(de.cta, "Code einlösen");
  const en = couponCopy("en", { percent: 10, expiresLabel: "21 Sep 2026" });
  assert.equal(en.benefit, "10 % off your entire order");
  assert.equal(en.terms, "Redeemable once · valid until 21 Sep 2026");
  // Without a percentage the benefit stays generic; without expiry no "valid until".
  assert.equal(couponCopy("de").benefit, "Dein Rabatt auf deine gesamte Bestellung");
  assert.equal(couponCopy("de", { percent: 0 }).benefit, "Dein Rabatt auf deine gesamte Bestellung");
  assert.equal(couponCopy("de").terms, "Einmalig einlösbar");
  // The scope steers what the code applies to.
  assert.equal(couponCopy("de", { percent: 5, scope: "recommendations" }).benefit, "5 % auf die empfohlenen Produkte aus dieser E-Mail");
  assert.equal(couponCopy("en", { percent: 5, scope: "set" }).benefit, "5 % off your personal set");
  assert.equal(couponCopy("de", { scope: "set" }).benefit, "Dein Rabatt auf dein persönliches Set");
  assert.equal(couponCopy("de", { percent: 5, scope: "bogus" }).benefit, "5 % auf deine gesamte Bestellung");
});

test("couponText carries code, value, terms and the redeem link", () => {
  const t = couponText("de", { code: "MK-ABC123", percent: 5, expiresLabel: "21.09.2026", scope: "all" });
  assert.equal(
    t,
    "Dein persönlicher Code: MK-ABC123 — 5 % auf deine gesamte Bestellung. Einmalig einlösbar · gültig bis 21.09.2026.\nCode einlösen: https://motionsports.de/discount/MK-ABC123"
  );
});
