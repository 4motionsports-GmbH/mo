import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DISCOUNT_SCOPE,
  DISCOUNT_SCOPES,
  DISCOUNT_SCOPE_OPTIONS,
  discountScopeLabel,
  discountScopePhrase,
  parseDiscountScope,
} from "./discount-scope.mjs";

test("parseDiscountScope accepts the three scopes and falls back to all", () => {
  for (const s of DISCOUNT_SCOPES) assert.equal(parseDiscountScope(s), s);
  assert.equal(parseDiscountScope("everything"), "all");
  assert.equal(parseDiscountScope(null), "all");
  assert.equal(parseDiscountScope(undefined), DEFAULT_DISCOUNT_SCOPE);
  assert.deepEqual(DISCOUNT_SCOPE_OPTIONS.map((o) => o.value), [...DISCOUNT_SCOPES]);
});

test("the phrase after the percentage names the scope, per language", () => {
  assert.equal(discountScopePhrase("all"), "auf deine gesamte Bestellung");
  assert.equal(discountScopePhrase("recommendations"), "auf die empfohlenen Produkte aus dieser E-Mail");
  assert.equal(discountScopePhrase("set"), "auf dein persönliches Set");
  assert.equal(discountScopePhrase("all", "en"), "off your entire order");
  assert.equal(discountScopePhrase("recommendations", "en"), "off the products recommended in this email");
  assert.equal(discountScopePhrase("set", "en"), "off your personal set");
  assert.equal(discountScopePhrase(undefined), "auf deine gesamte Bestellung");
});

test("desk labels", () => {
  assert.equal(discountScopeLabel("set"), "Nur das Set-Angebot");
  assert.equal(discountScopeLabel("nope"), "Gesamte Bestellung");
});
