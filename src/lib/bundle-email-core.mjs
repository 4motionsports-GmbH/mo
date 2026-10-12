// Pure, dependency-free core logic for the bundle SPECIAL-OFFER email block (S11).
//
// The decisions the special-offer block hinges on, isolated so they are
// unit-testable without the email template / catalog / DB:
//   1. shouldRenderBundleBlock — the block appears ONLY when a created, still
//      active bundle is attached to the send (never for a draft with no bundle,
//      never for an expired/failed/pending offer, and never once its deadline
//      has passed — even before the expiry sweep has flipped the row). A mail
//      whose block renders is a SET MAIL (offer-mode.mjs): it shows only the
//      set — no single-product rows, no discount code.
//   2. bundleStattPrice — the PAngV "statt €X" strike price is the genuine
//      snapshotted component sum, and ONLY when the bundle truly costs less than
//      its parts (reuses the S10 compare-at rule so the email and the Shopify
//      compareAtPrice can never disagree).
//   3. bundleBlockModel — EVERYTHING a design prints in the set block (money
//      labels, the saving, the eyecatcher, one row per item with its snapshot
//      unit price), computed once so no design re-derives money or PAngV
//      logic; bundleBlockText is the shared plain-text part.

import { computeCompareAtPrice, isExpired, toCents } from "./bundle-offer-core.mjs";

/**
 * Whether the personalized email should carry a special-offer block. True ONLY
 * for an attached, ACTIVE bundle offer whose deadline has not passed; false for
 * no bundle (null/undefined), any non-active lifecycle state
 * (pending/expired/failed) or an active row already past `expiresAt` — a dead
 * offer must never be advertised.
 *
 * @param {{ status?: string, expiresAt?: string | Date | null } | null | undefined} bundle
 * @param {number} [now]  epoch ms
 * @returns {boolean}
 */
export function shouldRenderBundleBlock(bundle, now = Date.now()) {
  return Boolean(bundle && bundle.status === "active" && !isExpired(bundle, now));
}

/**
 * The "statt €X" strike price for the email, or null when none should be shown.
 * It is the TRUE component sum, and present ONLY when bundlePrice < componentsSum
 * (PAngV: never invent a strike price; an at-or-above-sum bundle simply omits the
 * "statt" line). Delegates to the S10 compare-at rule so the displayed strike and
 * the Shopify compareAtPrice are computed identically.
 *
 * @param {string | number} bundlePrice
 * @param {string | number} componentsSum
 * @returns {string | null}  Money string (e.g. "298.00") or null
 */
export function bundleStattPrice(bundlePrice, componentsSum) {
  return computeCompareAtPrice(bundlePrice, componentsSum);
}

/** Titles longer than this are the auto-generated "Set: A + B + C" kind. */
const BUNDLE_HEADLINE_MAX_CHARS = 40;

/**
 * The short headline a design shows over the component list. Operators can
 * name a set ("Dein Rack-Upgrade"); the generated default is the component
 * names joined ("Set: Bodenschutzmatte … + ATX® Jammer Arms X1-600 + …"),
 * which as a 20px headline overwhelms the card. Long or "Set:"-style
 * titles therefore give way to the per-language default — the components
 * are listed underneath anyway.
 * @param {string | null | undefined} title
 * @param {"de" | "en"} [language]
 * @returns {string}
 */
export function bundleHeadline(title, language = "de") {
  const fallback = language === "en" ? "Your personal set" : "Dein persönliches Set";
  const t = typeof title === "string" ? title.trim() : "";
  if (!t) return fallback;
  if (/^set\s*:/i.test(t) || t.length > BUNDLE_HEADLINE_MAX_CHARS) return fallback;
  return t;
}

// ── The set block's model (every design prints exactly this) ─────────────────

/**
 * @typedef {{ kicker: string, deal: string, price: string, instead: string, save: string,
 *   separately: string, cta: string }} BundleBlockLabels
 */

