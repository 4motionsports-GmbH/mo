// Geschenkgutscheine — the storefront API's pure rules (spec §8,
// docs/GIFT_VOUCHERS.md).
//
// The public routes under /api/gift-vouchers/* (config, fonts, photo,
// suggest, preview, drafts, balance, download) keep their decisions here, free
// of I/O and covered by gift-voucher-storefront.test.mjs:
//   · availability — does the shop sell vouchers right now, and which
//     features (AI texts, own photo, Premium-Karte) may the page offer
//   · the config JSON the voucher page loads
//   · the customer-facing texts (German; English for the /en shop)
//   · „Mit Mo formulieren“: the request, the prompt (occasion and tone only —
//     never a name or any other personal data) and the clean-up of the
//     model's answer
//   · the photo upload checks, the balance answer, the download file name
// The I/O halves: lib/gift-voucher-storefront-io.ts (state, body reading),
// lib/gift-voucher-message.ts (the model call), lib/gift-voucher-photo.ts
// (sharp + Blob). Like gift-voucher-core.mjs this module imports no Node
// built-ins.

import {
  GIFT_VOUCHER_OCCASIONS,
  GIFT_VOUCHER_TEXT_LIMITS,
  GIFT_VOUCHER_TONES,
  giftVoucherExpiryDate,
  normalizeGiftVoucherCode,
  sanitizeGiftVoucherText,
} from "./gift-voucher-core.mjs";
import { normalizeLocale, pick } from "./locale.mjs";

/** @typedef {"de" | "en"} Locale */

// ---------------------------------------------------------------------------
// Limits and constants
// ---------------------------------------------------------------------------

/** Largest photo upload (bytes) — under Vercel's 4.5 MB request cap, which answers a non-JSON 413 itself. */
export const GIFT_VOUCHER_PHOTO_MAX_BYTES = 4_000_000;
/** Request Content-Types of the raw photo upload — none CORS-safelisted. */
export const GIFT_VOUCHER_PHOTO_CONTENT_TYPES = Object.freeze(/** @type {const} */ (["image/jpeg", "image/png", "image/webp"]));
/** sharp `metadata().format` values accepted (sniffed from the bytes, never trusted from the header). */
export const GIFT_VOUCHER_PHOTO_FORMATS = Object.freeze(/** @type {const} */ (["jpeg", "png", "webp"]));
/** Largest picture (width × height) — decoding cost; sharp's limitInputPixels backs it up. */
export const GIFT_VOUCHER_PHOTO_MAX_PIXELS = 40_000_000;
/** Shortest side a photo needs — anything smaller would print as a blur. */
export const GIFT_VOUCHER_PHOTO_MIN_SIDE = 500;
/**
 * Shortest side the Premium-Karte wants (about 174 ppi on its 146 mm front
 * incl. bleed): a photo between GIFT_VOUCHER_PHOTO_MIN_SIDE and this is
 * accepted but prints soft — the page warns when the card is chosen.
 */
export const GIFT_VOUCHER_PHOTO_PRINT_MIN_SIDE = 1000;
/** Longest side of the stored photo (px); larger photos are scaled down, never up. */
export const GIFT_VOUCHER_PHOTO_MAX_SIDE = 2400;
/** Largest JSON body of the storefront routes (a draft is well under 2 KB). */
export const GIFT_VOUCHER_JSON_MAX_BYTES = 16_384;
/** The bundled font files the page may load (the voucher's handwriting font, OFL). */
export const GIFT_VOUCHER_FONT_FILES = Object.freeze(/** @type {const} */ (["caveat-500.ttf", "caveat-700.ttf"]));
/** The font of the personal message in the live preview. */
export const GIFT_VOUCHER_SCRIPT_FONT = "caveat-500.ttf";
/** „Mit Mo formulieren“: suggestions per request, their length and lines. */
export const GIFT_VOUCHER_SUGGESTION_COUNT = 3;
export const GIFT_VOUCHER_SUGGESTION_MAX_CHARS = 300;
export const GIFT_VOUCHER_SUGGESTION_MAX_LINES = 6;
/** Boxes of the design backgrounds in the config (mm proportions of the two layouts). */
export const GIFT_VOUCHER_PREVIEW_BOXES = Object.freeze({
  landscape: Object.freeze({ width: 210, height: 148 }),
  square: Object.freeze({ width: 140, height: 140 }),
});

// ---------------------------------------------------------------------------
// Customer-facing texts
// ---------------------------------------------------------------------------

