// The drafting side of „Set ODER Einzelprodukte“ (owner, 12.10.2026;
// offer-mode.mjs holds the rule itself). Pure: what a draft about to be
// (re)generated may carry, which prompt variant it gets, how the set's
// contents read in the prompt, and which product names the per-product
// highlights must use. Shared by the campaign drafts (campaign-prepare.ts,
// campaign-draft.ts), the legacy Kunden draft (marketing-draft.ts + its route)
// and the KI-Hero (email-hero.ts), so none of them can drift from the rule:
//
//   - a SET mail presents the one attached set (with counts) as THE offer — no
//     single-product recommendations, no discount code, no percentage; the set
//     block with price and saving is appended below the prose automatically;
//   - an ITEMS mail presents the recommendations, optionally with a code that
//     applies to everything or only to the recommendations.

import { OFFER_ITEMS, OFFER_SET, discountForOffer, offerKind } from "./offer-mode.mjs";
import { DEFAULT_DISCOUNT_SCOPE, parseEditableDiscountScope } from "./discount-scope.mjs";
import { bundleItemLabel, bundleItemList } from "./bundle-offer-core.mjs";

/** @typedef {import("./offer-mode.mjs").OfferKind} OfferKind */
/** @typedef {{ title?: string | null, name?: string | null, quantity?: number | null }} SetComponentLike */

/**
 * The offer a draft is generated and saved with — regardless of who asked
 * (desk depth, campaign default, Vorbereiten popover, Eingang suggestion,
 * nightly auto-prepare):
 *   - with an active set attached: no discount (the set price is the
 *     concession) and scope "all" (a scope without a code means nothing);
 *   - without one: the requested depth, and the requested — else the stored —
 *     scope as long as it is one a new draft may carry; "set" (history) or
 *     anything unknown becomes "all".
 *
 * @param {{
 *   discountPercent?: number | null,
 *   requestedScope?: string | null,
 *   storedScope?: string | null,
 *   hasActiveBundle?: boolean | null,
 * }} input
 * @returns {{ kind: OfferKind, discountPercent: number, discountScope: "all" | "recommendations" }}
 */
export function effectiveDraftOffer({ discountPercent, requestedScope, storedScope, hasActiveBundle }) {
  const kind = offerKind(hasActiveBundle);
  const percent = discountForOffer(discountPercent, hasActiveBundle);
  if (kind === OFFER_SET) return { kind, discountPercent: percent, discountScope: DEFAULT_DISCOUNT_SCOPE };
  return {
    kind,
    discountPercent: percent,
    discountScope: parseEditableDiscountScope(requestedScope ?? storedScope) ?? DEFAULT_DISCOUNT_SCOPE,
  };
}

/**
 * The set's contents as the prompt (and the fallback text) list them, with the
 * count of each item — „2× Kettlebell – 16 kg“. Same grouping and label as the
 * set block and the Shopify set description (bundle-offer-core.bundleItemList),
 * so the prose and the block name the same things.
 *
 * @param {SetComponentLike[] | null | undefined} components
 * @returns {string[]}
 */
export function setContentsLines(components) {
  return bundleItemList(components ?? []).map(bundleItemLabel);
}

/**
 * The product names a set mail's highlights must carry: the component titles
 * exactly as the set block shows them (one per distinct title, no count), so
 * the block can find each description (email-products.highlightDescriptionFor
 * matches trimmed, case-insensitive names).
 *
 * @param {SetComponentLike[] | null | undefined} components
 * @returns {string[]}
 */
export function setHighlightNames(components) {
  return bundleItemList(components ?? []).map((item) => item.name);
}