/** Fixed labels of the set block, per language. PAngV wording stays intact in
 * German; the English mirror keeps the same honest "instead of" framing.
 * @type {Readonly<Record<"de" | "en", Readonly<BundleBlockLabels>>>} */
export const BUNDLE_BLOCK_LABELS = Object.freeze({
  de: Object.freeze({
    kicker: "Dein persönliches Angebot",
    deal: "Bundle Deal",
    price: "Set-Preis",
    instead: "statt",
    save: "Du sparst",
    separately: "Einzelkauf",
    cta: "Zur Kasse",
  }),
  en: Object.freeze({
    kicker: "Your personal offer",
    deal: "Bundle deal",
    price: "Set price",
    instead: "instead of",
    save: "You save",
    separately: "Bought separately",
    cta: "Checkout",
  }),
});

/**
 * A Money value as the reader sees it: "1.299,00 €" (de) / "€1,299.00" (en).
 * Accepts numbers and decimal strings ("149.00", "149,90"); an unparseable
 * value is printed as given rather than inventing a number.
 *
 * @param {string | number | null | undefined} value
 * @param {string} [currency]
 * @param {"de" | "en"} [language]
 * @returns {string}
 */
export function formatBundleMoney(value, currency = "EUR", language = "de") {
  const cents = toCents(value);
  if (cents == null) return String(value ?? "");
  return (cents / 100).toLocaleString(language === "en" ? "en-IE" : "de-DE", {
    style: "currency",
    currency,
  });
}

/**
 * The genuine saving of a set, or nulls. Present ONLY when the set costs less
 * than its parts (the same rule as the strike price): the amount in cents and
 * the percentage of the component sum, rounded DOWN — the mail never claims a
 * bigger saving than the real one. A saving under 1 % keeps its amount but
 * gets no percentage (no "−0 %" badge).
 *
 * @param {string | number} bundlePrice
 * @param {string | number} componentsSum
 * @returns {{ amountCents: number | null, pct: number | null }}
 */
export function bundleSaving(bundlePrice, componentsSum) {
  const price = toCents(bundlePrice);
  const sum = toCents(componentsSum);
  if (price == null || sum == null || sum <= 0 || price >= sum) return { amountCents: null, pct: null };
  const amountCents = sum - price;
  const pct = Math.floor((amountCents * 100) / sum);
  return { amountCents, pct: pct >= 1 ? pct : null };
}

/**
 * Which eyecatcher tops the set block: the saving badge („−16 %“ + „Du sparst
 * 29,90 €“) ONLY for a genuine saving with a percentage; otherwise the set
 * price badge („Set-Preis“ + amount) — never a strike or a saving.
 *
 * @param {{ savingLabel?: string | null, savingPct?: number | null }} computed
 * @returns {"saving" | "price"}
 */
export function bundleEyecatcherKind({ savingLabel, savingPct }) {
  return savingLabel && savingPct != null ? "saving" : "price";
}

/**
 * The price column of one set row: the SNAPSHOT unit price, „je 49,00 €“ when
 * the set holds more than one ("€49.00 each"), „49,00 €“ for one. Null without
 * a price (the row then shows no price).
 *
 * @param {string | null | undefined} unitPriceFormatted  already formatted ("49,00 €")
 * @param {number} quantity
 * @param {"de" | "en"} [language]
 * @returns {string | null}
 */
export function bundleUnitPriceLabel(unitPriceFormatted, quantity, language = "de") {
  if (!unitPriceFormatted) return null;
  if (!(quantity > 1)) return unitPriceFormatted;
  return language === "en" ? `${unitPriceFormatted} each` : `je ${unitPriceFormatted}`;
}

/** Longest item description a set row shows (two short lines in the mail). */
export const BUNDLE_ITEM_DESCRIPTION_MAX = 110;

/**
 * A short item description: whitespace collapsed, cut at a word boundary
 * before `max` characters with an ellipsis. Empty → null.
 *
 * @param {string | null | undefined} text
 * @param {number} [max]
 * @returns {string | null}
 */
