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
  REWARD_LIMITS,
  servedSigninExtras,
  parseRewardTermsUrl,
  welcomeRewardForPrompt,
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
      const keys = Object.keys(v).filter((k) => k !== "reward" && k !== "valueMoment");
      assert.deepEqual(keys.sort(), ["benefits", "headline", "id", "lawyerApproved"]);
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

test("v6: b and c share a's framing; b adds the reward, c the reward and the value moment", () => {
  for (const locale of ["de", "en"]) {
    const [a, b, c] = SIGNIN_VARIANTS[locale];
    assert.deepEqual([a.id, b.id, c.id], ["a", "b", "c"]);
    for (const v of [b, c]) {
      assert.equal(v.headline, a.headline);
      assert.deepEqual([...v.benefits], [...a.benefits]);
      assert.ok(v.reward && v.reward.badge && v.reward.terms);
    }
    assert.equal(a.reward, undefined);
    assert.equal(b.valueMoment, undefined);
    assert.ok(c.valueMoment?.lead);
  }
  // Approved by counsel (11.10.2026, German and the English F-12 drafts).
  assert.deepEqual(SIGNIN_VARIANTS.de.map((v) => v.lawyerApproved), [true, true, true]);
  assert.deepEqual(SIGNIN_VARIANTS.en.map((v) => v.lawyerApproved), [true, true, true]);
});

