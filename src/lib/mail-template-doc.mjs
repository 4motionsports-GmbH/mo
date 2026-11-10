// E-mail templates („Vorlagen“) — the block document format. Pure and tested
// (mail-template-doc.test.mjs); docs/EMAIL_TEMPLATES.md.
//
// A template is DATA, not code: a list of blocks (logo, heading, text, image,
// button, products, coupon, countdown, … and the Mo blocks that carry the
// personal content of Mo's mails) plus a global style. The operator builds it
// in the admin screen „Vorlagen“ (or lets the AI build it, or imports a JSON
// file) — no developer needed. One format serves two uses:
//
//   * PERSONAL mails (Kampagne, Marketing): a template with the block
//     `mo_content` can be selected as the design of these mails (Einstellungen
//     per type, or per campaign). Mo still writes the text, picks the products,
//     mints the code — the template only decides WHERE those pieces sit and
//     what surrounds them (mail-template-design.ts).
//   * RUNDMAIL (bulk mail, one identical content for everyone): the content
//     IS a block document — a copy of a template, edited per mailing.
//
// The renderer (mail-template-render.mjs) turns a document into e-mail HTML
// that follows every rule of docs/EMAIL_DESIGNS.md (tables, inline styles,
// Outlook twins) — so whatever the operator builds stays robust; there is no
// free-form HTML except the deliberately fenced `html` block.
//
// This module is the single description of the format: the block catalog
// (labels, fields, limits, which use allows which block), normalisation of
// untrusted input (API bodies, imports, AI output), validation with German
// messages, the merge fields ({{vorname}}) and the starter documents.
// The AI assistant gets MAIL_BLOCK_CATALOG verbatim as its "interface".

import { EMAIL_FONT_KEYS, EMAIL_BUTTON_SHAPES, parseHexColor } from "./email-theme.mjs";
import { formatProductRef, parseProductRef } from "./product-ref.mjs";

/** A template selected as a design is stored as this key (email_design_selections / campaigns.design_key). */
export const TEMPLATE_DESIGN_PREFIX = "vorlage-";

/** The design key of template `id`. */
export function templateDesignKey(id) {
  return `${TEMPLATE_DESIGN_PREFIX}${id}`;
}

/** The template id of a design key, or null for a code design / garbage. */
export function parseTemplateDesignKey(key) {
  const m = /^vorlage-(\d{1,12})$/.exec(String(key ?? ""));
  return m ? Number(m[1]) : null;
}

/** The `format` of an exported template file. */
export const MAIL_TEMPLATE_FILE_FORMAT = "mo-mail-template";
/** The document version this code writes. */
export const MAIL_TEMPLATE_DOC_VERSION = 1;

/** Upper bounds — a mail must stay well under Gmail's 102 KB clip. */
export const MAIL_TEMPLATE_LIMITS = Object.freeze({
  blocks: 40,
  textChars: 5000,
  headingChars: 200,
  labelChars: 60,
  urlChars: 1000,
  altChars: 200,
  productsPerBlock: 8,
  htmlChars: 20_000,
  nameChars: 80,
  descriptionChars: 300,
});

/** Who may use a block: `personal` = templates for Mo's personal mails, `bulk` = Rundmail content. */
/**
 * @typedef {"logo" | "heading" | "text" | "image" | "button" | "products" | "coupon" | "countdown" |
 *   "divider" | "spacer" | "social" | "html" | "greeting" | "hero" | "mo_content" | "mo_offer" |
 *   "mo_promo" | "footer"} MailBlockType
 */

/**
 * The block catalog: label, group, one-line description (UI + AI prompt), the
 * fields with their meaning, and where the block may be used.
 * @type {Readonly<Record<MailBlockType, { label: string, group: "inhalt" | "angebot" | "mo" | "rahmen",
 *   description: string, fields: Readonly<Record<string, string>>, personal: boolean, bulk: boolean }>>}
 */
