// Geschenkgutscheine (gift vouchers) — the pure rules (docs/GIFT_VOUCHERS.md).
//
// Everything here is pure: randomness and time are injected, there is no I/O,
// and node:test covers it (gift-voucher-core.test.mjs). The I/O halves are
// lib/gift-voucher-store.ts (database), lib/gift-voucher-issue.ts (issuing),
// lib/gift-voucher-print.ts (Premium-Karte) and the routes.
//
// Contents:
//   · vocabulary + German labels (statuses, reasons, hold reasons, print
//     statuses, attention keys) — the admin screen shows these words
//   · codes: generation (32 symbols, unbiased), formatting, normalising, the
//     sha256 lookup hash, opaque tokens (drafts, print assets, photos), the
//     download token derived per mail attempt
//   · money: exact decimal ⇄ cents, "50,00 €"
//   · voucher number G-<Berlin year>-<id> and the expiry date
//   · the orders/paid payload → voucher and print lines, refunds, pairing
//   · decisions: issue / hold / defer / cancel, manual issuing, retry plan,
//     print-job status order
//   · input hygiene: printable text (fonts cannot draw emoji), postal
//     address, the storefront draft
//
// This module is also imported for its labels by client components, so it
// must not import Node built-ins: the sha256 helper loads node:crypto lazily
// on the server (process.getBuiltinModule), randomness uses Web Crypto.

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** @typedef {"pending" | "held" | "issuing" | "issued" | "failed" | "rejected" | "cancelled" | "deactivated"} GiftVoucherStatusKey */
/** @typedef {"review" | "queued" | "submitting" | "submitted" | "printing" | "sent" | "failed" | "cancelled" | "done"} PrintJobStatusKey */

export const GIFT_VOUCHER_STATUSES = Object.freeze(
  /** @type {const} */ (["pending", "held", "issuing", "issued", "failed", "rejected", "cancelled", "deactivated"])
);
export const GIFT_VOUCHER_SOURCES = Object.freeze(/** @type {const} */ (["shop", "admin"]));
export const GIFT_VOUCHER_REASONS = Object.freeze(
  /** @type {const} */ (["verkauf", "kulanz", "marketing", "gewinnspiel", "firmengeschenk", "sonstiges"])
);
/** The reasons an operator can pick when issuing by hand (a sale only comes from the shop). */
export const GIFT_VOUCHER_MANUAL_REASONS = Object.freeze(
  /** @type {const} */ (["kulanz", "marketing", "gewinnspiel", "firmengeschenk", "sonstiges"])
);
export const GIFT_VOUCHER_DELIVERIES = Object.freeze(/** @type {const} */ (["pdf", "print", "email"]));
export const GIFT_VOUCHER_MAIL_STATUSES = Object.freeze(
  /** @type {const} */ (["none", "pending", "sent", "failed", "skipped"])
);
export const PRINT_JOB_STATUSES = Object.freeze(
  /** @type {const} */ (["review", "queued", "submitting", "submitted", "printing", "sent", "failed", "cancelled", "done"])
);
/** A print job in one of these is finished: nothing is submitted, polled or printed any more. */
export const PRINT_JOB_FINAL_STATUSES = Object.freeze(/** @type {const} */ (["sent", "failed", "cancelled", "done"]));
export const GIFT_VOUCHER_DESIGN_KEYS = Object.freeze(
  /** @type {const} */ (["classic", "birthday", "christmas", "thanks", "training", "photo"])
);
export const GIFT_VOUCHER_OCCASIONS = Object.freeze(
  /** @type {const} */ (["geburtstag", "weihnachten", "danke", "sport", "einfach_so"])
);
export const GIFT_VOUCHER_TONES = Object.freeze(/** @type {const} */ (["herzlich", "witzig", "sportlich", "kurz"]));

/** The private cart line property that links a voucher (and its print add-on) to its draft. */
export const GIFT_VOUCHER_DRAFT_PROPERTY = "_mo_gv";

/** Character / line limits of the texts (storefront, admin, print). */
export const GIFT_VOUCHER_TEXT_LIMITS = Object.freeze({
  recipientName: 40,
  senderName: 40,
  message: 350,
  messageLines: 8,
  addressName: 60,
  addressLine: 80,
  city: 60,
});

/** Private Blob prefixes (lib/gift-voucher-blob.ts writes nothing else). */
export const GIFT_VOUCHER_PHOTO_PREFIX = "gift-voucher-photos/";
export const GIFT_VOUCHER_PRINT_PREFIX = "gift-voucher-print/";

export const GIFT_VOUCHER_STATUS_LABELS = Object.freeze({
  pending: "Wartet",
  held: "Zu prüfen",
  issuing: "Wird ausgestellt",
  issued: "Ausgestellt",
  failed: "Fehler",
  rejected: "Abgelehnt",
  cancelled: "Storniert",
  deactivated: "Gesperrt",
});

export const GIFT_VOUCHER_HOLD_REASON_LABELS = Object.freeze({
  disabled: "Gutscheine sind ausgeschaltet",
  test_order: "Testbestellung",
  currency: "Fremdwährung",
  discounted: "Rabatt auf den Gutschein angewendet",
  amount: "Betrag außerhalb der Grenzen",
  risk: "Shopify meldet ein Betrugsrisiko",
  daily_limit: "Tageslimit erreicht",
  not_paid: "Nicht vollständig bezahlt",
  refunded: "Bestellung (teilweise) erstattet",
  attempts: "Zu viele Fehlversuche",
});

export const GIFT_VOUCHER_REASON_LABELS = Object.freeze({
  verkauf: "Verkauf",
  kulanz: "Kulanz",
  marketing: "Marketing",
  gewinnspiel: "Gewinnspiel",
  firmengeschenk: "Firmengeschenk",
  sonstiges: "Sonstiges",
});

export const PRINT_JOB_STATUS_LABELS = Object.freeze({
  review: "Zu prüfen",
  queued: "Wartet",
  submitting: "Wird übermittelt",
  submitted: "Übermittelt",
  printing: "Im Druck",
  sent: "Versendet",
  failed: "Fehler",
  cancelled: "Storniert",
  done: "Erledigt (manuell)",
});

export const GIFT_VOUCHER_ATTENTION_LABELS = Object.freeze({
  refund_after_use: "Erstattet, aber schon (teilweise) eingelöst",
  cancelled_after_use: "Storniert, aber schon (teilweise) eingelöst",
  print_without_voucher: "Druck bezahlt, aber kein Gutschein in der Bestellung",
  print_without_address: "Druck bezahlt, aber keine Adresse",
  deactivate_failed: "Sperren in Shopify fehlgeschlagen",
  print_cancel_too_late: "Druckauftrag ließ sich nicht mehr stornieren",
  unknown_product_line: "Bestellzeile mit Gutschein-Entwurf auf unbekanntem Produkt",
  // The acknowledged revoke flags (gift-voucher-issue-core.mjs GIFT_VOUCHER_REVOKE_ACK_ATTENTION):
  // kept on the row, but no „Achtung“ any more.
  refund_after_use_ok: "Erstattet, eingelöst — geklärt",
  cancelled_after_use_ok: "Storniert, eingelöst — geklärt",
});

/** @param {unknown} v @returns {v is GiftVoucherStatusKey} */
export function isGiftVoucherStatus(v) {
  return typeof v === "string" && /** @type {readonly string[]} */ (GIFT_VOUCHER_STATUSES).includes(v);
}

/** @param {unknown} v @returns {v is PrintJobStatusKey} */
export function isPrintJobStatus(v) {
  return typeof v === "string" && /** @type {readonly string[]} */ (PRINT_JOB_STATUSES).includes(v);
}

