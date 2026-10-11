// The served framing of the consent popup after a sign-in (OI3, surface=signin).
// Pure, tested.
//
// What the popup shows above the consent text: a `headline` and up to four
// short `benefits` bullets. Both are FRAMING, not consent text — the consent
// text stays `marketingLabel` + `consentFooter` (consentTextShown), served by
// consent-copy.ts. The widget renders `benefits` verbatim (textContent) and
// no longer carries bullets of its own (frontend task 1, 2026-10-05).
//
// Variants exist for an A/B test (CONSENT_SIGNIN_VARIANTS, default "a").
// Rules: static text per locale, no placeholders, honest (no urgency, no
// discount amounts in headline or benefits, nothing the newsletter does not
// deliver). A variant is never removed once shipped — only deactivated — so
// ids echoed by older copies stay known.
//
// Copy v6 (OPTIN_REWARD T3): variants b and c add the welcome-voucher hint
// (`reward`: badge, terms, teaser, afterAccept) and c also the value-moment
// lead (`valueMoment`) — framing like the headline, never consent text, never
// in consentTextShown. The amount appears only in the reward block (the copy
// ceiling's one exception, approved by counsel per the owner on 11.10.2026,
// dossier § 22; English as the F-12 drafts). Served only behind CONSENT_REWARD_ENABLED /
// CONSENT_VALUE_MOMENT_ENABLED (servedSigninExtras below); the reward must equal
// what new subscribers are actually sent.

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

/**
 * The widget's limits for the served reward fields (characters, trimmed). A
 * longer string is dropped by the widget without a trace, so the server never
 * serves one (servedSigninExtras) and a test pins the configured strings.
 */
export const REWARD_LIMITS = Object.freeze({ badge: 60, terms: 300, teaser: 160, afterAccept: 200, lead: 200 });

/**
 * The welcome voucher (owner decisions O-1…O-9 of 11.10.2026: a fixed 50 € from
 * 500 €, a unique single-use code, 30 days, not for reduced items or Concept2,
 * one code per customer ever). Shopify counts only the eligible items toward the
 * minimum of a collection-limited discount, so the terms say that the excluded
 * items do not count toward the 500 €.
 * Both languages follow the texts counsel approved (dossier § 22.2 and the English
 * drafts at F-12, reported by the owner 11.10.2026) with the decided fixed amount
 * in place of the example tiers. A wording change is a new review.
 */
const REWARD = Object.freeze({
  de: Object.freeze({
    badge: "50 € Willkommensgutschein ab 500 € Bestellwert",
    terms:
      "Für deine erste Newsletter-Anmeldung, nach Bestätigung per E-Mail. 50 € ab 500 € Bestellwert; reduzierte Artikel und Concept2 sind ausgeschlossen und zählen nicht zum Bestellwert; einmal einlösbar, 30 Tage gültig; nicht mit anderen Rabatten kombinierbar.",
    teaser: "Melde dich an und sichere dir 50 € Willkommensgutschein ab 500 € Bestellwert.",
    afterAccept: "Dein Gutschein kommt per E-Mail, sobald du deine Anmeldung bestätigt hast.",
  }),
  en: Object.freeze({
    badge: "€50 welcome voucher from €500 order value",
    terms:
      "For your first newsletter sign-up, after you confirm by e-mail. €50 from €500 order value; reduced items and Concept2 are excluded and do not count towards the order value; single use, valid 30 days; cannot be combined with other discounts.",
    teaser: "Sign in and get a €50 welcome voucher from €500 order value.",
    afterAccept: "Your voucher arrives by e-mail once you have confirmed your sign-up.",
  }),
});

/** The value-moment lead (variant c): the ask after a product recommendation. */
const VALUE_MOMENT = Object.freeze({
  de: Object.freeze({ lead: "Gefällt dir die Empfehlung? Hol dir deinen Willkommensgutschein für die Bestellung." }),
  en: Object.freeze({ lead: "Like the recommendation? Get your welcome voucher for your order." }),
});

/** Counsel's approval of the reward variants per locale (both 11.10.2026, as reported by the owner). */
const REWARD_APPROVED = Object.freeze({ de: true, en: true });

