// The served framing of the consent popup after a sign-in (OI3, surface=signin).
// Pure, tested.
//
// What the popup shows above the consent text: a `headline` and up to four
// short `benefits` bullets. Both are FRAMING, not consent text — the consent
// text stays `marketingLabel` + `consentFooter` (consentTextShown), served by
// consent-copy.ts. The widget renders `benefits` verbatim (textContent) and
// no longer carries bullets of its own (frontend task 1, 2026-10-05).
//
// Variants exist for a later A/B test (CONSENT_SIGNIN_VARIANTS, default "a").
// Rules: static text per locale, no placeholders, honest (no urgency, no
// discount amounts, nothing the newsletter does not deliver). A variant is
// never removed once shipped — only deactivated — so ids echoed by older
// copies stay known.

import { consentStrings } from "./consent-copy-core.mjs";

export const SIGNIN_PLACEMENTS = Object.freeze(["popup", "signin_return", "value_moment"]);
export const SIGNIN_VARIANT_ID_RE = /^[a-z0-9_-]{1,32}$/;

/** @param {unknown} v */
export function normalizePlacement(v) {
  return typeof v === "string" && SIGNIN_PLACEMENTS.includes(v) ? v : null;
}

/**
 * Bullet wording chosen 05.10.2026 (owner decision D-AP4: attractive, honest,
 * within the served-copy rules). EN is the translation (D-AP3).
 */
const BENEFITS_A = Object.freeze({
  de: Object.freeze([
    "Angebote, die zu deiner Beratung passen",
    "Exklusive Rabatt-Aktionen nur für Abonnenten",
    "Jederzeit mit einem Klick abbestellbar",
  ]),
  en: Object.freeze([
    "Offers that match your consultation",
    "Exclusive discount promotions for subscribers only",
    "Unsubscribe any time with one click",
  ]),
});

/** @param {"de" | "en"} locale */
function variantsFor(locale) {
  const s = consentStrings(locale);
  return Object.freeze([
    Object.freeze({ id: "a", headline: s.signinHeadline, benefits: BENEFITS_A[locale], lawyerApproved: true }),
  ]);
}

export const SIGNIN_VARIANTS = Object.freeze({ de: variantsFor("de"), en: variantsFor("en") });

/** Every id ever shipped — never removed (tested). */
export const SHIPPED_SIGNIN_VARIANT_IDS = Object.freeze(["a"]);

/** @param {unknown} raw CONSENT_SIGNIN_VARIANTS */
export function parseActiveVariantIds(raw) {
  const ids = (typeof raw === "string" && raw.trim() ? raw : "a")
    .split(",")
    .map((x) => x.trim())
    .filter((x) => SIGNIN_VARIANT_ID_RE.test(x));
  return [...new Set(ids.length ? ids : ["a"])];
}

/** @param {unknown} locale */
function loc(locale) {
  return locale === "en" ? "en" : "de";
}

/**
 * The variants served for a locale: active AND approved; never empty (the
 * control "a").
 * @param {unknown} locale @param {unknown} raw
 */
export function activeSigninVariants(locale, raw) {
  const all = SIGNIN_VARIANTS[loc(locale)];
  const active = parseActiveVariantIds(raw);
  const out = all.filter((v) => active.includes(v.id) && v.lawyerApproved === true);
  return out.length ? out : [all[0]];
}

/** FNV-1a 32-bit. @param {string} str */
export function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The variant for a session: stable per session and variant set; no session →
 * the control.
 * @param {unknown} sid @param {unknown} locale @param {unknown} raw
 */
export function pickSigninVariant(sid, locale, raw) {
  const vs = activeSigninVariants(locale, raw);
  if (vs.length === 1 || typeof sid !== "string" || !sid.trim()) return vs[0];
  const key = `${parseActiveVariantIds(raw).join(",")}|${sid.trim()}`;
  return vs[fnv1a32(key) % vs.length];
}

/**
 * A defined variant id (active or not) — for the opt-in echo and the dashboard.
 * @param {unknown} id @param {unknown} [locale]
 */
export function isKnownSigninVariant(id, locale) {
  if (typeof id !== "string" || !SIGNIN_VARIANT_ID_RE.test(id)) return false;
  const pools = locale === undefined ? [SIGNIN_VARIANTS.de, SIGNIN_VARIANTS.en] : [SIGNIN_VARIANTS[loc(locale)]];
  return pools.some((p) => p.some((v) => v.id === id));
}
