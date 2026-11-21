// The Geschenkgutschein designs („Motive“) and the voucher artwork — pure.
//
// Six code-defined designs (keys === GIFT_VOUCHER_DESIGN_KEYS) and the SVG
// builders for every surface the renderer (gift-voucher-render.ts) rasterises:
//   - landscape 210 × 148 mm: `front` and `inside` (download PDF + previews);
//   - square 140 × 140 mm trim for the print.one SQ14 folded card: `front`,
//     `back` (the address circle stays empty), `inside-message`, `inside-info`,
//     composed into the two 3378 × 1724 px spreads incl. 3 mm bleed
//     (buildGiftVoucherSpreadSvg);
//   - the A4 download page: front on top, inside below, a dashed cut/fold
//     line between (buildGiftVoucherPdfPageSvg).
//
// Every letter is a <path> outline taken from the bundled OFL fonts
// (Montserrat, Caveat — opentype.js Font objects passed in), so the artwork
// never depends on fonts installed on the server, and glyphs a font lacks are
// dropped instead of printing a box. Decorations are vector and come from
// seeded pseudo-random numbers: the same input gives the same SVG, byte for
// byte, at every resolution.
//
// Layout works in millimetres of the trim box (a panel knows its px per mm),
// so one layout serves a 1000-px preview, the 220-dpi PDF and the 300-dpi
// print file. Font sizes are in mm of the em (1 pt = 0.3528 mm): small print
// is ≥ 2.47 mm (7 pt) at print size.
//
// No I/O, no randomness, no clock: node --test runs it with real fonts.

import { formatEuro, formatGiftVoucherCode } from "./gift-voucher-core.mjs";

/**
 * @typedef {{
 *   background: string, ink: string, accent: string, muted: string,
 *   insideBackground: string, insideInk: string,
 * }} GiftVoucherDesignColors
 * @typedef {{
 *   key: string,
 *   name: { de: string, en: string },
 *   description: { de: string, en: string },
 *   photo: boolean,
 *   colors: GiftVoucherDesignColors,
 *   defaultMessage: { de: string, en: string },
 * }} GiftVoucherDesign
 */

/**
 * The part of an opentype.js Font the artwork uses (text → outlines).
 * @typedef {{
 *   unitsPerEm: number,
 *   charToGlyphIndex(s: string): number,
 *   getAdvanceWidth(text: string, fontSize?: number, options?: { letterSpacing?: number }): number,
 *   getPath(text: string, x: number, y: number, fontSize: number, options?: { letterSpacing?: number }): {
 *     toPathData(decimalPlaces: number): string,
 *     getBoundingBox(): { x1: number, y1: number, x2: number, y2: number },
 *   },
 * }} GiftVoucherFont
 */

/**
 * The fonts of the artwork: Montserrat 400/600/700/800 and Caveat 500/700.
 * @typedef {{
 *   regular: GiftVoucherFont, semibold: GiftVoucherFont, bold: GiftVoucherFont, extrabold: GiftVoucherFont,
 *   script: GiftVoucherFont, scriptBold: GiftVoucherFont,
 * }} GiftVoucherFonts
 */

/**
 * What a panel shows. Texts are expected sanitised (sanitizeGiftVoucherText);
 * characters the fonts cannot draw are dropped anyway.
 * @typedef {{
 *   locale?: "de" | "en",
 *   amountCents: number,
 *   recipientName?: string | null,
 *   senderName?: string | null,
 *   message?: string | null,
 *   code?: string | null,
 *   number?: string | null,
 *   expiresOn?: string | null,
 *   sample?: boolean,
 *   issuerLine?: string,
 *   termsUrl?: string,
 * }} GiftVoucherPanelData
 */

/**
 * The QR symbol: `size` modules per side, `data[row * size + col]` truthy =
 * dark (the `modules` of qrcode's create()), or a `get(row, col)` accessor.
 * @typedef {{ size: number, data?: ArrayLike<number | boolean>, get?: (row: number, col: number) => number | boolean }} GiftVoucherQrMatrix
 */

/** @typedef {"front" | "inside" | "inside-message" | "inside-info" | "back"} GiftVoucherPanelKind */
/** @typedef {{ x1: number, y1: number, x2: number, y2: number }} GiftVoucherBox */
/**
 * One drawn element with its bounding box in px (null for the full-bleed
 * background). `role`: background | decor | text | value | code | number |
 * qr | image | watermark.
 * @typedef {{ role: string, svg: string, bbox: GiftVoucherBox | null }} GiftVoucherElement
 * @typedef {{
 *   svg: string, inner: string, widthPx: number, heightPx: number, bleedPx: number,
 *   pxPerMm: number, elements: GiftVoucherElement[],
 * }} GiftVoucherPanelLayout
 */

// ---------------------------------------------------------------------------
// The designs
// ---------------------------------------------------------------------------

/** @param {GiftVoucherDesign} d @returns {Readonly<GiftVoucherDesign>} */
function freezeDesign(d) {
  Object.freeze(d.name);
  Object.freeze(d.description);
  Object.freeze(d.colors);
  Object.freeze(d.defaultMessage);
  return Object.freeze(d);
}

/** @type {ReadonlyArray<Readonly<GiftVoucherDesign>>} */
export const GIFT_VOUCHER_DESIGNS = Object.freeze([
  freezeDesign({
    key: "classic",
    name: { de: "Klassisch", en: "Classic" },
    description: {
      de: "Dunkles Anthrazit mit feinem Rändel-Muster wie an einem Hantelgriff und champagnerfarbenem Wert.",
      en: "Deep charcoal with a fine knurl pattern like a barbell grip and a champagne value.",
    },
    photo: false,
    colors: {
      background: "#15171a",
      ink: "#f3e7c6",
      accent: "#008ccb",
      muted: "#9aa3ab",
      insideBackground: "#fbfaf6",
      insideInk: "#1b1d20",
    },
    defaultMessage: { de: "Viel Freude beim Training!", en: "Enjoy your training!" },
  }),
  freezeDesign({
    key: "birthday",
    name: { de: "Geburtstag", en: "Birthday" },
    description: {
      de: "Hell und luftig mit Konfetti in Blautönen und einem warmen Akzent.",
      en: "Light and airy with confetti in shades of blue and one warm accent.",
    },
    photo: false,
    colors: {
      background: "#ffffff",
      ink: "#00577f",
      accent: "#f2a33a",
      muted: "#6b7f8c",
      insideBackground: "#ffffff",
      insideInk: "#1b1d20",
    },
    defaultMessage: { de: "Alles Gute zum Geburtstag!", en: "Happy birthday!" },
  }),
  freezeDesign({
    key: "christmas",
    name: { de: "Weihnachten", en: "Christmas" },
    description: {
      de: "Tiefes Nachtblau mit feinen Sternen und warmem Gold.",
      en: "Deep navy with fine stars and warm gold.",
    },
    photo: false,
    colors: {
      background: "#0b2440",
      ink: "#ffffff",
      accent: "#d9b26f",
      muted: "#9fb3c8",
      insideBackground: "#fbfaf6",
      insideInk: "#0b2440",
    },
    defaultMessage: { de: "Frohe Weihnachten!", en: "Merry Christmas!" },
  }),
  freezeDesign({
    key: "thanks",
    name: { de: "Danke", en: "Thank you" },
    description: {
      de: "Zartes Hellblau mit fließenden Wellenlinien in Markenblau.",
      en: "Soft light blue with flowing wave lines in brand blue.",
    },
    photo: false,
    colors: {
      background: "#eaf6fc",
      ink: "#00577f",
      accent: "#008ccb",
      muted: "#5f7f93",
      insideBackground: "#ffffff",
      insideInk: "#1b1d20",
    },
    defaultMessage: { de: "Danke von Herzen!", en: "Thank you so much!" },
  }),
  freezeDesign({
    key: "training",
    name: { de: "Training", en: "Training" },
    description: {
      de: "Kraftvoll: eine große Hantelscheibe in Blau und Schwarz.",
      en: "Bold: a large weight plate in blue and black.",
    },
    photo: false,
    colors: {
      background: "#0f1113",
      ink: "#ffffff",
      accent: "#008ccb",
      muted: "#8f99a3",
      insideBackground: "#ffffff",
      insideInk: "#0f1113",
    },
    defaultMessage: { de: "Viel Freude beim Training!", en: "Enjoy your training!" },
  }),
  freezeDesign({
    key: "photo",
    name: { de: "Eigenes Foto", en: "Your photo" },
    description: {
      de: "Dein Foto auf der ganzen Vorderseite, die Schrift gut lesbar darüber.",
      en: "Your photo across the whole front, with the lettering legible on top.",
    },
    photo: true,
    colors: {
      background: "#1b1d20",
      ink: "#ffffff",
      accent: "#008ccb",
      muted: "#c4cbd1",
      insideBackground: "#fbfaf6",
      insideInk: "#1b1d20",
    },
    defaultMessage: { de: "Viel Freude damit!", en: "Enjoy!" },
  }),
]);

/**
 * The design of a key, or null.
 * @param {unknown} key
 * @returns {Readonly<GiftVoucherDesign> | null}
 */
export function giftVoucherDesign(key) {
  return GIFT_VOUCHER_DESIGNS.find((d) => d.key === key) ?? null;
}

// Detailed palettes of the artwork (the public `colors` above are the summary
// the storefront uses for its live approximation).
const BRAND_BLUE = "#008ccb";
const NAVY = "#00577f";

/**
 * @typedef {{
 *   front: { wordmark: string, eyebrow: string, value: string, name: string, url: string, rule: string },
 *   paper: string, ink: string, soft: string, label: string, eyebrow: string,
 *   card: string, cardLine: string, qrDark: string, script: string, motif: string, motif2: string,
 *   back: string, backWordmark: string,
 * }} Theme
 */

/** @type {Record<string, Theme>} */
const THEMES = {
  classic: {
    front: { wordmark: BRAND_BLUE, eyebrow: "#d6c398", value: "url(#champagne)", name: "#ece6d8", url: "#8e979f", rule: "#c9b17f" },
    paper: "#fbfaf6", ink: "#1b1d20", soft: "#4b5157", label: "#646b72", eyebrow: "#9a7f4a",
    card: "#ffffff", cardLine: "#e7e1d2", qrDark: "#15171a", script: "#1b1d20", motif: "#15171a", motif2: "#c9b17f",
    back: "#fbfaf6", backWordmark: BRAND_BLUE,
  },
  birthday: {
    front: { wordmark: BRAND_BLUE, eyebrow: BRAND_BLUE, value: NAVY, name: "#1d3646", url: "#6b7f8c", rule: "#f2a33a" },
    paper: "#ffffff", ink: "#1b1d20", soft: "#46545e", label: "#5f6f7b", eyebrow: BRAND_BLUE,
    card: "#f3f9fd", cardLine: "#d8ebf6", qrDark: "#0d2a3b", script: "#14324a", motif: BRAND_BLUE, motif2: "#f2a33a",
    back: "#ffffff", backWordmark: BRAND_BLUE,
  },
  christmas: {
    front: { wordmark: "#ffffff", eyebrow: "#d9b26f", value: "#ffffff", name: "#ead2a0", url: "#9fb3c8", rule: "#d9b26f" },
    paper: "#fbfaf6", ink: "#0b2440", soft: "#3d5168", label: "#5f6e7e", eyebrow: "#9c7a3c",
    card: "#ffffff", cardLine: "#e9e1cf", qrDark: "#0b2440", script: "#0b2440", motif: "#c9a15c", motif2: "#0b2440",
    back: "#fbfaf6", backWordmark: "#0b2440",
  },
  thanks: {
    front: { wordmark: BRAND_BLUE, eyebrow: BRAND_BLUE, value: NAVY, name: NAVY, url: "#5f7f93", rule: BRAND_BLUE },
    paper: "#ffffff", ink: "#1b1d20", soft: "#46545e", label: "#5f6f7b", eyebrow: BRAND_BLUE,
    card: "#f2f9fd", cardLine: "#d3e9f5", qrDark: "#0d2a3b", script: "#0f3b57", motif: BRAND_BLUE, motif2: "#7cc6e8",
    back: "#ffffff", backWordmark: BRAND_BLUE,
  },
  training: {
    front: { wordmark: "#ffffff", eyebrow: "#2aa9e6", value: "#ffffff", name: "#ffffff", url: "#8f99a3", rule: BRAND_BLUE },
    paper: "#ffffff", ink: "#0f1113", soft: "#454c53", label: "#5f676f", eyebrow: BRAND_BLUE,
    card: "#f4f6f7", cardLine: "#e1e5e8", qrDark: "#0f1113", script: "#0f1113", motif: BRAND_BLUE, motif2: "#0f1113",
    back: "#ffffff", backWordmark: "#0f1113",
  },
  photo: {
    front: { wordmark: "#ffffff", eyebrow: "#ffffff", value: "#ffffff", name: "#ffffff", url: "#e6eaee", rule: "#ffffff" },
    paper: "#fbfaf6", ink: "#1b1d20", soft: "#4b5157", label: "#646b72", eyebrow: BRAND_BLUE,
    card: "#ffffff", cardLine: "#e7e3d8", qrDark: "#15171a", script: "#1b1d20", motif: BRAND_BLUE, motif2: "#9aa3ab",
    back: "#fbfaf6", backWordmark: BRAND_BLUE,
  },
};

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** The landscape panel (download PDF, previews), in mm. */
export const GIFT_VOUCHER_LANDSCAPE_MM = Object.freeze({ width: 210, height: 148 });
/** The square panel (print.one SQ14 folded card), trim size in mm. */
export const GIFT_VOUCHER_SQUARE_MM = Object.freeze({ width: 140, height: 140 });

