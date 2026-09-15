// The discount-code coupon in the recommendation mails: the code, what it is
// worth, its terms and the ONE-CLICK redeem link. E-mail cannot run scripts,
// so there is no "copy to clipboard" — instead the link goes to Shopify's
// discount URL (`/discount/<code>`), which stores the code in the shop session
// and applies it at checkout: one tap beats copying on a phone. Pure and
// tested; the designs only lay these values out (email-template
// renderDiscountCoupon → design hook discountCoupon).

export const SHOP_URL = "https://motionsports.de";

/**
 * Shopify's share link that applies the code in the shop (the storefront
 * remembers it for the checkout). Null for an empty code.
 * @param {string | null | undefined} code
 * @param {string} [shopUrl]
 * @returns {string | null}
 */
export function discountRedeemUrl(code, shopUrl = SHOP_URL) {
  const c = String(code ?? "").trim();
  if (!c) return null;
  return `${shopUrl.replace(/\/+$/, "")}/discount/${encodeURIComponent(c)}`;
}

/**
 * Fixed wording per language.
 * @param {"de" | "en"} language
 * @param {{ percent?: number | null, expiresLabel?: string | null }} [input]
 */
export function couponCopy(language, { percent = null, expiresLabel = null } = {}) {
  const en = language === "en";
  const pct = Number.isFinite(Number(percent)) && Number(percent) > 0 ? Number(percent) : null;
  const terms = [
    en ? "Redeemable once" : "Einmalig einlösbar",
    expiresLabel ? (en ? `valid until ${expiresLabel}` : `gültig bis ${expiresLabel}`) : null,
  ].filter(Boolean);
  return {
    kicker: en ? "Your personal code" : "Dein persönlicher Code",
    benefit:
      pct != null
        ? en
          ? `${pct} % off your entire order`
          : `${pct} % auf deine gesamte Bestellung`
        : en
          ? "Your discount on your entire order"
          : "Dein Rabatt auf deine gesamte Bestellung",
    terms: terms.join(" · "),
    cta: en ? "Redeem code" : "Code einlösen",
    hint: en ? "One click stores the code for your checkout." : "Ein Klick hinterlegt den Code für deine Kasse.",
  };
}

/**
 * The plain-text coupon (text part of the mail).
 * @param {"de" | "en"} language
 * @param {{ code: string, percent?: number | null, expiresLabel?: string | null }} input
 * @returns {string}
 */
export function couponText(language, { code, percent = null, expiresLabel = null }) {
  const c = couponCopy(language, { percent, expiresLabel });
  return `${c.kicker}: ${code} — ${c.benefit}. ${c.terms}.\n${c.cta}: ${discountRedeemUrl(code)}`;
}