export const MAIL_BLOCK_CATALOG = Object.freeze({
  logo: {
    label: "Logo",
    group: "rahmen",
    description: "Das Logo von motion sports, verlinkt auf den Shop.",
    fields: { align: "left | center", width: "Breite in px, 60–300 (Standard 144)" },
    personal: true,
    bulk: true,
  },
  heading: {
    label: "Überschrift",
    group: "inhalt",
    description: "Eine Überschrift. Mit Hintergrundfarbe wird daraus ein vollbreites Band (z. B. schwarz mit gelber Schrift).",
    fields: {
      text: "Text, max. 200 Zeichen; Platzhalter {{vorname}} oder {{vorname|Ersatz}} erlaubt",
      size: "s | m | l | xl",
      align: "left | center | right",
      color: "Schriftfarbe #rrggbb oder leer (= Stil)",
      background: "Hintergrund #rrggbb oder leer (= weiß)",
    },
    personal: true,
    bulk: true,
  },
  text: {
    label: "Text",
    group: "inhalt",
    description:
      "Fließtext. Leerzeile = neuer Absatz, Zeilen mit „- “ = Aufzählung, **fett**, Links als [Text](https://…).",
    fields: {
      text: "Text, max. 5.000 Zeichen; Platzhalter {{vorname}} erlaubt",
      size: "s | m | l",
      align: "left | center | right",
      color: "Schriftfarbe #rrggbb oder leer",
      background: "Hintergrund #rrggbb oder leer",
    },
    personal: true,
    bulk: true,
  },
  image: {
    label: "Bild",
    group: "inhalt",
    description: "Ein Bild (Banner, Foto, animiertes GIF), optional verlinkt. Bilder hochladen oder eine https-Adresse angeben.",
    fields: {
      src: "Bildadresse https://… (JPG, PNG oder GIF)",
      alt: "Alternativtext — Pflicht, wird gezeigt, wenn Bilder blockiert sind",
      href: "Link beim Klick (https://…) oder leer",
      width: "full (ganze Breite, 600 px) | content (mit Rand, 480 px)",
    },
    personal: true,
    bulk: true,
  },
  button: {
    label: "Button",
    group: "inhalt",
    description: "Ein Button mit Link — z. B. „Jetzt sparen“ auf die Black-Week-Kollektion.",
    fields: {
      label: "Beschriftung, max. 60 Zeichen",
      href: "Link https://…",
      align: "left | center | right",
      color: "Buttonfarbe #rrggbb oder leer (= Akzentfarbe)",
      textColor: "Schriftfarbe #rrggbb oder leer",
      fullWidth: "true = ganze Breite",
    },
    personal: true,
    bulk: true,
  },
  products: {
    label: "Produkte",
    group: "angebot",
    description:
      "Feste Produkte aus dem Katalog mit Bild, Name, aktuellem Preis und Link — für alle Empfänger gleich (z. B. die Deals der Woche).",
    fields: {
      title: "Überschrift über den Produkten oder leer",
      refs: "Katalog-Referenzen (Handle oder Handle~VariantenId), 1–8 Stück",
      layout: "rows (Zeilen mit Beschreibung) | grid (Raster, 2 pro Zeile)",
    },
    personal: true,
    bulk: true,
  },
  coupon: {
    label: "Gutschein-Code",
    group: "angebot",
    description:
      "Ein für alle gleicher Rabattcode (in Shopify angelegt) als Gutschein-Karte mit „Code einlösen“-Link, der den Code im Warenkorb hinterlegt.",
    fields: {
      code: "Der Code, genau wie in Shopify (z. B. BLACKWEEK25)",
      headline: "Was er bringt, z. B. „25 % auf alles“",
      terms: "Bedingungen, z. B. „Gültig bis 30.11. · nicht kombinierbar“",
    },
    personal: true,
    bulk: true,
  },
  countdown: {
    label: "Countdown",
    group: "angebot",
    description: "Ein Live-Countdown bis zu einem festen Zeitpunkt — die Zahlen stimmen bei jedem Öffnen.",
    fields: { until: "Ende als Datum/Uhrzeit (ISO)", heading: "Text darüber oder leer" },
    personal: true,
    bulk: true,
  },
  divider: {
    label: "Trennlinie",
    group: "rahmen",
    description: "Eine dünne Linie zwischen Abschnitten.",
    fields: { color: "Linienfarbe #rrggbb oder leer" },
    personal: true,
    bulk: true,
  },
  spacer: {
    label: "Abstand",
    group: "rahmen",
    description: "Leerer Abstand.",
    fields: { height: "Höhe in px, 8–80" },
    personal: true,
    bulk: true,
  },
  social: {
    label: "Social-Media",
    group: "rahmen",
    description: "Die Social-Media-Symbole von motion sports.",
    fields: {},
    personal: true,
    bulk: true,
  },
  html: {
    label: "Eigenes HTML",
    group: "inhalt",
    description:
      "Für Profis: ein eigener HTML-Abschnitt (z. B. aus einem Design-Tool). Skripte, Formulare und Event-Attribute werden entfernt; in Outlook unbedingt testen.",
    fields: { html: "HTML-Code, max. 20.000 Zeichen — Tabellen und Inline-Styles verwenden" },
    personal: true,
    bulk: true,
  },
  greeting: {
    label: "Anrede",
    group: "inhalt",
    description: "Die persönliche Anrede mit Vornamen — mit Ersatztext, wenn kein Vorname bekannt ist.",
    fields: {
      text: "Mit Vornamen, z. B. „Hallo {{vorname}},“",
      fallback: "Ohne Vornamen, z. B. „Hallo,“",
      align: "left | center",
    },
    personal: true,
    bulk: true,
  },
  hero: {
    label: "Titelbild (KI-Hero)",
    group: "mo",
    description:
      "Das Titelbild persönlicher Mails: das individuelle KI-Bild bzw. das Kampagnenbild, sonst das hier hinterlegte Bild. KI-Bilder tragen automatisch das EU-Kennzeichen.",
    fields: {
      src: "Ersatzbild https://… oder leer",
      alt: "Alternativtext",
      href: "Link oder leer",
      showHeadline: "true = die Hero-Überschrift unter dem Bild zeigen",
    },
    personal: true,
    bulk: false,
  },
  mo_content: {
    label: "Mos persönlicher Text",
    group: "mo",
    description:
      "Der Text, den Mo für jede Person schreibt (Kampagne, Marketing) — Pflicht in Vorlagen für persönliche Mails. Rechtliche und Inhalts-Bausteine bleiben unverändert.",
    fields: { showHeading: "true = die Überschrift der Mail (z. B. „Deine persönliche Empfehlung“) zeigen" },
    personal: true,
    bulk: false,
  },
  mo_offer: {
    label: "Mos Angebot",
    group: "mo",
    description:
      "Die individuell ausgesuchten Produkte bzw. das persönliche Set, der persönliche Rabattcode und sein Countdown. Fehlt der Baustein, steht das Angebot direkt unter Mos Text.",
    fields: {},
    personal: true,
    bulk: false,
  },
  mo_promo: {
    label: "Mo-Hinweis & Button",
    group: "mo",
    description:
      "Der Hinweis auf die Beratung mit Mo und der (gezählte) Haupt-Button der Kampagne. Fehlt der Baustein, steht er unter dem Angebot.",
    fields: {},
    personal: true,
    bulk: false,
  },
  footer: {
    label: "Fußzeile",
    group: "rahmen",
    description:
      "Impressum, Firmenangaben und der Abmelde-Link — Pflicht, immer am Ende, kann nicht entfernt werden.",
    fields: { showSocial: "true = Social-Media-Symbole in der Fußzeile" },
    personal: true,
    bulk: true,
  },
});