/**
 * The print.one SQ14 spread: 3378 × 1724 px at 300 dpi incl. 35 px (3 mm)
 * bleed on every side, fold at x = 1689; each panel is built 1724 × 1724
 * (bleed all round) and loses the bleed at the fold. The recipient address is
 * printed into a 77 mm circle in the middle of the back panel — the whole
 * centre (Ø 95 mm) stays empty; text keeps 5 mm inside the trim.
 */
export const GIFT_VOUCHER_PRINT_SPREAD = Object.freeze({
  widthPx: 3378,
  heightPx: 1724,
  bleedPx: 35,
  foldX: 1689,
  panelPx: 1724,
  dpi: 300,
  addressCircleMm: 77,
  keepOutDiameterMm: 95,
  safeMarginMm: 5,
});

const MM_PER_PT = 25.4 / 72;
/** Small print: 7 pt at print size, as mm of the em. */
const SMALL = 7 * MM_PER_PT;

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

const COPY = {
  de: {
    eyebrow: "GESCHENKGUTSCHEIN",
    forWord: "für",
    codeLabel: "DEIN GUTSCHEINCODE",
    valueLabel: "WERT",
    validLabel: "GÜLTIG BIS",
    validityLabel: "GÜLTIGKEIT",
    validForever: "unbegrenzt gültig",
    qrCaption: "Guthaben prüfen",
    redeemLead: "So löst du ihn ein:",
    redeemText: "Code im Checkout auf motionsports.de eingeben. Restguthaben bleibt erhalten. Keine Barauszahlung.",
    numberLabel: "Gutschein-Nr.",
    termsLabel: "Bedingungen:",
    sample: "MUSTER",
    cutHint: "Zum Verschenken ausschneiden oder falten",
  },
  en: {
    eyebrow: "GIFT VOUCHER",
    forWord: "for",
    codeLabel: "YOUR VOUCHER CODE",
    valueLabel: "VALUE",
    validLabel: "VALID UNTIL",
    validityLabel: "VALIDITY",
    validForever: "no expiry date",
    qrCaption: "Check balance",
    redeemLead: "How to redeem:",
    redeemText: "Enter the code at checkout on motionsports.de. Any remaining balance stays on the card. No cash payout.",
    numberLabel: "Voucher no.",
    termsLabel: "Terms:",
    sample: "SAMPLE",
    cutHint: "Cut out or fold to give as a gift",
  },
};

const WORDMARK = "motion sports";
const SITE = "motionsports.de";
const SAMPLE_CODE = "XXXX XXXX XXXX XXXX";
const DEFAULT_ISSUER = "4motionsports GmbH · Am Weidegrund 1 · 82194 Gröbenzell";
const DEFAULT_TERMS = "https://www.motionsports.de/pages/gutscheinbedingungen";
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A YYYY-MM-DD date as printed: "31.12.2029" (de) / "31 Dec 2029" (en); null
 * for anything else.
 * @param {unknown} iso
 * @param {string} [locale]
 * @returns {string | null}
 */