/** Trimmed, non-empty, first occurrence wins (case-insensitive). */
function uniqueNames(names) {
  const seen = new Set();
  const out = [];
  for (const raw of names ?? []) {
    const name = typeof raw === "string" ? raw.trim() : "";
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Which prompt variant a draft gets. The caller states the offer kind
 * explicitly (derived from the attached set); a "set" request without any set
 * contents cannot present a set and degrades to the item variant. A set mail
 * never carries a code, whatever was passed in.
 *
 * @param {{
 *   offerKind?: OfferKind | null,
 *   setComponents?: SetComponentLike[] | null,
 *   recommendationNames?: string[] | null,
 *   discountCode?: string | null,
 *   discountPercent?: number | null,
 * }} input
 * @returns {{
 *   kind: OfferKind,
 *   showRecommendations: boolean,
 *   setLines: string[],
 *   highlightNames: string[],
 *   discountCode: string | null,
 *   discountPercent: number,
 * }}
 */
export function draftPromptPlan({
  offerKind: requested,
  setComponents,
  recommendationNames,
  discountCode,
  discountPercent,
}) {
  const setLines = setContentsLines(setComponents);
  const isSet = requested === OFFER_SET && setLines.length > 0;
  const percent = discountForOffer(discountPercent, isSet);
  const code = typeof discountCode === "string" && discountCode.trim() ? discountCode : null;
  const withCode = !isSet && percent > 0 && code != null;
  return {
    kind: isSet ? OFFER_SET : OFFER_ITEMS,
    showRecommendations: !isSet,
    setLines: isSet ? setLines : [],
    highlightNames: isSet ? setHighlightNames(setComponents) : uniqueNames(recommendationNames),
    discountCode: withCode ? code : null,
    discountPercent: withCode ? percent : 0,
  };
}

/** „2× “ / „2 x “ in front of a name the model copied from the contents list. */
const COUNT_PREFIX = /^\d+\s*[×xX]\s+/;

/**
 * Align the model's highlight names with the names the renderer looks up: a
 * name that matches a target (trimmed, case-insensitive, also after dropping a
 * copied count prefix „2× “) takes the target's exact spelling; anything else
 * is kept as it came (it simply never matches a product). One entry per name —
 * the first wins.
 *
 * @param {Array<{ name: string, description: string }>} highlights
 * @param {string[]} targets
 * @returns {Array<{ name: string, description: string }>}
 */
export function alignHighlightNames(highlights, targets) {
  const byKey = new Map();
  for (const t of targets ?? []) {
    const name = typeof t === "string" ? t.trim() : "";
    if (name && !byKey.has(name.toLowerCase())) byKey.set(name.toLowerCase(), name);
  }
  const seen = new Set();
  const out = [];
  for (const h of highlights ?? []) {
    const raw = typeof h?.name === "string" ? h.name.trim() : "";
    const description = typeof h?.description === "string" ? h.description.trim() : "";
    if (!raw || !description) continue;
    const name =
      byKey.get(raw.toLowerCase()) ?? byKey.get(raw.replace(COUNT_PREFIX, "").toLowerCase()) ?? raw;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, description });
  }
  return out;
}

/**
 * The prompt section of a SET mail: the set is THE offer of this mail, its
 * contents with counts, and the price rule. The set block (image, contents,
 * set price, the genuine „statt“ reference and the button) is appended below
 * the prose automatically, so the model names no price, no saving and no
 * percentage itself; it may say the set costs less than the parts only when
 * that is true (PAngV: the block shows the real comparison).
 *
 * @param {{ title: string, lines: string[], hasSaving: boolean }} set
 * @param {"de" | "en"} [language]
 * @returns {string}
 */
export function setOfferSection(set, language = "de") {
  const items = (set.lines ?? []).map((line) => `  - ${line}`).join("\n");
  if (language === "en") {
    return (
      `## The offer of this email: one personal set\n` +
      `This email presents ONE offer: the personal set "${set.title}", put together ` +
      `for this customer. The set IS the offer of this email — not an extra next ` +
      `to other recommendations. It contains:\n${items}\n` +
      `Below your text the set appears automatically as its own offer block with ` +
      `pictures, contents, set price and button. ` +
      (set.hasSaving
        ? `It costs less than the individual products combined — point out the advantage kindly. `
        : `Do NOT claim that the set is cheaper than buying the products individually. `) +
      `Do NOT state a price, a saving or a percentage, and do NOT include a link ` +
      `(price, comparison and button are appended automatically).\n\n`
    );
  }
  return (
    `## Das Angebot dieser E-Mail: ein persönliches Set\n` +
    `Diese E-Mail stellt EIN Angebot vor: das persönliche Set „${set.title}“, das ` +
    `du für diese:n Kund:in zusammengestellt hast. Das Set IST das Angebot dieser ` +
    `Mail — kein Zusatz neben anderen Empfehlungen. Es enthält:\n${items}\n` +
    `Unter deinem Text erscheint das Set automatisch als eigener Angebotsblock ` +
    `mit Bildern, Inhalt, Set-Preis und Button. ` +
    (set.hasSaving
      ? `Es ist günstiger als die Einzelprodukte zusammen — weise freundlich auf den Vorteil hin. `
      : `Behaupte NICHT, dass das Set günstiger ist als die Einzelprodukte. `) +
    `Nenne KEINEN Preis, KEINE Ersparnis und KEINE Prozentzahl und baue KEINEN ` +
    `Link ein (Preis, Vergleich und Button werden automatisch angehängt).\n\n`
  );
}

