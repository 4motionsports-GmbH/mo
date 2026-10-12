// The arithmetic behind the two set composers (Kampagne set dialog, Kunden
// composer): the normal price of the chosen items (shown greyed in the empty
// price field), what a typed set price means against it, and whether the
// selection makes a set at all. Pure and tested (set-composer-core.test.mjs);
// the server re-checks everything (bundle-offer-core.mjs) — this only drives
// what the operator sees while composing.

import { BUNDLE_QUANTITY_MAX, centsToMoney, toCents } from "./bundle-offer-core.mjs";
import { bundleSaving } from "./bundle-email-core.mjs";

/** A set needs at least two units in total — one product twice, or two products. */
export const SET_MIN_UNITS = 2;

/**
 * @typedef {{ price: number | null | undefined, quantity: number }} SetRow
 */

/**
 * Normal price in cents: Σ unit price × count — what the items cost bought
 * separately today. null when nothing is chosen or any chosen price is unknown.
 * @param {SetRow[]} rows  the CHOSEN rows
 * @returns {number | null}
 */
export function setNormalPriceCents(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  let cents = 0;
  for (const row of rows) {
    const unit = toCents(row?.price);
    if (unit == null) return null;
    cents += unit * clampQuantity(row?.quantity);
  }
  return cents;
}

/**
 * Count clamped to 1…BUNDLE_QUANTITY_MAX (anything invalid counts as 1).
 * @param {unknown} quantity
 * @returns {number}
 */
export function clampQuantity(quantity) {
  const n = Math.floor(Number(quantity));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, BUNDLE_QUANTITY_MAX);
}

/**
 * Total units of the chosen rows.
 * @param {SetRow[]} rows
 * @returns {number}
 */
export function setUnits(rows) {
  return (Array.isArray(rows) ? rows : []).reduce((sum, row) => sum + clampQuantity(row?.quantity), 0);
}

/**
 * What the typed set price means.
 *   - "empty":     nothing typed — the set costs the normal price (no strike price)
 *   - "invalid":   not a positive amount
 *   - "saving":    below the normal price — the mail shows the strike price and the saving
 *   - "no_saving": at or above the normal price — no strike price, no saving (PAngV)
 *   - "unknown":   a valid price, but the normal price is unknown
 * The saving percentage is the mail's own (bundleSaving: rounded down, null
 * under 1 %), so the dialog never promises a bigger figure than the mail
 * prints.
 *
 * @param {{ normalCents: number | null, input: string | null | undefined }} args
 * @returns {{ kind: "empty" } | { kind: "invalid" } | { kind: "unknown", priceCents: number } |
 *   { kind: "no_saving", priceCents: number } |
 *   { kind: "saving", priceCents: number, savingCents: number, savingPct: number | null }}
 */
export function setPriceCheck({ normalCents, input }) {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return { kind: "empty" };
  const priceCents = toCents(raw);
  if (priceCents == null || priceCents <= 0) return { kind: "invalid" };
  if (normalCents == null || normalCents <= 0) return { kind: "unknown", priceCents };
  if (priceCents >= normalCents) return { kind: "no_saving", priceCents };
  const savingCents = normalCents - priceCents;
  const { pct } = bundleSaving(centsToMoney(priceCents), centsToMoney(normalCents));
  return { kind: "saving", priceCents, savingCents, savingPct: pct };
}

/**
 * Whether the chosen rows make a set, and the German reason when not.
 * @param {SetRow[]} rows  the CHOSEN rows
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function setSelectionCheck(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return { ok: false, reason: "Keine Produkte gewählt." };
  if (setUnits(list) < SET_MIN_UNITS) {
    return { ok: false, reason: "Ein Set braucht mindestens zwei Stück — ein zweites Produkt oder 2× wählen." };
  }
  return { ok: true };
}