export function formatGiftVoucherDate(iso, locale = "de") {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof iso === "string" ? iso.trim().slice(0, 10) : "");
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (locale === "en") return `${day} ${MONTHS_EN[month - 1]} ${m[1]}`;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** A URL as printed: without the scheme and a trailing slash. @param {string} url */
function shortUrl(url) {
  return String(url).replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

/**
 * Everything the panels print, resolved once (sample placeholders, defaults).
 * @param {GiftVoucherPanelData | undefined} data
 * @param {Readonly<GiftVoucherDesign>} design
 */
function resolveData(data, design) {
  const d = data ?? /** @type {GiftVoucherPanelData} */ ({ amountCents: 0 });
  const locale = d.locale === "en" ? "en" : "de";
  const copy = COPY[locale];
  const sample = d.sample === true;
  const clean = (/** @type {unknown} */ v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const code = !sample && clean(d.code) ? formatGiftVoucherCode(d.code) : null;
  const message = clean(d.message);
  return {
    locale,
    copy,
    sample,
    amountCents: typeof d.amountCents === "number" && Number.isFinite(d.amountCents) ? Math.max(0, Math.round(d.amountCents)) : 0,
    recipientName: clean(d.recipientName),
    senderName: clean(d.senderName),
    message: message ?? design.defaultMessage[locale],
    defaultMessage: design.defaultMessage[locale],
    isDefaultMessage: !message,
    code: code || SAMPLE_CODE,
    number: sample ? copy.sample : (clean(d.number) ?? "—"),
    expiry: formatGiftVoucherDate(d.expiresOn, locale),
    issuerLine: clean(d.issuerLine) ?? DEFAULT_ISSUER,
    terms: shortUrl(clean(d.termsUrl) ?? DEFAULT_TERMS),
  };
}

/** @typedef {ReturnType<typeof resolveData>} ResolvedData */

/**
 * The value split for typesetting: "50 €" → number "50" + "€" after; en
 * "€50" → "€" before.
 * @param {number} cents
 * @param {"de" | "en"} locale
 */
function valueParts(cents, locale) {
  const s = formatEuro(cents, locale, { compact: true });
  if (locale === "en") return { num: s.replace(/^€/, ""), cur: "€", curFirst: true };
  return { num: s.replace(/\s*€$/, ""), cur: "€", curFirst: false };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** A number for SVG output: 2 decimals, never "-0". @param {number} v */
function n2(v) {
  const r = Math.round(v * 100) / 100;
  return r === 0 ? "0" : String(r);
}

/** @param {string} s */
function escAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** FNV-1a of a string — the seed of a decoration. @param {string} s */
function seedOf(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: a small deterministic PRNG in [0, 1). @param {number} seed */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @param {GiftVoucherBox | null} a @param {GiftVoucherBox | null} b @returns {GiftVoucherBox | null} */
function unionBox(a, b) {
  if (!a) return b;
  if (!b) return a;
  return { x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) };
}

/** A smooth path through points (Catmull-Rom as cubic Béziers), px. @param {Array<[number, number]>} pts */
function smoothPath(pts) {
  let d = `M${n2(pts[0][0])} ${n2(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    d +=
      `C${n2(p1[0] + (p2[0] - p0[0]) / 6)} ${n2(p1[1] + (p2[1] - p0[1]) / 6)} ` +
      `${n2(p2[0] - (p3[0] - p1[0]) / 6)} ${n2(p2[1] - (p3[1] - p1[1]) / 6)} ${n2(p2[0])} ${n2(p2[1])}`;
  }
  return d;
}

/** A four-point sparkle star (px). @param {number} cx @param {number} cy @param {number} R @param {number} [pinch] */
function sparklePath(cx, cy, R, pinch = 0.17) {
  const r = R * pinch;
  return (
    `M${n2(cx)} ${n2(cy - R)}Q${n2(cx + r)} ${n2(cy - r)} ${n2(cx + R)} ${n2(cy)}` +
    `Q${n2(cx + r)} ${n2(cy + r)} ${n2(cx)} ${n2(cy + R)}Q${n2(cx - r)} ${n2(cy + r)} ${n2(cx - R)} ${n2(cy)}` +
    `Q${n2(cx - r)} ${n2(cy - r)} ${n2(cx)} ${n2(cy - R)}Z`
  );
}

// ---------------------------------------------------------------------------
// Text engine (opentype.js outlines)
// ---------------------------------------------------------------------------

/** @type {WeakMap<object, Map<string, number>>} */
const WIDTHS = new WeakMap();
/** @type {WeakMap<object, Map<string, boolean>>} */
const HAS_GLYPH = new WeakMap();

/** Does the font draw this character? @param {GiftVoucherFont} font @param {string} ch */
function hasGlyph(font, ch) {
  let m = HAS_GLYPH.get(font);
  if (!m) {
    m = new Map();
    HAS_GLYPH.set(font, m);
  }
  let v = m.get(ch);
  if (v === undefined) {
    v = font.charToGlyphIndex(ch) > 0;
    m.set(ch, v);
  }
  return v;
}

/** The text without the characters the font lacks (spaces and newlines stay). @param {GiftVoucherFont} font @param {string} text */
function printable(font, text) {
  let out = "";
  for (const ch of String(text)) {
    if (ch === "\n") out += ch;
    else if (/\s/.test(ch)) out += " ";
    else if (hasGlyph(font, ch)) out += ch;
  }
  return out;
}

/**
 * Advance width in em (kerning on, `tracking` em after every glyph but the
 * last). Cached per font and string.
 * @param {GiftVoucherFont} font @param {string} text @param {number} [tracking]
 */
function emWidth(font, text, tracking = 0) {
  if (!text) return 0;
  let m = WIDTHS.get(font);
  if (!m) {
    m = new Map();
    WIDTHS.set(font, m);
  }
  const key = tracking ? `${tracking}\u0000${text}` : text;
  let w = m.get(key);
  if (w === undefined) {
    const raw = font.getAdvanceWidth(text, 1, tracking ? { letterSpacing: tracking } : undefined);
    w = tracking ? raw - tracking : raw;
    if (m.size > 20000) m.clear();
    m.set(key, w);
  }
  return w;
}

/**
 * Greedy line breaking in em: explicit newlines are kept (an empty line stays
 * as ""), a word longer than the line is split by characters.
 * @param {GiftVoucherFont} font @param {string} text @param {number} maxEm
 * @returns {string[]}
 */
function wrapEm(font, text, maxEm) {
  /** @type {string[]} */
  const lines = [];
  for (const para of text.split("\n")) {
    const words = para.split(" ").filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let cur = "";
    for (let word of words) {
      while (emWidth(font, word) > maxEm && Array.from(word).length > 1) {
        const chars = Array.from(word);
        let k = chars.length - 1;
        while (k > 1 && emWidth(font, chars.slice(0, k).join("")) > maxEm) k--;
        if (cur) {
          lines.push(cur);
          cur = "";
        }
        lines.push(chars.slice(0, k).join(""));
        word = chars.slice(k).join("");
      }
      const cand = cur ? `${cur} ${word}` : word;
      if (!cur || emWidth(font, cand) <= maxEm) cur = cand;
      else {
        lines.push(cur);
        cur = word;
      }
    }
    if (cur) lines.push(cur);
  }
  return lines;
}

/**
 * Cut a single line to `maxEm` with an ellipsis.
 * @param {GiftVoucherFont} font @param {string} text @param {number} maxEm @param {number} [tracking]
 */
function ellipsize(font, text, maxEm, tracking = 0) {
  if (emWidth(font, text, tracking) <= maxEm) return text;
  const chars = Array.from(text);
  for (let k = chars.length - 1; k > 0; k--) {
    const cand = `${chars.slice(0, k).join("").trimEnd()}…`;
    if (emWidth(font, cand, tracking) <= maxEm) return cand;
  }
  return "…";
}

// ---------------------------------------------------------------------------
// The panel: px per mm, bleed, defs and the element registry
// ---------------------------------------------------------------------------

class Panel {
  /**
   * @param {{ widthPx: number, heightPx: number, bleedPx: number, nominalWidthMm: number, idPrefix: string, raster?: boolean }} o
   */
  constructor(o) {
    /** Units are device pixels (rasterised by sharp), not a scalable preview. */
    this.raster = o.raster !== false;
    this.widthPx = o.widthPx;
    this.heightPx = o.heightPx;
    this.bleedPx = o.bleedPx;
    /** px per mm */
    this.S = (o.widthPx - 2 * o.bleedPx) / o.nominalWidthMm;
    /** trim width / height in mm */
    this.W = o.nominalWidthMm;
    this.H = (o.heightPx - 2 * o.bleedPx) / this.S;
    /** bleed in mm */
    this.B = o.bleedPx / this.S;
    this.isSquare = Math.abs(this.W - this.H) < 1;
    this.idPrefix = o.idPrefix;
    /** @type {string[]} */
    this.defs = [];
    /** @type {GiftVoucherElement[]} */
    this.elements = [];
  }

  /** A coordinate (x or y) in mm of the trim box → px. @param {number} mm */
  p(mm) {
    return this.bleedPx + mm * this.S;
  }

  /** A length in mm → px. @param {number} mm */
  len(mm) {
    return mm * this.S;
  }

  /** @param {string} name */
  id(name) {
    return `${this.idPrefix}-${name}`;
  }

  /** @param {string} svg */
  def(svg) {
    this.defs.push(svg);
  }

  /** @param {string} role @param {string} svg @param {GiftVoucherBox | null} bbox */
  add(role, svg, bbox) {
    this.elements.push({ role, svg, bbox });
  }

  /** A box in mm → px. @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 */
  box(x1, y1, x2, y2) {
    return { x1: this.p(Math.min(x1, x2)), y1: this.p(Math.min(y1, y2)), x2: this.p(Math.max(x1, x2)), y2: this.p(Math.max(y1, y2)) };
  }

  /** Full-bleed fill. @param {string} fill */
  fill(fill) {
    this.add("background", `<rect width="${n2(this.widthPx)}" height="${n2(this.heightPx)}" fill="${fill}"/>`, null);
  }

  /**
   * A rectangle (mm); role decor unless given.
   * @param {number} x @param {number} y @param {number} w @param {number} h @param {string} attrs @param {string} [role]
   */
  rect(x, y, w, h, attrs, role = "decor") {
    this.add(
      role,
      `<rect x="${n2(this.p(x))}" y="${n2(this.p(y))}" width="${n2(this.len(w))}" height="${n2(this.len(h))}" ${attrs}/>`,
      this.box(x, y, x + w, y + h)
    );
  }

  /**
   * A circle (mm). @param {number} cx @param {number} cy @param {number} r @param {string} attrs @param {number} [strokeMm]
   * @param {string} [role]
   */
  circle(cx, cy, r, attrs, strokeMm = 0, role = "decor") {
    const e = r + strokeMm / 2;
    this.add(role, `<circle cx="${n2(this.p(cx))}" cy="${n2(this.p(cy))}" r="${n2(this.len(r))}" ${attrs}/>`, this.box(cx - e, cy - e, cx + e, cy + e));
  }

  /**
   * One line of text as outlines. (x, y) = the baseline start / middle / end
   * in mm, `size` = mm of the em.
   * @param {string} role @param {GiftVoucherFont} font @param {string} str @param {number} x @param {number} y @param {number} size
   * @param {{ fill: string, tracking?: number, anchor?: "start" | "middle" | "end", opacity?: number }} o
   * @returns {{ widthMm: number, bbox: GiftVoucherBox | null }}
   */
  text(role, font, str, x, y, size, { fill, tracking = 0, anchor = "start", opacity = 1 }) {
    const t = printable(font, str).replace(/\n/g, " ");
    const sizePx = this.len(size);
    const w = emWidth(font, t, tracking) * sizePx;
    let xPx = this.p(x);
    if (anchor === "middle") xPx -= w / 2;
    else if (anchor === "end") xPx -= w;
    if (!t.trim()) return { widthMm: w / this.S, bbox: null };
    const path = font.getPath(t, xPx, this.p(y), sizePx, tracking ? { letterSpacing: tracking } : undefined);
    const d = path.toPathData(2);
    if (!d) return { widthMm: w / this.S, bbox: null };
    const bb = path.getBoundingBox();
    const bbox = { x1: bb.x1, y1: bb.y1, x2: bb.x2, y2: bb.y2 };
    const op = opacity < 1 ? ` fill-opacity="${n2(opacity)}"` : "";
    this.add(role, `<path d="${d}" fill="${fill}"${op}/>`, bbox);
    return { widthMm: w / this.S, bbox };
  }

  /** Width of a text in mm. @param {GiftVoucherFont} font @param {string} str @param {number} size @param {number} [tracking] */
  measure(font, str, size, tracking = 0) {
    return emWidth(font, printable(font, str).replace(/\n/g, " "), tracking) * size;
  }

  /** The inner markup (defs + elements), for nesting into a spread or a page. */
  inner() {
    return (this.defs.length ? `<defs>${this.defs.join("")}</defs>` : "") + this.elements.map((e) => e.svg).join("");
  }

  /** @returns {GiftVoucherPanelLayout} */
  layout() {
    const inner = this.inner();
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
      `width="${n2(this.widthPx)}" height="${n2(this.heightPx)}" viewBox="0 0 ${n2(this.widthPx)} ${n2(this.heightPx)}">` +
      `${inner}</svg>`;
    return {
      svg,
      inner,
      widthPx: this.widthPx,
      heightPx: this.heightPx,
      bleedPx: this.bleedPx,
      pxPerMm: this.S,
      elements: this.elements,
    };
  }
}

/** Full-bleed extent of a panel in mm (trim box plus bleed). @param {Panel} c */
function bleedBox(c) {
  return { x: -c.B, y: -c.B, w: c.W + 2 * c.B, h: c.H + 2 * c.B };
}

// ---------------------------------------------------------------------------
// Decorations (front backgrounds) — no text; shared by the panels and the
// storefront background layer
// ---------------------------------------------------------------------------

/**
 * The text zone of a front a decoration keeps clear (mm): the block the
 * lettering sits in, by the composition of the design.
 * @param {Panel} c @param {"left" | "center"} align
 */
function frontKeepOut(c, align) {
  if (align === "center") {
    return { cx: c.W / 2, cy: c.H * 0.52, rx: c.isSquare ? c.W * 0.4 : c.W * 0.34, ry: c.isSquare ? c.H * 0.36 : c.H * 0.36 };
  }
  return { cx: c.W * 0.3, cy: c.H * 0.5, rx: c.W * 0.32, ry: c.H * 0.4 };
}

/**
 * Boxes (mm) around the wordmark and the site line of a centred front — the
 * decorations stay off them.
 * @param {Panel} c
 * @returns {Array<{ x1: number, y1: number, x2: number, y2: number }>}
 */
function centeredTextBoxes(c) {
  const M = c.isSquare ? 13 : 14;
  const wm = c.isSquare ? 21 : 23.5;
  const url = c.isSquare ? 16 : 17;
  return [
    { x1: c.W / 2 - wm, y1: M - 4, x2: c.W / 2 + wm, y2: M + 8.5 },
    { x1: c.W / 2 - url, y1: c.H - M - 5.5, x2: c.W / 2 + url, y2: c.H - M + 3.5 },
  ];
}

/** @param {Array<{ x1: number, y1: number, x2: number, y2: number }> | undefined} boxes @param {number} x @param {number} y @param {number} pad */
function inBoxes(boxes, x, y, pad) {
  return (boxes ?? []).some((b) => x > b.x1 - pad && x < b.x2 + pad && y > b.y1 - pad && y < b.y2 + pad);
}

/** @param {Panel} c */
function decorClassic(c) {
  const bb = bleedBox(c);
  c.def(
    `<radialGradient id="${c.id("bg")}" gradientUnits="userSpaceOnUse" cx="${n2(c.p(c.W * 0.22))}" cy="${n2(c.p(c.H * 0.18))}" r="${n2(c.len(Math.max(c.W, c.H) * 1.1))}">` +
      `<stop offset="0" stop-color="#202327"/><stop offset="0.55" stop-color="#17191c"/><stop offset="1" stop-color="#101214"/></radialGradient>`
  );
  c.fill(`url(#${c.id("bg")})`);

  // Knurl: a lattice of tiny pyramids (light facets up-left, dark down-right)
  // like the grip of a barbell, fading in from the right. One diamond in the
  // middle of the tile plus the four corner ones (clipped by the tile). For
  // rasters the tile is whole pixels (librsvg renders fractional pattern
  // tiles ~20× slower) and never finer than 9 px.
  const dy = c.raster ? Math.max(9, Math.round(c.len(1.9))) : c.len(1.9);
  const dx = c.raster ? Math.max(13, Math.round(dy * 1.45)) : dy * 1.45;
  const pyramid = (/** @type {number} */ cx, /** @type {number} */ cy) => {
    const hx = (dx / 2) * 0.82;
    const hy = (dy / 2) * 0.82;
    /** @param {number[]} a @param {number[]} b @param {string} fill */
    const facet = (a, b, fill) => `<path d="M${n2(a[0])} ${n2(a[1])}L${n2(b[0])} ${n2(b[1])}L${n2(cx)} ${n2(cy)}Z" fill="${fill}"/>`;
    const T = [cx, cy - hy];
    const R = [cx + hx, cy];
    const B = [cx, cy + hy];
    const L = [cx - hx, cy];
    return facet(L, T, "#ffffff") + facet(T, R, "#c9ced3") + facet(R, B, "#3a3f45") + facet(B, L, "#5b6168");
  };
  c.def(
    `<pattern id="${c.id("knurl")}" patternUnits="userSpaceOnUse" width="${n2(dx)}" height="${n2(dy)}">` +
      pyramid(dx / 2, dy / 2) + pyramid(0, 0) + pyramid(dx, 0) + pyramid(0, dy) + pyramid(dx, dy) +
      `</pattern>`
  );
  const x0 = c.isSquare ? c.W * 0.46 : c.W * 0.5;
  c.def(
    `<linearGradient id="${c.id("knurl-fade")}" gradientUnits="userSpaceOnUse" x1="${n2(c.p(x0))}" y1="0" x2="${n2(c.p(c.W + c.B))}" y2="0">` +
      `<stop offset="0" stop-color="#000"/><stop offset="0.45" stop-color="#5a5a5a"/><stop offset="1" stop-color="#ffffff"/></linearGradient>` +
      `<mask id="${c.id("knurl-mask")}" maskUnits="userSpaceOnUse" x="0" y="0" width="${n2(c.widthPx)}" height="${n2(c.heightPx)}">` +
      `<rect x="${n2(c.p(x0))}" y="0" width="${n2(c.p(c.W + c.B) - c.p(x0))}" height="${n2(c.heightPx)}" fill="url(#${c.id("knurl-fade")})"/></mask>`
  );
  c.add(
    "decor",
    `<rect x="${n2(c.p(x0))}" y="0" width="${n2(c.p(c.W + c.B) - c.p(x0))}" height="${n2(c.heightPx)}" fill="url(#${c.id("knurl")})" opacity="0.62" mask="url(#${c.id("knurl-mask")})"/>`,
    c.box(x0, bb.y, c.W + c.B, bb.y + bb.h)
  );
  // A hairline frame in champagne.
  const inset = c.isSquare ? 6.5 : 7;
  c.rect(inset, inset, c.W - 2 * inset, c.H - 2 * inset, `fill="none" stroke="#c9b17f" stroke-opacity="0.38" stroke-width="${n2(c.len(0.28))}"`);
}

/**
 * @param {Panel} c
 * @param {{ keepOut?: { cx: number, cy: number, rx: number, ry: number } | null, avoid?: Array<{ x1: number, y1: number, x2: number, y2: number }>,
 *   region?: { x1: number, y1: number, x2: number, y2: number } | null, count?: number, seed: string, scale?: number }} o
 */
function confetti(c, o) {
  const rnd = prng(seedOf(o.seed));
  const colors = [
    [BRAND_BLUE, 0.3],
    [NAVY, 0.16],
    ["#7cc6e8", 0.22],
    ["#bfe3f4", 0.14],
    ["#f2a33a", 0.18],
  ];
  const pick = () => {
    let r = rnd();
    for (const [col, w] of colors) {
      if ((r -= /** @type {number} */ (w)) <= 0) return /** @type {string} */ (col);
    }
    return BRAND_BLUE;
  };
  const region = o.region ?? { x1: -c.B, y1: -c.B, x2: c.W + c.B, y2: c.H + c.B };
  const k = o.scale ?? (c.isSquare ? 0.95 : 1);
  const target = o.count ?? Math.round(((region.x2 - region.x1) * (region.y2 - region.y1)) / 330);
  /** @type {Array<[number, number]>} */
  const placed = [];
  const minDist = 5.2 * k;
  let tries = 0;
  while (placed.length < target && tries < target * 40) {
    tries++;
    const x = region.x1 + rnd() * (region.x2 - region.x1);
    const y = region.y1 + rnd() * (region.y2 - region.y1);
    if (o.keepOut) {
      const q = Math.hypot((x - o.keepOut.cx) / o.keepOut.rx, (y - o.keepOut.cy) / o.keepOut.ry);
      if (q < 1.06) continue;
      // Calmer close to the lettering: the nearer, the likelier a skip.
      if (q < 1.5 && rnd() < 0.55) continue;
    }
    if (inBoxes(o.avoid, x, y, 3.2 * k)) continue;
    if (placed.some(([px, py]) => Math.hypot(px - x, py - y) < minDist)) continue;
    placed.push([x, y]);
    const col = pick();
    const kind = rnd();
    if (kind < 0.46) {
      const r = (0.5 + rnd() * 0.85) * k;
      c.circle(x, y, r, `fill="${col}"`, 0, "sprinkle");
    } else if (kind < 0.86) {
      const len = (2.2 + rnd() * 2.2) * k;
      const a = rnd() * Math.PI;
      const dx = (Math.cos(a) * len) / 2;
      const dy = (Math.sin(a) * len) / 2;
      const sw = 0.78 * k;
      c.add(
        "sprinkle",
        `<path d="M${n2(c.p(x - dx))} ${n2(c.p(y - dy))}L${n2(c.p(x + dx))} ${n2(c.p(y + dy))}" stroke="${col}" stroke-width="${n2(c.len(sw))}" stroke-linecap="round" fill="none"/>`,
        c.box(x - Math.abs(dx) - sw / 2, y - Math.abs(dy) - sw / 2, x + Math.abs(dx) + sw / 2, y + Math.abs(dy) + sw / 2)
      );
    } else {
      const r = (0.85 + rnd() * 0.5) * k;
      c.circle(x, y, r, `fill="none" stroke="${col}" stroke-width="${n2(c.len(0.42 * k))}"`, 0.42 * k, "sprinkle");
    }
  }
}

/** @param {Panel} c */
function decorBirthday(c) {
  c.def(
    `<radialGradient id="${c.id("bg")}" gradientUnits="userSpaceOnUse" cx="${n2(c.p(c.W * 0.5))}" cy="${n2(c.p(c.H * 0.5))}" r="${n2(c.len(Math.max(c.W, c.H) * 0.75))}">` +
      `<stop offset="0" stop-color="#ffffff"/><stop offset="0.7" stop-color="#fbfdff"/><stop offset="1" stop-color="#eef7fc"/></radialGradient>`
  );
  c.fill(`url(#${c.id("bg")})`);
  confetti(c, { keepOut: frontKeepOut(c, "center"), avoid: centeredTextBoxes(c), seed: `birthday-front-${c.isSquare ? "sq" : "ls"}` });
}

/**
 * @param {Panel} c
 * @param {{ seed: string, keepOut?: { cx: number, cy: number, rx: number, ry: number } | null, avoid?: Array<{ x1: number, y1: number, x2: number, y2: number }>,
 *   frameInset?: number, region?: { x1: number, y1: number, x2: number, y2: number }, snow?: number, stars?: number, gold?: string, onLight?: boolean }} o
 */
function starfield(c, o) {
  const rnd = prng(seedOf(o.seed));
  const region = o.region ?? { x1: -c.B, y1: -c.B, x2: c.W + c.B, y2: c.H + c.B };
  const area = (region.x2 - region.x1) * (region.y2 - region.y1);
  const snow = o.snow ?? Math.round(area / 115);
  const gold = o.gold ?? "#d9b26f";
  const flake = o.onLight ? "#9fb3c8" : "#ffffff";
  for (let i = 0; i < snow; i++) {
    const x = region.x1 + rnd() * (region.x2 - region.x1);
    const y = region.y1 + rnd() * (region.y2 - region.y1);
    const r = 0.14 + Math.pow(rnd(), 2.2) * 0.5;
    let op = 0.22 + rnd() * 0.6;
    if (inBoxes(o.avoid, x, y, 1.5)) continue;
    if (o.keepOut) {
      const q = Math.hypot((x - o.keepOut.cx) / o.keepOut.rx, (y - o.keepOut.cy) / o.keepOut.ry);
      if (q < 1) op *= 0.35;
    }
    c.circle(x, y, r, `fill="${flake}" fill-opacity="${n2(op)}"`, 0, "sprinkle");
  }
  const stars = o.stars ?? Math.round(area / 2600);
  /** @type {Array<[number, number]>} */
  const placed = [];
  let tries = 0;
  while (placed.length < stars && tries < stars * 60) {
    tries++;
    const x = region.x1 + 3 + rnd() * (region.x2 - region.x1 - 6);
    const y = region.y1 + 3 + rnd() * (region.y2 - region.y1 - 6);
    if (o.keepOut && Math.hypot((x - o.keepOut.cx) / o.keepOut.rx, (y - o.keepOut.cy) / o.keepOut.ry) < 1.08) continue;
    if (inBoxes(o.avoid, x, y, 4)) continue;
    if (o.frameInset !== undefined) {
      const f = o.frameInset;
      const nearV = Math.min(Math.abs(x - f), Math.abs(x - (c.W - f))) < 4.5 && y > f - 4.5 && y < c.H - f + 4.5;
      const nearH = Math.min(Math.abs(y - f), Math.abs(y - (c.H - f))) < 4.5 && x > f - 4.5 && x < c.W - f + 4.5;
      if (nearV || nearH) continue;
    }
    if (placed.some(([px, py]) => Math.hypot(px - x, py - y) < 14)) continue;
    placed.push([x, y]);
    const R = 1.0 + Math.pow(rnd(), 1.6) * 2.6;
    const op = 0.55 + rnd() * 0.45;
    c.add(
      "sprinkle",
      `<path d="${sparklePath(c.p(x), c.p(y), c.len(R))}" fill="${gold}" fill-opacity="${n2(op)}"/>`,
      c.box(x - R, y - R, x + R, y + R)
    );
  }
}

/** @param {Panel} c */
function decorChristmas(c) {
  c.def(
    `<radialGradient id="${c.id("bg")}" gradientUnits="userSpaceOnUse" cx="${n2(c.p(c.W * 0.5))}" cy="${n2(c.p(c.H * 0.36))}" r="${n2(c.len(Math.max(c.W, c.H) * 0.82))}">` +
      `<stop offset="0" stop-color="#16406b"/><stop offset="0.5" stop-color="#0d2a4a"/><stop offset="1" stop-color="#081a2f"/></radialGradient>`
  );
  c.fill(`url(#${c.id("bg")})`);
  const inset = c.isSquare ? 6.5 : 7;
  starfield(c, { seed: `christmas-front-${c.isSquare ? "sq" : "ls"}`, keepOut: frontKeepOut(c, "center"), avoid: centeredTextBoxes(c), frameInset: inset });
  c.rect(inset, inset, c.W - 2 * inset, c.H - 2 * inset, `fill="none" stroke="#d9b26f" stroke-opacity="0.45" stroke-width="${n2(c.len(0.28))}"`);
}

/**
 * The flowing ribbon of parallel wave lines.
 * @param {Panel} c
 * @param {{ lines?: number, opacity?: number, y0: number, y1: number, amp: number, spread0: number, spread1: number, x0?: number, x1?: number, width?: number, color?: string }} o
 */
function waves(c, o) {
  const n = o.lines ?? 15;
  const x0 = o.x0 ?? -c.B;
  const x1 = o.x1 ?? c.W + c.B;
  const steps = Math.max(12, Math.round((x1 - x0) / 5));
  const color = o.color ?? BRAND_BLUE;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    /** @type {Array<[number, number]>} */
    const pts = [];
    let box = /** @type {GiftVoucherBox | null} */ (null);
    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      const x = x0 + (x1 - x0) * u;
      const ease = u * u * (3 - 2 * u);
      const base = o.y0 + (o.y1 - o.y0) * ease;
      const spread = o.spread0 + (o.spread1 - o.spread0) * u;
      const y = base + (t - 0.5) * spread + o.amp * Math.sin(u * Math.PI * 2.1 + t * 1.15 + 0.4) * (0.55 + 0.45 * u);
      pts.push([c.p(x), c.p(y)]);
      box = unionBox(box, c.box(x, y, x, y));
    }
    const w = (0.26 + 0.14 * Math.sin(Math.PI * t)) * (o.width ?? 1);
    const op = (0.16 + 0.62 * Math.pow(Math.sin(Math.PI * t), 1.4)) * (o.opacity ?? 1);
    const pad = c.len(w);
    c.add(
      "decor",
      `<path d="${smoothPath(pts)}" fill="none" stroke="${color}" stroke-opacity="${n2(op)}" stroke-width="${n2(c.len(w))}" stroke-linecap="round"/>`,
      box && { x1: box.x1 - pad, y1: box.y1 - pad, x2: box.x2 + pad, y2: box.y2 + pad }
    );
  }
}

/** @param {Panel} c */
function decorThanks(c) {
  c.def(
    `<linearGradient id="${c.id("bg")}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${n2(c.heightPx)}">` +
      `<stop offset="0" stop-color="#f1f9fd"/><stop offset="1" stop-color="#dff0f9"/></linearGradient>`
  );
  c.fill(`url(#${c.id("bg")})`);
  if (c.isSquare) {
    waves(c, { y0: c.H * 1.02, y1: c.H * 0.6, amp: 4.2, spread0: 10, spread1: 22 });
  } else {
    waves(c, { y0: c.H * 1.04, y1: c.H * 0.38, amp: 4.8, spread0: 9, spread1: 30 });
  }
}

/**
 * The stylised weight plate (a blue competition plate seen from the front).
 * @param {Panel} c @param {number} cx @param {number} cy @param {number} R
 */
function weightPlate(c, cx, cy, R) {
  const X = c.p(cx);
  const Y = c.p(cy);
  const L = (/** @type {number} */ mm) => c.len(mm);
  const box = c.box(cx - R, cy - R, cx + R, cy + R);
  c.def(
    `<radialGradient id="${c.id("plate")}" gradientUnits="userSpaceOnUse" cx="${n2(X - L(R * 0.32))}" cy="${n2(Y - L(R * 0.38))}" r="${n2(L(R * 1.45))}">` +
      `<stop offset="0" stop-color="#1aa7e8"/><stop offset="0.45" stop-color="#008ccb"/><stop offset="1" stop-color="#004a6d"/></radialGradient>` +
      `<linearGradient id="${c.id("steel")}" gradientUnits="userSpaceOnUse" x1="${n2(X - L(R * 0.3))}" y1="${n2(Y - L(R * 0.3))}" x2="${n2(X + L(R * 0.3))}" y2="${n2(Y + L(R * 0.3))}">` +
      `<stop offset="0" stop-color="#f1f3f5"/><stop offset="0.48" stop-color="#a7afb6"/><stop offset="0.52" stop-color="#c3c9ce"/><stop offset="1" stop-color="#6d767e"/></linearGradient>`
  );
  /** @param {number} r @param {string} attrs */
  const ring = (r, attrs) => `<circle cx="${n2(X)}" cy="${n2(Y)}" r="${n2(L(r))}" ${attrs}/>`;
  let s = "";
  // Soft shadow, body, rim lip.
  s += ring(R + 1.6, `fill="#000000" fill-opacity="0.35"`);
  s += ring(R, `fill="url(#${c.id("plate")})"`);
  s += ring(R - 1.1, `fill="none" stroke="#00314a" stroke-opacity="0.55" stroke-width="${n2(L(2.2))}"`);
  s += ring(R - 2.6, `fill="none" stroke="#5fd0ff" stroke-opacity="0.35" stroke-width="${n2(L(0.35))}"`);
  // Rim ticks.
  let ticks = "";
  const nTicks = 120;
  for (let i = 0; i < nTicks; i++) {
    const a = (i / nTicks) * Math.PI * 2;
    const major = i % 10 === 0;
    const r1 = R - (major ? 9.2 : 7.4);
    const r2 = R - 4.4;
    ticks += `M${n2(X + Math.cos(a) * L(r1))} ${n2(Y + Math.sin(a) * L(r1))}L${n2(X + Math.cos(a) * L(r2))} ${n2(Y + Math.sin(a) * L(r2))}`;
  }
  s += `<path d="${ticks}" stroke="#ffffff" stroke-opacity="0.42" stroke-width="${n2(L(0.42))}" stroke-linecap="round" fill="none"/>`;
  // Concentric grooves (embossed: dark line + light line).
  for (const k of [0.74, 0.7]) {
    s += ring(R * k, `fill="none" stroke="#003a57" stroke-opacity="0.6" stroke-width="${n2(L(0.9))}"`);
    s += ring(R * k + 0.55, `fill="none" stroke="#7fd8ff" stroke-opacity="0.32" stroke-width="${n2(L(0.35))}"`);
  }
  // Raised inner face.
  s += ring(R * 0.47, `fill="#007cb6" fill-opacity="0.65" stroke="#4cc6fa" stroke-opacity="0.45" stroke-width="${n2(L(0.45))}"`);
  // Steel hub, collar ring, centre hole.
  s += ring(R * 0.27, `fill="url(#${c.id("steel")})" stroke="#2f363c" stroke-width="${n2(L(0.5))}"`);
  s += ring(R * 0.205, `fill="none" stroke="#59626a" stroke-opacity="0.75" stroke-width="${n2(L(0.4))}"`);
  s += ring(R * 0.14, `fill="#0b0c0e" stroke="#1d2125" stroke-width="${n2(L(1.1))}"`);
  // Highlight arc, top left.
  const a0 = Math.PI * 1.08;
  const a1 = Math.PI * 1.42;
  const rh = R - 5.6;
  s +=
    `<path d="M${n2(X + Math.cos(a0) * L(rh))} ${n2(Y + Math.sin(a0) * L(rh))}A${n2(L(rh))} ${n2(L(rh))} 0 0 1 ` +
    `${n2(X + Math.cos(a1) * L(rh))} ${n2(Y + Math.sin(a1) * L(rh))}" fill="none" stroke="#ffffff" stroke-opacity="0.16" stroke-width="${n2(L(1.6))}" stroke-linecap="round"/>`;
  c.add("decor", `<g>${s}</g>`, { x1: box.x1 - c.len(1.6), y1: box.y1 - c.len(1.6), x2: box.x2 + c.len(1.6), y2: box.y2 + c.len(1.6) });
}

/** @param {Panel} c */
function decorTraining(c) {
  c.def(
    `<radialGradient id="${c.id("bg")}" gradientUnits="userSpaceOnUse" cx="${n2(c.p(c.W * 0.78))}" cy="${n2(c.p(c.H * 0.55))}" r="${n2(c.len(Math.max(c.W, c.H) * 0.9))}">` +
      `<stop offset="0" stop-color="#1a1f24"/><stop offset="0.6" stop-color="#111316"/><stop offset="1" stop-color="#0b0c0e"/></radialGradient>`
  );
  c.fill(`url(#${c.id("bg")})`);
  if (c.isSquare) weightPlate(c, c.W * 0.98, c.H * 1.0, c.W * 0.58);
  else weightPlate(c, c.W * 0.935, c.H * 0.5, c.H * 0.58);
}

/**
 * The photo design without a photo (storefront placeholder): neutral dark.
 * @param {Panel} c
 */
function decorPhotoPlaceholder(c) {
  c.def(
    `<linearGradient id="${c.id("bg")}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${n2(c.widthPx)}" y2="${n2(c.heightPx)}">` +
      `<stop offset="0" stop-color="#3a4249"/><stop offset="1" stop-color="#16191c"/></linearGradient>`
  );
  c.fill(`url(#${c.id("bg")})`);
  photoShade(c);
}

/**
 * Legibility shades over a photo: the lower part (from 36 % of the height,
 * already half dark where the eyebrow sits) and a top band for the
 * wordmark — white lettering stays readable on a bright photo (snow, sky,
 * a white wall: eyebrow ≥ 4.5 : 1).
 * @param {Panel} c
 */
function photoShade(c) {
  const from = c.H * 0.36;
  c.def(
    `<linearGradient id="${c.id("shade-b")}" gradientUnits="userSpaceOnUse" x1="0" y1="${n2(c.p(from))}" x2="0" y2="${n2(c.heightPx)}">` +
      `<stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="0.28" stop-color="#000" stop-opacity="0.52"/>` +
      `<stop offset="1" stop-color="#000" stop-opacity="0.82"/></linearGradient>` +
      `<linearGradient id="${c.id("shade-t")}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${n2(c.p(c.H * 0.3))}">` +
      `<stop offset="0" stop-color="#000" stop-opacity="0.62"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>`
  );
  c.add("decor", `<rect x="0" y="${n2(c.p(from))}" width="${n2(c.widthPx)}" height="${n2(c.heightPx - c.p(from))}" fill="url(#${c.id("shade-b")})"/>`, c.box(-c.B, from, c.W + c.B, c.H + c.B));
  c.add("decor", `<rect x="0" y="0" width="${n2(c.widthPx)}" height="${n2(c.p(c.H * 0.3))}" fill="url(#${c.id("shade-t")})"/>`, c.box(-c.B, -c.B, c.W + c.B, c.H * 0.3));
}

/** A data URI we embed: JPEG/PNG/WebP base64 only. @param {unknown} uri */
function safeDataUri(uri) {
  return typeof uri === "string" && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(uri) ? uri : null;
}

/** @param {Panel} c @param {string} uri */
function decorPhoto(c, uri) {
  c.fill("#1b1d20");
  c.add(
    "image",
    `<image x="0" y="0" width="${n2(c.widthPx)}" height="${n2(c.heightPx)}" preserveAspectRatio="xMidYMid slice" xlink:href="${escAttr(uri)}"/>`,
    c.box(-c.B, -c.B, c.W + c.B, c.H + c.B)
  );
  photoShade(c);
}

/** @type {Record<string, (c: Panel) => void>} */
const DECOR = {
  classic: decorClassic,
  birthday: decorBirthday,
  christmas: decorChristmas,
  thanks: decorThanks,
  training: decorTraining,
  photo: decorPhotoPlaceholder,
};

/** @type {Record<string, "left" | "center" | "photo">} */
const FRONT_ALIGN = { classic: "left", birthday: "center", christmas: "center", thanks: "left", training: "left", photo: "photo" };

// ---------------------------------------------------------------------------
// Front lettering
// ---------------------------------------------------------------------------

/**
 * The value „50 €“ as one typographic unit: the number in Montserrat 800,
 * the euro sign smaller on the same baseline.
 * @param {Panel} c @param {GiftVoucherFonts} fonts @param {ResolvedData} d
 */
function valueMetrics(c, fonts, d) {
  const parts = valueParts(d.amountCents, d.locale);
  const curK = 0.56;
  const gapK = parts.curFirst ? 0.05 : 0.09;
  const em = emWidth(fonts.extrabold, parts.num) + gapK + emWidth(fonts.extrabold, parts.cur) * curK;
  return { parts, curK, gapK, em };
}

/**
 * @param {Panel} c @param {GiftVoucherFonts} fonts @param {ResolvedData} d
 * @param {number} x @param {number} baseline @param {number} V @param {string} fill @param {"start" | "middle"} anchor
 */
function drawValue(c, fonts, d, x, baseline, V, fill, anchor) {
  const { parts, curK, gapK, em } = valueMetrics(c, fonts, d);
  let x0 = anchor === "middle" ? x - (em * V) / 2 : x;
  const numW = emWidth(fonts.extrabold, parts.num) * V;
  const curW = emWidth(fonts.extrabold, parts.cur) * V * curK;
  if (parts.curFirst) {
    c.text("value", fonts.extrabold, parts.cur, x0, baseline, V * curK, { fill });
    x0 += curW + gapK * V;
    c.text("value", fonts.extrabold, parts.num, x0, baseline, V, { fill });
  } else {
    c.text("value", fonts.extrabold, parts.num, x0, baseline, V, { fill });
    c.text("value", fonts.extrabold, parts.cur, x0 + numW + gapK * V, baseline, V * curK, { fill });
  }
}

/**
 * „für Lena“: "für" light, the name semibold; shrinks, then shortens to fit.
 * @param {Panel} c @param {GiftVoucherFonts} fonts @param {ResolvedData} d @param {number} size @param {number} maxW
 */
function nameMetrics(c, fonts, d, size, maxW) {
  if (!d.recipientName) return null;
  const lead = `${d.copy.forWord} `;
  let name = printable(fonts.semibold, d.recipientName).replace(/\n/g, " ").trim();
  if (!name) return null;
  const emOf = (/** @type {string} */ n) => emWidth(fonts.regular, lead) + emWidth(fonts.semibold, n);
  let s = size;
  if (emOf(name) * s > maxW) s = Math.max(size * 0.62, maxW / emOf(name));
  if (emOf(name) * s > maxW) name = ellipsize(fonts.semibold, name, maxW / s - emWidth(fonts.regular, lead));
  return { lead, name, size: s, width: emOf(name) * s };
}

/**
 * @param {Panel} c @param {GiftVoucherFonts} fonts @param {ResolvedData} d
 * @param {{ lead: string, name: string, size: number, width: number }} nm
 * @param {number} x @param {number} baseline @param {string} fill @param {"start" | "middle"} anchor
 */
function drawName(c, fonts, d, nm, x, baseline, fill, anchor) {
  const x0 = anchor === "middle" ? x - nm.width / 2 : x;
  const leadW = emWidth(fonts.regular, nm.lead) * nm.size;
  c.text("text", fonts.regular, nm.lead, x0, baseline, nm.size, { fill, opacity: 0.86 });
  c.text("text", fonts.semibold, nm.name, x0 + leadW, baseline, nm.size, { fill });
}

/**
 * The lettering of a front.
 * @param {Panel} c @param {GiftVoucherFonts} fonts @param {ResolvedData} d @param {string} key
 */
function frontLettering(c, fonts, d, key) {
  const th = THEMES[key] ?? THEMES.classic;
  const col = th.front;
  const align = FRONT_ALIGN[key] ?? "left";
  const sq = c.isSquare;
  const M = sq ? 13 : 14;
  const sizes = sq
    ? { wordmark: 4.7, eyebrow: 2.85, name: 5.7, url: 2.65, valueMax: 40 }
    : { wordmark: 5.3, eyebrow: 3.05, name: 6.4, url: 2.75, valueMax: 47 };
  const center = align === "center";
  const anchor = center ? "middle" : "start";
  const xText = center ? c.W / 2 : M;

  // Wordmark (top) and site (bottom).
  const wmBase = M + 0.74 * sizes.wordmark;
  if (align === "photo") {
    c.text("text", fonts.semibold, WORDMARK, M, wmBase, sizes.wordmark, { fill: col.wordmark });
  } else {
    c.text("text", fonts.semibold, WORDMARK, xText, wmBase, sizes.wordmark, { fill: col.wordmark, anchor });
  }
  const urlTop = key === "thanks";
  const urlBase = c.H - M;
  const urlAnchor = align === "photo" || urlTop ? "end" : anchor;
  const urlX = align === "photo" || urlTop ? c.W - M : xText;
  c.text("text", fonts.semibold, SITE, urlX, urlTop ? wmBase : urlBase, sizes.url, { fill: col.url, anchor: urlAnchor, tracking: 0.08 });

  // Middle block: eyebrow — value — „für Lena“.
  const maxW = (() => {
    if (center) return c.W - 2 * M - 8;
    if (key === "training") return sq ? c.W * 0.52 : c.W * 0.42;
    if (key === "classic") return sq ? c.W * 0.62 : c.W * 0.5;
    if (key === "thanks") return sq ? c.W * 0.6 : c.W * 0.45;
    return c.W * 0.62; // photo
  })();
  const vm = valueMetrics(c, fonts, d);
  const valueMax = align === "photo" ? (sq ? 30 : 34) : sizes.valueMax;
  const V = Math.min(valueMax, maxW / vm.em);
  const nm = nameMetrics(c, fonts, d, sizes.name, center ? c.W - 2 * M : maxW + (key === "training" ? 0 : 16));
  const capE = 0.7 * sizes.eyebrow;
  const capV = 0.7 * V;
  const gap1 = Math.max(4.2, V * 0.2);
  const gap2 = Math.max(4.4, V * 0.2);
  const capN = nm ? 0.7 * nm.size : 0;
  const blockH = capE + gap1 + capV + (nm ? gap2 + capN : 0);
  let top;
  if (align === "photo") {
    top = c.H - M - (sq ? 8 : 9) - blockH;
  } else {
    const avTop = wmBase + 6;
    const avBottom = urlBase - sizes.url - 6;
    const bias = key === "training" && sq ? -0.17 : 0;
    top = avTop + (avBottom - avTop - blockH) / 2 + (avBottom - avTop) * bias;
  }
  const eyebrowBase = top + capE;
  const valueBase = eyebrowBase + gap1 + capV;
  const nameBase = valueBase + gap2 + capN;

  const eyebrowTracking = 0.32;
  if (center && key === "christmas") {
    // A gold star above, hairlines either side of the eyebrow.
    const wE = c.measure(fonts.semibold, d.copy.eyebrow, sizes.eyebrow, eyebrowTracking);
    const yMid = eyebrowBase - capE / 2;
    const gap = 3.2;
    const lineL = sq ? 10 : 14;
    c.rect(xText - wE / 2 - gap - lineL, yMid - 0.14, lineL, 0.28, `fill="${col.rule}" fill-opacity="0.85"`);
    c.rect(xText + wE / 2 + gap, yMid - 0.14, lineL, 0.28, `fill="${col.rule}" fill-opacity="0.85"`);
    const R = sq ? 2.4 : 2.7;
    const sy = eyebrowBase - capE - (sq ? 5.4 : 6.2) - R;
    c.add("decor", `<path d="${sparklePath(c.p(xText), c.p(sy), c.len(R))}" fill="${col.rule}"/>`, c.box(xText - R, sy - R, xText + R, sy + R));
  } else if (center) {
    const wE = c.measure(fonts.semibold, d.copy.eyebrow, sizes.eyebrow, eyebrowTracking);
    const yMid = eyebrowBase - capE / 2;
    const gap = 3.2;
    const dot = 0.75;
    c.circle(xText - wE / 2 - gap - dot, yMid, dot, `fill="${col.rule}"`);
    c.circle(xText + wE / 2 + gap + dot, yMid, dot, `fill="${col.rule}"`);
  } else {
    // A short accent bar above the eyebrow.
    const barW = sq ? 9 : 10;
    c.rect(xText, eyebrowBase - capE - 3.6, barW, 0.7, `fill="${col.rule}"`);
  }
  c.text("text", fonts.semibold, d.copy.eyebrow, xText, eyebrowBase, sizes.eyebrow, { fill: col.eyebrow, tracking: eyebrowTracking, anchor });

  let valueFill = col.value;
  if (col.value === "url(#champagne)") {
    const id = c.id("champagne");
    c.def(
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${n2(c.p(valueBase - capV))}" x2="${n2(c.len(V * 0.35))}" y2="${n2(c.p(valueBase + 0.02 * V))}">` +
        `<stop offset="0" stop-color="#fbf4e2"/><stop offset="0.38" stop-color="#ead9b0"/><stop offset="0.5" stop-color="#c8ab72"/>` +
        `<stop offset="0.62" stop-color="#e5d1a3"/><stop offset="1" stop-color="#b99c63"/></linearGradient>`
    );
    valueFill = `url(#${id})`;
  }
  drawValue(c, fonts, d, xText, valueBase, V, valueFill, anchor);
  if (nm) drawName(c, fonts, d, nm, xText, nameBase, col.name, anchor);
}

// ---------------------------------------------------------------------------
// Inside: message, code card, footer
// ---------------------------------------------------------------------------

/**
 * The small design motif inside the card (mm, centred on cx/cy).
 * @param {Panel} c @param {string} key @param {number} cx @param {number} cy @param {number} k scale
 */
function motif(c, key, cx, cy, k = 1) {
  const th = THEMES[key] ?? THEMES.classic;
  switch (key) {
    case "classic": {
      // Three knurl diamonds.
      for (let i = -1; i <= 1; i++) {
        const x = cx + i * 3.6 * k;
        const w = 1.5 * k;
        const h = 1.05 * k;
        c.add(
          "decor",
          `<path d="M${n2(c.p(x))} ${n2(c.p(cy - h))}L${n2(c.p(x + w))} ${n2(c.p(cy))}L${n2(c.p(x))} ${n2(c.p(cy + h))}L${n2(c.p(x - w))} ${n2(c.p(cy))}Z" fill="${i === 0 ? th.motif2 : th.motif}"/>`,
          c.box(x - w, cy - h, x + w, cy + h)
        );
      }
      return;
    }
    case "birthday":
      confetti(c, { region: { x1: cx - 9 * k, y1: cy - 3.5 * k, x2: cx + 9 * k, y2: cy + 3.5 * k }, count: 6, seed: `birthday-motif-${n2(cx)}-${n2(cy)}`, scale: 0.85 * k });
      return;
    case "christmas": {
      const R = 2.3 * k;
      c.add("decor", `<path d="${sparklePath(c.p(cx), c.p(cy), c.len(R))}" fill="${th.motif}"/>`, c.box(cx - R, cy - R, cx + R, cy + R));
      const r2 = 1.0 * k;
      for (const dx of [-5.2, 5.2]) {
        c.add("decor", `<path d="${sparklePath(c.p(cx + dx * k), c.p(cy + 0.8 * k), c.len(r2))}" fill="${th.motif}" fill-opacity="0.7"/>`, c.box(cx + dx * k - r2, cy + 0.8 * k - r2, cx + dx * k + r2, cy + 0.8 * k + r2));
      }
      return;
    }
    case "thanks":
      waves(c, { x0: cx - 11 * k, x1: cx + 11 * k, y0: cy + 0.6 * k, y1: cy - 0.6 * k, amp: 0.9 * k, spread0: 3 * k, spread1: 3 * k, lines: 4, width: 1.1 });
      return;
    case "training": {
      // A small barbell: bar, collars, two plates each side.
      const r = (/** @type {number} */ v) => n2(c.len(v));
      c.rect(cx - 10 * k, cy - 0.32 * k, 20 * k, 0.64 * k, `fill="${th.motif2}" rx="${r(0.32 * k)}"`);
      for (const side of [-1, 1]) {
        c.rect(cx + side * 5.6 * k - 0.45 * k, cy - 1.2 * k, 0.9 * k, 2.4 * k, `fill="${th.motif2}" rx="${r(0.3 * k)}"`);
        c.rect(cx + side * 7.0 * k - 0.7 * k, cy - 3.0 * k, 1.4 * k, 6.0 * k, `fill="${th.motif}" rx="${r(0.45 * k)}"`);
        c.rect(cx + side * 8.6 * k - 0.6 * k, cy - 2.2 * k, 1.2 * k, 4.4 * k, `fill="${th.motif}" rx="${r(0.4 * k)}"`);
      }
      return;
    }
    default:
      for (const [i, dx] of [-3.4, 0, 3.4].entries()) {
        c.circle(cx + dx * k, cy, (i === 1 ? 0.75 : 0.55) * k, `fill="${i === 1 ? th.motif : th.motif2}"`);
      }
  }
}

/**
 * The personal message in Caveat, as large as fits, plus „— Jonas“.
 * @param {Panel} c @param {GiftVoucherFonts} fonts @param {ResolvedData} d @param {string} key
 * @param {{ x: number, y: number, w: number, h: number }} box mm
 * @param {{ maxSize: number, minSize: number }} sizes
 */
function drawMessage(c, fonts, d, key, box, sizes) {
  const th = THEMES[key] ?? THEMES.classic;
  const font = fonts.script;
  let text = printable(font, d.message).trim();
  let isDefault = d.isDefaultMessage;
  if (!text) {
    // Nothing drawable left (e.g. only emoji): the design's line instead.
    text = printable(font, d.defaultMessage);
    isDefault = true;
  }
  const sender = d.senderName ? printable(fonts.scriptBold, d.senderName).replace(/\n/g, " ").trim() : "";
  const senderLabel = sender ? `— ${sender}` : "";
  const LH = 1.2;
  const blank = 0.5;
  // The sender line shrinks to the column (a 40-character „Von“ stays above
  // 7 pt in the narrowest column); only a longer one is shortened below.
  const senderFit = sender ? Math.max(SMALL, box.w / emWidth(fonts.scriptBold, senderLabel)) : Infinity;
  /** @param {number} s */
  const layout = (s) => {
    const lines = wrapEm(font, text, box.w / s);
    let h = 0;
    lines.forEach((l, i) => {
      if (i > 0) h += (l === "" ? blank : 1) * LH * s;
    });
    h += 0.95 * s;
    const ss = Math.min(s * 0.92, sizes.maxSize * 0.8, senderFit);
    const senderH = sender ? 0.62 * s + 0.95 * ss : 0;
    return { lines, h: h + senderH, ss };
  };
  let lo = sizes.minSize;
  let hi = isDefault ? sizes.maxSize * 1.15 : sizes.maxSize;
  if (layout(hi).h <= box.h) lo = hi;
  else {
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (layout(mid).h <= box.h) lo = mid;
      else hi = mid;
    }
  }
  const s = lo;
  const { lines: rawLines, ss } = layout(s);
  // The lines that fit, counted the way layout() measures them (an empty line
  // is half a line) — all of them unless even the minimum size is too big.
  // Only that last case is cut, with an ellipsis (a safety net: the core's
  // limits of 350 characters and 8 lines always fit).
  let lines = rawLines;
  const room = box.h - 0.95 * s - (sender ? 0.62 * s + 0.95 * ss : 0);
  let maxLines = 1;
  for (let i = 1, used = 0; i < rawLines.length; i++) {
    used += (rawLines[i] === "" ? blank : 1) * LH * s;
    if (used > room + 1e-6) break;
    maxLines = i + 1;
  }
  // A cut never ends on an empty line (the ellipsis goes onto words).
  while (maxLines > 1 && rawLines.length > maxLines && rawLines[maxLines - 1] === "") maxLines--;
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = ellipsize(font, `${lines[maxLines - 1]}…`, box.w / s);
  }
  const widest = Math.max(...lines.map((l) => emWidth(font, l) * s), sender ? emWidth(fonts.scriptBold, senderLabel) * ss : 0);
  const blockW = Math.min(box.w, widest);
  // Height of the block as laid out → vertical centre.
  let h = 0;
  lines.forEach((l, i) => {
    if (i > 0) h += (l === "" ? blank : 1) * LH * s;
  });
  const total = h + 0.95 * s + (sender ? 0.62 * s + 0.95 * ss : 0);
  const x0 = box.x + (box.w - blockW) / 2;
  let y = box.y + (box.h - total) / 2 + 0.72 * s;
  let dPath = "";
  /** @type {GiftVoucherBox | null} */
  let bbox = null;
  lines.forEach((l, i) => {
    if (i > 0) y += (l === "" ? blank : 1) * LH * s;
    if (!l) return;
    const path = font.getPath(l, c.p(x0), c.p(y), c.len(s));
    const pd = path.toPathData(2);
    if (!pd) return;
    dPath += pd;
    const bb = path.getBoundingBox();
    bbox = unionBox(bbox, { x1: bb.x1, y1: bb.y1, x2: bb.x2, y2: bb.y2 });
  });
  if (dPath) c.add("text", `<path d="${dPath}" fill="${th.script}"/>`, bbox);
  if (sender) {
    const sy = y + 0.3 * s + 0.95 * ss;
    // (1 + 1e-9: ss may be exactly the column's width — no cut for rounding.)
    const maxEm = (box.w / ss) * (1 + 1e-9);
    c.text("text", fonts.scriptBold, ellipsize(fonts.scriptBold, senderLabel, maxEm), x0 + blockW, sy, ss, { fill: th.script, anchor: "end" });
  }
  return { top: box.y + (box.h - total) / 2, cx: x0 + blockW / 2 };
}