/** @type {ReadonlyArray<MailBlockType>} */
export const MAIL_BLOCK_TYPES = Object.freeze(/** @type {MailBlockType[]} */ (Object.keys(MAIL_BLOCK_CATALOG)));

/**
 * One block of a document: its id and type plus the fields of its type
 * (MAIL_BLOCK_CATALOG[type].fields).
 * @typedef {{ id: string, type: MailBlockType } & Record<string, any>} MailBlock
 */

/** The Mo blocks — only meaningful in a template for personal mails. */
export const MO_BLOCK_TYPES = Object.freeze(/** @type {MailBlockType[]} */ (["hero", "mo_content", "mo_offer", "mo_promo"]));

/** Default global style — the brand's classic look. */
export const DEFAULT_MAIL_STYLE = Object.freeze({
  accentColor: "#008ccb",
  buttonTextColor: "#ffffff",
  textColor: "#111111",
  headingColor: "#111111",
  outerBackground: "#fafafa",
  fontFamily: "montserrat",
  buttonShape: "pill",
  logoUrl: null,
});

/** Merge fields: {{vorname}} and {{vorname|Ersatz}} (case-insensitive name). */
export const MERGE_FIELD_RE = /\{\{\s*([a-zA-ZäöüÄÖÜß_]+)\s*(?:\|([^{}]{0,40}))?\}\}/g;
/** The only merge field there is (privacy: no e-mail, no order data in a mail body). */
export const MERGE_FIELDS = Object.freeze(["vorname"]);

const ALIGNS = ["left", "center", "right"];
const HEADING_SIZES = ["s", "m", "l", "xl"];
const TEXT_SIZES = ["s", "m", "l"];

// ── small parsers ────────────────────────────────────────────────────────────

/** @param {unknown} v @param {number} max */
function str(v, max) {
  if (typeof v !== "string") return "";
  return v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, max);
}
/** One-line string. */
function line(v, max) {
  return str(v, max).replace(/\s*\n\s*/g, " ").trim();
}
/** @param {unknown} v @param {readonly string[]} allowed @param {string} fallback */
function oneOf(v, allowed, fallback) {
  return typeof v === "string" && allowed.includes(v) ? v : fallback;
}
/** @param {unknown} v */
function color(v) {
  return parseHexColor(v) ?? null;
}
/** @param {unknown} v @param {number} lo @param {number} hi @param {number} fallback */
function int(v, lo, hi, fallback) {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}
/** @param {unknown} v */
function bool(v, fallback) {
  return typeof v === "boolean" ? v : fallback;
}

