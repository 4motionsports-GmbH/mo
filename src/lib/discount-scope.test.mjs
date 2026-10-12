import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DISCOUNT_SCOPE,
  DISCOUNT_SCOPES,
  DISCOUNT_SCOPE_OPTIONS,
  EDITABLE_DISCOUNT_SCOPES,
  discountScopeLabel,
  discountScopePhrase,
  parseDiscountScope,
  parseEditableDiscountScope,
} from "./discount-scope.mjs";

test("parseDiscountScope accepts the three scopes (history included) and falls back to all", () => {
  for (const s of DISCOUNT_SCOPES) assert.equal(parseDiscountScope(s), s);
  assert.equal(parseDiscountScope("set"), "set");
  assert.equal(parseDiscountScope("everything"), "all");
  assert.equal(parseDiscountScope(null), "all");
  assert.equal(parseDiscountScope(undefined), DEFAULT_DISCOUNT_SCOPE);
});

test("new drafts may only scope a code to everything or the recommendations", () => {
  assert.deepEqual([...EDITABLE_DISCOUNT_SCOPES], ["all", "recommendations"]);
  assert.deepEqual(DISCOUNT_SCOPE_OPTIONS.map((o) => o.value), [...EDITABLE_DISCOUNT_SCOPES]);
  assert.equal(parseEditableDiscountScope("all"), "all");
  assert.equal(parseEditableDiscountScope("recommendations"), "recommendations");
  // A set mail carries no code (offer-mode.mjs) — "set" is history only.
  assert.equal(parseEditableDiscountScope("set"), null);
  assert.equal(parseEditableDiscountScope("everything"), null);
  assert.equal(parseEditableDiscountScope(undefined), null);
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

test("desk labels (history still reads)", () => {
  assert.equal(discountScopeLabel("recommendations"), "Nur die empfohlenen Produkte");
  assert.equal(discountScopeLabel("set"), "Nur das Set-Angebot");
  assert.equal(discountScopeLabel("nope"), "Gesamte Bestellung");
});
