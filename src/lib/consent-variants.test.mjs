import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SIGNIN_VARIANTS,
  SHIPPED_SIGNIN_VARIANT_IDS,
  activeSigninVariants,
  pickSigninVariant,
  parseActiveVariantIds,
  isKnownSigninVariant,
  normalizePlacement,
  fnv1a32,
} from "./consent-variants.mjs";
import { consentStrings } from "./consent-copy-core.mjs";

test("the default serves only the control; unknown ids are never served", () => {
  for (const locale of ["de", "en"]) {
    assert.deepEqual(activeSigninVariants(locale, undefined).map((v) => v.id), ["a"]);
    assert.deepEqual(activeSigninVariants(locale, "zz,qq").map((v) => v.id), ["a"]);
  }
  assert.deepEqual(parseActiveVariantIds(" a , a ,<x>,b "), ["a", "b"]);
  assert.deepEqual(parseActiveVariantIds(""), ["a"]);
});

test("the headline is the approved one; the bullets are pinned (a change is a new decision)", () => {
  assert.equal(SIGNIN_VARIANTS.de[0].headline, consentStrings("de").signinHeadline);
  assert.equal(SIGNIN_VARIANTS.en[0].headline, consentStrings("en").signinHeadline);
  assert.deepEqual([...SIGNIN_VARIANTS.de[0].benefits], [
    "Angebote, die zu deiner Beratung passen",
    "Exklusive Rabatt-Aktionen nur für Abonnenten",
    "Jederzeit mit einem Klick abbestellbar",
  ]);
  assert.deepEqual([...SIGNIN_VARIANTS.en[0].benefits], [
    "Offers that match your consultation",
    "Exclusive discount promotions for subscribers only",
    "Unsubscribe any time with one click",
  ]);
});

test("tone rules: short, at most 4, no placeholders, no urgency, no amounts; only framing keys", () => {
  for (const locale of ["de", "en"]) {
    for (const v of SIGNIN_VARIANTS[locale]) {
      assert.deepEqual(Object.keys(v).sort(), ["benefits", "headline", "id", "lawyerApproved"]);
      assert.ok(v.benefits.length <= 4);
      for (const t of [v.headline, ...v.benefits]) {
        assert.ok(t.trim().length > 0 && t.length <= 200, t);
        assert.doesNotMatch(t, /\{|%s|\$\{/);
        assert.doesNotMatch(t, /\d+\s*(%|€|EUR)/, `no discount amounts: ${t}`);
        assert.doesNotMatch(t, /nur heute|jetzt sofort|letzte chance|only today|last chance|hurry/i);
      }
    }
  }
});

test("every shipped id stays defined", () => {
  for (const id of SHIPPED_SIGNIN_VARIANT_IDS) {
    assert.ok(isKnownSigninVariant(id, "de") && isKnownSigninVariant(id, "en"), id);
  }
  assert.equal(isKnownSigninVariant("<script>"), false);
  assert.equal(isKnownSigninVariant("zz"), false);
});

test("assignment is stable per session; no session gets the control", () => {
  assert.equal(pickSigninVariant("s1", "de", "a").id, "a");
  assert.equal(pickSigninVariant(null, "de", "a").id, "a");
  assert.equal(pickSigninVariant("s1", "de", "a"), pickSigninVariant("s1", "de", "a"));
  assert.equal(typeof fnv1a32("x"), "number");
});

test("normalizePlacement", () => {
  assert.equal(normalizePlacement("popup"), "popup");
  assert.equal(normalizePlacement("signin_return"), "signin_return");
  assert.equal(normalizePlacement("value_moment"), "value_moment");
  assert.equal(normalizePlacement("x"), null);
  assert.equal(normalizePlacement(7), null);
});