/**
 * The code „ABCD EFGH JKLM NPQR“ in tabular cells: each character centred in
 * a cell of at least `cell` em, groups of four apart.
 * @param {GiftVoucherFont} font @param {string} code
 */
function codeCells(font, code) {
  const cell = 0.8;
  const groupGap = 0.62;
  /** @type {Array<{ ch: string, x: number }>} */
  const items = [];
  let x = 0;
  code.split(" ").filter(Boolean).forEach((group, gi) => {
    if (gi > 0) x += groupGap;
    for (const ch of group) {
      if (!hasGlyph(font, ch)) continue;
      const adv = emWidth(font, ch);
      const w = Math.max(adv, cell);
      items.push({ ch, x: x + (w - adv) / 2 });
      x += w;
    }
  });
  return { items, width: x };
}

/**
 * @param {Panel} c @param {GiftVoucherFont} font @param {string} code @param {number} x mm @param {number} baseline mm
 * @param {number} size mm @param {string} fill @param {"start" | "middle"} anchor
 */
function drawCode(c, font, code, x, baseline, size, fill, anchor) {
  const cells = codeCells(font, code);
  const x0 = anchor === "middle" ? x - (cells.width * size) / 2 : x;
  let d = "";
  /** @type {GiftVoucherBox | null} */
  let bbox = null;
  for (const it of cells.items) {
    const path = font.getPath(it.ch, c.p(x0 + it.x * size), c.p(baseline), c.len(size));
    d += path.toPathData(2);
    const bb = path.getBoundingBox();
    bbox = unionBox(bbox, { x1: bb.x1, y1: bb.y1, x2: bb.x2, y2: bb.y2 });
  }
  if (d) c.add("code", `<path d="${d}" fill="${fill}"/>`, bbox);
  return bbox;
}