/**
 * An absolute http(s) URL (https required unless `allowHttp`), or "" when
 * empty/invalid. Never javascript:, data:, relative or protocol-less.
 * @param {unknown} v
 * @param {{ allowHttp?: boolean }} [opts]
 */
export function cleanUrl(v, opts = {}) {
  const s = line(v, MAIL_TEMPLATE_LIMITS.urlChars);
  if (!s) return "";
  let u;
  try {
    u = new URL(s);
  } catch {
    return "";
  }
  if (u.protocol !== "https:" && !(opts.allowHttp && u.protocol === "http:")) return "";
  if (!u.hostname || u.username || u.password) return "";
  return u.toString();
}

/** A link target: https URL, or mailto:/tel: (buttons may call or mail the shop). */
export function cleanHref(v) {
  const s = line(v, MAIL_TEMPLATE_LIMITS.urlChars);
  if (/^mailto:[^\s@<>"]+@[^\s@<>"]+$/i.test(s)) return s;
  if (/^tel:\+?[0-9 ()/-]{3,30}$/i.test(s)) return s;
  return cleanUrl(s);
}

/** An ISO timestamp or null. */
function isoDate(v) {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * A catalog id as the shop keeps it: the Shopify handle, which may carry
 * letters beyond ASCII and symbols — more than half of the catalog reads like
 * „atx®-hantelbank-klappbar-schwarz-silber“. Letters, digits, marks, symbols
 * (®, ™, ©), dot, underscore, hyphen; never whitespace, „~“, quotes or slashes.
 */
const CATALOG_HANDLE = /^[\p{L}\p{N}\p{M}\p{So}][\p{L}\p{N}\p{M}\p{So}._-]{0,254}$/u;

/** Catalog refs: a handle or handle~variantId (product-ref.mjs), deduplicated. */
function refs(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const r of v) {
    if (typeof r !== "string") continue;
    const { productId, variantId } = parseProductRef(r);
    if (!CATALOG_HANDLE.test(productId) || (variantId != null && variantId.length > 20)) continue;
    const ref = formatProductRef(productId, variantId);
    if (!out.includes(ref)) out.push(ref);
    if (out.length >= MAIL_TEMPLATE_LIMITS.productsPerBlock) break;
  }
  return out;
}

let idCounter = 0;
/** A short block id (unique inside a document). */
export function newBlockId(taken = new Set()) {
  for (;;) {
    idCounter = (idCounter + 1) % 1_000_000;
    const id = `b${Date.now().toString(36).slice(-4)}${idCounter.toString(36)}`;
    if (!taken.has(id)) return id;
  }
}

// ── normalisation ────────────────────────────────────────────────────────────

/**
 * One block from untrusted input → a clean block, or null for an unknown type.
 * Every field is clamped to its vocabulary/limits; unknown fields are dropped.
 * @param {unknown} raw
 * @param {Set<string>} takenIds
 * @returns {MailBlock | null}
 */
export function normalizeMailBlock(raw, takenIds = new Set()) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const type = /** @type {MailBlockType} */ (r.type);
  if (!MAIL_BLOCK_TYPES.includes(type)) return null;
  const wanted = typeof r.id === "string" && /^[A-Za-z0-9_-]{1,24}$/.test(r.id) ? r.id : "";
  const id = wanted && !takenIds.has(wanted) ? wanted : newBlockId(takenIds);
  takenIds.add(id);
  const L = MAIL_TEMPLATE_LIMITS;
  switch (type) {
    case "logo":
      return { id, type, align: oneOf(r.align, ["left", "center"], "center"), width: int(r.width, 60, 300, 144) };
    case "heading":
      return {
        id,
        type,
        text: line(r.text, L.headingChars),
        size: oneOf(r.size, HEADING_SIZES, "l"),
        align: oneOf(r.align, ALIGNS, "center"),
        color: color(r.color),
        background: color(r.background),
      };
    case "text":
      return {
        id,
        type,
        text: str(r.text, L.textChars).trim(),
        size: oneOf(r.size, TEXT_SIZES, "m"),
        align: oneOf(r.align, ALIGNS, "left"),
        color: color(r.color),
        background: color(r.background),
      };
    case "image":
      return {
        id,
        type,
        src: cleanUrl(r.src),
        alt: line(r.alt, L.altChars),
        href: cleanHref(r.href),
        width: oneOf(r.width, ["full", "content"], "full"),
      };
    case "button":
      return {
        id,
        type,
        label: line(r.label, L.labelChars),
        href: cleanHref(r.href),
        align: oneOf(r.align, ALIGNS, "center"),
        color: color(r.color),
        textColor: color(r.textColor),
        fullWidth: bool(r.fullWidth, false),
      };
    case "products":
      return {
        id,
        type,
        title: line(r.title, L.headingChars),
        refs: refs(r.refs),
        layout: oneOf(r.layout, ["rows", "grid"], "rows"),
      };
    case "coupon":
      return {
        id,
        type,
        code: line(r.code, 40).replace(/\s+/g, "").toUpperCase(),
        headline: line(r.headline, L.headingChars),
        terms: line(r.terms, 300),
      };
    case "countdown":
      return { id, type, until: isoDate(r.until), heading: line(r.heading, L.headingChars) };
    case "divider":
      return { id, type, color: color(r.color) };
    case "spacer":
      return { id, type, height: int(r.height, 8, 80, 24) };
    case "social":
      return { id, type };
    case "html":
      return { id, type, html: str(r.html, L.htmlChars) };
    case "greeting":
      return {
        id,
        type,
        text: line(r.text, L.headingChars) || "Hallo {{vorname}},",
        fallback: line(r.fallback, L.headingChars) || "Hallo,",
        align: oneOf(r.align, ["left", "center"], "left"),
      };
    case "hero":
      return {
        id,
        type,
        src: cleanUrl(r.src),
        alt: line(r.alt, L.altChars),
        href: cleanHref(r.href),
        showHeadline: bool(r.showHeadline, true),
      };
    case "mo_content":
      return { id, type, showHeading: bool(r.showHeading, true) };
    case "mo_offer":
    case "mo_promo":
      return { id, type };
    case "footer":
      return { id, type, showSocial: bool(r.showSocial, true) };
    default:
      return null;
  }
}