const TEXT = Object.freeze({
  invalid_json: { de: "Ungültige Anfrage.", en: "Invalid request." },
  body_too_large: { de: "Die Anfrage ist zu groß.", en: "The request is too large." },
  unavailable: { de: "Gutscheine sind gerade nicht verfügbar.", en: "Gift vouchers are not available right now." },
  upstream: {
    de: "Das hat gerade nicht geklappt — bitte versuche es gleich noch einmal.",
    en: "That did not work just now — please try again in a moment.",
  },
  photo_off: {
    de: "Eigene Fotos sind gerade nicht möglich — bitte wähle ein anderes Motiv.",
    en: "Custom photos are not available right now — please choose another design.",
  },
  photo_format: {
    de: "Bitte ein Foto als JPG, PNG oder WebP hochladen.",
    en: "Please upload a photo as JPG, PNG or WebP.",
  },
  photo_too_large: { de: "Das Foto ist zu groß (höchstens 4 MB).", en: "The photo is too large (4 MB at most)." },
  photo_too_many_pixels: {
    de: "Das Foto hat zu viele Pixel (höchstens 40 Megapixel) — bitte verkleinern.",
    en: "The photo has too many pixels (40 megapixels at most) — please make it smaller.",
  },
  photo_too_small: {
    de: "Das Foto ist zu klein — es braucht mindestens 500 × 500 Pixel.",
    en: "The photo is too small — it needs at least 500 × 500 pixels.",
  },
  photo_empty: { de: "Die Datei ist leer — bitte ein Foto wählen.", en: "The file is empty — please choose a photo." },
  photo_animated: {
    de: "Animierte Bilder gehen leider nicht — bitte ein Foto wählen.",
    en: "Animated images are not supported — please choose a photo.",
  },
  photo_unreadable: {
    de: "Das Foto konnte nicht gelesen werden — bitte als JPG speichern und noch einmal versuchen.",
    en: "The photo could not be read — please save it as JPG and try again.",
  },
  photo_storage_failed: {
    de: "Das Foto konnte gerade nicht gespeichert werden — bitte versuche es noch einmal.",
    en: "The photo could not be saved just now — please try again.",
  },
  photo_missing: {
    de: "Das Foto ist nicht mehr verfügbar — bitte lade es noch einmal hoch.",
    en: "The photo is no longer available — please upload it again.",
  },
  ai_off: { de: "Textvorschläge sind gerade nicht verfügbar.", en: "Text suggestions are not available right now." },
  ai_failed: {
    de: "Mo konnte gerade keine Vorschläge schreiben — bitte versuche es gleich noch einmal.",
    en: "Mo could not write suggestions just now — please try again in a moment.",
  },
  occasion: { de: "Bitte einen Anlass wählen.", en: "Please choose an occasion." },
  tone: { de: "Bitte einen Ton wählen.", en: "Please choose a tone." },
  amount_missing: { de: "Bitte einen Betrag wählen.", en: "Please choose an amount." },
  preview_failed: {
    de: "Die Vorschau konnte gerade nicht erstellt werden — bitte versuche es noch einmal.",
    en: "The preview could not be created just now — please try again.",
  },
  code_invalid: { de: "Bitte gib einen gültigen Gutscheincode ein.", en: "Please enter a valid voucher code." },
  download_not_found: {
    de: "Dieser Download-Link ist ungültig oder nicht mehr aktiv.",
    en: "This download link is invalid or no longer active.",
  },
  download_unavailable: {
    de: "Der Gutschein kann gerade nicht erstellt werden — bitte versuche es später noch einmal.",
    en: "The voucher cannot be created right now — please try again later.",
  },
  rate_limited: {
    de: "Zu viele Anfragen — bitte versuche es in ein paar Minuten noch einmal.",
    en: "Too many requests — please try again in a few minutes.",
  },
  server_error: {
    de: "Unerwarteter Fehler — bitte versuche es später noch einmal.",
    en: "Unexpected error — please try again later.",
  },
});

/** @typedef {keyof typeof TEXT} GiftVoucherApiTextKey */

/**
 * A customer-facing text of the storefront routes, in the shop's language.
 * @param {GiftVoucherApiTextKey} key
 * @param {unknown} locale
 * @returns {string}
 */
export function giftVoucherApiText(key, locale) {
  const entry = TEXT[key];
  return entry ? pick(normalizeLocale(locale), entry) : String(key);
}

/**
 * The JSON error envelope of the storefront routes — { error: { code,
 * message } }, plus the input `field` a validation error belongs to (the page
 * marks that field).
 * @param {string} code
 * @param {string} message
 * @param {string | null} [field]
 * @returns {{ error: { code: string, message: string, field?: string } }}
 */
export function giftVoucherErrorBody(code, message, field = null) {
  return { error: field ? { code, message, field } : { code, message } };
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   enabled: boolean,
 *   settings: { salesEnabled: boolean, aiSuggestions: boolean, photoUploads: boolean },
 *   shopifyConfigured: boolean,
 *   dbConfigured: boolean,
 *   tablesReady: boolean,
 *   blobConfigured: boolean,
 *   aiConfigured: boolean,
 *   printProvider: "printone" | "manual",
 *   printOneConfigured: boolean,
 *   printSendsApproved: boolean,
 * }} GiftVoucherStorefrontInputs
 *
 * @typedef {{
 *   available: boolean,
 *   unavailableReason: "disabled" | "not_configured" | null,
 *   features: { ai: boolean, photo: boolean, print: boolean },
 * }} GiftVoucherStorefrontState
 */