/**
 * The QR code: dark modules as one path of row runs on a white quiet zone,
 * snapped to whole pixels when they are big enough.
 * @param {Panel} c @param {GiftVoucherQrMatrix | null | undefined} m @param {number} x mm @param {number} y mm
 * @param {number} size mm (incl. quiet zone) @param {string} dark
 */
function drawQr(c, m, x, y, size, dark) {
  const n = m && Number.isInteger(m.size) && m.size > 0 && m.size <= 200 ? m.size : 0;
  if (!n || !m) return null;
  const quiet = 3;
  const total = n + 2 * quiet;
  const want = c.len(size);
  let mod = want / total;
  if (mod >= 2.5) mod = Math.floor(mod);
  const side = mod * total;
  const x0 = c.p(x) + (want - side) / 2;
  const y0 = c.p(y) + (want - side) / 2;
  const X0 = mod >= 2 ? Math.round(x0) : x0;
  const Y0 = mod >= 2 ? Math.round(y0) : y0;
  const dark1 = (/** @type {number} */ r, /** @type {number} */ col) =>
    Boolean(typeof m.get === "function" ? m.get(r, col) : m.data ? m.data[r * n + col] : 0);
  let d = "";
  for (let r = 0; r < n; r++) {
    let col = 0;
    while (col < n) {
      if (!dark1(r, col)) {
        col++;
        continue;
      }
      let run = 1;
      while (col + run < n && dark1(r, col + run)) run++;
      d += `M${n2(X0 + (quiet + col) * mod)} ${n2(Y0 + (quiet + r) * mod)}h${n2(run * mod)}v${n2(mod)}h${n2(-run * mod)}z`;
      col += run;
    }
  }
  const bbox = { x1: X0, y1: Y0, x2: X0 + side, y2: Y0 + side };
  c.add(
    "qr",
    `<g><rect x="${n2(X0)}" y="${n2(Y0)}" width="${n2(side)}" height="${n2(side)}" rx="${n2(mod * 1.2)}" fill="#ffffff"/>` +
      `<path d="${d}" fill="${dark}"/></g>`,
    bbox
  );
  return { x: (X0 - c.bleedPx) / c.S, y: (Y0 - c.bleedPx) / c.S, size: side / c.S };
}

