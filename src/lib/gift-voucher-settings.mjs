// Geschenkgutscheine — the operator settings (admin „Gutscheine“ → Einrichtung),
// stored in admin_settings under the key 'gift_vouchers' (migration 0078 — no
// migration of their own; the store is lib/gift-voucher-store.ts, the pattern
// is the Konfigurator's). Pure, tested in gift-voucher-settings.test.mjs.
//
//   salesEnabled          „Verkauf im Shop“ — the storefront page sells (with
//                         GIFT_VOUCHERS_ENABLED; either off → no sale)
//   aiSuggestions         „KI-Textvorschläge“ — „Mit Mo formulieren“
//   photoUploads          „Eigene Fotos“ — the design „Eigenes Foto“
//   reviewPrintWithPhoto  „Druck mit eigenem Foto prüfen“ — a card with a
//                         customer photo waits for an operator's release
//                         before it is printed

export const GIFT_VOUCHER_SETTINGS_KEY = "gift_vouchers";

/**
 * @typedef {{
 *   salesEnabled: boolean,
 *   aiSuggestions: boolean,
 *   photoUploads: boolean,
 *   reviewPrintWithPhoto: boolean,
 * }} GiftVoucherSettings
 */

/** @type {Readonly<GiftVoucherSettings>} */
export const DEFAULT_GIFT_VOUCHER_SETTINGS = Object.freeze({
  salesEnabled: true,
  aiSuggestions: true,
  photoUploads: true,
  reviewPrintWithPhoto: true,
});

/** The German names of the settings, as the admin shows them. */
export const GIFT_VOUCHER_SETTING_LABELS = Object.freeze({
  salesEnabled: "Verkauf im Shop",
  aiSuggestions: "KI-Textvorschläge",
  photoUploads: "Eigene Fotos",
  reviewPrintWithPhoto: "Druck mit eigenem Foto prüfen",
});

/** @type {ReadonlyArray<keyof GiftVoucherSettings>} */
const KEYS = Object.freeze(["salesEnabled", "aiSuggestions", "photoUploads", "reviewPrintWithPhoto"]);

/** @param {unknown} v @returns {Record<string, unknown> | null} */
function asObject(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : null;
}

/**
 * The stored value → settings. Fail-soft per field: a missing or broken field
 * takes its default, so a damaged row never changes a switch by accident.
 * @param {unknown} value
 * @returns {GiftVoucherSettings}
 */
export function parseGiftVoucherSettings(value) {
  const obj = asObject(value) ?? {};
  /** @type {GiftVoucherSettings} */
  const out = { ...DEFAULT_GIFT_VOUCHER_SETTINGS };
  for (const key of KEYS) {
    if (typeof obj[key] === "boolean") out[key] = /** @type {boolean} */ (obj[key]);
  }
  return out;
}

/**
 * Strict check of a NEW value (the admin route body): every switch must be a
 * boolean. German messages.
 * @param {unknown} body
 * @returns {{ ok: true, settings: GiftVoucherSettings } | { ok: false, message: string }}
 */
export function validateGiftVoucherSettingsInput(body) {
  const obj = asObject(body);
  if (!obj) return { ok: false, message: "Ungültige Einstellungen." };
  /** @type {GiftVoucherSettings} */
  const settings = { ...DEFAULT_GIFT_VOUCHER_SETTINGS };
  for (const key of KEYS) {
    if (typeof obj[key] !== "boolean") return { ok: false, message: `„${GIFT_VOUCHER_SETTING_LABELS[key]}“ fehlt.` };
    settings[key] = /** @type {boolean} */ (obj[key]);
  }
  return { ok: true, settings };
}