/**
 * Can the Premium-Karte really be fulfilled — the rule behind the page's
 * `features.print` and the setup check: in-house
 * (GIFT_VOUCHER_PRINT_PROVIDER=manual), or by print.one, configured AND
 * released by the legal gate GIFT_VOUCHER_PRINT_SENDS_APPROVED.
 * @param {{ printProvider: "printone" | "manual", printOneConfigured: boolean, printSendsApproved: boolean }} input
 * @returns {boolean}
 */
export function isGiftVoucherPrintOffered(input) {
  return input?.printProvider === "manual" || (input?.printOneConfigured === true && input?.printSendsApproved === true);
}

/**
 * Does the shop sell vouchers right now, and what may the page offer?
 *   available — GIFT_VOUCHERS_ENABLED and the admin switch „Verkauf im Shop“
 *     (else `disabled`), Shopify, the database and migration 0083 (else
 *     `not_configured`);
 *   features.ai — ANTHROPIC_API_KEY and „KI-Textvorschläge“;
 *   features.photo — the Blob store and „Eigene Fotos“;
 *   features.print — the Premium-Karte can really be fulfilled: in-house
 *     (GIFT_VOUCHER_PRINT_PROVIDER=manual) or by print.one, configured AND
 *     released by the legal gate GIFT_VOUCHER_PRINT_SENDS_APPROVED.
 * Nothing is offered while the shop does not sell.
 * @param {GiftVoucherStorefrontInputs} input
 * @returns {GiftVoucherStorefrontState}
 */
export function giftVoucherStorefrontState(input) {
  const s = input?.settings ?? { salesEnabled: false, aiSuggestions: false, photoUploads: false };
  /** @type {"disabled" | "not_configured" | null} */
  let unavailableReason = null;
  if (input?.enabled !== true || s.salesEnabled !== true) unavailableReason = "disabled";
  else if (input.shopifyConfigured !== true || input.dbConfigured !== true || input.tablesReady !== true) {
    unavailableReason = "not_configured";
  }
  const available = unavailableReason === null;
  const printUsable = isGiftVoucherPrintOffered(input);
  return {
    available,
    unavailableReason,
    features: {
      ai: available && input.aiConfigured === true && s.aiSuggestions === true,
      photo: available && input.blobConfigured === true && s.photoUploads === true,
      print: available && printUsable,
    },
  };
}

// ---------------------------------------------------------------------------
// The config JSON
// ---------------------------------------------------------------------------

export const GIFT_VOUCHER_OCCASION_LABELS = Object.freeze({
  geburtstag: Object.freeze({ de: "Geburtstag", en: "Birthday" }),
  weihnachten: Object.freeze({ de: "Weihnachten", en: "Christmas" }),
  danke: Object.freeze({ de: "Danke", en: "Thank you" }),
  sport: Object.freeze({ de: "Sport & Training", en: "Sport & training" }),
  einfach_so: Object.freeze({ de: "Einfach so", en: "Just because" }),
});

export const GIFT_VOUCHER_TONE_LABELS = Object.freeze({
  herzlich: Object.freeze({ de: "Herzlich", en: "Warm" }),
  witzig: Object.freeze({ de: "Witzig", en: "Funny" }),
  sportlich: Object.freeze({ de: "Sportlich", en: "Sporty" }),
  kurz: Object.freeze({ de: "Kurz & knapp", en: "Short & sweet" }),
});

const DELIVERY_NOTE = Object.freeze({ de: "3–6 Werktage", en: "3–6 working days" });

const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * A calendar day ("2029-12-31") as people read it: "31.12.2029" (de) /
 * "31 December 2029" (en). Null for anything else.
 * @param {unknown} isoDate
 * @param {unknown} locale
 * @returns {string | null}
 */
