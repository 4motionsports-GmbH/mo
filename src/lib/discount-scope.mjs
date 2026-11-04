// What a campaign discount code applies to (migration 0058). Pure: parsing,
// the wording the coupon, the text part and the AI prompt share — so the code
// the customer receives and the sentence they read can never describe
// different things — and the Shopify item selection the code is minted with.
//
// Since 04.11.2026 a campaign code applies ONLY to the customer's individual
// selection — exactly the products the mail lists ("recommendations"): a
// product shown in all its variants is covered in every variant, a pinned
// variant only in that variant. The two other values are HISTORY:
//   - "all" (the whole order, the pre-0058 behaviour and the old default),
//   - "set" (the code only on the attached set; retired 12.10.2026 — a mail is
//     either a set offer or single items, only an item mail carries a code).
// Both still PARSE so sends stamped with them read back (Gesendet, KPIs), but
// no new draft or campaign takes them, and the send path refuses a draft that
// still carries one with a code (its prose may promise the wrong thing).

/** @typedef {"all" | "recommendations" | "set"} DiscountScope */

export const DISCOUNT_SCOPES = Object.freeze(["all", "recommendations", "set"]);

/** How a MISSING stored value reads: rows from before 0058 had whole-order
 * codes. History only — new values take NEW_DISCOUNT_SCOPE. */
export const DEFAULT_DISCOUNT_SCOPE = "all";

/** The scope every new draft and campaign takes: the individual selection. */
export const NEW_DISCOUNT_SCOPE = "recommendations";

/** The scopes a new draft or campaign may carry. */
export const EDITABLE_DISCOUNT_SCOPES = Object.freeze([NEW_DISCOUNT_SCOPE]);

/** Labels of every scope that can appear on a stored draft or send. */
const SCOPE_LONG_LABELS = Object.freeze({
  all: "Gesamte Bestellung",
  recommendations: "Individuelle Auswahl",
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
 * default): one of EDITABLE_DISCOUNT_SCOPES, else null — "all" and "set"
 * included.
 * @param {unknown} value
 * @returns {"recommendations" | null}
 */
export function parseEditableDiscountScope(value) {
  return typeof value === "string" && EDITABLE_DISCOUNT_SCOPES.includes(value)
    ? /** @type {"recommendations"} */ (value)
    : null;
}

/**
 * The phrase after "X %": "auf deine individuelle Auswahl" (history: "auf
 * deine gesamte Bestellung" / "auf dein persönliches Set").
 * @param {DiscountScope | string | null | undefined} scope
 * @param {"de" | "en"} [language]
 * @returns {string}
 */
export function discountScopePhrase(scope, language = "de") {
  const s = parseDiscountScope(scope);
  if (language === "en") {
    if (s === "recommendations") return "off your personal selection";
    if (s === "set") return "off your personal set";
    return "off your entire order";
  }
  if (s === "recommendations") return "auf deine individuelle Auswahl";
  if (s === "set") return "auf dein persönliches Set";
  return "auf deine gesamte Bestellung";
}

/**
 * The German label for the desk („Gilt für: Individuelle Auswahl").
 * @param {DiscountScope | string | null | undefined} scope
 * @returns {string}
 */
export function discountScopeLabel(scope) {
  return SCOPE_LONG_LABELS[parseDiscountScope(scope)] ?? SCOPE_LONG_LABELS.all;
}

/**
 * Why a draft carrying `scope` with a code can no longer be sent — null when it
 * can. The desk shows it as a blocked Prüfpunkt, the send path refuses with it.
 * @param {unknown} scope the draft's stored scope
 * @param {number} discountPercent
 * @returns {string | null}
 */
export function retiredDiscountScopeMessage(scope, discountPercent) {
  if (!(Number(discountPercent) > 0)) return null;
  const s = parseDiscountScope(scope);
  if (s === "set") return "„Gilt für: Set“ gibt es nicht mehr — bitte den Rabatt auf die Auswahl begrenzen.";
  if (s === "all") {
    return (
      "Rabattcodes gelten nur noch für die individuelle Auswahl der Mail, nicht mehr für die gesamte Bestellung — " +
      "bitte „Auf Auswahl begrenzen“ (der Text wird neu generiert)."
    );
  }
  return null;
}

// ── What Shopify mints the code against ────────────────────────────────────

/**
 * The code never stacks: not with another product, order or shipping discount
 * (Shopify DiscountCombinesWithInput — an explicit false, not the default).
 */
export const NON_COMBINABLE_DISCOUNT = Object.freeze({
  orderDiscounts: false,
  productDiscounts: false,
  shippingDiscounts: false,
});

/**
 * The selection targets of a scoped code: a product shown in ALL its variants
 * (or without a variant choice) is covered as the product (every variant), a
 * pinned variant as exactly that variant. A variant whose product is covered
 * as a whole anyway is left out. Order-preserving, deduplicated.
 * @param {Array<{ handle: string, variantId?: string | null }>} items
 * @returns {{ handles: string[], variantIds: string[] }}
 */
export function discountSelectionTargets(items) {
  const handles = [];
  const variants = [];
  for (const item of Array.isArray(items) ? items : []) {
    const handle = String(item?.handle ?? "").trim();
    if (!handle) continue;
    const variantId = item?.variantId == null ? "" : String(item.variantId).trim();
    if (/^\d+$/.test(variantId)) variants.push({ handle, variantId });
    else if (!handles.includes(handle)) handles.push(handle);
  }
  const variantIds = [];
  for (const v of variants) {
    if (handles.includes(v.handle) || variantIds.includes(v.variantId)) continue;
    variantIds.push(v.variantId);
  }
  return { handles, variantIds };
}

/**
 * gid of a numeric Shopify variant id ("123" → gid://shopify/ProductVariant/123).
 * @param {unknown} id
 * @returns {string | null}
 */
export function productVariantGid(id) {
  const s = id == null ? "" : String(id).trim();
  if (/^\d+$/.test(s)) return `gid://shopify/ProductVariant/${s}`;
  return /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(s) ? s : null;
}

/**
 * `customerGets.items` of a DiscountCodeBasicInput: the given products and
 * variants (DiscountProductsInput), or the whole order when both are empty.
 * Malformed gids are dropped.
 * @param {{ productIds?: string[] | null, productVariantIds?: string[] | null }} input
 * @returns {{ all: true } | { products: { productsToAdd?: string[], productVariantsToAdd?: string[] } }}
 */
export function discountItemsInput({ productIds = [], productVariantIds = [] } = {}) {
  const products = [
    ...new Set((productIds ?? []).filter((g) => /^gid:\/\/shopify\/Product\/\d+$/.test(String(g)))),
  ];
  const variants = [
    ...new Set(
      (productVariantIds ?? []).filter((g) => /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(String(g)))
    ),
  ];
  if (products.length === 0 && variants.length === 0) return { all: true };
  return {
    products: {
      ...(products.length > 0 ? { productsToAdd: products } : {}),
      ...(variants.length > 0 ? { productVariantsToAdd: variants } : {}),
    },
  };
}