export function clampBundleDescription(text, max = BUNDLE_ITEM_DESCRIPTION_MAX) {
  const t = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  if (!t) return null;
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.4 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.\-–·]+$/, "")}…`;
}

/**
 * The short line under the set headline: how many products, and — only with a
 * genuine saving — that they are cheaper together.
 *
 * @param {{ itemCount: number, pieceCount: number, eyecatcher: "saving" | "price", language?: "de" | "en" }} input
 * @returns {string}
 */
export function bundleTagline({ itemCount, pieceCount, eyecatcher, language = "de" }) {
  const en = language === "en";
  const count =
    itemCount === 1
      ? en
        ? `${pieceCount} ${pieceCount === 1 ? "piece" : "pieces"}`
        : `${pieceCount} Stück`
      : en
        ? `${itemCount} products`
        : `${itemCount} Produkte`;
  if (eyecatcher === "saving") return en ? `${count} · cheaper together` : `${count} · zusammen günstiger`;
  return en ? `${count} in one set` : `${count} in einem Set`;
}

/**
 * A light tint of a design's accent colour for the eyecatcher band of the
 * classic set frame (classic #008ccb → a pale blue, Studio's black → a pale
 * grey): the colour mixed with white, `strength` of the colour kept. A value
 * that is not a #rgb / #rrggbb hex falls back to a neutral light grey.
 *
 * @param {string | null | undefined} hex
 * @param {number} [strength]  0…1 share of the colour
 * @returns {string}  "#rrggbb"
 */
export function tintHex(hex, strength = 0.1) {
  const m = typeof hex === "string" ? hex.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i) : null;
  if (!m) return "#f4f4f4";
  const full = m[1].length === 3 ? m[1].replace(/./g, (ch) => ch + ch) : m[1];
  const s = Math.min(1, Math.max(0, Number.isFinite(strength) ? strength : 0.1));
  const channel = (/** @type {number} */ i) => {
    const c = parseInt(full.slice(i, i + 2), 16);
    return Math.round(255 - (255 - c) * s)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

/**
 * @typedef {{ name?: string | null, quantity?: number | null, imageUrl?: string | null,
 *   description?: string | null, unitPrice?: string | number | null }} BundleModelComponent
 */

/**
 * @typedef {{ name: string, quantity: number, imageUrl: string | null,
 *   description: string | null, unitPriceLabel: string | null }} BundleBlockItem
 */

/**
 * Everything the set block shows, for every design. Money and PAngV logic live
 * ONLY here: the strike price (stattLabel) and the saving exist only when the
 * set genuinely costs less than its parts; the per-item prices are the
 * SNAPSHOT unit prices of the components and are shown only when they add up
 * exactly to the component sum (Σ unitPrice × quantity = componentsSum) — a
 * row never prints a price the "Einzelkauf" total does not stand behind.
 * Items with the same name are merged and their counts added (like
 * bundleItemList). Images must be absolute https URLs (mail clients load
 * nothing else); others are dropped.
 *
 * @param {{ title?: string | null, components: BundleModelComponent[], bundlePrice: string | number,
 *   componentsSum: string | number, currency?: string, language?: "de" | "en" }} input
 */
export function bundleBlockModel(input) {
  const language = input.language === "en" ? "en" : "de";
  const currency = input.currency || "EUR";
  const labels = BUNDLE_BLOCK_LABELS[language];
  const money = (/** @type {string | number} */ v) => formatBundleMoney(v, currency, language);

  const priceLabel = money(input.bundlePrice);
  const statt = bundleStattPrice(input.bundlePrice, input.componentsSum);
  const stattLabel = statt != null ? money(statt) : null;
  const saving = statt != null ? bundleSaving(input.bundlePrice, input.componentsSum) : { amountCents: null, pct: null };
  const savingLabel = saving.amountCents != null ? money(saving.amountCents / 100) : null;
  const savingPct = savingLabel ? saving.pct : null;

  /** @type {Array<{ name: string, quantity: number, imageUrl: string | null, description: string | null, unitCents: number | null }>} */
  const merged = [];
  const byName = new Map();
  let pricesConsistent = true;
  let unitSumCents = 0;
  for (const c of input.components ?? []) {
    const name = String(c?.name ?? "").trim();
    if (!name) continue;
    const rawQty = Number(c?.quantity);
    const quantity = Number.isFinite(rawQty) && rawQty > 0 ? Math.floor(rawQty) : 1;
    const unitCents = c?.unitPrice == null ? null : toCents(c.unitPrice);
    if (unitCents == null) pricesConsistent = false;
    else unitSumCents += unitCents * quantity;
    const existing = byName.get(name);
    if (existing) {
      existing.quantity += quantity;
      if (existing.unitCents !== unitCents) pricesConsistent = false;
      continue;
    }
    const item = {
      name,
      quantity,
      imageUrl: typeof c?.imageUrl === "string" && c.imageUrl.startsWith("https://") ? c.imageUrl : null,
      description: clampBundleDescription(c?.description),
      unitCents,
    };
    byName.set(name, item);
    merged.push(item);
  }
  const sumCents = toCents(input.componentsSum);
  if (sumCents == null || unitSumCents !== sumCents || merged.length === 0) pricesConsistent = false;

  /** @type {BundleBlockItem[]} */
  const items = merged.map((m) => ({
    name: m.name,
    quantity: m.quantity,
    imageUrl: m.imageUrl,
    description: m.description,
    unitPriceLabel:
      pricesConsistent && m.unitCents != null
        ? bundleUnitPriceLabel(money(m.unitCents / 100), m.quantity, language)
        : null,
  }));
  const itemCount = items.length;
  const pieceCount = items.reduce((n, i) => n + i.quantity, 0);
  const eyecatcher = bundleEyecatcherKind({ savingLabel, savingPct });
  /** @type {{ label: string | null, value: string, note: string | null }} */
  const eyecatcherCopy =
    eyecatcher === "saving"
      ? {
          label: null,
          value: language === "en" ? `−${savingPct}%` : `−${savingPct} %`,
          note: `${labels.save} ${savingLabel}`,
        }
      : { label: labels.price, value: priceLabel, note: null };

  return {
    headline: bundleHeadline(input.title, language),
    priceLabel,
    stattLabel,
    savingLabel,
    savingPct,
    labels,
    items,
    itemCount,
    pieceCount,
    eyecatcher,
    eyecatcherCopy,
    tagline: bundleTagline({ itemCount, pieceCount, eyecatcher, language }),
  };
}

/**
 * The set block's plain-text part (every design): the set title, one line per
 * item with its count and snapshot unit price, the set price (+ "statt …" and
 * "Du sparst … (x %)" only when genuine) and the checkout link.
 *
 * @param {{ headline: string, priceLabel: string, stattLabel: string | null, savingLabel: string | null,
 *   savingPct: number | null, labels: Readonly<BundleBlockLabels>,
 *   items: ReadonlyArray<{ name: string, quantity: number, unitPriceLabel: string | null }> }} model
 *   a bundleBlockModel result
 * @param {string} offerUrl  the tracked /api/r/<token> link
 * @returns {string}
 */
export function bundleBlockText(model, offerUrl) {
  const { labels } = model;
  return [
    "",
    "—",
    `${labels.kicker}: ${model.headline}`,
    ...model.items.map(
      (item) => `- ${item.quantity}× ${item.name}${item.unitPriceLabel ? ` — ${item.unitPriceLabel}` : ""}`
    ),
    model.stattLabel
      ? `${labels.price}: ${model.priceLabel} (${labels.instead} ${model.stattLabel})`
      : `${labels.price}: ${model.priceLabel}`,
    ...(model.savingLabel && model.savingPct != null
      ? [`${labels.save} ${model.savingLabel} (${model.savingPct} %)`]
      : []),
    `${labels.cta}: ${offerUrl}`,
  ].join("\n");
}