// ---------------------------------------------------------------------------
// Randomness, hashing, tokens
// ---------------------------------------------------------------------------

/** @param {number} n @returns {Uint8Array} */
function webRandomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

/**
 * node:crypto, loaded lazily — a static import would break the client
 * components that import this module for its labels. Server only.
 * @returns {typeof import("node:crypto")}
 */
function nodeCrypto() {
  const proc = /** @type {{ getBuiltinModule?: (id: string) => unknown } | undefined} */ (globalThis.process);
  const mod = proc && typeof proc.getBuiltinModule === "function" ? proc.getBuiltinModule("node:crypto") : null;
  if (!mod) throw new Error("node:crypto is not available here (server only)");
  return /** @type {typeof import("node:crypto")} */ (mod);
}

/** 32 symbols without the look-alikes 0/O and 1/I — `byte % 32` is unbiased. */
export const GIFT_VOUCHER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const GIFT_VOUCHER_CODE_LENGTH = 16;

/**
 * A new gift-card code: 16 symbols (80 bits), upper-case, no separators — the
 * form Shopify accepts (8–20 letters and digits). Never logged.
 * @param {(n: number) => Uint8Array} [randomBytes]
 * @returns {string}
 */
export function generateGiftVoucherCode(randomBytes = webRandomBytes) {
  const bytes = randomBytes(GIFT_VOUCHER_CODE_LENGTH);
  if (!bytes || bytes.length < GIFT_VOUCHER_CODE_LENGTH) throw new Error("randomBytes returned too few bytes");
  let out = "";
  for (let i = 0; i < GIFT_VOUCHER_CODE_LENGTH; i++) out += GIFT_VOUCHER_CODE_ALPHABET[bytes[i] % 32];
  return out;
}

// Spaces (incl. NBSP and the thin ones), hyphens and dashes, dots, zero-width
// characters — what people type or paste between the groups of a code.
const CODE_SEPARATORS = /[\s\-.\u{2010}-\u{2015}\u{2212}\u{200b}-\u{200d}\u{2060}\u{feff}]/gu;

/**
 * Display form: groups of four, upper-case ("ABCD EFGH JKLM NPQR").
 * @param {unknown} code
 * @returns {string}
 */
export function formatGiftVoucherCode(code) {
  const s = String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return (s.match(/.{1,4}/g) ?? []).join(" ");
}

/**
 * A code as typed (any case, with spaces, hyphens or dots between groups) →
 * the bare upper-case code, or null unless it is 8–20 letters and digits.
 * @param {unknown} input
 * @returns {string | null}
 */
export function normalizeGiftVoucherCode(input) {
  if (typeof input !== "string") return null;
  const s = input.replace(CODE_SEPARATORS, "").toUpperCase();
  return /^[A-Z0-9]{8,20}$/.test(s) ? s : null;
}

/**
 * Lookup hash of a code: sha256 hex of the normalised, lower-cased code (the
 * case Shopify returns). Null for something that is not a code. Server only.
 * @param {unknown} code
 * @returns {string | null}
 */
export function giftVoucherCodeHash(code) {
  const normalized = normalizeGiftVoucherCode(code);
  if (!normalized) return null;
  return nodeCrypto().createHash("sha256").update(normalized.toLowerCase(), "utf8").digest("hex");
}

/**
 * The last four characters (upper-case) — the only part of a code that may be
 * shown or searched for. Null for something that is not a code.
 * @param {unknown} code
 * @returns {string | null}
 */
export function giftVoucherCodeLast4(code) {
  const normalized = normalizeGiftVoucherCode(code);
  return normalized ? normalized.slice(-4) : null;
}

/**
 * sha256 hex of an opaque token (download links, print assets) — tokens are
 * bearer secrets, so only their hash is stored. Server only.
 * @param {string} token
 * @returns {string}
 */
export function hashOpaqueToken(token) {
  return nodeCrypto().createHash("sha256").update(String(token), "utf8").digest("hex");
}

/** @param {Uint8Array} bytes */
function base64Url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * An unguessable URL-safe token (base64url): draft tokens and print-asset
 * tokens (24 bytes → 32 characters), photo ids (16 bytes → 22 characters).
 * (Download tokens are derived per mail attempt: giftVoucherDownloadToken.)
 * @param {number} [bytes]
 * @param {(n: number) => Uint8Array} [randomBytes]
 * @returns {string}
 */
export function newOpaqueToken(bytes = 24, randomBytes = webRandomBytes) {
  const n = Number.isInteger(bytes) && bytes >= 16 && bytes <= 48 ? bytes : 24;
  const raw = randomBytes(n);
  if (!raw || raw.length < n) throw new Error("randomBytes returned too few bytes");
  return base64Url(raw.subarray(0, n));
}

/**
 * The download token of one mail attempt — the link in the voucher mail.
 * Derived, not drawn: HMAC-SHA256 over `${voucherId}|${mailAttempts}|${code}`
 * keyed by sha256(`gift-voucher-download|${secret}`) (the AES key
 * TOKEN_ENC_KEY never keys an HMAC directly); the first 24 bytes as
 * base64url = 32 characters, the shape isValidGiftVoucherDownloadToken
 * accepts. The same attempt always gives the same token, so a repeat of a
 * send (a worker died after Resend took the mail) rebuilds the link the
 * delivered mail carries; every concluded attempt (mail_attempts + 1)
 * rotates it. The code is part of the message: the key alone forges no link.
 * Throws on an empty secret. Server only.
 * @param {{ secret: string, voucherId: number, mailAttempts: number, code: string }} input
 * @returns {string}
 */
export function giftVoucherDownloadToken({ secret, voucherId, mailAttempts, code }) {
  if (typeof secret !== "string" || secret.length === 0) throw new Error("giftVoucherDownloadToken: no secret (TOKEN_ENC_KEY)");
  const attempt = Number.isSafeInteger(mailAttempts) && mailAttempts >= 0 ? mailAttempts : 0;
  const c = nodeCrypto();
  const key = c.createHash("sha256").update(`gift-voucher-download|${secret}`, "utf8").digest();
  const mac = c.createHmac("sha256", key).update(`${voucherId}|${attempt}|${code}`, "utf8").digest();
  return base64Url(mac.subarray(0, 24));
}

/** @param {unknown} s @returns {s is string} */
export function isValidDraftToken(s) {
  return typeof s === "string" && /^[A-Za-z0-9_-]{24,64}$/.test(s);
}

/** @param {unknown} s @returns {s is string} */
export function isValidPhotoId(s) {
  return typeof s === "string" && /^[A-Za-z0-9_-]{22,64}$/.test(s);
}

/**
 * The private Blob pathname of an uploaded photo, or null for an invalid id.
 * @param {unknown} photoId
 * @returns {string | null}
 */
export function giftVoucherPhotoPathname(photoId) {
  return isValidPhotoId(photoId) ? `${GIFT_VOUCHER_PHOTO_PREFIX}${photoId}.jpg` : null;
}

/**
 * The photo id back from a stored pathname, or null.
 * @param {unknown} pathname
 * @returns {string | null}
 */
export function giftVoucherPhotoIdFromPathname(pathname) {
  if (typeof pathname !== "string" || !pathname.startsWith(GIFT_VOUCHER_PHOTO_PREFIX)) return null;
  const m = pathname.slice(GIFT_VOUCHER_PHOTO_PREFIX.length).match(/^([A-Za-z0-9_-]{22,64})\.jpg$/);
  return m ? m[1] : null;
}

/**
 * Photo bytes that count as a photo: a non-empty Buffer / Uint8Array. A read
 * that answered 200 with an empty body is no photo.
 * @param {unknown} bytes
 * @returns {bytes is Uint8Array}
 */