/**
 * The „KEIN Rabattangebot“ prompt branch. An item mail without a depth keeps
 * the classic wording; a set mail says why there is no code — the set price in
 * the block below IS the offer — without forbidding the set's (true) advantage
 * that setOfferSection allows.
 *
 * @param {OfferKind} kind
 * @param {"de" | "en"} [language]
 * @returns {string}
 */
export function noDiscountHint(kind, language = "de") {
  if (kind === OFFER_SET) {
    return language === "en"
      ? "There is NO discount offer in this email: no code and no percentage discount — " +
          "do not mention a discount, a code or a percentage. The set price in the offer " +
          "block below the text is the offer."
      : "Es gibt in dieser Mail KEIN Rabattangebot: keinen Code und keinen Rabatt in " +
          "Prozent — erwähne also weder einen Rabatt noch einen Code oder eine Prozentzahl. " +
          "Das Angebot ist der Set-Preis im Angebotsblock unter dem Text.";
  }
  return language === "en"
    ? "There is NO discount offer this time — do not mention any discount, code, or price reduction."
    : "Es gibt diesmal KEIN Rabattangebot — erwähne also weder einen Rabatt noch einen Code und versprich keinen Preisnachlass.";
}

/**
 * The prompt line that lists the exact names the highlights must use ("" when
 * there are none). For a set mail these are the set's product titles without
 * the count, so the set block can show each description.
 *
 * @param {string[]} names
 * @param {OfferKind} kind
 * @param {"de" | "en"} [language]
 * @returns {string}
 */
export function highlightNamesSection(names, kind, language = "de") {
  if (!names || names.length === 0) return "";
  const list = names.map((n) => `  - ${n}`).join("\n");
  if (language === "en") {
    return kind === OFFER_SET
      ? `Product descriptions (productHighlights): exactly one per product of the set, ` +
          `"name" copied EXACTLY from this list (without the count):\n${list}\n\n`
      : `Product descriptions (productHighlights): exactly one per recommended product, ` +
          `"name" copied EXACTLY from this list:\n${list}\n\n`;
  }
  return kind === OFFER_SET
    ? `Produktbeschreibungen (productHighlights): genau eine pro Produkt des Sets, ` +
        `„name“ EXAKT aus dieser Liste übernommen (ohne die Anzahl):\n${list}\n\n`
    : `Produktbeschreibungen (productHighlights): genau eine pro empfohlenem Produkt, ` +
        `„name“ EXAKT aus dieser Liste übernommen:\n${list}\n\n`;
}

/**
 * The set's products for the KI-Hero: one entry per product id in component
 * order, with the total count across components (two variants of the same
 * kettlebell are one object type to draw, twice).
 *
 * @param {Array<{ productId?: string | null, title?: string | null, quantity?: number | null }> | null | undefined} components
 * @returns {Array<{ productId: string, title: string, quantity: number }>}
 */
export function setHeroProducts(components) {
  const byId = new Map();
  const out = [];
  for (const c of components ?? []) {
    const productId = typeof c?.productId === "string" ? c.productId.trim() : "";
    if (!productId) continue;
    const raw = Number(c?.quantity);
    const quantity = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1;
    const existing = byId.get(productId);
    if (existing) {
      existing.quantity += quantity;
      continue;
    }
    const item = { productId, title: typeof c?.title === "string" ? c.title.trim() : "", quantity };
    byId.set(productId, item);
    out.push(item);
  }
  return out;
}

/**
 * A product label with its count in front when the set holds more than one
 * („2× ATX® Kettlebell (Kettlebell, black)“).
 *
 * @param {string} label
 * @param {number} quantity
 * @returns {string}
 */
export function countedLabel(label, quantity) {
  const q = Number(quantity);
  return Number.isFinite(q) && q > 1 ? `${Math.floor(q)}× ${label}` : label;
}