export function formatGiftVoucherDate(isoDate, locale) {
  const m = typeof isoDate === "string" ? isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  if (normalizeLocale(locale) === "en") return `${Number(m[3])} ${MONTHS_EN[month - 1]} ${m[1]}`;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/**
 * @typedef {{
 *   key: string,
 *   name: { de: string, en: string },
 *   description: { de: string, en: string },
 *   photo: boolean,
 *   colors: Readonly<Record<string, string>>,
 *   defaultMessage: { de: string, en: string },
 * }} GiftVoucherDesignLike
 */

/**
 * The config the voucher page loads (GET /api/gift-vouchers/config, spec
 * §8.1): availability, the designs with their decorative backgrounds and
 * default lines (what an empty message prints) for the live preview,
 * features, text and photo limits, occasions and tones for „Mit Mo
 * formulieren“, the print countries, the validity and the font URL. Public
 * shop data only. A design whose background fails to build gets empty
 * previews instead of breaking the page.
 *
 * @param {{
 *   locale: unknown,
 *   state: GiftVoucherStorefrontState,
 *   designs: ReadonlyArray<GiftVoucherDesignLike>,
 *   backgroundSvg: (key: string, box: { width: number, height: number }) => string,
 *   validityYears: number,
 *   printCountries: readonly string[],
 *   termsUrl: string,
 *   apiBase: string,
 *   now: Date,
 * }} input
 */
export function buildGiftVoucherConfig(input) {
  const locale = normalizeLocale(input.locale);
  /** @param {string} key @param {{ width: number, height: number }} box */
  const svg = (key, box) => {
    try {
      const out = input.backgroundSvg(key, { width: box.width, height: box.height });
      return typeof out === "string" ? out : "";
    } catch {
      return "";
    }
  };
  const until = giftVoucherExpiryDate(input.now, input.validityYears);
  const L = GIFT_VOUCHER_TEXT_LIMITS;
  const apiBase = String(input.apiBase ?? "").replace(/\/+$/, "");
  return {
    ok: true,
    available: input.state.available,
    unavailableReason: input.state.unavailableReason,
    designs: input.designs.map((d) => ({
      key: d.key,
      name: pick(locale, d.name),
      description: pick(locale, d.description),
      defaultMessage: pick(locale, d.defaultMessage),
      photo: d.photo === true,
      colors: { ...d.colors },
      previewSvg: {
        landscape: svg(d.key, GIFT_VOUCHER_PREVIEW_BOXES.landscape),
        square: svg(d.key, GIFT_VOUCHER_PREVIEW_BOXES.square),
      },
    })),
    features: { ...input.state.features },
    limits: {
      recipientName: L.recipientName,
      senderName: L.senderName,
      message: L.message,
      messageLines: L.messageLines,
      photoMaxBytes: GIFT_VOUCHER_PHOTO_MAX_BYTES,
      photoPrintMinSide: GIFT_VOUCHER_PHOTO_PRINT_MIN_SIDE,
    },
    occasions: GIFT_VOUCHER_OCCASIONS.map((key) => ({ key, label: pick(locale, GIFT_VOUCHER_OCCASION_LABELS[key]) })),
    tones: GIFT_VOUCHER_TONES.map((key) => ({ key, label: pick(locale, GIFT_VOUCHER_TONE_LABELS[key]) })),
    print: { countries: [...input.printCountries], deliveryNote: pick(locale, DELIVERY_NOTE) },
    validity: { years: until ? input.validityYears : 0, untilExample: formatGiftVoucherDate(until, locale) },
    termsUrl: input.termsUrl,
    fonts: { script: `${apiBase}/api/gift-vouchers/fonts/${GIFT_VOUCHER_SCRIPT_FONT}` },
  };
}

/**
 * Is this one of the bundled font files the font route serves? (A strict
 * allowlist — the name never becomes part of a path otherwise.)
 * @param {unknown} name
 * @returns {name is "caveat-500.ttf" | "caveat-700.ttf"}
 */
export function isGiftVoucherFontFile(name) {
  return typeof name === "string" && /** @type {readonly string[]} */ (GIFT_VOUCHER_FONT_FILES).includes(name);
}

// ---------------------------------------------------------------------------
// Request bodies and uploads
// ---------------------------------------------------------------------------

/** @param {unknown} v @returns {Record<string, unknown> | null} */
function asObject(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : null;
}

/**
 * The language of a request: the body's `locale` when it has one, else the
 * request's (?locale= / x-ms-locale, resolved by the route), else German.
 * @param {Record<string, unknown> | null} body
 * @param {unknown} fallback
 * @returns {Locale}
 */
function bodyLocale(body, fallback) {
  const v = body?.locale;
  return normalizeLocale(v != null && v !== "" ? v : fallback);
}

/**
 * A draft or preview body with its `locale` settled — the body's ("en-GB" →
 * "en"), else the request's — before the core validators read it (they know
 * only "de" | "en"). The body's locale decides the language of the preview
 * and of the validation messages; the issued voucher, its mail and its PDF
 * follow the order's customer_locale (spec §9). Anything that is not an
 * object stays as it is.
 * @param {unknown} body
 * @param {unknown} [fallbackLocale]
 * @returns {unknown}
 */
export function withGiftVoucherLocale(body, fallbackLocale = "de") {
  const b = asObject(body);
  return b ? { ...b, locale: bodyLocale(b, fallbackLocale) } : body;
}

/**
 * The declared request size from a Content-Length header: a whole number of
 * bytes, or null when the header is absent or unparsable (a chunked body —
 * the size read is checked again then).
 * @param {unknown} raw
 * @returns {number | null}
 */
export function parseContentLength(raw) {
  if (typeof raw === "number") return Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!/^\d{1,15}$/.test(s)) return null;
  return Number(s);
}