/**
 * The global style from untrusted input — every token falls back to the
 * brand default when missing or invalid.
 * @param {unknown} raw
 */
export function normalizeMailStyle(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? /** @type {Record<string, unknown>} */ (raw) : {};
  const logo = cleanUrl(r.logoUrl);
  return {
    accentColor: color(r.accentColor) ?? DEFAULT_MAIL_STYLE.accentColor,
    buttonTextColor: color(r.buttonTextColor) ?? DEFAULT_MAIL_STYLE.buttonTextColor,
    textColor: color(r.textColor) ?? DEFAULT_MAIL_STYLE.textColor,
    headingColor: color(r.headingColor) ?? DEFAULT_MAIL_STYLE.headingColor,
    outerBackground: color(r.outerBackground) ?? DEFAULT_MAIL_STYLE.outerBackground,
    fontFamily: oneOf(r.fontFamily, EMAIL_FONT_KEYS, DEFAULT_MAIL_STYLE.fontFamily),
    buttonShape: oneOf(r.buttonShape, EMAIL_BUTTON_SHAPES, DEFAULT_MAIL_STYLE.buttonShape),
    logoUrl: logo || null,
  };
}

/**
 * A whole document from untrusted input (API body, import file, AI output) →
 * a clean document. Unknown blocks are dropped, at most `blocks` blocks are
 * kept, exactly ONE footer stands at the end (added when missing, extra ones
 * dropped), at most one of each Mo block (the first wins).
 * @param {unknown} raw
 */
export function normalizeMailTemplateDoc(raw) {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      v = null;
    }
  }
  const r = v && typeof v === "object" && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : {};
  const taken = new Set();
  const seenSingletons = new Set();
  /** @type {MailBlock[]} */
  const blocks = [];
  let footer = null;
  for (const entry of Array.isArray(r.blocks) ? r.blocks : []) {
    const b = normalizeMailBlock(entry, taken);
    if (!b) continue;
    if (b.type === "footer") {
      footer = footer ?? b;
      continue;
    }
    if (MO_BLOCK_TYPES.includes(b.type)) {
      if (seenSingletons.has(b.type)) continue;
      seenSingletons.add(b.type);
    }
    if (blocks.length < MAIL_TEMPLATE_LIMITS.blocks - 1) blocks.push(b);
  }
  blocks.push(/** @type {MailBlock} */ (footer ?? normalizeMailBlock({ type: "footer" }, taken)));
  return { v: MAIL_TEMPLATE_DOC_VERSION, style: normalizeMailStyle(r.style), blocks };
}

/** The doc without the Mo blocks (a template copied into a Rundmail). */
export function stripMoBlocks(doc) {
  const d = normalizeMailTemplateDoc(doc);
  return { ...d, blocks: d.blocks.filter((b) => !MO_BLOCK_TYPES.includes(b.type)) };
}

// ── facts about a document ───────────────────────────────────────────────────

/** Has the block `mo_content` → usable as the design of personal mails. */
export function docSupportsPersonal(doc) {
  return Array.isArray(doc?.blocks) && doc.blocks.some((b) => b?.type === "mo_content");
}