/**
 * Words with fonts → lines within `maxW` mm (a lead in semibold, then regular).
 * @param {Panel} c @param {Array<{ text: string, font: GiftVoucherFont }>} runs @param {number} size @param {number} maxW
 * @param {GiftVoucherFont} spaceFont
 */
function wrapRuns(c, runs, size, maxW, spaceFont) {
  /** @type {Array<{ word: string, font: GiftVoucherFont }>} */
  const words = [];
  for (const r of runs) for (const w of printable(r.font, r.text).split(" ").filter(Boolean)) words.push({ word: w, font: r.font });
  const space = emWidth(spaceFont, " ") * size;
  /** @type {Array<Array<{ word: string, font: GiftVoucherFont, w: number }>>} */
  const lines = [];
  let cur = /** @type {Array<{ word: string, font: GiftVoucherFont, w: number }>} */ ([]);
  let width = 0;
  for (const w of words) {
    const ww = emWidth(w.font, w.word) * size;
    if (cur.length && width + space + ww > maxW) {
      lines.push(cur);
      cur = [];
      width = 0;
    }
    cur.push({ ...w, w: ww });
    width += (cur.length > 1 ? space : 0) + ww;
  }
  if (cur.length) lines.push(cur);
  return { lines, space };
}

/**
 * Draw wrapped runs; returns the last baseline.
 * @param {Panel} c @param {ReturnType<typeof wrapRuns>} wrapped @param {number} x @param {number} y first baseline
 * @param {number} size @param {number} lineH @param {string} fill @param {"start" | "middle"} [anchor] @param {number} [boxW]
 */
