// What a campaign discount code applies to (migration 0058): the whole order,
// only the products recommended in the mail, or only the attached set. Pure:
// parsing, the desk's options and the wording the coupon, the text part and
// the AI prompt share — so the code the customer receives and the sentence
// they read can never describe different things.

/** @typedef {"all" | "recommendations" | "set"} DiscountScope */

export const DISCOUNT_SCOPES = Object.freeze(["all", "recommendations", "set"]);

/** The default (and the pre-0058 behaviour): the code applies to everything. */
export const DEFAULT_DISCOUNT_SCOPE = "all";

/** The desk's switch, in its display order. */
export const DISCOUNT_SCOPE_OPTIONS = Object.freeze([
  { value: "all", label: "Alles", long: "Gesamte Bestellung" },
  { value: "recommendations", label: "Empfehlungen", long: "Nur die empfohlenen Produkte" },
  { value: "set", label: "Set", long: "Nur das Set-Angebot" },
]);

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
  const s = parseDiscountScope(scope);
  return DISCOUNT_SCOPE_OPTIONS.find((o) => o.value === s)?.long ?? "Gesamte Bestellung";
}