/** @param {"de" | "en"} locale */
function variantsFor(locale) {
  const s = consentStrings(locale);
  const framing = { headline: s.signinHeadline, benefits: BENEFITS_A[locale] };
  return Object.freeze([
    Object.freeze({ id: "a", ...framing, lawyerApproved: true }),
    Object.freeze({ id: "b", ...framing, reward: REWARD[locale], lawyerApproved: REWARD_APPROVED[locale] }),
    Object.freeze({
      id: "c",
      ...framing,
      reward: REWARD[locale],
      valueMoment: VALUE_MOMENT[locale],
      lawyerApproved: REWARD_APPROVED[locale],
    }),
  ]);
}

export const SIGNIN_VARIANTS = Object.freeze({ de: variantsFor("de"), en: variantsFor("en") });

/** Every id ever shipped — never removed (tested). */
export const SHIPPED_SIGNIN_VARIANT_IDS = Object.freeze(["a", "b", "c"]);

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

/** @param {unknown} v @param {number} max */
function servedText(v, max) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t !== "" && t.length <= max ? t : null;
}

/**
 * The terms page URL (CONSENT_REWARD_TERMS_URL): an absolute https URL without
 * credentials, else null (the widget then shows no „Bedingungen“ link).
 * @param {unknown} raw
 */
export function parseRewardTermsUrl(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" || u.username || u.password || !u.hostname) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * What a served sign-in copy adds to a variant's framing (copy v6): the reward
 * hint while CONSENT_REWARD_ENABLED is on and the variant is approved for the
 * locale, and the value-moment lead only together with the reward (the lead
 * names the voucher) while CONSENT_VALUE_MOMENT_ENABLED is on. Badge and terms
 * are required (else no reward at all); teaser, afterAccept and the terms link
 * are dropped one by one when invalid — the widget's own rules, so what is
 * served is what renders. Never part of consentTextShown.
 *
 * @param {unknown} variant a SIGNIN_VARIANTS entry
 * @param {{ rewardEnabled?: boolean, valueMomentEnabled?: boolean, termsUrl?: string | null }} opts
 * @returns {{ reward?: { badge: string, terms: string, termsUrl?: string, teaser?: string, afterAccept?: string }, valueMoment?: { lead: string } }}
 */
export function servedSigninExtras(variant, { rewardEnabled = false, valueMomentEnabled = false, termsUrl = null } = {}) {
  const v = variant != null && typeof variant === "object" ? /** @type {Record<string, any>} */ (variant) : {};
  if (rewardEnabled !== true || v.lawyerApproved !== true) return {};
  const r = v.reward != null && typeof v.reward === "object" ? v.reward : null;
  const badge = servedText(r?.badge, REWARD_LIMITS.badge);
  const terms = servedText(r?.terms, REWARD_LIMITS.terms);
  if (!badge || !terms) return {};
  /** @type {{ badge: string, terms: string, termsUrl?: string, teaser?: string, afterAccept?: string }} */
  const reward = { badge, terms };
  const url = parseRewardTermsUrl(termsUrl);
  if (url) reward.termsUrl = url;
  const teaser = servedText(r?.teaser, REWARD_LIMITS.teaser);
  if (teaser) reward.teaser = teaser;
  const afterAccept = servedText(r?.afterAccept, REWARD_LIMITS.afterAccept);
  if (afterAccept) reward.afterAccept = afterAccept;
  /** @type {{ reward: typeof reward, valueMoment?: { lead: string } }} */
  const out = { reward };
  const lead = valueMomentEnabled === true ? servedText(v.valueMoment?.lead, REWARD_LIMITS.lead) : null;
  if (lead) out.valueMoment = { lead };
  return out;
}

/**
 * The welcome voucher as Mo may state it (OPTIN_REWARD T4): the badge and terms
 * of the first approved variant with a reward for the locale, only while
 * CONSENT_REWARD_ENABLED is on — independent of the variant a session sees (the
 * voucher exists for every first sign-up; the variants test only the hint on the
 * ask). Null → Mo's neutral interim rule.
 *
 * @param {unknown} locale
 * @param {{ rewardEnabled?: boolean, termsUrl?: string | null }} opts
 * @returns {{ badge: string, terms: string, termsUrl?: string } | null}
 */
export function welcomeRewardForPrompt(locale, { rewardEnabled = false, termsUrl = null } = {}) {
  for (const v of SIGNIN_VARIANTS[loc(locale)]) {
    const { reward } = servedSigninExtras(v, { rewardEnabled, termsUrl });
    if (reward) {
      return { badge: reward.badge, terms: reward.terms, ...(reward.termsUrl ? { termsUrl: reward.termsUrl } : {}) };
    }
  }
  return null;
}
