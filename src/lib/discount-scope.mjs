// What a campaign discount code applies to (migration 0058): the whole order
// or only the products recommended in the mail. Pure: parsing, the desk's
// options and the wording the coupon, the text part and the AI prompt share —
// so the code the customer receives and the sentence they read can never
// describe different things.
//
// "set" (the code only on the attached set) is HISTORY: since 12.10.2026 a
// mail is either a set offer or single items, and only an item mail carries a
// code (offer-mode.mjs). "set" still PARSES so sends stamped with it read back
// (Gesendet, KPIs), but it is no longer offered or accepted for new drafts.

/** @typedef {"all" | "recommendations" | "set"} DiscountScope */

export const DISCOUNT_SCOPES = Object.freeze(["all", "recommendations", "set"]);

/** The default (and the pre-0058 behaviour): the code applies to everything. */
export const DEFAULT_DISCOUNT_SCOPE = "all";

/** The scopes a new draft or campaign may carry (no "set" — see above). */
export const EDITABLE_DISCOUNT_SCOPES = Object.freeze(["all", "recommendations"]);

/** The desk's switch, in its display order. */
export const DISCOUNT_SCOPE_OPTIONS = Object.freeze([
  { value: "all", label: "Alles", long: "Gesamte Bestellung" },
  { value: "recommendations", label: "Empfehlungen", long: "Nur die empfohlenen Produkte" },
]);

/** Labels of every scope that can appear on a stored send, history included. */
const SCOPE_LONG_LABELS = Object.freeze({
  all: "Gesamte Bestellung",
  recommendations: "Nur die empfohlenen Produkte",
  set: "Nur das Set-Angebot",
});

/**
 * @param {unknown} value
 * @returns {DiscountScope}
 */
export function parseDiscountScope(value) {
  return typeof value === "string" && DISCOUNT_SCOPES.includes(value)
    ? /** @type {DiscountScope} */ (value)
    : DEFAULT_DISCOUNT_SCOPE;
}

/**
 * Strict parse for a NEW value (a route body, the campaign editor, an env
 * default): one of EDITABLE_DISCOUNT_SCOPES, else null — "set" included.
 * @param {unknown} value
 * @returns {"all" | "recommendations" | null}
 */
export function parseEditableDiscountScope(value) {
  return typeof value === "string" && EDITABLE_DISCOUNT_SCOPES.includes(value)
    ? /** @type {"all" | "recommendations"} */ (value)
    : null;
}

/**
 * The phrase after "X %": "auf deine gesamte Bestellung" / "auf die
 * empfohlenen Produkte aus dieser E-Mail" / "auf dein persönliches Set".
 * @param {DiscountScope | string | null | undefined} scope
 * @param {"de" | "en"} [language]
 * @returns {string}
 */
export function discountScopePhrase(scope, language = "de") {
  const s = parseDiscountScope(scope);
  if (language === "en") {
    if (s === "recommendations") return "off the products recommended in this email";
    if (s === "set") return "off your personal set";
    return "off your entire order";
  }
  if (s === "recommendations") return "auf die empfohlenen Produkte aus dieser E-Mail";
  if (s === "set") return "auf dein persönliches Set";
  return "auf deine gesamte Bestellung";
}

/**
 * The German label for the desk („Gilt für: Empfehlungen").
 * @param {DiscountScope | string | null | undefined} scope
 * @returns {string}
 */
export function discountScopeLabel(scope) {
  return SCOPE_LONG_LABELS[parseDiscountScope(scope)] ?? SCOPE_LONG_LABELS.all;
}