function drawRuns(c, wrapped, x, y, size, lineH, fill, anchor = "start", boxW = 0) {
  let base = y;
  wrapped.lines.forEach((line, i) => {
    if (i > 0) base += lineH;
    const lineW = line.reduce((s, w, k) => s + w.w + (k ? wrapped.space : 0), 0);
    let xx = anchor === "middle" ? x + (boxW - lineW) / 2 : x;
    for (const w of line) {
      c.text("text", w.font, w.word, xx, base, size, { fill });
      xx += w.w + wrapped.space;
    }
  });
  return base;
}

const FOOTER_SEP = "  ·  ";

/**
 * Footer items joined with „ · “ into as few lines as fit (an item longer
 * than a line is shortened).
 * @param {Panel} c @param {GiftVoucherFonts} fonts @param {string[]} items @param {number} size @param {number} maxW
 * @returns {string[][]}
 */
function packFooter(c, fonts, items, size, maxW) {
  /** @type {string[][]} */
  const lines = [];
  /** @type {string[]} */
  let cur = [];
  for (const raw of items) {
    const it = c.measure(fonts.regular, raw, size) > maxW ? ellipsize(fonts.regular, raw, maxW / size) : raw;
    if (cur.length && c.measure(fonts.regular, [...cur, it].join(FOOTER_SEP), size) > maxW) {
      lines.push(cur);
      cur = [];
    }
    cur.push(it);
  }
  if (cur.length) lines.push(cur);
  return lines;
}

/**
 * The code card: label, code, rule, QR + value/validity, how to redeem.
 * Returns its height (mm) when `measureOnly`.
 * @param {Panel} c @param {GiftVoucherFonts} fonts @param {ResolvedData} d @param {string} key
 * @param {{ x: number, y: number, w: number }} box @param {GiftVoucherQrMatrix | null | undefined} qr
 * @param {{ pad: number, label: number, codeMax: number, qr: number, valueSize: number, dateSize: number, text: number, card: boolean }} sz
 * @param {boolean} measureOnly
 */
function infoCard(c, fonts, d, key, box, qr, sz, measureOnly) {
  const th = THEMES[key] ?? THEMES.classic;
  const P = sz.pad;
  const iw = box.w - 2 * P;
  const x = box.x + P;
  const cap = (/** @type {number} */ s) => 0.7 * s;
  const y = box.y + P;
  // Label.
  const labelBase = y + cap(sz.label);
  // Code.
  const cells = codeCells(fonts.bold, d.code);
  const codeSize = Math.min(sz.codeMax, iw / cells.width);
  const codeBase = labelBase + 3.6 + cap(codeSize);
  const ruleY = codeBase + Math.max(3.8, codeSize * 0.62);
  const qrTop = ruleY + 4.6;
  const qrSize = qr ? sz.qr : 0;
  const capY = qrTop + qrSize + 3.9;
  // Value and validity, right of the QR (or below the rule without one).
  const colX = qr ? x + qrSize + 6 : x;
  const l1 = qrTop + 1.6 + cap(sz.label);
  const v1 = l1 + 2.4 + cap(sz.valueSize);
  const l2 = v1 + 5.2 + cap(sz.label);
  const v2 = l2 + 2.4 + cap(sz.dateSize);
  const colBottom = v2 + 1.2;
  // How to redeem.
  const runs = [
    { text: d.copy.redeemLead, font: fonts.semibold },
    { text: d.copy.redeemText, font: fonts.regular },
  ];
  const wrapped = wrapRuns(c, runs, sz.text, iw, fonts.regular);
  const textLH = sz.text * 1.48;
  const textTop = Math.max(qr ? capY + 1.2 : 0, colBottom) + 4.8;
  const textBase = textTop + cap(sz.text);
  const lastBase = textBase + (wrapped.lines.length - 1) * textLH;
  const height = lastBase + 0.25 * sz.text + P - box.y;
  if (measureOnly) return height;

  if (sz.card) {
    c.rect(box.x, box.y, box.w, height, `rx="${n2(c.len(2.6))}" fill="${th.card}" stroke="${th.cardLine}" stroke-width="${n2(c.len(0.3))}"`);
  }
  c.text("text", fonts.semibold, d.copy.codeLabel, x, labelBase, sz.label, { fill: th.eyebrow, tracking: 0.24 });
  drawCode(c, fonts.bold, d.code, x, codeBase, codeSize, th.ink, "start");
  c.rect(x, ruleY, iw, 0.25, `fill="${th.cardLine}"`);
  if (qr) {
    drawQr(c, qr, x, qrTop, qrSize, th.qrDark);
    c.text("text", fonts.regular, d.copy.qrCaption, x + qrSize / 2, capY, sz.label, { fill: th.label, anchor: "middle" });
  }
  c.text("text", fonts.semibold, d.copy.valueLabel, colX, l1, sz.label, { fill: th.label, tracking: 0.18 });
  c.text("text", fonts.bold, formatEuro(d.amountCents, d.locale), colX, v1, sz.valueSize, { fill: th.ink });
  c.text("text", fonts.semibold, d.expiry ? d.copy.validLabel : d.copy.validityLabel, colX, l2, sz.label, { fill: th.label, tracking: 0.18 });
  c.text("text", fonts.semibold, d.expiry ?? d.copy.validForever, colX, v2, sz.dateSize, { fill: th.ink });
  drawRuns(c, wrapped, x, textBase, sz.text, textLH, th.soft);
  return height;
}

/**
 * The footer: issuer · voucher number · terms. The number is its own element
 * (role "number") so the PDF can put its copyable text right over it.
 * @param {Panel} c @param {GiftVoucherFonts} fonts @param {ResolvedData} d @param {string} key
 * @param {{ x: number, w: number, lastBaseline: number, anchor: "start" | "middle" }} o
 */
function drawFooter(c, fonts, d, key, o) {
  const th = THEMES[key] ?? THEMES.classic;
  const size = SMALL;
  const lh = size * 1.45;
  const numberItem = `${d.copy.numberLabel} ${d.number}`;
  const items = [d.issuerLine, numberItem, `${d.copy.termsLabel} ${d.terms}`];
  const lines = packFooter(c, fonts, items, size, o.w);
  const first = o.lastBaseline - (lines.length - 1) * lh;
  const sepW = c.measure(fonts.regular, FOOTER_SEP, size);
  lines.forEach((line, i) => {
    const widths = line.map((it) => c.measure(fonts.regular, it, size));
    const total = widths.reduce((a, b) => a + b, 0) + sepW * (line.length - 1);
    let x = o.anchor === "middle" ? o.x + (o.w - total) / 2 : o.x;
    const y = first + i * lh;
    line.forEach((it, k) => {
      if (k > 0) {
        c.text("text", fonts.regular, FOOTER_SEP, x, y, size, { fill: th.label });
        x += sepW;
      }
      const role = it === numberItem && !d.sample && d.number !== "—" ? "number" : "text";
      c.text(role, fonts.regular, it, x, y, size, { fill: th.label });
      x += widths[k];
    });
  });
  return { top: first - 0.7 * size, lines: lines.length };
}

/** @param {Panel} c @param {string} key */
function paper(c, key) {
  const th = THEMES[key] ?? THEMES.classic;
  c.fill(th.paper);
}

/** Landscape inside: message left, code card right, footer across. @param {Panel} c @param {GiftVoucherFonts} fonts @param {ResolvedData} d @param {string} key @param {GiftVoucherQrMatrix | null | undefined} qr */
function insideLandscape(c, fonts, d, key, qr) {
  paper(c, key);
  const M = 13;
  const footer = drawFooter(c, fonts, d, key, { x: M, w: c.W - 2 * M, lastBaseline: c.H - 9.5, anchor: "middle" });
  const cardX = c.W * 0.47;
  const cardW = c.W - M - cardX;
  const sz = { pad: 8, label: 2.5, codeMax: 6.2, qr: 28, valueSize: 4.6, dateSize: 3.6, text: 2.7, card: true };
  const avTop = M;
  const avBottom = footer.top - 5.5;
  const h = /** @type {number} */ (infoCard(c, fonts, d, key, { x: cardX, y: 0, w: cardW }, qr, sz, true));
  const cardY = avTop + Math.max(0, (avBottom - avTop - h) / 2);
  infoCard(c, fonts, d, key, { x: cardX, y: cardY, w: cardW }, qr, sz, false);
  // Message column; the motif sits just above the message block.
  const colX = M + 1;
  const colW = cardX - colX - 9;
  const msgTop = avTop + 8;
  const msg = drawMessage(c, fonts, d, key, { x: colX, y: msgTop, w: colW, h: avBottom - msgTop }, { maxSize: 10.5, minSize: 3.6 });
  motif(c, key, msg.cx, msg.top - 5.5, 1);
}

/** Square inside, left: the message. @param {Panel} c @param {GiftVoucherFonts} fonts @param {ResolvedData} d @param {string} key */
function insideMessageSquare(c, fonts, d, key) {
  paper(c, key);
  const M = 15;
  const top = M + 8;
  const msg = drawMessage(c, fonts, d, key, { x: M, y: top, w: c.W - 2 * M, h: c.H - M - 2 - top }, { maxSize: 11.5, minSize: 3.8 });
  motif(c, key, msg.cx, msg.top - 6, 1.1);
}

/** Square inside, right: code card and footer. @param {Panel} c @param {GiftVoucherFonts} fonts @param {ResolvedData} d @param {string} key @param {GiftVoucherQrMatrix | null | undefined} qr */
function insideInfoSquare(c, fonts, d, key, qr) {
  paper(c, key);
  const M = 11;
  const footer = drawFooter(c, fonts, d, key, { x: M + 2, w: c.W - 2 * M - 4, lastBaseline: c.H - 11, anchor: "middle" });
  const sz = { pad: 9, label: 2.55, codeMax: 6.6, qr: 30, valueSize: 5.0, dateSize: 3.9, text: 2.75, card: true };
  const avTop = M;
  const avBottom = footer.top - 4.5;
  const h = /** @type {number} */ (infoCard(c, fonts, d, key, { x: M, y: 0, w: c.W - 2 * M }, qr, sz, true));
  const y = avTop + Math.max(0, (avBottom - avTop - h) / 2);
  infoCard(c, fonts, d, key, { x: M, y, w: c.W - 2 * M }, qr, sz, false);
}

/**
 * Square back: plain paper, the wordmark and the site at the bottom; the
 * address circle (Ø 95 mm around the centre) stays empty.
 * @param {Panel} c @param {GiftVoucherFonts} fonts @param {string} key
 */
function backSquare(c, fonts, key) {
  const th = THEMES[key] ?? THEMES.classic;
  c.fill(th.back);
  const cx = c.W / 2;
  const wmBase = c.H - 16.5;
  c.text("text", fonts.semibold, WORDMARK, cx, wmBase, 4.4, { fill: th.backWordmark, anchor: "middle" });
  c.text("text", fonts.semibold, SITE, cx, c.H - 10.6, 2.6, { fill: th.label, anchor: "middle", tracking: 0.08 });
  // The design motif, twice, left and right of the wordmark (outside the circle).
  motif(c, key, cx - 33, wmBase - 1.5, 0.8);
  motif(c, key, cx + 33, wmBase - 1.5, 0.8);
}

/**
 * A diagonal „MUSTER“ across a sample panel.
 * @param {Panel} c @param {GiftVoucherFonts} fonts @param {ResolvedData} d @param {boolean} dark
 */