/** Has a hero block → the Kampagne desk shows its hero controls. */
export function docHasHero(doc) {
  return Array.isArray(doc?.blocks) && doc.blocks.some((b) => b?.type === "hero");
}

/** Every catalog ref of the document's product blocks, in order, unique. */
export function docProductRefs(doc) {
  const out = [];
  for (const b of doc?.blocks ?? []) {
    if (b?.type !== "products") continue;
    for (const r of b.refs ?? []) if (!out.includes(r)) out.push(r);
  }
  return out;
}

// ── merge fields ─────────────────────────────────────────────────────────────

/**
 * A first name fit to print, or null: trimmed, collapsed, 1–30 letters
 * (hyphen, apostrophe, space and dot allowed), no digits or "@". An
 * all-lower or all-upper name is title-cased ("anna" / "ANNA" → "Anna";
 * "anna-sophie" → "Anna-Sophie"); mixed case stays as typed ("McKenzie").
 * @param {unknown} raw
 * @returns {string | null}
 */
export function normalizeFirstName(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s || s.length > 30) return null;
  if (!/^[\p{L}][\p{L}' .-]*$/u.test(s)) return null;
  if (/^(test|kunde|customer|n\/a|none|null|undefined|vorname|name)$/i.test(s)) return null;
  const allLower = s === s.toLowerCase();
  const allUpper = s === s.toUpperCase();
  if (!allLower && !allUpper) return s;
  return s.toLowerCase().replace(/(^|[\s'.-])(\p{L})/gu, (_m, sep, ch) => sep + ch.toUpperCase());
}

/**
 * Replace the merge fields of a text. `{{vorname}}` → the first name or "";
 * `{{vorname|Ersatz}}` → the first name or the fallback. The result is plain
 * text (escape it where it goes into HTML). Unknown fields stay as written
 * (validation reports them).
 * @param {string} text
 * @param {{ firstName?: string | null }} values
 * @param {(index: number, fallback: string) => string} [token]  freeze mode:
 *   called per occurrence instead of resolving (the Rundmail freezes a
 *   placeholder and resolves it per recipient)
 */
export function applyMergeFields(text, values, token) {
  let i = 0;
  return String(text ?? "").replace(MERGE_FIELD_RE, (all, name, fallback) => {
    if (!MERGE_FIELDS.includes(String(name).toLowerCase())) return all;
    const fb = (fallback ?? "").trim();
    if (token) return token(i++, fb);
    const first = normalizeFirstName(values.firstName ?? null);
    return first ?? fb;
  });
}

/** Unknown merge fields of a text ({{vornme}} …) — a validation error. */
export function unknownMergeFields(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(MERGE_FIELD_RE)) {
    const name = String(m[1]).toLowerCase();
    if (!MERGE_FIELDS.includes(name) && !out.includes(m[0])) out.push(m[0]);
  }
  // A brace pair the pattern did not take ({{ vorname | … } …) is a typo too.
  for (const m of String(text ?? "").matchAll(/\{\{[^}]*\}?\}?/g)) {
    MERGE_FIELD_RE.lastIndex = 0;
    if (!new RegExp(MERGE_FIELD_RE.source).test(m[0]) && !out.includes(m[0])) out.push(m[0]);
  }
  return out;
}

// ── validation ───────────────────────────────────────────────────────────────

/**
 * @typedef {{ blockId: string | null, message: string }} DocIssue
 */

/**
 * Check a NORMALISED document for a use. Errors block saving as a design /
 * sending; warnings are shown. German messages name the block.
 * @param {ReturnType<typeof normalizeMailTemplateDoc>} doc
 * @param {"personal" | "bulk" | "template"} use  template = a saved Vorlage (either use later)
 * @param {{ now?: Date }} [opts]
 * @returns {{ errors: DocIssue[], warnings: DocIssue[] }}
 */
export function validateMailTemplateDoc(doc, use, opts = {}) {
  /** @type {DocIssue[]} */
  const errors = [];
  /** @type {DocIssue[]} */
  const warnings = [];
  const now = (opts.now ?? new Date()).getTime();
  const blocks = Array.isArray(doc?.blocks) ? doc.blocks : [];
  const err = (b, m) => errors.push({ blockId: b?.id ?? null, message: m });
  const warn = (b, m) => warnings.push({ blockId: b?.id ?? null, message: m });
  const nameOf = (b) => MAIL_BLOCK_CATALOG[b.type]?.label ?? b.type;

  if (blocks.filter((b) => b.type !== "footer").length === 0) err(null, "Die Vorlage hat noch keinen Inhalt.");
  if (!blocks.some((b) => b.type === "footer")) err(null, "Die Fußzeile mit dem Abmelde-Link fehlt.");
  if (use === "personal" && !docSupportsPersonal(doc)) {
    err(null, "Für persönliche Mails braucht die Vorlage den Baustein „Mos persönlicher Text“.");
  }
  if (use === "bulk") {
    for (const b of blocks) if (!MAIL_BLOCK_CATALOG[b.type]?.bulk) err(b, `„${nameOf(b)}“ gibt es nur in persönlichen Mails — Baustein entfernen.`);
  }
  for (const b of blocks) {
    const label = nameOf(b);
    switch (b.type) {
      case "heading":
        if (!b.text) err(b, `${label}: Text fehlt.`);
        break;
      case "text":
        if (!b.text) err(b, `${label}: Text fehlt.`);
        break;
      case "greeting":
        if (!b.text || !b.fallback) err(b, `${label}: Text mit und ohne Vornamen angeben.`);
        break;
      case "image":
        if (!b.src) err(b, `${label}: Bild fehlt (hochladen oder https-Adresse angeben).`);
        if (!b.alt) warn(b, `${label}: Alternativtext fehlt — er erscheint, wenn Bilder blockiert sind, und hilft gegen Spamfilter.`);
        if (b.src && /\.webp(\?|$)/i.test(b.src)) warn(b, `${label}: WebP zeigt Outlook nicht an — besser JPG, PNG oder GIF.`);
        break;
      case "button":
        if (!b.label) err(b, `${label}: Beschriftung fehlt.`);
        if (!b.href) err(b, `${label}: Link fehlt (https://…).`);
        break;
      case "products":
        if (b.refs.length === 0) err(b, `${label}: noch kein Produkt gewählt.`);
        break;
      case "coupon":
        if (!b.code) err(b, `${label}: Code fehlt.`);
        else if (!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(b.code)) err(b, `${label}: Der Code darf nur Buchstaben, Ziffern, - und _ enthalten.`);
        if (!b.headline) warn(b, `${label}: Ohne Text darüber sieht niemand, was der Code bringt.`);
        if (use === "personal") warn(b, `${label}: Ein fester Code steht in JEDER persönlichen Mail — der persönliche Rabatt kommt über „Mos Angebot“.`);
        break;
      case "countdown":
        if (!b.until) err(b, `${label}: Ende fehlt.`);
        else if (Date.parse(b.until) <= now) err(b, `${label}: Das Ende liegt in der Vergangenheit.`);
        break;
      case "html":
        if (!b.html.trim()) err(b, `${label}: HTML fehlt.`);
        else warn(b, `${label}: Eigenes HTML — in Outlook und auf dem Handy mit einer Testmail prüfen.`);
        break;
      case "hero":
        if (b.src && !b.alt) warn(b, `${label}: Alternativtext fehlt.`);
        break;
      default:
        break;
    }
    for (const t of [b.text, b.fallback, b.label]) {
      for (const bad of unknownMergeFields(t ?? "")) err(b, `${label}: Unbekannter Platzhalter ${bad} — erlaubt ist {{vorname}} bzw. {{vorname|Ersatz}}.`);
    }
  }
  const first = blocks[0];
  if (first && first.type !== "logo" && first.type !== "image" && first.type !== "hero" && first.type !== "heading") {
    warn(first, "Tipp: Mails beginnen am besten mit Logo, Bild oder Überschrift.");
  }
  return { errors, warnings };
}

// ── starters ─────────────────────────────────────────────────────────────────

/**
 * The ready-made starting points of „Neue Vorlage“. Each returns a fresh,
 * normalised document (new block ids).
 */
export const MAIL_TEMPLATE_STARTERS = Object.freeze([
  {
    key: "black-week",
    name: "Black Week",
    description: "Dunkles Aktionsdesign: Banner, Aktions-Band, Gutschein, Countdown, Produkt-Raster, großer Button.",
    use: "bulk",
    build: () =>
      normalizeMailTemplateDoc({
        style: {
          accentColor: "#ffd400",
          buttonTextColor: "#111111",
          textColor: "#111111",
          headingColor: "#111111",
          outerBackground: "#111111",
          fontFamily: "arial",
          buttonShape: "square",
        },
        blocks: [
          { type: "logo" },
          { type: "heading", text: "BLACK WEEK", size: "xl", align: "center", color: "#ffd400", background: "#111111" },
          { type: "image", src: "", alt: "Black Week bei motion sports", href: "https://motionsports.de", width: "full" },
          { type: "greeting", text: "Hallo {{vorname}},", fallback: "Hallo," },
          {
            type: "text",
            text: "die Black Week ist da: Spare jetzt auf Fitnessgeräte für dein Home-Gym. Nur solange der Vorrat reicht.",
          },
          { type: "coupon", code: "", headline: "x % auf alles", terms: "Gültig bis … · nicht kombinierbar" },
          { type: "countdown", heading: "Die Black Week endet in" },
          { type: "products", title: "Unsere Black-Week-Deals", refs: [], layout: "grid" },
          { type: "button", label: "Jetzt sparen", href: "https://motionsports.de", align: "center", fullWidth: true },
          { type: "footer", showSocial: true },
        ],
      }),
  },
  {
    key: "newsletter",
    name: "Newsletter",
    description: "Klassischer Newsletter: Logo, Titelbild, Überschrift, Text, Button, Produkte.",
    use: "bulk",
    build: () =>
      normalizeMailTemplateDoc({
        style: {},
        blocks: [
          { type: "logo" },
          { type: "image", src: "", alt: "", href: "https://motionsports.de", width: "full" },
          { type: "heading", text: "Neu bei motion sports", size: "l", align: "center" },
          { type: "greeting", text: "Hallo {{vorname}},", fallback: "Hallo," },
          { type: "text", text: "hier steht dein Text." },
          { type: "button", label: "Jetzt entdecken", href: "https://motionsports.de", align: "center" },
          { type: "divider" },
          { type: "products", title: "Für dich ausgewählt", refs: [], layout: "rows" },
          { type: "footer", showSocial: true },
        ],
      }),
  },
  {
    key: "persoenlich",
    name: "Persönliche Kampagne",
    description: "Für Mos persönliche Mails: Titelbild, Mos Text, Mos Angebot, Mo-Hinweis — umrahmt von deinem Design.",
    use: "personal",
    build: () =>
      normalizeMailTemplateDoc({
        style: {},
        blocks: [
          { type: "logo" },
          { type: "hero", src: "", alt: "", showHeadline: true },
          { type: "mo_content", showHeading: true },
          { type: "mo_offer" },
          { type: "mo_promo" },
          { type: "footer", showSocial: true },
        ],
      }),
  },
  {
    key: "leer",
    name: "Leer",
    description: "Nur Logo und Fußzeile — alles andere baust du selbst.",
    use: "bulk",
    build: () => normalizeMailTemplateDoc({ style: {}, blocks: [{ type: "logo" }, { type: "footer" }] }),
  },
]);

// ── export / import files ────────────────────────────────────────────────────

/**
 * The JSON file „Exportieren“ writes.
 * @param {{ name: string, description: string | null, doc: unknown }} t
 */
export function templateExportFile(t) {
  return {
    format: MAIL_TEMPLATE_FILE_FORMAT,
    v: MAIL_TEMPLATE_DOC_VERSION,
    name: t.name,
    description: t.description ?? null,
    doc: normalizeMailTemplateDoc(t.doc),
  };
}

/**
 * Read an import file (the export format, or a bare document). Returns the
 * normalised template or a German message.
 * @param {unknown} raw  parsed JSON
 * @returns {{ ok: true, name: string, description: string | null, doc: ReturnType<typeof normalizeMailTemplateDoc> } | { ok: false, message: string }}
 */
export function parseTemplateImport(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, message: "Die Datei ist keine Vorlage (JSON-Objekt erwartet)." };
  const r = /** @type {Record<string, unknown>} */ (raw);
  const docRaw = r.format === MAIL_TEMPLATE_FILE_FORMAT ? r.doc : r.blocks ? r : null;
  if (!docRaw) return { ok: false, message: "Die Datei ist keine Mo-Vorlage (format „mo-mail-template“ fehlt)." };
  if (typeof r.v === "number" && r.v > MAIL_TEMPLATE_DOC_VERSION) {
    return { ok: false, message: "Die Vorlage stammt aus einer neueren Mo-Version — bitte zuerst aktualisieren." };
  }
  const doc = normalizeMailTemplateDoc(docRaw);
  if (doc.blocks.length <= 1) return { ok: false, message: "Die Vorlage enthält keine verwendbaren Bausteine." };
  const name = line(r.name, MAIL_TEMPLATE_LIMITS.nameChars) || "Importierte Vorlage";
  const description = line(r.description, MAIL_TEMPLATE_LIMITS.descriptionChars) || null;
  return { ok: true, name, description, doc };
}

/**
 * The catalog as plain text — the „interface“ the AI assistant gets.
 * @returns {string}
 */
export function blockCatalogForPrompt() {
  return MAIL_BLOCK_TYPES.map((type) => {
    const c = MAIL_BLOCK_CATALOG[type];
    const uses = [c.personal ? "persönliche Mails" : null, c.bulk ? "Rundmail" : null].filter(Boolean).join(" + ");
    const fields = Object.entries(c.fields)
      .map(([k, v]) => `    - ${k}: ${v}`)
      .join("\n");
    return `- ${type} („${c.label}“, ${uses}): ${c.description}${fields ? `\n${fields}` : ""}`;
  }).join("\n");
}