test("v6 reward strings fit the widget's limits and state every condition (O-1…O-8)", () => {
  for (const locale of ["de", "en"]) {
    for (const v of SIGNIN_VARIANTS[locale]) {
      for (const [k, t] of Object.entries(v.reward ?? {})) {
        assert.ok(t.trim() === t && t.length > 0 && t.length <= REWARD_LIMITS[k], `${locale}/${v.id}/${k}: ${t.length}`);
        assert.doesNotMatch(t, /\{|%s|\$\{|nur heute|letzte chance|only today|last chance|hurry/i);
      }
      if (v.valueMoment) assert.ok(v.valueMoment.lead.length <= REWARD_LIMITS.lead);
    }
  }
  const en = SIGNIN_VARIANTS.en[1].reward;
  for (const part of ["€50", "€500", "first newsletter sign-up", "after you confirm by e-mail", "single use", "valid 30 days", "reduced items and Concept2 are excluded and do not count towards the order value", "cannot be combined"]) {
    assert.ok(en.terms.includes(part), part);
  }
  const de = SIGNIN_VARIANTS.de[1].reward;
  // The amount and the minimum, the first sign-up, the DOI, single use, 30 days,
  // the exclusions incl. Concept2, no stacking — at the claim (OLG Hamm 4 U 4/18).
  for (const part of ["50 €", "500 €", "erste Newsletter-Anmeldung", "nach Bestätigung per E-Mail", "einmal einlösbar", "30 Tage gültig", "reduzierte Artikel und Concept2 sind ausgeschlossen und zählen nicht zum Bestellwert", "nicht mit anderen Rabatten kombinierbar"]) {
    assert.ok(de.terms.includes(part), part);
  }
  assert.ok(de.badge.includes("50 €") && de.badge.includes("500 €"));
  // No percentage anywhere (the old 5 % is gone) and no „bis zu“ (F-41 not used).
  // No afterAccept: the widget would show it on a neutral answer without a mail too.
  assert.equal(de.afterAccept, undefined);
  assert.equal(en.afterAccept, undefined);
  for (const t of [de.badge, de.terms, de.teaser]) {
    assert.doesNotMatch(t, /%|bis zu/i);
  }
});

test("servedSigninExtras: nothing while the switch is off, for a or for an unapproved variant", () => {
  const [a, b, c] = SIGNIN_VARIANTS.de;
  assert.deepEqual(servedSigninExtras(b, {}), {});
  assert.deepEqual(servedSigninExtras(c, { rewardEnabled: false, valueMomentEnabled: true }), {});
  assert.deepEqual(servedSigninExtras(a, { rewardEnabled: true, valueMomentEnabled: true }), {});
  assert.deepEqual(servedSigninExtras({ ...b, lawyerApproved: false }, { rewardEnabled: true }), {});
  assert.deepEqual(servedSigninExtras(null, { rewardEnabled: true }), {});
});

test("servedSigninExtras: the reward behind its switch; the lead only with the reward and its own switch", () => {
  const [, b, c] = SIGNIN_VARIANTS.de;
  const url = "https://www.motionsports.de/pages/newsletter-gutschein";
  const rb = servedSigninExtras(b, { rewardEnabled: true, valueMomentEnabled: true, termsUrl: url });
  assert.deepEqual(rb, { reward: { ...b.reward, termsUrl: url } });
  const rc = servedSigninExtras(c, { rewardEnabled: true, valueMomentEnabled: true, termsUrl: url });
  assert.deepEqual(rc.valueMoment, { lead: c.valueMoment.lead });
  assert.equal(servedSigninExtras(c, { rewardEnabled: true }).valueMoment, undefined);
  // No or a bad URL → no link, the reward stays.
  assert.equal(servedSigninExtras(b, { rewardEnabled: true, termsUrl: "javascript:alert(1)" }).reward.termsUrl, undefined);
  assert.equal(servedSigninExtras(b, { rewardEnabled: true }).reward.termsUrl, undefined);
});

test("servedSigninExtras applies the widget's rules: badge and terms required, optional parts dropped one by one", () => {
  const base = { id: "x", lawyerApproved: true };
  const long = "x".repeat(61);
  assert.deepEqual(servedSigninExtras({ ...base, reward: { badge: long, terms: "T" } }, { rewardEnabled: true }), {});
  assert.deepEqual(servedSigninExtras({ ...base, reward: { badge: "B", terms: "  " } }, { rewardEnabled: true }), {});
  assert.deepEqual(
    servedSigninExtras(
      { ...base, reward: { badge: " B ", terms: "T", teaser: "y".repeat(161), afterAccept: 7 }, valueMoment: { lead: "" } },
      { rewardEnabled: true, valueMomentEnabled: true }
    ),
    { reward: { badge: "B", terms: "T" } }
  );
  assert.deepEqual(servedSigninExtras({ ...base, lawyerApproved: false, reward: { badge: "B", terms: "T" } }, { rewardEnabled: true }), {});
});

test("parseRewardTermsUrl: https only, no credentials", () => {
  assert.equal(parseRewardTermsUrl("https://www.motionsports.de/pages/newsletter-gutschein"), "https://www.motionsports.de/pages/newsletter-gutschein");
  assert.equal(parseRewardTermsUrl(" https://x.de/a "), "https://x.de/a");
  for (const bad of [undefined, "", "http://x.de", "javascript:alert(1)", "https://u:p@x.de", "/pages/x", "mailto:a@b.de"]) {
    assert.equal(parseRewardTermsUrl(bad), null, String(bad));
  }
});

test("welcomeRewardForPrompt: the approved badge and terms of the locale while the switch is on, else null", () => {
  assert.equal(welcomeRewardForPrompt("de", {}), null);
  assert.equal(welcomeRewardForPrompt("en", {}), null);
  assert.equal(welcomeRewardForPrompt("en", { rewardEnabled: true })?.badge, SIGNIN_VARIANTS.en[1].reward.badge);
  const r = welcomeRewardForPrompt("de", { rewardEnabled: true, termsUrl: "https://x.de/t" });
  const de = SIGNIN_VARIANTS.de[1].reward;
  const en = SIGNIN_VARIANTS.en[1].reward;
  // The other language's approved wording rides along, so Mo never translates the terms.
  assert.deepEqual(r, { badge: de.badge, terms: de.terms, termsUrl: "https://x.de/t", alt: { badge: en.badge, terms: en.terms } });
  assert.deepEqual(welcomeRewardForPrompt("en", { rewardEnabled: true }).alt, { badge: de.badge, terms: de.terms });
  assert.equal(welcomeRewardForPrompt("xx", { rewardEnabled: true })?.badge, SIGNIN_VARIANTS.de[1].reward.badge);
});

test("assignment with a,b,c: sessions spread over the three, the same id in both locales", () => {
  for (const locale of ["de", "en"]) {
    const seen = new Set();
    for (let i = 0; i < 300; i++) seen.add(pickSigninVariant(`sid-${i}`, locale, "a,b,c").id);
    assert.deepEqual([...seen].sort(), ["a", "b", "c"]);
  }
  for (let i = 0; i < 50; i++) {
    assert.equal(pickSigninVariant(`sid-${i}`, "en", "a,b,c").id, pickSigninVariant(`sid-${i}`, "de", "a,b,c").id);
  }
  assert.deepEqual(activeSigninVariants("en", "b,c").map((v) => v.id), ["b", "c"]);
});