export function hasGiftVoucherPhotoBytes(bytes) {
  return bytes instanceof Uint8Array && bytes.length > 0;
}

/**
 * A photo voucher („Eigenes Foto“, with a stored photo pathname) whose photo
 * could not be read — missing, unreadable or empty. Such a voucher is never
 * delivered (PDF, mail attachment, print files): the „Klassisch“ look would
 * stand in for the customer's photo, so the caller refuses or retries. Any
 * other design, or one without a pathname, never counts.
 * @param {{ designKey: string, photoPathname: string | null } | null | undefined} voucher
 * @param {unknown} photo  the bytes loadGiftVoucherPhoto returned
 * @returns {boolean}
 */
export function isGiftVoucherPhotoUnavailable(voucher, photo) {
  return voucher?.designKey === "photo" && Boolean(voucher.photoPathname) && !hasGiftVoucherPhotoBytes(photo);
}

// ---------------------------------------------------------------------------
// Dates and numbers
// ---------------------------------------------------------------------------

/** @param {unknown} value @returns {Date | null} */
function toDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

const BERLIN_YEAR = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", year: "numeric" });

/**
 * The calendar year in Europe/Berlin (the shop's year) of an instant.
 * @param {Date | string | number} date
 * @returns {number | null}
 */
export function berlinYear(date) {
  const d = toDate(date);
  return d ? Number(BERLIN_YEAR.format(d)) : null;
}

/**
 * The last day a voucher is valid: 31 December of (the Berlin year it was
 * issued + `years`) — the regular German limitation period runs to the end of
 * a year (§§ 195, 199 BGB). `years` 0 (or less) = never expires → null.
 * @param {Date | string | number} issuedAt
 * @param {number} years
 * @returns {string | null} YYYY-MM-DD
 */
export function giftVoucherExpiryDate(issuedAt, years) {
  if (!Number.isFinite(years) || years <= 0) return null;
  const year = berlinYear(issuedAt);
  if (year == null) return null;
  return `${year + Math.floor(years)}-12-31`;
}

/**
 * The voucher number people see: G-<Berlin year of creation>-<id, 5 digits>,
 * e.g. G-2026-00042. Null for an invalid id or date.
 * @param {unknown} id
 * @param {Date | string | number} createdAt
 * @returns {string | null}
 */
export function formatGiftVoucherNumber(id, createdAt) {
  const n = typeof id === "string" && /^\d+$/.test(id) ? Number(id) : id;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n <= 0) return null;
  const year = berlinYear(createdAt);
  if (year == null) return null;
  return `G-${year}-${String(n).padStart(5, "0")}`;
}

/**
 * A voucher number as typed ("G-2026-00042", "g 2026 42") → the id, or null.
 * The year is not checked (it only repeats the creation date).
 * @param {unknown} str
 * @returns {number | null}
 */