/**
 * @typedef {"format" | "too_large" | "too_many_pixels" | "too_small" | "empty" | "animated" | "unreadable"
 *   | "not_configured" | "storage_failed"} GiftVoucherPhotoErrorCode
 */

const PHOTO_ERRORS = Object.freeze({
  format: { status: 415, text: "photo_format" },
  too_large: { status: 413, text: "photo_too_large" },
  too_many_pixels: { status: 413, text: "photo_too_many_pixels" },
  too_small: { status: 400, text: "photo_too_small" },
  empty: { status: 400, text: "photo_empty" },
  animated: { status: 400, text: "photo_animated" },
  unreadable: { status: 400, text: "photo_unreadable" },
  not_configured: { status: 503, text: "photo_off" },
  storage_failed: { status: 502, text: "photo_storage_failed" },
});

/**
 * A photo upload error with its HTTP status and the customer's text.
 * @param {GiftVoucherPhotoErrorCode} code
 * @param {unknown} locale
 * @returns {{ ok: false, code: GiftVoucherPhotoErrorCode, status: number, message: string }}
 */
export function giftVoucherPhotoError(code, locale) {
  const e = PHOTO_ERRORS[code] ?? PHOTO_ERRORS.unreadable;
  return {
    ok: false,
    code: PHOTO_ERRORS[code] ? code : "unreadable",
    status: e.status,
    message: giftVoucherApiText(/** @type {GiftVoucherApiTextKey} */ (e.text), locale),
  };
}

/**
 * Check the photo request before reading its body: the Content-Type must be
 * JPEG, PNG or WebP (the bytes are sniffed again later), the declared size
 * 1 byte … 4 MB. An absent size passes (the read is capped).
 * @param {{ contentType?: string | null, contentLength?: string | number | null }} r
 * @returns {{ ok: true } | { ok: false, code: GiftVoucherPhotoErrorCode }}
 */
export function checkGiftVoucherPhotoRequest(r) {
  const type = String(r?.contentType ?? "").split(";")[0].trim().toLowerCase();
  if (!/** @type {readonly string[]} */ (GIFT_VOUCHER_PHOTO_CONTENT_TYPES).includes(type)) return { ok: false, code: "format" };
  const n = parseContentLength(r?.contentLength);
  if (n === 0) return { ok: false, code: "empty" };
  if (n !== null && n > GIFT_VOUCHER_PHOTO_MAX_BYTES) return { ok: false, code: "too_large" };
  return { ok: true };
}

/**
 * Check a decoded photo header. `width`/`height` are the ORIENTED size (EXIF
 * rotation applied). Only still JPEG, PNG and WebP; at most 40 megapixels; at
 * least 500 px on the shorter side.
 * @param {{ format?: string | null, width?: number | null, height?: number | null, pages?: number | null }} img
 * @returns {{ ok: true } | { ok: false, code: GiftVoucherPhotoErrorCode }}
 */
export function checkGiftVoucherPhotoImage(img) {
  const format = String(img?.format ?? "").toLowerCase();
  if (!/** @type {readonly string[]} */ (GIFT_VOUCHER_PHOTO_FORMATS).includes(format)) return { ok: false, code: "format" };
  if (Number(img?.pages ?? 1) > 1) return { ok: false, code: "animated" };
  const w = Number(img?.width);
  const h = Number(img?.height);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) return { ok: false, code: "unreadable" };
  if (w * h > GIFT_VOUCHER_PHOTO_MAX_PIXELS) return { ok: false, code: "too_many_pixels" };
  if (Math.min(w, h) < GIFT_VOUCHER_PHOTO_MIN_SIDE) return { ok: false, code: "too_small" };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// „Mit Mo formulieren“ — AI text suggestions
// ---------------------------------------------------------------------------

/**
 * The suggestion request (POST /api/gift-vouchers/suggest): `occasion` and
 * `tone` from the fixed lists (missing → „Einfach so“ / „Herzlich“, unknown →
 * error), `locale` (else `fallbackLocale`). Nothing else is read — no names
 * reach the model.
 * @param {unknown} body
 * @param {unknown} [fallbackLocale]
 * @returns {{ ok: true, value: { occasion: string, tone: string, locale: Locale } }
 *   | { ok: false, field: string, message: string, locale: Locale }}
 */
export function parseGiftVoucherSuggestInput(body, fallbackLocale = "de") {
  const b = asObject(body);
  const locale = bodyLocale(b, fallbackLocale);
  if (!b) return { ok: false, field: "body", message: giftVoucherApiText("invalid_json", locale), locale };
  const occasion = b.occasion == null || b.occasion === "" ? "einfach_so" : b.occasion;
  if (typeof occasion !== "string" || !/** @type {readonly string[]} */ (GIFT_VOUCHER_OCCASIONS).includes(occasion)) {
    return { ok: false, field: "occasion", message: giftVoucherApiText("occasion", locale), locale };
  }
  const tone = b.tone == null || b.tone === "" ? "herzlich" : b.tone;
  if (typeof tone !== "string" || !/** @type {readonly string[]} */ (GIFT_VOUCHER_TONES).includes(tone)) {
    return { ok: false, field: "tone", message: giftVoucherApiText("tone", locale), locale };
  }
  return { ok: true, value: { occasion, tone, locale } };
}