function watermark(c, fonts, d, dark) {
  const text = d.copy.sample;
  const diag = Math.hypot(c.W, c.H);
  const size = (diag * 0.5) / emWidth(fonts.extrabold, text, 0.12);
  const angle = (-Math.atan2(c.H, c.W) * 180) / Math.PI;
  const cx = c.W / 2;
  const cy = c.H / 2 + 0.35 * size;
  const sizePx = c.len(size);
  const w = emWidth(fonts.extrabold, text, 0.12) * sizePx;
  const path = fonts.extrabold.getPath(text, c.p(cx) - w / 2, c.p(cy), sizePx, { letterSpacing: 0.12 });
  const fill = dark ? "#ffffff" : "#5d6870";
  c.add(
    "watermark",
    `<g transform="rotate(${n2(angle)} ${n2(c.p(c.W / 2))} ${n2(c.p(c.H / 2))})"><path d="${path.toPathData(2)}" fill="${fill}" fill-opacity="${dark ? "0.26" : "0.2"}"/></g>`,
    c.box(-c.B, -c.B, c.W + c.B, c.H + c.B)
  );
}

// ---------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------

/**
 * Drop the small scattered pieces (confetti, snow, stars) that would touch
 * the lettering — long names reach beyond the zone decorations keep clear.
 * @param {Panel} c
 */
function clearSprinkles(c) {
  const pad = c.len(3);
  const boxes = c.elements.filter((e) => (e.role === "text" || e.role === "value") && e.bbox).map((e) => /** @type {GiftVoucherBox} */ (e.bbox));
  c.elements = c.elements.filter(
    (e) =>
      e.role !== "sprinkle" ||
      !e.bbox ||
      !boxes.some((b) => e.bbox && e.bbox.x2 > b.x1 - pad && e.bbox.x1 < b.x2 + pad && e.bbox.y2 > b.y1 - pad && e.bbox.y1 < b.y2 + pad)
  );
}

/** @param {unknown} n @param {number} fallback */
function size(n, fallback) {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

/**
 * The decorative background layer of a design's front (no text, no photo) —
 * for the storefront's live preview. Unknown keys use "classic". `width` and
 * `height` are the box (any unit; ~1:1 is the square card, else landscape).
 * @param {unknown} key
 * @param {{ width?: number, height?: number }} [box]
 * @returns {string}
 */
export function giftVoucherBackgroundSvg(key, { width = 210, height = 148 } = {}) {
  const d = giftVoucherDesign(key) ?? GIFT_VOUCHER_DESIGNS[0];
  const w = size(width, 210);
  const h = size(height, 148);
  const square = Math.abs(w - h) / Math.max(w, h) < 0.12;
  const c = new Panel({
    widthPx: w,
    heightPx: h,
    bleedPx: 0,
    nominalWidthMm: square ? GIFT_VOUCHER_SQUARE_MM.width : GIFT_VOUCHER_LANDSCAPE_MM.width,
    idPrefix: `gv-${d.key}-${square ? "sq" : "ls"}`,
    raster: false,
  });
  (DECOR[d.key] ?? decorClassic)(c);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice">` +
    `${c.inner()}</svg>`
  );
}

/**
 * Lay out one panel: the SVG plus every element with its bounding box (px).
 * `layout` "landscape" → panels `front` | `inside` (210 mm wide);
 * "square" → `front` | `back` | `inside-message` | `inside-info` (140 mm
 * trim; `bleedPx` on every side). A photo design without a photo falls back
 * to "classic" on the front.
 * @param {{
 *   panel: GiftVoucherPanelKind,
 *   layout: "landscape" | "square",
 *   widthPx: number, heightPx: number, bleedPx?: number,
 *   design: Readonly<GiftVoucherDesign> | null, data?: GiftVoucherPanelData, fonts?: GiftVoucherFonts | null,
 *   photoDataUri?: string | null, qrMatrix?: GiftVoucherQrMatrix | null, idPrefix?: string,
 * }} input
 * @returns {GiftVoucherPanelLayout}
 */
export function layoutGiftVoucherPanel(input) {
  const design = input.design ?? GIFT_VOUCHER_DESIGNS[0];
  const fonts = input.fonts;
  if (!fonts) throw new TypeError("gift voucher panel: fonts missing");
  const layout = input.layout === "square" ? "square" : "landscape";
  const bleedPx = layout === "square" && typeof input.bleedPx === "number" && input.bleedPx > 0 ? input.bleedPx : 0;
  const widthPx = size(input.widthPx, 1000);
  const heightPx = size(input.heightPx, layout === "square" ? widthPx : Math.round((widthPx * 148) / 210));
  const panel = input.panel;
  const c = new Panel({
    widthPx,
    heightPx,
    bleedPx,
    nominalWidthMm: layout === "square" ? GIFT_VOUCHER_SQUARE_MM.width : GIFT_VOUCHER_LANDSCAPE_MM.width,
    idPrefix: input.idPrefix ?? `gv-${panel}-${layout}`,
  });
  const d = resolveData(input.data, design);
  const photo = safeDataUri(input.photoDataUri);
  let key = design.key;
  let darkFront = ["classic", "christmas", "training", "photo"].includes(key);

  if (panel === "front") {
    if (design.photo && !photo) key = "classic";
    if (key === "photo" && photo) decorPhoto(c, photo);
    else (DECOR[key] ?? decorClassic)(c);
    frontLettering(c, fonts, d, key);
    clearSprinkles(c);
    darkFront = ["classic", "christmas", "training", "photo"].includes(key);
  } else if (panel === "back") {
    backSquare(c, fonts, key);
    darkFront = false;
  } else if (panel === "inside-message") {
    insideMessageSquare(c, fonts, d, key);
    darkFront = false;
  } else if (panel === "inside-info") {
    insideInfoSquare(c, fonts, d, key, input.qrMatrix);
    darkFront = false;
  } else {
    insideLandscape(c, fonts, d, key, input.qrMatrix);
    darkFront = false;
  }
  if (d.sample) watermark(c, fonts, d, darkFront);
  return c.layout();
}

/**
 * A full panel as SVG (see layoutGiftVoucherPanel). For `layout` "square"
 * and `panel` "inside" this is the opened card: the message and the code
 * panel side by side in `widthPx` × `heightPx`.
 * @param {{
 *   panel: GiftVoucherPanelKind,
 *   layout: "landscape" | "square",
 *   widthPx: number, heightPx: number, bleedPx?: number,
 *   design: Readonly<GiftVoucherDesign> | null, data?: GiftVoucherPanelData, fonts?: GiftVoucherFonts | null,
 *   photoDataUri?: string | null, qrMatrix?: GiftVoucherQrMatrix | null,
 * }} input
 * @returns {string}
 */
export function buildGiftVoucherPanelSvg(input) {
  if (input.layout === "square" && input.panel === "inside") {
    const bleedPx = typeof input.bleedPx === "number" && input.bleedPx > 0 ? Math.round(input.bleedPx) : 0;
    const widthPx = size(input.widthPx, 2000);
    const heightPx = size(input.heightPx, Math.round(widthPx / 2));
    const half = Math.round(widthPx / 2);
    const panelPx = half + bleedPx;
    const common = { ...input, layout: /** @type {const} */ ("square"), widthPx: panelPx, heightPx, bleedPx };
    return buildGiftVoucherSpreadSvg({
      left: layoutGiftVoucherPanel({ ...common, panel: "inside-message" }),
      right: layoutGiftVoucherPanel({ ...common, panel: "inside-info" }),
      widthPx: half * 2,
      heightPx,
      bleedPx,
    });
  }
  return layoutGiftVoucherPanel(input).svg;
}

/**
 * Two square panels side by side, folded in the middle: each panel was laid
 * out with bleed on every side and loses it at the fold. (print.one SQ14:
 * 3378 × 1724, bleed 35 → fold at 1689.)
 * @param {{ left: GiftVoucherPanelLayout, right: GiftVoucherPanelLayout, widthPx: number, heightPx: number, bleedPx: number }} o
 * @returns {string}
 */
export function buildGiftVoucherSpreadSvg({ left, right, widthPx, heightPx, bleedPx }) {
  const half = widthPx / 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${n2(widthPx)}" height="${n2(heightPx)}" viewBox="0 0 ${n2(widthPx)} ${n2(heightPx)}">` +
    `<svg x="0" y="0" width="${n2(half)}" height="${n2(heightPx)}" viewBox="0 0 ${n2(half)} ${n2(heightPx)}" overflow="hidden">${left.inner}</svg>` +
    `<svg x="${n2(half)}" y="0" width="${n2(half)}" height="${n2(heightPx)}" viewBox="${n2(bleedPx)} 0 ${n2(half)} ${n2(heightPx)}" overflow="hidden">${right.inner}</svg>` +
    `</svg>`
  );
}

/**
 * The A4 download page: the landscape front on top, the inside below, a
 * dashed cut/fold line between with a tiny hint. Both panels must be laid out
 * `widthPx` × `heightPx / 2`.
 * @param {{ front: GiftVoucherPanelLayout, inside: GiftVoucherPanelLayout, widthPx: number, heightPx: number, fonts: GiftVoucherFonts, locale?: "de" | "en" }} o
 * @returns {string}
 */
export function buildGiftVoucherPdfPageSvg({ front, inside, widthPx, heightPx, fonts, locale }) {
  const half = heightPx / 2;
  const S = widthPx / 210; // px per mm on A4
  const copy = COPY[locale === "en" ? "en" : "de"];
  const hint = copy.cutHint;
  const size = SMALL * S;
  const w = emWidth(fonts.regular, hint, 0.02) * size;
  const iconW = 4.2 * S;
  const pillPad = 3 * S;
  const pillW = w + iconW + 2.2 * S + 2 * pillPad;
  const pillH = 5.2 * S;
  const px = (widthPx - pillW) / 2;
  const textX = px + pillPad + iconW + 2.2 * S;
  const textPath = fonts.regular.getPath(hint, textX, half + 0.35 * size * 0.7 * 1.0 + 0.2 * S, size, { letterSpacing: 0.02 });
  // A small pair of scissors.
  const ix = px + pillPad;
  const iy = half;
  const r = 0.75 * S;
  const scissors =
    `<g fill="none" stroke="#6b737b" stroke-width="${n2(0.32 * S)}" stroke-linecap="round">` +
    `<circle cx="${n2(ix + r)}" cy="${n2(iy - 1.05 * S)}" r="${n2(r)}"/><circle cx="${n2(ix + r)}" cy="${n2(iy + 1.05 * S)}" r="${n2(r)}"/>` +
    `<path d="M${n2(ix + 1.35 * S)} ${n2(iy - 0.55 * S)}L${n2(ix + iconW)} ${n2(iy + 1.0 * S)}M${n2(ix + 1.35 * S)} ${n2(iy + 0.55 * S)}L${n2(ix + iconW)} ${n2(iy - 1.0 * S)}"/></g>`;
  const dash = 2.2 * S;
  const gap = 1.6 * S;
  const line = (/** @type {number} */ x1, /** @type {number} */ x2) =>
    `<path d="M${n2(x1)} ${n2(half)}H${n2(x2)}" stroke="#8c949b" stroke-width="${n2(0.3 * S)}" stroke-dasharray="${n2(dash)} ${n2(gap)}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${n2(widthPx)}" height="${n2(heightPx)}" viewBox="0 0 ${n2(widthPx)} ${n2(heightPx)}">` +
    `<rect width="${n2(widthPx)}" height="${n2(heightPx)}" fill="#ffffff"/>` +
    `<svg x="0" y="0" width="${n2(widthPx)}" height="${n2(half)}" viewBox="0 0 ${n2(front.widthPx)} ${n2(front.heightPx)}" overflow="hidden">${front.inner}</svg>` +
    `<svg x="0" y="${n2(half)}" width="${n2(widthPx)}" height="${n2(half)}" viewBox="0 0 ${n2(inside.widthPx)} ${n2(inside.heightPx)}" overflow="hidden">${inside.inner}</svg>` +
    line(0, px - 1.5 * S) +
    line(px + pillW + 1.5 * S, widthPx) +
    `<rect x="${n2(px)}" y="${n2(half - pillH / 2)}" width="${n2(pillW)}" height="${n2(pillH)}" rx="${n2(pillH / 2)}" fill="#ffffff" stroke="#c9ced3" stroke-width="${n2(0.25 * S)}"/>` +
    scissors +
    `<path d="${textPath.toPathData(2)}" fill="#5d656c"/>` +
    `</svg>`
  );
}

/**
 * Where the code and the voucher number sit on a laid-out panel (px), for
 * the PDF's invisible text layer.
 * @param {GiftVoucherPanelLayout} layout
 * @returns {{ code: GiftVoucherBox | null, number: GiftVoucherBox | null }}
 */
export function giftVoucherTextAnchors(layout) {
  /** @type {GiftVoucherBox | null} */
  let code = null;
  /** @type {GiftVoucherBox | null} */
  let number = null;
  for (const e of layout.elements) {
    if (e.role === "code") code = unionBox(code, e.bbox);
    if (e.role === "number") number = unionBox(number, e.bbox);
  }
  return { code, number };
}

/** The printed copy of a locale (for the PDF text layer and tests). @param {"de" | "en"} locale */
export function giftVoucherCopy(locale) {
  return COPY[locale === "en" ? "en" : "de"];
}