export function parseGiftVoucherNumber(str) {
  if (typeof str !== "string") return null;
  const m = str.trim().match(/^G[\s-]*(\d{4})[\s-]*(\d{1,15})$/i);
  if (!m) return null;
  const id = Number(m[2]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * An exact decimal amount → integer cents: "50.00" → 5000, "50" → 5000,
 * "49.9" → 4990, 50 → 5000, "-10.0" → -1000. More than two decimals only when
 * the extra digits are zeros. Null for anything else (never rounds silently).
 * @param {unknown} value
 * @returns {number | null}
 */
export function decimalToCents(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const cents = Math.round(value * 100);
    if (Math.abs(value * 100 - cents) > 1e-6 || !Number.isSafeInteger(cents)) return null;
    return cents === 0 ? 0 : cents;
  }
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  const fraction = m[3] ?? "";
  if (fraction.length > 2 && !/^0+$/.test(fraction.slice(2))) return null;
  const cents = Number(m[2]) * 100 + Number(fraction.slice(0, 2).padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return null;
  return m[1] === "-" && cents !== 0 ? -cents : cents;
}

/**
 * Integer cents → a decimal string for APIs ("50.00"). Non-integers are
 * rounded; a non-number gives "0.00" (which Shopify refuses as a card value).
 * @param {unknown} cents
 * @returns {string}
 */
export function centsToDecimalString(cents) {
  const n = typeof cents === "number" && Number.isFinite(cents) ? Math.round(cents) : 0;
  const abs = Math.abs(n);
  return `${n < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** @param {number} whole @param {string} sep */
function groupThousands(whole, sep) {
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/**
 * Cents as people read them: "50,00 €" (de) / "€50.00" (en); with
 * `compact`, whole amounts drop the decimals ("50 €" / "€50"). Plain spaces,
 * no Intl (the same bytes on every runtime and in every font).
 * @param {unknown} cents
 * @param {string} [locale] "de" (default) | "en"
 * @param {{ compact?: boolean }} [options]
 * @returns {string}
 */
export function formatEuro(cents, locale = "de", { compact = false } = {}) {
  const n = typeof cents === "number" && Number.isFinite(cents) ? Math.round(cents) : 0;
  const abs = Math.abs(n);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  const sign = n < 0 ? "-" : "";
  const showFrac = !(compact && abs % 100 === 0);
  if (locale === "en") return `${sign}€${groupThousands(whole, ",")}${showFrac ? `.${frac}` : ""}`;
  return `${sign}${groupThousands(whole, ".")}${showFrac ? `,${frac}` : ""} €`;
}

// ---------------------------------------------------------------------------
// The orders/paid payload
// ---------------------------------------------------------------------------

/**
 * A Shopify id as a numeric string, from a number, a digit string or a GID
 * (the rule of shopify-customer-map.mjs numericShopifyId, kept local so this
 * module stays free of that import chain).
 * @param {unknown} value
 * @returns {string | null}
 */
function numericId(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  const s = String(value).trim();
  if (/^\d+$/.test(s)) return s;
  const m = s.match(/^gid:\/\/shopify\/\w+\/(\d+)(?:\?.*)?$/);
  return m ? m[1] : null;
}

/** @param {unknown} v @returns {Record<string, unknown> | null} */
function asObject(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : null;
}

/** @param {unknown} v @returns {string | null} */
function str(v) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

/** @param {unknown} v @returns {string | null} */
function emailOrNull(v) {
  const s = str(v);
  if (!s) return null;
  const e = s.toLowerCase();
  return isPlausibleEmail(e) ? e : null;
}

/**
 * A plausible e-mail address (one at-sign, a dot in the domain, no spaces, ≤ 254).
 * @param {unknown} v
 * @returns {boolean}
 */
export function isPlausibleEmail(v) {
  return typeof v === "string" && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/.test(v);
}

/**
 * Shop-currency amount of a money set ({ shop_money: { amount } }) with the
 * plain field as fallback.
 * @param {unknown} set
 * @param {unknown} plain
 * @returns {number | null}
 */
function shopMoneyCents(set, plain) {
  const shop = asObject(asObject(set)?.shop_money);
  const fromSet = shop ? decimalToCents(shop.amount) : null;
  return fromSet ?? decimalToCents(plain);
}

/**
 * The draft token of a line: the private property _mo_gv, when it is a valid
 * token. Order payloads carry properties as [{ name, value }]; an object map
 * (cart shape) is accepted too.
 * @param {unknown} properties
 * @returns {string | null}
 */
function draftTokenOf(properties) {
  let raw = null;
  if (Array.isArray(properties)) {
    for (const p of properties) {
      const o = asObject(p);
      if (o && o.name === GIFT_VOUCHER_DRAFT_PROPERTY) raw = o.value;
    }
  } else {
    const o = asObject(properties);
    if (o) raw = o[GIFT_VOUCHER_DRAFT_PROPERTY];
  }
  const token = typeof raw === "string" ? raw.trim() : null;
  return isValidDraftToken(token) ? token : null;
}

/** @param {Iterable<unknown> | null | undefined} ids */
function idSet(ids) {
  const out = new Set();
  if (ids && typeof (/** @type {any} */ (ids))[Symbol.iterator] === "function") {
    for (const id of ids) {
      const n = numericId(id);
      if (n) out.add(n);
    }
  }
  return out;
}

/**
 * @typedef {{
 *   id: string, gid: string, name: string | null, email: string | null, test: boolean,
 *   financialStatus: string | null, cancelledAt: string | null, shopifyCustomerId: string | null,
 *   customerName: string | null, currency: string | null, presentmentCurrency: string | null, locale: "de" | "en",
 * }} GiftVoucherOrderInfo
 * @typedef {{
 *   lineItemId: string, productId: string, variantId: string | null, title: string | null,
 *   variantTitle: string | null, quantity: number, unitCents: number | null, discountCents: number,
 *   draftToken: string | null,
 * }} GiftVoucherOrderLine
 * @typedef {{ lineItemId: string, quantity: number, unitCents: number | null, draftToken: string | null }} GiftVoucherPrintLine
 * @typedef {{
 *   order: GiftVoucherOrderInfo, vouchers: GiftVoucherOrderLine[], prints: GiftVoucherPrintLine[],
 *   unmatchedDraftLines: string[],
 * }} GiftVoucherOrderExtract
 */

/**
 * The units a line still holds: its `quantity`, or `current_quantity` when
 * that is smaller (Shopify: the quantity minus the units removed by an order
 * edit — at orders/paid time a unit removed before payment was never paid).
 * @param {Record<string, unknown>} li
 * @returns {number}
 */
function lineUnits(li) {
  const quantity = typeof li.quantity === "number" && Number.isSafeInteger(li.quantity) ? li.quantity : 0;
  const current = li.current_quantity;
  return typeof current === "number" && Number.isSafeInteger(current) && current >= 0 ? Math.min(quantity, current) : quantity;
}

/**
 * The voucher-relevant part of an orders/paid (REST) payload. Lines are
 * recognised by PRODUCT id (resolved from the product handles); the _mo_gv
 * property only links a line to its draft. Amounts come from the line's
 * shop-currency price — never from a property. `quantity` is the number of
 * units the line still holds (lineUnits: never more than current_quantity;
 * refunds are handled separately, refundedQuantities); a line with none is
 * skipped. A paid line that carries a valid draft token but is neither the
 * voucher nor the print product (the theme sells another product than Mo's
 * handles name, or a stale product id) is listed in `unmatchedDraftLines` —
 * it is never treated as a voucher (its price is no voucher price). The
 * order's `presentmentCurrency` is the currency the buyer paid in (shop
 * money is back-converted from it). Ids are read from the GraphQL ids where
 * present (exact digits; a JSON number above 2^53 would lose them). Null
 * when the payload has no order id.
 *
 * @param {unknown} payload
 * @param {{ voucherProductIds?: Iterable<unknown> | null, printProductIds?: Iterable<unknown> | null }} [productIds]
 * @returns {GiftVoucherOrderExtract | null}
 */
export function extractGiftVoucherOrder(payload, { voucherProductIds = [], printProductIds = [] } = {}) {
  const p = asObject(payload);
  if (!p) return null;
  const id = numericId(p.admin_graphql_api_id) ?? numericId(p.id);
  if (!id) return null;

  const customer = asObject(p.customer);
  const billing = asObject(p.billing_address);
  const fullName = (/** @type {Record<string, unknown> | null} */ o) =>
    o ? str([str(o.first_name), str(o.last_name)].filter(Boolean).join(" ")) : null;
  const locale = /** @type {"de" | "en"} */ (
    typeof p.customer_locale === "string" && p.customer_locale.trim().toLowerCase().startsWith("en") ? "en" : "de"
  );
  const order = {
    id,
    gid: `gid://shopify/Order/${id}`,
    name: str(p.name),
    email: emailOrNull(p.email) ?? emailOrNull(p.contact_email) ?? emailOrNull(customer?.email),
    test: p.test === true,
    financialStatus: str(p.financial_status)?.toLowerCase() ?? null,
    cancelledAt: str(p.cancelled_at),
    shopifyCustomerId: customer ? numericId(customer.admin_graphql_api_id) ?? numericId(customer.id) : null,
    customerName: fullName(customer) ?? str(billing?.name) ?? fullName(billing),
    currency: str(p.currency)?.toUpperCase() ?? null,
    presentmentCurrency: str(p.presentment_currency)?.toUpperCase() ?? null,
    locale,
  };

  const voucherIds = idSet(voucherProductIds);
  const printIds = idSet(printProductIds);
  /** @type {GiftVoucherOrderLine[]} */
  const vouchers = [];
  /** @type {GiftVoucherPrintLine[]} */
  const prints = [];
  /** @type {string[]} */
  const unmatchedDraftLines = [];
  for (const raw of Array.isArray(p.line_items) ? p.line_items : []) {
    const li = asObject(raw);
    if (!li) continue;
    const lineItemId = numericId(li.admin_graphql_api_id) ?? numericId(li.id);
    const quantity = lineUnits(li);
    if (quantity <= 0) continue;
    // The token first: a draft on a product Mo does not know must not vanish.
    const draftToken = draftTokenOf(li.properties);
    const productId = numericId(li.product_id);
    const isVoucher = productId !== null && voucherIds.has(productId);
    const isPrint = !isVoucher && productId !== null && printIds.has(productId);
    if (!isVoucher && !isPrint) {
      if (draftToken) unmatchedDraftLines.push(lineItemId ?? "?");
      continue;
    }
    if (!lineItemId || !productId) continue;
    const unitCents = shopMoneyCents(li.price_set, li.price);
    if (isPrint) {
      prints.push({ lineItemId, quantity, unitCents, draftToken });
      continue;
    }
    // Discounts on the voucher line: the allocations (Shopify's preferred
    // source) and the deprecated total — the larger counts, so a discount is
    // never missed because one of the two fields is empty.
    let fromAllocations = 0;
    for (const a of Array.isArray(li.discount_allocations) ? li.discount_allocations : []) {
      const o = asObject(a);
      const c = o ? shopMoneyCents(o.amount_set, o.amount) : null;
      if (c != null && c > 0) fromAllocations += c;
    }
    const fromTotal = shopMoneyCents(li.total_discount_set, li.total_discount) ?? 0;
    vouchers.push({
      lineItemId,
      productId,
      variantId: numericId(li.variant_id),
      title: str(li.title),
      variantTitle: str(li.variant_title),
      quantity,
      unitCents,
      discountCents: Math.max(fromAllocations, fromTotal, 0),
      draftToken,
    });
  }
  return { order, vouchers, prints, unmatchedDraftLines };
}

/**
 * Which print add-on line pays for which voucher unit: a print line with
 * draft token T covers up to its quantity of the voucher units with token T,
 * in order (voucher lines in payload order, units 0…quantity-1). Lines
 * without a token cannot be paired. Print lines (or parts) left over are
 * returned with the number of cards they paid for but found no voucher.
 *
 * @param {Array<{ lineItemId: string, quantity: number, draftToken: string | null }>} vouchers
 * @param {Array<{ lineItemId: string, quantity: number, draftToken: string | null }>} prints
 * @returns {{ units: Array<{ lineItemId: string, unitIndex: number, printLineItemId: string | null }>, unmatchedPrints: Array<{ lineItemId: string, missing: number }> }}
 */
export function pairPrintLines(vouchers, prints) {
  /** @type {Array<{ lineItemId: string, unitIndex: number, printLineItemId: string | null, token: string | null }>} */
  const units = [];
  for (const v of Array.isArray(vouchers) ? vouchers : []) {
    const q = Number.isSafeInteger(v?.quantity) && v.quantity > 0 ? v.quantity : 0;
    for (let i = 0; i < q; i++) {
      units.push({ lineItemId: v.lineItemId, unitIndex: i, printLineItemId: null, token: v.draftToken ?? null });
    }
  }
  /** @type {Array<{ lineItemId: string, missing: number }>} */
  const unmatchedPrints = [];
  for (const pl of Array.isArray(prints) ? prints : []) {
    const q = Number.isSafeInteger(pl?.quantity) && pl.quantity > 0 ? pl.quantity : 0;
    let covered = 0;
    if (pl.draftToken) {
      for (const u of units) {
        if (covered >= q) break;
        if (u.printLineItemId === null && u.token === pl.draftToken) {
          u.printLineItemId = pl.lineItemId;
          covered++;
        }
      }
    }
    if (covered < q) unmatchedPrints.push({ lineItemId: pl.lineItemId, missing: q - covered });
  }
  return {
    units: units.map(({ lineItemId, unitIndex, printLineItemId }) => ({ lineItemId, unitIndex, printLineItemId })),
    unmatchedPrints,
  };
}

/**
 * Refunded quantity per line item id, summed over every refund of an order
 * payload (refunds[].refund_line_items[]).
 * @param {unknown} payload
 * @returns {Map<string, number>}
 */
export function refundedQuantities(payload) {
  /** @type {Map<string, number>} */
  const out = new Map();
  const p = asObject(payload);
  for (const r of Array.isArray(p?.refunds) ? p.refunds : []) {
    const refund = asObject(r);
    for (const raw of Array.isArray(refund?.refund_line_items) ? refund.refund_line_items : []) {
      const rli = asObject(raw);
      if (!rli) continue;
      const lineItemId = numericId(asObject(rli.line_item)?.admin_graphql_api_id) ?? numericId(rli.line_item_id);
      const qty = rli.quantity;
      if (!lineItemId || typeof qty !== "number" || !Number.isSafeInteger(qty) || qty <= 0) continue;
      out.set(lineItemId, (out.get(lineItemId) ?? 0) + qty);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

/**
 * What to do with one voucher unit of a shop order, checked in this order:
 * cancelled → cancel(order_cancelled); feature off → hold(disabled); test
 * order → hold(test_order) unless allowed; not fully paid → defer(not_paid);
 * currency ≠ EUR → hold(currency); a discount on the line → hold(discounted);
 * unit price outside the limits → hold(amount); risk HIGH or recommendation
 * CANCEL / INVESTIGATE → hold(risk); risk still PENDING → defer(risk_pending)
 * until the wait expired; today's issued sum + this unit above the daily
 * limit (0 = none) → hold(daily_limit); else issue.
 *
 * @param {{
 *   enabled: boolean, allowTestOrders: boolean,
 *   order: { test?: boolean, cancelled?: boolean, fullyPaid?: boolean | null, financialStatus?: string | null,
 *            currency?: string | null, riskLevel?: string | null, riskRecommendation?: string | null },
 *   line: { unitCents: number | null, discountCents?: number | null },
 *   limits: { minCents: number, maxCents: number, dailyLimitCents: number },
 *   issuedTodayCents: number, riskWaitExpired: boolean,
 * }} input
 * @returns {{ action: "issue" | "hold" | "defer" | "cancel", reason: string | null }}
 */
export function decideGiftVoucherIssue(input) {
  const order = input?.order ?? {};
  const line = input?.line ?? { unitCents: null };
  const limits = input?.limits ?? { minCents: 0, maxCents: 0, dailyLimitCents: 0 };
  if (order.cancelled === true) return { action: "cancel", reason: "order_cancelled" };
  if (input?.enabled !== true) return { action: "hold", reason: "disabled" };
  if (order.test === true && input.allowTestOrders !== true) return { action: "hold", reason: "test_order" };
  const status = typeof order.financialStatus === "string" ? order.financialStatus.toLowerCase() : "";
  const paid =
    typeof order.fullyPaid === "boolean" ? order.fullyPaid : status === "paid" || status === "partially_refunded";
  if (!paid) return { action: "defer", reason: "not_paid" };
  if (String(order.currency ?? "").toUpperCase() !== "EUR") return { action: "hold", reason: "currency" };
  const discount = typeof line.discountCents === "number" && Number.isFinite(line.discountCents) ? line.discountCents : 0;
  if (discount > 0) return { action: "hold", reason: "discounted" };
  const unit = line.unitCents;
  if (typeof unit !== "number" || !Number.isSafeInteger(unit) || unit < limits.minCents || unit > limits.maxCents) {
    return { action: "hold", reason: "amount" };
  }
  const level = String(order.riskLevel ?? "").toUpperCase();
  const recommendation = String(order.riskRecommendation ?? "").toUpperCase();
  if (level === "HIGH" || recommendation === "CANCEL" || recommendation === "INVESTIGATE") {
    return { action: "hold", reason: "risk" };
  }
  if (level === "PENDING" && input.riskWaitExpired !== true) return { action: "defer", reason: "risk_pending" };
  const daily = limits.dailyLimitCents;
  const issuedToday = Number.isFinite(input.issuedTodayCents) ? input.issuedTodayCents : 0;
  if (typeof daily === "number" && daily > 0 && issuedToday + unit > daily) return { action: "hold", reason: "daily_limit" };
  return { action: "issue", reason: null };
}

/**
 * The daily limit as the hard cap of the issuing reservation
 * (markGiftVoucherIssuing): the limit in cents when it is a positive safe
 * integer, else 0 = no cap (an operator's voucher, an override, no limit).
 * Any limit GIFT_VOUCHER_DAILY_LIMIT_EUR can express is passed on unchanged
 * — 99 999 999 € (9 999 999 900 cents, "practically none") is far beyond the
 * int4 range, so the database compares the cap as BIGINT, never as int.
 * @param {unknown} dailyLimitCents
 * @returns {number}
 */
export function giftVoucherReservationCapCents(dailyLimitCents) {
  return typeof dailyLimitCents === "number" && Number.isSafeInteger(dailyLimitCents) && dailyLimitCents > 0 ? dailyLimitCents : 0;
}

/**
 * Check a voucher an operator issues by hand (German messages). Marketing
 * vouchers are PDF only — Mo neither mails nor posts advertising without a
 * consent; e-mail delivery needs an address, the card a printable address.
 *
 * @param {{
 *   amountCents: unknown, reason: unknown, delivery: unknown, recipientEmail?: unknown, address?: unknown,
 *   adminMaxCents: number, printCountries?: readonly string[], designKey?: unknown, minCents?: number,
 * }} input
 * @returns {{ ok: true } | { ok: false, field: string, message: string }}
 */
export function decideManualGiftVoucher(input) {
  /** @param {unknown} v @param {number} fallback */
  const positiveInt = (v, fallback) => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : fallback);
  const max = positiveInt(input?.adminMaxCents, 0);
  const min = positiveInt(input?.minCents, 100);
  const amount = input?.amountCents;
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < min || amount > max) {
    return {
      ok: false,
      field: "amountCents",
      message: `Bitte einen Betrag zwischen ${formatEuro(min)} und ${formatEuro(Math.max(max, min))} angeben.`,
    };
  }
  if (typeof input.reason !== "string" || !/** @type {readonly string[]} */ (GIFT_VOUCHER_MANUAL_REASONS).includes(input.reason)) {
    return { ok: false, field: "reason", message: "Bitte einen Anlass wählen." };
  }
  if (input.designKey !== undefined) {
    if (typeof input.designKey !== "string" || !/** @type {readonly string[]} */ (GIFT_VOUCHER_DESIGN_KEYS).includes(input.designKey)) {
      return { ok: false, field: "designKey", message: "Bitte ein Motiv wählen." };
    }
    if (input.designKey === "photo") {
      return { ok: false, field: "designKey", message: "„Eigenes Foto“ gibt es nur im Shop — bitte ein anderes Motiv wählen." };
    }
  }
  if (typeof input.delivery !== "string" || !/** @type {readonly string[]} */ (GIFT_VOUCHER_DELIVERIES).includes(input.delivery)) {
    return { ok: false, field: "delivery", message: "Bitte eine Versandart wählen." };
  }
  if (input.reason === "marketing" && input.delivery !== "pdf") {
    return {
      ok: false,
      field: "delivery",
      message: "Marketing-Gutscheine gibt es nur als PDF — Mo verschickt Werbung nicht ohne Einwilligung per E-Mail oder Post.",
    };
  }
  if (input.delivery === "email") {
    const email = typeof input.recipientEmail === "string" ? input.recipientEmail.trim().toLowerCase() : "";
    if (!isPlausibleEmail(email)) {
      return { ok: false, field: "recipientEmail", message: "Bitte eine gültige E-Mail-Adresse angeben." };
    }
  }
  if (input.delivery === "print") {
    const a = validatePostalAddress(input.address, { countries: input.printCountries ?? ["DE"], locale: "de" });
    if (!a.ok) return a;
  }
  return { ok: true };
}

const RETRY_PLAN_MINUTES = Object.freeze([1, 2, 5, 15, 30, 60, 120, 240, 480, 720]);

/**
 * Minutes until the next try after `attempts` failed tries (counting the one
 * that just failed): 1, 2, 5, 15, 30, 60, 120, 240, 480, 720 for the first
 * ten — null from the eleventh on, so after ten retries the eleventh failed
 * try is the last (the voucher is held with reason `attempts`, a mail turns
 * `failed`).
 * @param {number} attempts
 * @returns {number | null}
 */
export function planGiftVoucherRetry(attempts) {
  const n = Number.isFinite(attempts) ? Math.floor(attempts) : 1;
  if (n > RETRY_PLAN_MINUTES.length) return null;
  return RETRY_PLAN_MINUTES[Math.max(1, n) - 1];
}

/** Progress order of a print job; the final statuses rank last. */
export const PRINT_JOB_STATUS_RANK = Object.freeze({
  review: 0,
  queued: 1,
  submitting: 2,
  submitted: 3,
  printing: 4,
  sent: 5,
  done: 6,
  failed: 7,
  cancelled: 8,
});

/**
 * May a print job move from `from` to `to`? Forward only along review →
 * queued → submitting → submitted → printing → sent (a late webhook never
 * moves a job back); `failed` / `cancelled` only from an unfinished job;
 * `done` (printed in-house) only from review, queued or failed. A finished
 * job never changes, and a job never "moves" to its own status.
 * @param {unknown} from
 * @param {unknown} to
 * @returns {boolean}
 */
export function canAdvancePrintJobStatus(from, to) {
  if (!isPrintJobStatus(from) || !isPrintJobStatus(to) || from === to) return false;
  if (to === "done") return from === "review" || from === "queued" || from === "failed";
  if (/** @type {readonly string[]} */ (PRINT_JOB_FINAL_STATUSES).includes(from)) return false;
  if (to === "failed" || to === "cancelled") return true;
  return PRINT_JOB_STATUS_RANK[to] > PRINT_JOB_STATUS_RANK[from];
}

/** @param {unknown} status */
export function isFinalPrintJobStatus(status) {
  return typeof status === "string" && /** @type {readonly string[]} */ (PRINT_JOB_FINAL_STATUSES).includes(status);
}

// ---------------------------------------------------------------------------
// Text hygiene
// ---------------------------------------------------------------------------

// Look-alikes mapped before the repertoire check (no `removed` flag for these).
const SPACE_LIKE = /[\t\u{a0}\u{1680}\u{2000}-\u{200a}\u{202f}\u{205f}\u{3000}]/gu;
const HYPHEN_LIKE = /[\u{2010}\u{2011}\u{2212}]/gu;
// Invisible / formatting characters dropped silently: soft hyphen, combining
// grapheme joiner, Mongolian vowel separator, zero-width and bidi controls,
// word joiners, BOM, variation selectors, tag characters.
const INVISIBLE =
  /[\u{ad}\u{34f}\u{180e}\u{200b}-\u{200f}\u{202a}-\u{202e}\u{2060}-\u{2064}\u{2066}-\u{2069}\u{fe00}-\u{fe0f}\u{feff}\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/gu;
// C0 / C1 control characters except the newline.
const CONTROLS = /[\u{0}-\u{9}\u{b}-\u{1f}\u{7f}-\u{9f}]/gu;

/** Extra characters of the printable repertoire beyond Latin-1 and Latin Extended-A. */
const PRINTABLE_EXTRA = new Set([0x20ac, 0x201e, 0x201c, 0x201d, 0x201a, 0x2018, 0x2019, 0x2013, 0x2014, 0x2026, 0x2022, 0x2039, 0x203a]);

/**
 * Can the voucher fonts draw this code point? Basic Latin, Latin-1
 * Supplement, Latin Extended-A without the long s ſ (U+017F — the
 * handwriting font Caveat has no glyph for it), plus € „ “ ” ‚ ‘ ’ – — … • ‹ ›.
 * @param {number} cp
 */
function isPrintableCodePoint(cp) {
  return (
    (cp >= 0x20 && cp <= 0x7e) ||
    (cp >= 0xa0 && cp <= 0x17f && cp !== 0xad && cp !== 0x17f) ||
    PRINTABLE_EXTRA.has(cp)
  );
}

/**
 * Make a customer-written text printable: NFC, controls and invisible
 * characters out (a newline stays only when `maxLines` > 1), space-like
 * characters → space, runs of spaces collapsed, lines trimmed, at most one
 * empty line in a row, lines beyond `maxLines` joined onto the last one, cut
 * to `max` characters (code points, never inside a pair). Every character
 * the fonts cannot draw — emoji above all — is REMOVED and reported
 * (`removed`), so the page can tell the customer.
 *
 * @param {unknown} raw
 * @param {{ max?: number, maxLines?: number }} [options]
 * @returns {{ text: string, removed: boolean, truncated: boolean }}
 */
export function sanitizeGiftVoucherText(raw, { max = GIFT_VOUCHER_TEXT_LIMITS.message, maxLines = 1 } = {}) {
  if (typeof raw !== "string" || raw === "") return { text: "", removed: false, truncated: false };
  const multiLine = Number.isFinite(maxLines) && maxLines > 1;
  let s = raw.normalize("NFC").replace(/\r\n?|[\u{2028}\u{2029}\u{85}]/gu, "\n");
  s = s.replace(SPACE_LIKE, " ").replace(HYPHEN_LIKE, "-").replace(INVISIBLE, "").replace(CONTROLS, "");
  if (!multiLine) s = s.replace(/\n/g, " ");

  let removed = false;
  let kept = "";
  for (const ch of s) {
    const cp = /** @type {number} */ (ch.codePointAt(0));
    if (ch === "\n" || isPrintableCodePoint(cp)) kept += ch;
    else removed = true;
  }

  let lines = kept.split("\n").map((l) => l.replace(/ {2,}/g, " ").trim());
  // At most one empty line in a row; none at the start or the end.
  lines = lines.filter((l, i) => l !== "" || (i > 0 && lines[i - 1] !== ""));
  while (lines.length && lines[0] === "") lines.shift();
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  const limit = multiLine ? Math.floor(maxLines) : 1;
  if (lines.length > limit) {
    const tail = lines.slice(limit - 1).filter(Boolean).join(" ");
    lines = [...lines.slice(0, limit - 1), tail];
  }
  let text = lines.join("\n");

  const cap = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : Infinity;
  const points = Array.from(text);
  let truncated = false;
  if (points.length > cap) {
    text = points.slice(0, cap).join("").trimEnd();
    truncated = true;
  }
  return { text, removed, truncated };
}

/** @typedef {"de" | "en"} GiftVoucherLocale */

/** @param {unknown} v @returns {GiftVoucherLocale} */
function localeOf(v) {
  return v === "en" ? "en" : "de";
}

/**
 * @typedef {{ name: string, address_line_1: string, address_line_2: string | null, postal_code: string, city: string, country: string }} GiftVoucherAddressJson
 * @typedef {{ name: string, addressLine1: string, addressLine2: string | null, postalCode: string, city: string, country: string }} GiftVoucherAddressFields
 */

const ADDRESS_TEXT = {
  missing: { de: "Bitte eine Adresse angeben.", en: "Please enter an address." },
  name: { de: "Bitte den Namen für die Adresse angeben.", en: "Please enter the recipient's name." },
  nameLong: { de: "Der Name darf höchstens 60 Zeichen haben.", en: "The name may have at most 60 characters." },
  line1: { de: "Bitte Straße und Hausnummer angeben.", en: "Please enter the street and house number." },
  line1Long: {
    de: "Straße und Hausnummer dürfen höchstens 80 Zeichen haben.",
    en: "Street and house number may have at most 80 characters.",
  },
  line2Long: { de: "Der Adresszusatz darf höchstens 80 Zeichen haben.", en: "The address addition may have at most 80 characters." },
  postal: { de: "Bitte eine gültige Postleitzahl angeben.", en: "Please enter a valid postcode." },
  postalDe: { de: "Bitte eine gültige Postleitzahl (5 Ziffern) angeben.", en: "Please enter a valid postcode (5 digits)." },
  city: { de: "Bitte den Ort angeben.", en: "Please enter the town or city." },
  cityLong: { de: "Der Ort darf höchstens 60 Zeichen haben.", en: "The town or city may have at most 60 characters." },
  countryDe: {
    de: "Die Karte kann nur innerhalb Deutschlands verschickt werden.",
    en: "We can only send the card within Germany.",
  },
  country: { de: "In dieses Land können wir die Karte nicht verschicken.", en: "We cannot send the card to this country." },
  chars: {
    de: "Die Adresse enthält Zeichen, die wir nicht drucken können.",
    en: "The address contains characters we cannot print.",
  },
};

/**
 * Check a postal address for the Premium-Karte. Accepts the storefront's
 * camelCase shape ({ name, line1, line2, postalCode, city, country }) and the
 * stored snake_case shape; returns the snake_case shape of
 * customers.postal_address. Never shortens or alters an address silently:
 * too long or unprintable → an error (`field` is "address.<field>").
 *
 * @param {unknown} input
 * @param {{ countries?: readonly string[], locale?: string }} [options]
 * @returns {{ ok: true, address: GiftVoucherAddressJson } | { ok: false, field: string, message: string }}
 */
export function validatePostalAddress(input, { countries = ["DE"], locale = "de" } = {}) {
  const loc = localeOf(locale);
  /** @param {string} field @param {keyof typeof ADDRESS_TEXT} key */
  const fail = (field, key) => ({ ok: /** @type {const} */ (false), field, message: ADDRESS_TEXT[key][loc] });
  const a = asObject(input);
  if (!a) return fail("address", "missing");
  const allowed = (Array.isArray(countries) ? countries : [])
    .map((c) => (typeof c === "string" ? c.trim().toUpperCase() : ""))
    .filter((c) => /^[A-Z]{2}$/.test(c));
  if (allowed.length === 0) allowed.push("DE");

  /** @param {unknown} v */
  const clean = (v) => sanitizeGiftVoucherText(typeof v === "string" ? v : "", { max: Infinity, maxLines: 1 });
  const fields = {
    name: clean(a.name),
    line1: clean(a.line1 ?? a.addressLine1 ?? a.address_line_1),
    line2: clean(a.line2 ?? a.addressLine2 ?? a.address_line_2),
    postalCode: clean(a.postalCode ?? a.postal_code ?? a.zip),
    city: clean(a.city),
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value.removed) return fail(`address.${key}`, "chars");
  }
  const L = GIFT_VOUCHER_TEXT_LIMITS;
  const len = (/** @type {string} */ s) => Array.from(s).length;
  if (!fields.name.text) return fail("address.name", "name");
  if (len(fields.name.text) > L.addressName) return fail("address.name", "nameLong");
  if (!fields.line1.text || !/\d/.test(fields.line1.text)) return fail("address.line1", "line1");
  if (len(fields.line1.text) > L.addressLine) return fail("address.line1", "line1Long");
  if (len(fields.line2.text) > L.addressLine) return fail("address.line2", "line2Long");

  const rawCountry = typeof a.country === "string" ? a.country.trim().toUpperCase() : "";
  const country = rawCountry || (allowed.length === 1 ? allowed[0] : "");
  if (!allowed.includes(country)) {
    return fail("address.country", allowed.length === 1 && allowed[0] === "DE" ? "countryDe" : "country");
  }
  const postal = fields.postalCode.text.replace(/\s+/g, country === "DE" ? "" : " ").toUpperCase();
  if (country === "DE" ? !/^\d{5}$/.test(postal) : !/^[A-Z0-9][A-Z0-9 -]{1,9}$/.test(postal)) {
    return fail("address.postalCode", country === "DE" ? "postalDe" : "postal");
  }
  if (!fields.city.text) return fail("address.city", "city");
  if (len(fields.city.text) > L.city) return fail("address.city", "cityLong");
  return {
    ok: true,
    address: {
      name: fields.name.text,
      address_line_1: fields.line1.text,
      address_line_2: fields.line2.text || null,
      postal_code: postal,
      city: fields.city.text,
      country,
    },
  };
}

/**
 * The stored snake_case address JSON → the camelCase fields of the store
 * types, or null when a required part is missing.
 * @param {unknown} json
 * @returns {GiftVoucherAddressFields | null}
 */
export function giftVoucherAddressFromJson(json) {
  const a = asObject(json);
  if (!a) return null;
  const name = str(a.name);
  const addressLine1 = str(a.address_line_1);
  const postalCode = str(a.postal_code);
  const city = str(a.city);
  const country = str(a.country)?.toUpperCase() ?? null;
  if (!name || !addressLine1 || !postalCode || !city || !country) return null;
  return { name, addressLine1, addressLine2: str(a.address_line_2), postalCode, city, country };
}

/**
 * camelCase fields (store types) or an already snake_case object → the
 * snake_case JSON stored in recipient_postal_address; null when incomplete.
 * @param {unknown} address
 * @returns {GiftVoucherAddressJson | null}
 */
export function giftVoucherAddressToJson(address) {
  const a = asObject(address);
  if (!a) return null;
  const fields = giftVoucherAddressFromJson({
    name: a.name,
    address_line_1: a.addressLine1 ?? a.address_line_1 ?? a.line1,
    address_line_2: a.addressLine2 ?? a.address_line_2 ?? a.line2,
    postal_code: a.postalCode ?? a.postal_code,
    city: a.city,
    country: a.country,
  });
  if (!fields) return null;
  return {
    name: fields.name,
    address_line_1: fields.addressLine1,
    address_line_2: fields.addressLine2,
    postal_code: fields.postalCode,
    city: fields.city,
    country: fields.country,
  };
}

const DRAFT_TEXT = {
  body: { de: "Ungültige Anfrage.", en: "Invalid request." },
  design: { de: "Bitte ein Motiv wählen.", en: "Please choose a design." },
  photoOff: {
    de: "Eigene Fotos sind gerade nicht möglich — bitte ein anderes Motiv wählen.",
    en: "Custom photos are not available right now — please choose another design.",
  },
  photoMissing: { de: "Bitte lade ein Foto hoch.", en: "Please upload a photo." },
  photoInvalid: {
    de: "Das Foto ist nicht mehr verfügbar — bitte lade es noch einmal hoch.",
    en: "The photo is no longer available — please upload it again.",
  },
  amount: { de: "Ungültiger Betrag.", en: "Invalid amount." },
  text: { de: "Ungültiger Text.", en: "Invalid text." },
  recipientLong: { de: "„Für“ darf höchstens 40 Zeichen haben.", en: "“For” may have at most 40 characters." },
  senderLong: { de: "„Von“ darf höchstens 40 Zeichen haben.", en: "“From” may have at most 40 characters." },
  messageLong: { de: "Die Nachricht darf höchstens 350 Zeichen haben.", en: "The message may have at most 350 characters." },
  delivery: { de: "Bitte eine Versandart wählen.", en: "Please choose a delivery option." },
  printOff: {
    de: "Die Premium-Karte ist gerade nicht verfügbar — bitte wähle den Versand als PDF.",
    en: "The premium card is not available right now — please choose the PDF.",
  },
};

/** Highest draft amount accepted (it is only shown in the preview; the price comes from the variant). */
const DRAFT_AMOUNT_MAX_CENTS = 1_000_000;

/**
 * The common part of a draft and a preview body.
 * @param {Record<string, unknown>} b
 * @param {GiftVoucherLocale} loc
 * @param {boolean} allowPhoto
 */
function validateDesignFields(b, loc, allowPhoto) {
  /** @param {string} field @param {keyof typeof DRAFT_TEXT} key */
  const fail = (field, key) => ({ ok: /** @type {const} */ (false), field, message: DRAFT_TEXT[key][loc] });
  const designKey = b.designKey;
  if (typeof designKey !== "string" || !/** @type {readonly string[]} */ (GIFT_VOUCHER_DESIGN_KEYS).includes(designKey)) {
    return fail("designKey", "design");
  }
  let photoId = null;
  if (designKey === "photo") {
    if (!allowPhoto) return fail("designKey", "photoOff");
    if (b.photoId == null || b.photoId === "") return fail("photoId", "photoMissing");
    if (!isValidPhotoId(b.photoId)) return fail("photoId", "photoInvalid");
    photoId = b.photoId;
  }
  let amountCents = null;
  if (b.amountCents != null) {
    const a = b.amountCents;
    if (typeof a !== "number" || !Number.isSafeInteger(a) || a <= 0 || a > DRAFT_AMOUNT_MAX_CENTS) {
      return fail("amountCents", "amount");
    }
    amountCents = a;
  }
  const L = GIFT_VOUCHER_TEXT_LIMITS;
  /** @type {Array<[string, number, number, keyof typeof DRAFT_TEXT]>} */
  const specs = [
    ["recipientName", L.recipientName, 1, "recipientLong"],
    ["senderName", L.senderName, 1, "senderLong"],
    ["message", L.message, L.messageLines, "messageLong"],
  ];
  /** @type {Record<string, string | null>} */
  const texts = {};
  let textRemoved = false;
  for (const [field, max, maxLines, longKey] of specs) {
    const raw = b[field];
    if (raw != null && typeof raw !== "string") return fail(field, "text");
    const r = sanitizeGiftVoucherText(raw ?? "", { max, maxLines });
    if (r.truncated) return fail(field, longKey);
    textRemoved = textRemoved || r.removed;
    texts[field] = r.text || null;
  }
  return {
    ok: /** @type {const} */ (true),
    value: {
      designKey,
      amountCents,
      recipientName: texts.recipientName,
      senderName: texts.senderName,
      message: texts.message,
      photoId,
      textRemoved,
    },
  };
}

/**
 * @typedef {{
 *   designKey: string, amountCents: number | null, recipientName: string | null, senderName: string | null,
 *   message: string | null, photoId: string | null, delivery: "pdf" | "print", address: GiftVoucherAddressJson | null,
 *   locale: GiftVoucherLocale, textRemoved: boolean,
 * }} GiftVoucherDraftValue
 */

/**
 * Validate the storefront's draft body (POST /api/gift-vouchers/drafts).
 * Texts are made printable (sanitizeGiftVoucherText; `textRemoved` tells the
 * page that characters such as emoji were dropped); too long → error. The
 * photo design needs a photo id (when photos are allowed), the card needs the
 * print option and a valid address. Messages in the body's locale.
 *
 * @param {unknown} body
 * @param {{ allowPhoto?: boolean, allowPrint?: boolean, countries?: readonly string[] }} [options]
 * @returns {{ ok: true, value: GiftVoucherDraftValue } | { ok: false, field: string, message: string }}
 */
export function validateGiftVoucherDraftInput(body, { allowPhoto = true, allowPrint = true, countries = ["DE"] } = {}) {
  const b = asObject(body);
  if (!b) return { ok: false, field: "body", message: DRAFT_TEXT.body.de };
  const loc = localeOf(b.locale);
  const design = validateDesignFields(b, loc, allowPhoto);
  if (!design.ok) return design;
  const delivery = b.delivery == null || b.delivery === "" ? "pdf" : b.delivery;
  if (delivery !== "pdf" && delivery !== "print") return { ok: false, field: "delivery", message: DRAFT_TEXT.delivery[loc] };
  let address = null;
  if (delivery === "print") {
    if (!allowPrint) return { ok: false, field: "delivery", message: DRAFT_TEXT.printOff[loc] };
    const a = validatePostalAddress(b.address, { countries, locale: loc });
    if (!a.ok) return a;
    address = a.address;
  }
  return { ok: true, value: { ...design.value, delivery, address, locale: loc } };
}

/**
 * @typedef {{
 *   designKey: string, amountCents: number | null, recipientName: string | null, senderName: string | null,
 *   message: string | null, photoId: string | null, locale: GiftVoucherLocale, textRemoved: boolean,
 *   layout: "landscape" | "square",
 * }} GiftVoucherPreviewValue
 */

/**
 * Validate a preview body (POST /api/gift-vouchers/preview): the draft fields
 * without delivery and address, plus `layout` ("landscape" default |
 * "square").
 * @param {unknown} body
 * @param {{ allowPhoto?: boolean }} [options]
 * @returns {{ ok: true, value: GiftVoucherPreviewValue } | { ok: false, field: string, message: string }}
 */
export function giftVoucherPreviewInput(body, { allowPhoto = true } = {}) {
  const b = asObject(body);
  if (!b) return { ok: false, field: "body", message: DRAFT_TEXT.body.de };
  const loc = localeOf(b.locale);
  const design = validateDesignFields(b, loc, allowPhoto);
  if (!design.ok) return design;
  const layout = b.layout === "square" ? "square" : "landscape";
  return { ok: true, value: { ...design.value, locale: loc, layout } };
}