const OCCASION_BRIEF = Object.freeze({
  geburtstag: { de: "zum Geburtstag", en: "for a birthday" },
  weihnachten: { de: "zu Weihnachten", en: "for Christmas" },
  danke: { de: "als Dankeschön", en: "as a thank-you" },
  sport: {
    de: "für jemanden, der gern trainiert oder ein sportliches Ziel hat",
    en: "for someone who loves to train or has a sporting goal",
  },
  einfach_so: { de: "einfach so, ohne besonderen Anlass", en: "just because, without a special occasion" },
});

const TONE_BRIEF = Object.freeze({
  herzlich: { de: "herzlich und warm", en: "warm and heartfelt" },
  witzig: {
    de: "witzig, mit einem Augenzwinkern — nie albern und nie auf Kosten der beschenkten Person",
    en: "funny, with a wink — never silly and never at the recipient's expense",
  },
  sportlich: { de: "sportlich, motivierend und voller Energie", en: "sporty, motivating and full of energy" },
  kurz: {
    de: "kurz und knapp — außer der Anrede ein bis zwei Sätze, zusammen höchstens 120 Zeichen",
    en: "short and sweet — apart from the greeting one or two sentences, 120 characters at most in total",
  },
});

const SYSTEM_DE = [
  "Du schreibst persönliche Grußtexte für Geschenkgutscheine von motion sports, einem Shop für Fitnessgeräte und Trainingszubehör.",
  "Wer den Gutschein verschenkt, übernimmt einen deiner Texte als Nachricht auf der Karte.",
  "",
  "Regeln für jeden Vorschlag:",
  "- Deutsch, Du-Form, warm und natürlich — wie von einem Menschen geschrieben.",
  "- Höchstens 300 Zeichen und höchstens 6 Zeilen.",
  "- Die erste Zeile ist nur die Anrede mit dem Platzhalter {{fuer}} für den Namen der beschenkten Person, z. B. „Hallo {{fuer}},“ oder „Hey {{fuer}}!“. Der eigentliche Text beginnt in der zweiten Zeile.",
  "- {{fuer}} kommt nur in dieser Anrede vor. Schreib nie echte oder erfundene Namen.",
  "- Keine Grußformel und keine Unterschrift am Ende: Der Name der schenkenden Person ({{von}}) wird automatisch unter den Text gedruckt.",
  "- Keine Emojis, keine Hashtags, keine Preise, Beträge oder Rabatte, keine Versprechen, keine Werbeaussagen über motion sports oder Produkte.",
  "- Keine Anführungszeichen um den ganzen Text.",
  "- Die drei Vorschläge unterscheiden sich deutlich voneinander.",
  "",
  "Antworte nur mit dem JSON-Objekt: vorschlaege = Liste mit genau drei Texten, Zeilenumbrüche als echte Zeilenumbrüche.",
].join("\n");

const SYSTEM_EN = [
  "You write personal greeting texts for gift vouchers from motion sports, a shop for fitness equipment and training gear.",
  "The person giving the voucher uses one of your texts as the message on the card.",
  "",
  "Rules for every suggestion:",
  "- English, informal (“you”), warm and natural — as if written by a person.",
  "- At most 300 characters and at most 6 lines.",
  "- The first line is only the greeting with the placeholder {{fuer}} for the recipient's name, e.g. “Hi {{fuer}},” or “Hey {{fuer}}!”. The message itself starts on the second line.",
  "- {{fuer}} appears only in that greeting. Never write real or made-up names.",
  "- No closing phrase and no signature: the giver's name ({{von}}) is printed below the text automatically.",
  "- No emojis, no hashtags, no prices, amounts or discounts, no promises, no advertising claims about motion sports or products.",
  "- No quotation marks around the whole text.",
  "- The three suggestions are clearly different from each other.",
  "",
  "Answer only with the JSON object: vorschlaege = a list of exactly three texts, line breaks as real line breaks.",
].join("\n");

/**
 * The prompt of „Mit Mo formulieren“: the rules (system) and the occasion and
 * tone (prompt). Built from the two fixed keys and the locale only.
 * @param {{ occasion: string, tone: string, locale: unknown }} input
 * @returns {{ system: string, prompt: string }}
 */
export function giftVoucherSuggestionPrompt(input) {
  const locale = normalizeLocale(input?.locale);
  const occasion = OCCASION_BRIEF[/** @type {keyof typeof OCCASION_BRIEF} */ (input?.occasion)] ?? OCCASION_BRIEF.einfach_so;
  const tone = TONE_BRIEF[/** @type {keyof typeof TONE_BRIEF} */ (input?.tone)] ?? TONE_BRIEF.herzlich;
  if (locale === "en") {
    return {
      system: SYSTEM_EN,
      prompt: `Occasion: a gift voucher ${occasion.en}.\nTone: ${tone.en}.\nWrite three suggestions.`,
    };
  }
  return {
    system: SYSTEM_DE,
    prompt: `Anlass: ein Gutschein ${occasion.de}.\nTon: ${tone.de}.\nSchreib drei Vorschläge.`,
  };
}

const PLACEHOLDER_FOR = "{{fuer}}";
const PLACEHOLDER_FROM = "{{von}}";
// What models write instead of the exact placeholders: spaces inside, other
// case, „für“ with an umlaut.
const PLACEHOLDER_VARIANTS = /\{\{\s*(f(?:ue|ü)r|von)\s*\}\}/giu;
const QUOTE_PAIRS = [
  ["„", "“"],
  ["“", "”"],
  ['"', '"'],
  ["»", "«"],
  ["«", "»"],
  ["‚", "‘"],
];

/** Remove quotation marks around the whole text (models like to add them). @param {string} s */
function unwrapQuotes(s) {
  const t = s.trim();
  for (const [open, close] of QUOTE_PAIRS) {
    if (t.length > open.length + close.length && t.startsWith(open) && t.endsWith(close)) {
      const inner = t.slice(open.length, t.length - close.length);
      if (!inner.includes(open) && !inner.includes(close)) return inner.trim();
    }
  }
  return t;
}

/**
 * A greeting and the text on one line („Hallo {{fuer}}, alles Gute …“) → two
 * lines: the page drops a line whose placeholder stays empty, and that must
 * never take the message with it.
 * @param {string} s
 */
function splitGreeting(s) {
  const nl = s.indexOf("\n");
  const first = nl === -1 ? s : s.slice(0, nl);
  const rest = nl === -1 ? "" : s.slice(nl);
  const m = first.match(/^([^\n]{0,40}?\{\{fuer\}\}[,!:])[ \t]+(\S.*)$/u);
  return m ? `${m[1]}\n${m[2]}${rest}` : s;
}

/**
 * Drop a closing line that signs with the giver ({{von}}): the card prints
 * the giver's name under the message anyway.
 * @param {string} s
 */
function dropSignature(s) {
  const lines = s.split("\n");
  while (lines.length > 1) {
    const last = lines[lines.length - 1].trim();
    if (last === "" || (last.includes(PLACEHOLDER_FROM) && Array.from(last).length <= 40)) lines.pop();
    else break;
  }
  return lines.join("\n");
}

/**
 * Cut a text to `max` characters at a sentence end (when that keeps at least
 * half of it), else at a word boundary with "…".
 * @param {string} s
 * @param {number} max
 */
function cutAtBoundary(s, max) {
  const points = Array.from(s);
  if (points.length <= max) return s;
  const head = points.slice(0, max).join("");
  const sentenceEnd = Math.max(...[". ", "! ", "? ", ".\n", "!\n", "?\n", "…\n", "… "].map((p) => head.lastIndexOf(p)));
  if (sentenceEnd >= max / 2) return head.slice(0, sentenceEnd + 1).trimEnd();
  const space = Math.max(head.lastIndexOf(" "), head.lastIndexOf("\n"));
  const cut = (space >= max / 2 ? head.slice(0, space) : Array.from(head).slice(0, max - 1).join("")).replace(/[\s,;:–—-]+$/u, "");
  return `${cut}…`;
}

/**
 * Clean the model's suggestions before they reach the page: only strings;
 * literal "\n" turned into line breaks; placeholder variants normalised to
 * {{fuer}} / {{von}}; texts with any other {…} or {{…}} dropped (the page
 * could not fill them and would print the braces); quotes around the
 * whole text removed; the greeting on its own line; a signature line with
 * {{von}} dropped; made printable (sanitizeGiftVoucherText — emoji and
 * characters the fonts cannot draw are removed); at most `maxLines` lines and
 * `maxChars` characters (cut at a sentence or word); empty texts and
 * duplicates dropped; at most `count`.
 * @param {unknown} raw
 * @param {{ count?: number, maxChars?: number, maxLines?: number }} [options]
 * @returns {string[]}
 */
export function cleanGiftVoucherSuggestions(
  raw,
  {
    count = GIFT_VOUCHER_SUGGESTION_COUNT,
    maxChars = GIFT_VOUCHER_SUGGESTION_MAX_CHARS,
    maxLines = GIFT_VOUCHER_SUGGESTION_MAX_LINES,
  } = {}
) {
  if (!Array.isArray(raw)) return [];
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (out.length >= count) break;
    if (typeof item !== "string") continue;
    let s = item.replace(/\\n/g, "\n").replace(PLACEHOLDER_VARIANTS, (_m, name) =>
      String(name).toLowerCase() === "von" ? PLACEHOLDER_FROM : PLACEHOLDER_FOR
    );
    if (/[{}]/u.test(s.replace(/\{\{(?:fuer|von)\}\}/g, ""))) continue; // another placeholder or a stray brace
    s = unwrapQuotes(s);
    s = splitGreeting(s);
    s = dropSignature(s);
    let text = sanitizeGiftVoucherText(s, { max: Infinity, maxLines }).text;
    text = cutAtBoundary(text, maxChars);
    if (!text || text.replace(/\{\{(?:fuer|von)\}\}/g, "").replace(/[\s\p{P}]/gu, "") === "") continue;
    const key = text.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Balance check
// ---------------------------------------------------------------------------

/**
 * The balance request (POST /api/gift-vouchers/balance): { code } as typed
 * (any case, spaces, hyphens) → the bare code, or a validation error.
 * @param {unknown} body
 * @param {unknown} [fallbackLocale]
 * @returns {{ ok: true, code: string, locale: Locale } | { ok: false, field: string, message: string, locale: Locale }}
 */
export function parseGiftVoucherBalanceInput(body, fallbackLocale = "de") {
  const b = asObject(body);
  const locale = bodyLocale(b, fallbackLocale);
  const code = typeof b?.code === "string" && b.code.length <= 64 ? normalizeGiftVoucherCode(b.code) : null;
  if (!code) return { ok: false, field: "code", message: giftVoucherApiText("code_invalid", locale), locale };
  return { ok: true, code, locale };
}

const BERLIN_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * The calendar day in Europe/Berlin (the shop's day) of an instant, "YYYY-MM-DD".
 * @param {Date} now
 * @returns {string}
 */
export function berlinDate(now) {
  const parts = Object.fromEntries(BERLIN_DAY.formatToParts(now).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** @param {unknown} v @returns {string | null} */
function isoDay(v) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/** @param {unknown} v @returns {number | null} */
function cents(v) {
  return typeof v === "number" && Number.isSafeInteger(v) ? Math.max(0, v) : null;
}

/**
 * @typedef {{ ok: true, found: false }
 *   | { ok: true, found: true, balanceCents: number, amountCents: number, currency: "EUR", expiresOn: string | null,
 *       state: "active" | "used" | "expired" | "deactivated" }} GiftVoucherBalanceAnswer
 */

/**
 * The answer of the balance check. Only vouchers the shop really handed out
 * count (status issued or deactivated) — every other voucher, like an
 * unknown code, is `found: false` and nothing else. The live Shopify card
 * (when it could be read) wins over the stored values: balance, expiry, and
 * a card deactivated in Shopify. State: deactivated > used (nothing left) >
 * expired (after the expiry day, Berlin) > active.
 * @param {{
 *   voucher: { status: string, amountCents: number, balanceCents: number | null, expiresOn: string | null } | null,
 *   live?: { balanceCents: number, expiresOn: string | null, enabled: boolean, deactivatedAt: string | null } | null,
 *   today: string,
 * }} input
 * @returns {GiftVoucherBalanceAnswer}
 */
export function giftVoucherBalanceAnswer(input) {
  const v = input?.voucher;
  if (!v || (v.status !== "issued" && v.status !== "deactivated")) return { ok: true, found: false };
  const live = input.live ?? null;
  const amountCents = cents(v.amountCents) ?? 0;
  const balanceCents = cents(live?.balanceCents) ?? cents(v.balanceCents) ?? amountCents;
  const expiresOn = live ? isoDay(live.expiresOn) : isoDay(v.expiresOn);
  /** @type {"active" | "used" | "expired" | "deactivated"} */
  let state = "active";
  if (v.status === "deactivated" || (live && (live.enabled === false || Boolean(live.deactivatedAt)))) state = "deactivated";
  else if (balanceCents <= 0) state = "used";
  else if (expiresOn && isoDay(input.today) && input.today > expiresOn) state = "expired";
  return { ok: true, found: true, balanceCents, amountCents, currency: "EUR", expiresOn, state };
}

// ---------------------------------------------------------------------------
// Download link
// ---------------------------------------------------------------------------

/**
 * Could this be a download token (newOpaqueToken, base64url)? Checked before
 * anything is looked up.
 * @param {unknown} s
 * @returns {s is string}
 */
export function isValidGiftVoucherDownloadToken(s) {
  return typeof s === "string" && /^[A-Za-z0-9_-]{24,64}$/.test(s);
}

/**
 * The file name of the downloaded PDF: "Gutschein-G-2026-00042.pdf"
 * ("Gutschein.pdf" when the number is not a voucher number).
 * @param {unknown} number
 * @returns {string}
 */
export function giftVoucherPdfFilename(number) {
  return typeof number === "string" && /^G-\d{4}-\d{5,15}$/.test(number) ? `Gutschein-${number}.pdf` : "Gutschein.pdf";
}
