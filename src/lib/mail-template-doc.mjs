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
// Version 2 (11.11.2026, owner: „any template he wants, no fixed layout“):
// free layouts — a `section` holds 1–4 columns of blocks (stacking on
// phones, background colour or picture), every block takes optional spacing
// and type settings, the card has its own colour, there are more fonts and
// the blocks `menu` (link bar) and `product` (one live catalog product in the
// template's own look). New optional fields are OMITTED while unset, so a
// version-1 document normalises to exactly the JSON it had.
//
// The fixed blocks in the mail's look (12.11.2026, owner: „those fixed
// building blocks such as the countdown or the code should be editable … so
// that it matches the template“): coupon, countdown and products take look
// fields (card colour, frame, corners, text / code / tile / digit / label
// colours, the code's font, link or button); unset, a format-2 document gives
// them the look of its style (countdownLook here, the rest in the renderer).
//
// This module is the single description of the format: the block catalog
// (labels, fields, limits, which use allows which block), normalisation of
// untrusted input (API bodies, imports, AI output), validation with German
// messages, the merge fields ({{vorname}}) and the starter documents.
// The AI assistant gets MAIL_BLOCK_CATALOG verbatim as its "interface".

import { EMAIL_FONT_CHOICES, EMAIL_FONT_KEYS, EMAIL_BUTTON_SHAPES, msoFontStackFor, parseHexColor } from "./email-theme.mjs";
import { customHtmlReport } from "./mail-template-html.mjs";
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
/** The document version this code writes (2: sections, columns, per-block styling). */
export const MAIL_TEMPLATE_DOC_VERSION = 2;

/** Upper bounds — a mail must stay well under Gmail's 102 KB clip. */
export const MAIL_TEMPLATE_LIMITS = Object.freeze({
  /** top-level blocks (sections count as one) */
  blocks: 40,
  /** every block of the document, the ones inside sections included */
  totalBlocks: 80,
  columns: 4,
  blocksPerColumn: 12,
  menuItems: 8,
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

// ── fonts ────────────────────────────────────────────────────────────────────

/**
 * Template-only web fonts (Google Fonts) on top of the theme fonts of
 * email-theme.mjs. Apple Mail, iOS and Outlook for Mac show them; Gmail,
 * Outlook for Windows and others fall back to the stack (Word gets one
 * Windows-safe font for the whole mail — msoHeadHtml). `classic` is the
 * theme font the classic block renderers (product rows, countdown) use.
 */
export const MAIL_TEMPLATE_FONTS = Object.freeze({
  oswald: {
    label: "Oswald (schmal, sportlich)",
    stack: "'Oswald', 'Arial Narrow', Arial, sans-serif",
    google: "Oswald:wght@400;600;700",
    mso: "Arial, Helvetica, sans-serif",
    classic: "arial",
  },
  bebas: {
    label: "Bebas Neue (Plakatschrift, nur Großbuchstaben)",
    stack: "'Bebas Neue', Impact, 'Arial Narrow', Arial, sans-serif",
    google: "Bebas+Neue",
    mso: "Arial, Helvetica, sans-serif",
    classic: "arial",
  },
  poppins: {
    label: "Poppins (modern, rund)",
    stack: "'Poppins', Verdana, Geneva, sans-serif",
    google: "Poppins:wght@400;600;700",
    mso: "Verdana, Geneva, sans-serif",
    classic: "verdana",
  },
  playfair: {
    label: "Playfair Display (elegant, Serifen)",
    stack: "'Playfair Display', Georgia, 'Times New Roman', serif",
    google: "Playfair+Display:wght@400;700",
    mso: "Georgia, 'Times New Roman', serif",
    classic: "georgia",
  },
  roboto: {
    label: "Roboto",
    stack: "'Roboto', Arial, Helvetica, sans-serif",
    google: "Roboto:wght@400;700",
    mso: "Arial, Helvetica, sans-serif",
    classic: "arial",
  },
  opensans: {
    label: "Open Sans",
    stack: "'Open Sans', Arial, Helvetica, sans-serif",
    google: "Open+Sans:wght@400;700",
    mso: "Arial, Helvetica, sans-serif",
    classic: "arial",
  },
  lato: {
    label: "Lato",
    stack: "'Lato', Arial, Helvetica, sans-serif",
    google: "Lato:wght@400;700",
    mso: "Arial, Helvetica, sans-serif",
    classic: "arial",
  },
  inter: {
    label: "Inter",
    stack: "'Inter', Arial, Helvetica, sans-serif",
    google: "Inter:wght@400;700",
    mso: "Arial, Helvetica, sans-serif",
    classic: "arial",
  },
});

/** Every font a template may use: the theme fonts, then the template web fonts. */
export const MAIL_FONT_KEYS = Object.freeze([...EMAIL_FONT_KEYS, ...Object.keys(MAIL_TEMPLATE_FONTS)]);

/** @param {unknown} key */
function isMailFontKey(key) {
  return typeof key === "string" && MAIL_FONT_KEYS.includes(key);
}

/** The inline CSS font stack of a font key (unknown → the brand font). */
export function mailFontStack(key) {
  const extra = MAIL_TEMPLATE_FONTS[/** @type {keyof typeof MAIL_TEMPLATE_FONTS} */ (key)];
  if (extra) return extra.stack;
  const theme = EMAIL_FONT_CHOICES[/** @type {keyof typeof EMAIL_FONT_CHOICES} */ (key)];
  return (theme ?? EMAIL_FONT_CHOICES.montserrat).stack;
}

/** The Windows-safe stack Outlook (Word) uses for the whole mail. */
export function mailFontMsoStack(key) {
  const extra = MAIL_TEMPLATE_FONTS[/** @type {keyof typeof MAIL_TEMPLATE_FONTS} */ (key)];
  return extra ? extra.mso : msoFontStackFor(String(key));
}

/** The Google-Fonts family spec of a web font ("Oswald:wght@400;600;700"), or null. */
export function mailFontGoogleFamily(key) {
  if (key === "montserrat") return "Montserrat:wght@400;700";
  const extra = MAIL_TEMPLATE_FONTS[/** @type {keyof typeof MAIL_TEMPLATE_FONTS} */ (key)];
  return extra ? extra.google : null;
}

/** The German label of a font key. */
export function mailFontLabel(key) {
  const extra = MAIL_TEMPLATE_FONTS[/** @type {keyof typeof MAIL_TEMPLATE_FONTS} */ (key)];
  if (extra) return extra.label;
  return EMAIL_FONT_CHOICES[/** @type {keyof typeof EMAIL_FONT_CHOICES} */ (key)]?.label ?? String(key);
}

/** The theme font (email-theme.mjs) closest to a template font — for the classic renderers. */
export function classicFontFor(key) {
  const extra = MAIL_TEMPLATE_FONTS[/** @type {keyof typeof MAIL_TEMPLATE_FONTS} */ (key)];
  if (extra) return extra.classic;
  return EMAIL_FONT_KEYS.includes(/** @type {any} */ (key)) ? key : "montserrat";
}

/** Who may use a block: `personal` = templates for Mo's personal mails, `bulk` = Rundmail content. */
/**
 * @typedef {"logo" | "heading" | "text" | "image" | "button" | "products" | "coupon" | "countdown" |
 *   "divider" | "spacer" | "social" | "html" | "greeting" | "hero" | "mo_content" | "mo_offer" |
 *   "mo_promo" | "footer" | "section" | "menu" | "product"} MailBlockType
 */

/** Optional spacing / background fields every content block takes (omitted while unset). */
const BOX_FIELD_DOCS = Object.freeze({
  padTop: "Abstand oben in px, 0–120 (leer = Standard des Bausteins)",
  padBottom: "Abstand unten in px, 0–120 (leer = Standard)",
  background: "Hintergrundfarbe #rrggbb des Bausteins oder leer (= Hintergrund drumherum)",
});

/** Optional type settings of text blocks (omitted while unset). */
const TEXT_STYLE_DOCS = Object.freeze({
  fontSize: "Schriftgröße in px, 10–72 (leer = Größe s/m/l/xl)",
  weight: "normal | bold (leer = Standard: Überschriften fett)",
  italic: "true = kursiv",
  uppercase: "true = GROSSBUCHSTABEN (per CSS, der Text bleibt normal geschrieben)",
  letterSpacing: "Buchstabenabstand in px, -2–20",
  lineHeight: "Zeilenhöhe in Prozent, 100–250 (Standard 150 Text, 125 Überschrift)",
  font: "Schrift nur für diesen Baustein (Schlüssel wie fontFamily) oder leer",
});

/**
 * The block catalog: label, group, one-line description (UI + AI prompt), the
 * fields with their meaning, where the block may be used, and whether it may
 * stand inside a column of a `section`.
 * @type {Readonly<Record<MailBlockType, { label: string, group: "inhalt" | "angebot" | "mo" | "rahmen" | "aufbau",
 *   description: string, fields: Readonly<Record<string, string>>, personal: boolean, bulk: boolean, inColumns: boolean }>>}
 */
export const MAIL_BLOCK_CATALOG = Object.freeze({
  section: {
    label: "Abschnitt mit Spalten",
    group: "aufbau",
    description:
      "Ein Abschnitt mit 1–4 Spalten nebeneinander (auf dem Handy untereinander), optional mit Hintergrundfarbe oder Hintergrundbild — für Kopfzeilen, Bild + Text nebeneinander, Produkt-Kacheln, Vorteile-Leisten, farbige Bänder.",
    fields: {
      columns:
        "1–4 Spalten: { width: Breite in % (5–95, Summe 100), valign: top | middle | bottom, background: #rrggbb oder leer, padding: Innenabstand 0–48 px, blocks: [Bausteine, max. 12] }",
      background: "Hintergrundfarbe #rrggbb des Abschnitts oder leer (= Kartenfarbe)",
      bgImage: "Hintergrundbild https://… (Text darüber; Farbe als Ersatz setzen) oder leer",
      minHeight: "Mindesthöhe in px mit Hintergrundbild, 0–800",
      padTop: "Abstand oben in px, 0–120 (Standard 24)",
      padBottom: "Abstand unten in px, 0–120 (Standard 24)",
      padX: "Seitenabstand in px, 0–60 (leer = Seitenabstand der Mail; 0 = randlos)",
      gap: "Abstand zwischen den Spalten in px, 0–48 (Standard 20)",
      stack: "true = Spalten auf dem Handy untereinander (Standard) · false = immer nebeneinander (kleine Symbole, Logo + Menü)",
      reverse: "true = auf dem Handy kommt die letzte Spalte zuerst (Bild rechts am PC, oben am Handy)",
      radius: "abgerundete Ecken in px, 0–32",
      borderColor: "Rahmenfarbe #rrggbb oder leer",
    },
    personal: true,
    bulk: true,
    inColumns: false,
  },
  logo: {
    label: "Logo",
    group: "rahmen",
    description: "Das Logo von motion sports, verlinkt auf den Shop.",
    fields: { align: "left | center | right", width: "Breite in px, 60–300 (Standard 144)", ...BOX_FIELD_DOCS },
    personal: true,
    bulk: true,
    inColumns: true,
  },
  heading: {
    label: "Überschrift",
    group: "inhalt",
    description: "Eine Überschrift. Mit Hintergrundfarbe wird daraus ein vollbreites Band (z. B. schwarz mit gelber Schrift).",
    fields: {
      text: "Text, max. 200 Zeichen; Platzhalter {{vorname}} oder {{vorname|Ersatz}} erlaubt",
      size: "s | m | l | xl (16 / 20 / 26 / 34 px)",
      align: "left | center | right",
      color: "Schriftfarbe #rrggbb oder leer (= Stil)",
      background: "Hintergrund #rrggbb oder leer",
      padTop: BOX_FIELD_DOCS.padTop,
      padBottom: BOX_FIELD_DOCS.padBottom,
      ...TEXT_STYLE_DOCS,
    },
    personal: true,
    bulk: true,
    inColumns: true,
  },
  text: {
    label: "Text",
    group: "inhalt",
    description:
      "Fließtext. Leerzeile = neuer Absatz, Zeilen mit „- “ = Aufzählung, **fett**, Links als [Text](https://…).",
    fields: {
      text: "Text, max. 5.000 Zeichen; Platzhalter {{vorname}} erlaubt",
      size: "s | m | l (12 / 14 / 16 px)",
      align: "left | center | right",
      color: "Schriftfarbe #rrggbb oder leer",
      background: "Hintergrund #rrggbb oder leer",
      bullet: "Zeichen der Aufzählung: ✓ | → | – | ★ | 1. (nummeriert) oder leer (= •)",
      accentBar: "Farbe #rrggbb eines Balkens links neben dem Text (Zitat, Hinweis) oder leer",
      padTop: BOX_FIELD_DOCS.padTop,
      padBottom: BOX_FIELD_DOCS.padBottom,
      ...TEXT_STYLE_DOCS,
    },
    personal: true,
    bulk: true,
    inColumns: true,
  },
  image: {
    label: "Bild",
    group: "inhalt",
    description: "Ein Bild (Banner, Foto, animiertes GIF), optional verlinkt. Bilder hochladen oder eine https-Adresse angeben.",
    fields: {
      src: "Bildadresse https://… (JPG, PNG oder GIF)",
      alt: "Alternativtext — Pflicht, wird gezeigt, wenn Bilder blockiert sind",
      href: "Link beim Klick (https://…) oder leer",
      width: "full (ganze Breite: 600 px bzw. Spaltenbreite) | content (mit Seitenrand) | Zahl in px (40–600)",
      align: "left | center | right (bei schmaleren Bildern)",
      radius: "abgerundete Ecken in px, 0–40",
      ...BOX_FIELD_DOCS,
    },
    personal: true,
    bulk: true,
    inColumns: true,
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
      size: "s | m | l (leer = m)",
      shape: "pill | rounded | square (leer = Button-Form der Mail)",
      outline: "true = nur Rahmen und Schrift in der Buttonfarbe, kein gefüllter Button",
      borderColor: "Rahmenfarbe #rrggbb oder leer",
      ...BOX_FIELD_DOCS,
    },
    personal: true,
    bulk: true,
    inColumns: true,
  },
  products: {
    label: "Produkte",
    group: "angebot",
    description:
      "Feste Produkte aus dem Katalog mit Bild, Name, aktuellem Preis und Link — für alle Empfänger gleich (z. B. die Deals der Woche). In Schriften, Farben und Button-Look der Mail.",
    fields: {
      title: "Überschrift über den Produkten oder leer",
      refs: "Katalog-Referenzen (Handle oder Handle~VariantenId), 1–8 Stück",
      layout: "rows (Zeilen mit Beschreibung) | grid (Raster, 2 pro Zeile)",
      cardColor: "Farbe #rrggbb einer Karte hinter jedem Produkt oder leer (= ohne Karte, auf der Kartenfarbe der Mail)",
      textColor: "Schriftfarbe #rrggbb von Name, Preis und Beschreibung oder leer (= Überschriften- und Textfarbe der Mail)",
    },
    personal: true,
    bulk: true,
    inColumns: false,
  },
  product: {
    label: "Produkt-Highlight",
    group: "angebot",
    description:
      "EIN Produkt aus dem Katalog im Look der Mail — Bild, Name, aktueller Preis (auch Sale- und „ab“-Preis) und Link kommen beim Versand live aus dem Katalog. In Spalten nebeneinander ergibt das Produkt-Kacheln im eigenen Design.",
    fields: {
      ref: "Katalog-Referenz (Handle oder Handle~VariantenId)",
      layout: "stacked (Bild über dem Text) | side (Bild links, Text rechts)",
      showImage: "true | false",
      showPrice: "true | false",
      showDescription: "true = Kurzbeschreibung aus dem Katalog zeigen",
      buttonLabel: "Beschriftung des Buttons (Standard „Zum Produkt“, leer = kein Button)",
      align: "left | center | right",
      color: "Schriftfarbe #rrggbb oder leer",
      nameSize: "Schriftgröße des Namens in px, 12–40",
      ...BOX_FIELD_DOCS,
    },
    personal: true,
    bulk: true,
    inColumns: true,
  },
  coupon: {
    label: "Gutschein-Code",
    group: "angebot",
    description:
      "Ein für alle gleicher Rabattcode (in Shopify angelegt) als Gutschein-Karte mit „Code einlösen“-Link oder -Button, der den Code im Warenkorb hinterlegt. Ohne eigene Farben in Schrift und Farben der Mail.",
    fields: {
      code: "Der Code, genau wie in Shopify (z. B. BLACKWEEK25)",
      headline: "Was er bringt, z. B. „25 % auf alles“",
      terms: "Bedingungen, z. B. „Gültig bis 30.11. · nicht kombinierbar“",
      accent: "Farbe #rrggbb von Rahmen und Überschrift oder leer (= Rahmen in der Akzentfarbe, Überschrift in der Schriftfarbe)",
      cardColor: "Farbe #rrggbb der Gutschein-Karte selbst oder leer (= ohne Füllung, der Hintergrund drumherum)",
      borderStyle: "Rahmen: dashed (gestrichelt, Standard) | solid (durchgezogen) | none (ohne Rahmen)",
      radius: "abgerundete Ecken der Karte in px, 0–24 (Standard 8)",
      textColor: "Schriftfarbe #rrggbb von „Dein Code“, Überschrift und Bedingungen oder leer (= Textfarbe der Mail, auf der Karte gut lesbar)",
      codeColor: "Farbe #rrggbb des Codes oder leer (= Überschriftenfarbe der Mail)",
      codeFont: "Schrift des Codes (Schlüssel wie fontFamily) oder leer (= Schrift der Überschriften)",
      cta: "link (Standard: der Link „Code einlösen →“) | button (gefüllter Button im Button-Look der Mail: Akzentfarbe, Button-Schriftfarbe, Button-Form)",
      ...BOX_FIELD_DOCS,
    },
    personal: true,
    bulk: true,
    inColumns: true,
  },
  countdown: {
    label: "Countdown",
    group: "angebot",
    description:
      "Ein Live-Countdown bis zu einem festen Zeitpunkt — die Zahlen stimmen bei jedem Öffnen. Ohne eigene Farben passt er sich dem Stil der Mail an (Hintergrund, Akzentfarbe, Schrift).",
    fields: {
      until: "Ende als Datum/Uhrzeit (ISO)",
      heading: "Text darüber oder leer",
      tileColor: "Farbe #rrggbb der Zahlen-Kacheln oder leer (= automatisch ein Ton heller bzw. dunkler als der Hintergrund)",
      digitColor: "Farbe #rrggbb der Ziffern oder leer (= Akzentfarbe, wenn sie auf den Kacheln gut lesbar ist, sonst Überschriftenfarbe)",
      labelColor:
        "Farbe #rrggbb der Beschriftungen — Tage/Stunden/Minuten, die Zeile im Bild und die Zeile darunter — oder leer (= gedämpfte, gut lesbare Schriftfarbe)",
      padTop: BOX_FIELD_DOCS.padTop,
      padBottom: BOX_FIELD_DOCS.padBottom,
      background: "Hintergrundfarbe #rrggbb des Bausteins, zugleich der Grund des Countdown-Bilds (nahtlos), oder leer (= Kartenfarbe)",
    },
    personal: true,
    bulk: true,
    inColumns: false,
  },
  menu: {
    label: "Navigation",
    group: "rahmen",
    description: "Eine Leiste mit Text-Links (z. B. „Kraft | Cardio | Zubehör | Sale“) — oben unter dem Logo oder neben dem Logo.",
    fields: {
      items: "1–8 Links: { label: Text (max. 40 Zeichen), href: https://… }",
      align: "left | center | right",
      separator: "| | · | / | none",
      uppercase: "true | false",
      bold: "true | false",
      color: "Schriftfarbe #rrggbb oder leer (= Textfarbe)",
      fontSize: "Schriftgröße in px, 10–28 (Standard 13)",
      letterSpacing: TEXT_STYLE_DOCS.letterSpacing,
      font: TEXT_STYLE_DOCS.font,
      ...BOX_FIELD_DOCS,
    },
    personal: true,
    bulk: true,
    inColumns: true,
  },
  divider: {
    label: "Trennlinie",
    group: "rahmen",
    description: "Eine dünne Linie zwischen Abschnitten.",
    fields: {
      color: "Linienfarbe #rrggbb oder leer",
      thickness: "Stärke in px, 1–8",
      widthPct: "Länge in % der Breite, 10–100",
      lineStyle: "solid | dashed | dotted",
      align: "left | center | right",
      ...BOX_FIELD_DOCS,
    },
    personal: true,
    bulk: true,
    inColumns: true,
  },
  spacer: {
    label: "Abstand",
    group: "rahmen",
    description: "Leerer Abstand.",
    fields: { height: "Höhe in px, 4–200", background: BOX_FIELD_DOCS.background },
    personal: true,
    bulk: true,
    inColumns: true,
  },
  social: {
    label: "Social-Media",
    group: "rahmen",
    description: "Die Social-Media-Symbole von motion sports.",
    fields: { align: "left | center | right", ...BOX_FIELD_DOCS },
    personal: true,
    bulk: true,
    inColumns: true,
  },
  html: {
    label: "Eigenes HTML",
    group: "inhalt",
    description:
      "Für Profis: ein eigener HTML-Abschnitt (z. B. aus einem Design-Tool). Skripte, Formulare und Event-Attribute werden entfernt; in Outlook unbedingt testen.",
    fields: { html: "HTML-Code, max. 20.000 Zeichen — Tabellen und Inline-Styles verwenden", ...BOX_FIELD_DOCS },
    personal: true,
    bulk: true,
    inColumns: true,
  },
  greeting: {
    label: "Anrede",
    group: "inhalt",
    description: "Die persönliche Anrede mit Vornamen — mit Ersatztext, wenn kein Vorname bekannt ist.",
    fields: {
      text: "Mit Vornamen, z. B. „Hallo {{vorname}},“",
      fallback: "Ohne Vornamen, z. B. „Hallo,“",
      align: "left | center",
      color: "Schriftfarbe #rrggbb oder leer",
      padTop: BOX_FIELD_DOCS.padTop,
      padBottom: BOX_FIELD_DOCS.padBottom,
      background: BOX_FIELD_DOCS.background,
      ...TEXT_STYLE_DOCS,
    },
    personal: true,
    bulk: true,
    inColumns: true,
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
    inColumns: false,
  },
  mo_content: {
    label: "Mos persönlicher Text",
    group: "mo",
    description:
      "Der Text, den Mo für jede Person schreibt (Kampagne, Marketing) — Pflicht in Vorlagen für persönliche Mails. Rechtliche und Inhalts-Bausteine bleiben unverändert.",
    fields: { showHeading: "true = die Überschrift der Mail (z. B. „Deine persönliche Empfehlung“) zeigen" },
    personal: true,
    bulk: false,
    inColumns: false,
  },
  mo_offer: {
    label: "Mos Angebot",
    group: "mo",
    description:
      "Die individuell ausgesuchten Produkte bzw. das persönliche Set, der persönliche Rabattcode und sein Countdown. Fehlt der Baustein, steht das Angebot direkt unter Mos Text.",
    fields: {},
    personal: true,
    bulk: false,
    inColumns: false,
  },
  mo_promo: {
    label: "Mo-Hinweis & Button",
    group: "mo",
    description:
      "Der Hinweis auf die Beratung mit Mo und der (gezählte) Haupt-Button der Kampagne. Fehlt der Baustein, steht er unter dem Angebot.",
    fields: {},
    personal: true,
    bulk: false,
    inColumns: false,
  },
  footer: {
    label: "Fußzeile",
    group: "rahmen",
    description:
      "Impressum, Firmenangaben und der Abmelde-Link — Pflicht, immer am Ende, kann nicht entfernt werden.",
    fields: {
      showSocial: "true = Social-Media-Symbole in der Fußzeile",
      background: "Hintergrund #rrggbb oder leer (= hellgrau)",
      textColor: "Schriftfarbe #rrggbb oder leer (= schwarz) — gut lesbar halten",
    },
    personal: true,
    bulk: true,
    inColumns: false,
  },
});

/** @type {ReadonlyArray<MailBlockType>} */
export const MAIL_BLOCK_TYPES = Object.freeze(/** @type {MailBlockType[]} */ (Object.keys(MAIL_BLOCK_CATALOG)));

/** The block types a column of a section may hold. */
export const MAIL_CHILD_BLOCK_TYPES = Object.freeze(MAIL_BLOCK_TYPES.filter((t) => MAIL_BLOCK_CATALOG[t].inColumns));

/** The block types that only stand at the top level of a document. */
export const MAIL_TOP_ONLY_TYPES = Object.freeze(MAIL_BLOCK_TYPES.filter((t) => !MAIL_BLOCK_CATALOG[t].inColumns));

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
  cardBackground: "#ffffff",
  headingFont: null,
  linkColor: null,
  contentPadding: 60,
  cardRadius: 0,
});

/** The separators of a menu block. */
export const MENU_SEPARATORS = Object.freeze(["|", "·", "/", "none"]);
/** The bullets of a text block's list ("1." = numbered). */
export const TEXT_BULLETS = Object.freeze(["✓", "→", "–", "★", "1."]);

/** Merge fields: {{vorname}} and {{vorname|Ersatz}} (case-insensitive name). */
export const MERGE_FIELD_RE = /\{\{\s*([a-zA-ZäöüÄÖÜß_]+)\s*(?:\|([^{}]{0,40}))?\}\}/g;
/** The only merge field there is (privacy: no e-mail, no order data in a mail body). */
export const MERGE_FIELDS = Object.freeze(["vorname"]);

/**
 * The link targets in the prose of a text block, with the patterns
 * email-prose.mjs links them by: the quoted href of an <a>, the target of
 * [label](url) (with its brackets) and a bare http(s) address. Merge fields
 * are never replaced inside them — validation refuses them there, the
 * renderer merges only the text around them (link labels included). Global:
 * use with replace / matchAll only.
 */
export const PROSE_URL_RE = /href\s*=\s*(?:"[^"]*"|'[^']*')|\]\(https?:\/\/[^\s()]+\)|https?:\/\/[^\s<>()[\]"']+/gi;

/** A placeholder in an address — as written or percent-encoded by the URL parser (%7B%7B). */
const PLACEHOLDER_IN_URL_RE = /\{\{|%7B%7B/i;
/** @param {unknown} url */
const urlHasPlaceholder = (url) => PLACEHOLDER_IN_URL_RE.test(String(url ?? ""));

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
 * An OPTIONAL number: rounded and clamped, or null when empty / not a number
 * (the block's default applies). Negative values are allowed when `lo` is.
 * @param {unknown} v @param {number} lo @param {number} hi
 */
function nint(v, lo, hi) {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/** Copy the optional spacing / background fields (omitted while unset). */
function boxInto(out, r, { background = true } = {}) {
  const padTop = nint(r.padTop, 0, 120);
  const padBottom = nint(r.padBottom, 0, 120);
  if (padTop != null) out.padTop = padTop;
  if (padBottom != null) out.padBottom = padBottom;
  if (background) {
    const bg = color(r.background);
    if (bg) out.background = bg;
  }
  return out;
}

/** Copy optional #rrggbb fields (omitted while unset or invalid). */
function colorsInto(out, r, keys) {
  for (const k of keys) {
    const c = color(r[k]);
    if (c) out[k] = c;
  }
  return out;
}

/** The corner radius of a coupon card (px) while its `radius` is unset. */
export const COUPON_RADIUS = 8;

/** Copy the optional type settings of a text block (omitted while unset). */
function textStyleInto(out, r, { maxSize = 72 } = {}) {
  const fontSize = nint(r.fontSize, 10, maxSize);
  if (fontSize != null) out.fontSize = fontSize;
  if (r.weight === "normal" || r.weight === "bold") out.weight = r.weight;
  if (r.italic === true) out.italic = true;
  if (r.uppercase === true) out.uppercase = true;
  const ls = nint(r.letterSpacing, -2, 20);
  if (ls != null && ls !== 0) out.letterSpacing = ls;
  const lh = nint(r.lineHeight, 100, 250);
  if (lh != null) out.lineHeight = lh;
  if (isMailFontKey(r.font)) out.font = r.font;
  return out;
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

/** One catalog ref (the product block), or "". */
function singleRef(v) {
  return refs(typeof v === "string" ? [v] : [])[0] ?? "";
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

/** The wanted id when it is well-formed and free, else a new one — taken either way. */
function takeId(wanted, taken) {
  const ok = typeof wanted === "string" && /^[A-Za-z0-9_-]{1,24}$/.test(wanted) && !taken.has(wanted);
  const id = ok ? /** @type {string} */ (wanted) : newBlockId(taken);
  taken.add(id);
  return id;
}

/**
 * Column widths in percent that add up to 100: unset ones (0) share what the
 * set ones leave (equally when none is set), then everything is scaled and
 * rounded, each column at least 5 %.
 * @param {number[]} raw
 */
export function normalizeColumnWidths(raw) {
  const n = raw.length;
  if (n === 0) return [];
  const set = raw.filter((w) => w > 0);
  const setSum = set.reduce((a, b) => a + b, 0);
  const unset = n - set.length;
  const share = unset > 0 ? Math.max(5, (setSum < 100 ? 100 - setSum : 100 / n) / unset) : 0;
  const filled = raw.map((w) => (w > 0 ? w : share));
  const sum = filled.reduce((a, b) => a + b, 0);
  const scaled = filled.map((w) => Math.max(5, Math.round((w / sum) * 100)));
  // rounding remainder goes to the widest column
  const diff = 100 - scaled.reduce((a, b) => a + b, 0);
  if (diff !== 0) {
    let widest = 0;
    scaled.forEach((w, i) => {
      if (w > scaled[widest]) widest = i;
    });
    scaled[widest] = Math.max(5, scaled[widest] + diff);
  }
  return scaled;
}

// ── normalisation ────────────────────────────────────────────────────────────

/** @param {unknown} v */
function imageWidth(v) {
  if (v === "full" || v === "content") return v;
  return nint(v, 40, 600) ?? "full";
}

/**
 * One block from untrusted input → a clean block, or null for an unknown type
 * (or a type that may not stand where it is: inside a column only
 * MAIL_CHILD_BLOCK_TYPES). Every field is clamped to its vocabulary/limits;
 * unknown fields are dropped; optional fields are omitted while unset.
 * @param {unknown} raw
 * @param {Set<string>} takenIds  ids of the WHOLE document (one set for the tree)
 * @param {{ inColumn?: boolean, budget?: { left: number } }} [opts]  budget: blocks still allowed (incl. nested)
 * @returns {MailBlock | null}
 */
export function normalizeMailBlock(raw, takenIds = new Set(), opts = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const type = /** @type {MailBlockType} */ (r.type);
  if (!MAIL_BLOCK_TYPES.includes(type)) return null;
  if (opts.inColumn && !MAIL_BLOCK_CATALOG[type].inColumns) return null;
  if (opts.budget) {
    if (opts.budget.left <= 0) return null;
    opts.budget.left--;
  }
  const id = takeId(r.id, takenIds);
  const L = MAIL_TEMPLATE_LIMITS;
  switch (type) {
    case "logo":
      return boxInto({ id, type, align: oneOf(r.align, ALIGNS, "center"), width: int(r.width, 60, 300, 144) }, r);
    case "heading":
      return textStyleInto(
        boxInto(
          {
            id,
            type,
            text: line(r.text, L.headingChars),
            size: oneOf(r.size, HEADING_SIZES, "l"),
            align: oneOf(r.align, ALIGNS, "center"),
            color: color(r.color),
            background: color(r.background),
          },
          r,
          { background: false }
        ),
        r
      );
    case "text": {
      const out = boxInto(
        {
          id,
          type,
          text: str(r.text, L.textChars).trim(),
          size: oneOf(r.size, TEXT_SIZES, "m"),
          align: oneOf(r.align, ALIGNS, "left"),
          color: color(r.color),
          background: color(r.background),
        },
        r,
        { background: false }
      );
      if (typeof r.bullet === "string" && TEXT_BULLETS.includes(r.bullet)) out.bullet = r.bullet;
      const bar = color(r.accentBar);
      if (bar) out.accentBar = bar;
      return textStyleInto(out, r);
    }
    case "image": {
      const out = {
        id,
        type,
        src: cleanUrl(r.src),
        alt: line(r.alt, L.altChars),
        href: cleanHref(r.href),
        width: imageWidth(r.width),
      };
      if (r.align === "left" || r.align === "right") out.align = r.align;
      const radius = nint(r.radius, 0, 40);
      if (radius) out.radius = radius;
      return boxInto(out, r);
    }
    case "button": {
      const out = {
        id,
        type,
        label: line(r.label, L.labelChars),
        href: cleanHref(r.href),
        align: oneOf(r.align, ALIGNS, "center"),
        color: color(r.color),
        textColor: color(r.textColor),
        fullWidth: bool(r.fullWidth, false),
      };
      if (r.size === "s" || r.size === "l") out.size = r.size;
      if (typeof r.shape === "string" && EMAIL_BUTTON_SHAPES.includes(/** @type {any} */ (r.shape))) out.shape = r.shape;
      if (r.outline === true) out.outline = true;
      const border = color(r.borderColor);
      if (border) out.borderColor = border;
      return boxInto(out, r);
    }
    case "products": {
      const out = {
        id,
        type,
        title: line(r.title, L.headingChars),
        refs: refs(r.refs),
        layout: oneOf(r.layout, ["rows", "grid"], "rows"),
      };
      colorsInto(out, r, ["cardColor", "textColor"]);
      return out;
    }
    case "product": {
      const out = {
        id,
        type,
        ref: singleRef(r.ref),
        layout: oneOf(r.layout, ["stacked", "side"], "stacked"),
        showImage: bool(r.showImage, true),
        showPrice: bool(r.showPrice, true),
        showDescription: bool(r.showDescription, false),
        buttonLabel: typeof r.buttonLabel === "string" ? line(r.buttonLabel, L.labelChars) : "Zum Produkt",
        align: oneOf(r.align, ALIGNS, "center"),
      };
      const c = color(r.color);
      if (c) out.color = c;
      const nameSize = nint(r.nameSize, 12, 40);
      if (nameSize != null) out.nameSize = nameSize;
      return boxInto(out, r);
    }
    case "coupon": {
      const out = {
        id,
        type,
        code: line(r.code, 40).replace(/\s+/g, "").toUpperCase(),
        headline: line(r.headline, L.headingChars),
        terms: line(r.terms, 300),
      };
      const accent = color(r.accent);
      if (accent) out.accent = accent;
      colorsInto(out, r, ["cardColor"]);
      if (r.borderStyle === "solid" || r.borderStyle === "none") out.borderStyle = r.borderStyle;
      const radius = nint(r.radius, 0, 24);
      if (radius != null && radius !== COUPON_RADIUS) out.radius = radius;
      colorsInto(out, r, ["textColor", "codeColor"]);
      if (isMailFontKey(r.codeFont)) out.codeFont = r.codeFont;
      if (r.cta === "button") out.cta = "button";
      return boxInto(out, r);
    }
    case "countdown": {
      const out = { id, type, until: isoDate(r.until), heading: line(r.heading, L.headingChars) };
      colorsInto(out, r, ["tileColor", "digitColor", "labelColor"]);
      return boxInto(out, r);
    }
    case "menu": {
      /** @type {Array<{ label: string, href: string }>} */
      const items = [];
      for (const it of Array.isArray(r.items) ? r.items : []) {
        if (!it || typeof it !== "object" || Array.isArray(it)) continue;
        const ir = /** @type {Record<string, unknown>} */ (it);
        const label = line(ir.label, 40);
        const href = cleanHref(ir.href);
        if (!label && !href) continue;
        items.push({ label, href });
        if (items.length >= L.menuItems) break;
      }
      const out = {
        id,
        type,
        items,
        align: oneOf(r.align, ALIGNS, "center"),
        separator: oneOf(r.separator, MENU_SEPARATORS, "|"),
        uppercase: bool(r.uppercase, true),
        bold: bool(r.bold, true),
      };
      const c = color(r.color);
      if (c) out.color = c;
      const fontSize = nint(r.fontSize, 10, 28);
      if (fontSize != null) out.fontSize = fontSize;
      const ls = nint(r.letterSpacing, -2, 20);
      if (ls != null && ls !== 0) out.letterSpacing = ls;
      if (isMailFontKey(r.font)) out.font = r.font;
      return boxInto(out, r);
    }
    case "divider": {
      const out = { id, type, color: color(r.color) };
      const thickness = nint(r.thickness, 1, 8);
      if (thickness != null && thickness !== 1) out.thickness = thickness;
      const widthPct = nint(r.widthPct, 10, 100);
      if (widthPct != null && widthPct !== 100) out.widthPct = widthPct;
      if (r.lineStyle === "dashed" || r.lineStyle === "dotted") out.lineStyle = r.lineStyle;
      if (r.align === "left" || r.align === "right") out.align = r.align;
      return boxInto(out, r);
    }
    case "spacer": {
      const out = { id, type, height: int(r.height, 4, 200, 24) };
      const bg = color(r.background);
      if (bg) out.background = bg;
      return out;
    }
    case "social": {
      const out = { id, type };
      if (r.align === "left" || r.align === "right") out.align = r.align;
      return boxInto(out, r);
    }
    case "html":
      return boxInto({ id, type, html: str(r.html, L.htmlChars) }, r);
    case "greeting": {
      const out = {
        id,
        type,
        text: line(r.text, L.headingChars) || "Hallo {{vorname}},",
        fallback: line(r.fallback, L.headingChars) || "Hallo,",
        align: oneOf(r.align, ["left", "center"], "left"),
      };
      const c = color(r.color);
      if (c) out.color = c;
      return textStyleInto(boxInto(out, r), r);
    }
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
    case "footer": {
      const out = { id, type, showSocial: bool(r.showSocial, true) };
      const bg = color(r.background);
      if (bg) out.background = bg;
      const tc = color(r.textColor);
      if (tc) out.textColor = tc;
      return out;
    }
    case "section":
      return normalizeSection(id, r, takenIds, opts.budget);
    default:
      return null;
  }
}

/**
 * A section: its columns (1–4, widths adding up to 100 %) with their child
 * blocks (MAIL_CHILD_BLOCK_TYPES only, at most 12 per column).
 * @param {string} id
 * @param {Record<string, unknown>} r
 * @param {Set<string>} takenIds
 * @param {{ left: number } | undefined} budget
 */
function normalizeSection(id, r, takenIds, budget) {
  const L = MAIL_TEMPLATE_LIMITS;
  const rawCols = Array.isArray(r.columns) && r.columns.length > 0 ? r.columns.slice(0, L.columns) : [{}];
  const columns = rawCols.map((c) => {
    const cr = c && typeof c === "object" && !Array.isArray(c) ? /** @type {Record<string, unknown>} */ (c) : {};
    const colId = takeId(cr.id, takenIds);
    /** @type {MailBlock[]} */
    const blocks = [];
    for (const child of Array.isArray(cr.blocks) ? cr.blocks : []) {
      if (blocks.length >= L.blocksPerColumn) break;
      const k = normalizeMailBlock(child, takenIds, { inColumn: true, budget });
      if (k) blocks.push(k);
    }
    return {
      id: colId,
      width: nint(cr.width, 5, 95) ?? 0,
      valign: oneOf(cr.valign, ["top", "middle", "bottom"], "top"),
      background: color(cr.background),
      padding: int(cr.padding, 0, 48, 0),
      blocks,
    };
  });
  const widths = normalizeColumnWidths(columns.map((c) => c.width));
  columns.forEach((c, i) => {
    c.width = widths[i];
  });
  return {
    id,
    type: /** @type {MailBlockType} */ ("section"),
    columns,
    background: color(r.background),
    bgImage: cleanUrl(r.bgImage),
    minHeight: int(r.minHeight, 0, 800, 0),
    padTop: int(r.padTop, 0, 120, 24),
    padBottom: int(r.padBottom, 0, 120, 24),
    padX: nint(r.padX, 0, 60),
    gap: int(r.gap, 0, 48, 20),
    stack: bool(r.stack, true),
    reverse: bool(r.reverse, false),
    radius: int(r.radius, 0, 32, 0),
    borderColor: color(r.borderColor),
  };
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
    fontFamily: oneOf(r.fontFamily, MAIL_FONT_KEYS, DEFAULT_MAIL_STYLE.fontFamily),
    buttonShape: oneOf(r.buttonShape, EMAIL_BUTTON_SHAPES, DEFAULT_MAIL_STYLE.buttonShape),
    logoUrl: logo || null,
    cardBackground: color(r.cardBackground) ?? DEFAULT_MAIL_STYLE.cardBackground,
    headingFont: isMailFontKey(r.headingFont) ? /** @type {string} */ (r.headingFont) : null,
    linkColor: color(r.linkColor),
    contentPadding: int(r.contentPadding, 16, 60, DEFAULT_MAIL_STYLE.contentPadding),
    cardRadius: int(r.cardRadius, 0, 24, DEFAULT_MAIL_STYLE.cardRadius),
  };
}

/**
 * A whole document from untrusted input (API body, import file, AI output) →
 * a clean document. Unknown blocks are dropped, at most `blocks` top-level
 * blocks and `totalBlocks` blocks overall are kept, exactly ONE footer stands
 * at the end (added when missing, extra ones dropped), at most one of each Mo
 * block (the first wins). Ids are unique across the whole tree.
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
  // One block stays reserved for the footer.
  const budget = { left: MAIL_TEMPLATE_LIMITS.totalBlocks - 1 };
  /** @type {MailBlock[]} */
  const blocks = [];
  let footer = null;
  for (const entry of Array.isArray(r.blocks) ? r.blocks : []) {
    const type = entry && typeof entry === "object" ? /** @type {Record<string, unknown>} */ (entry).type : null;
    if (type === "footer") {
      if (!footer) footer = normalizeMailBlock(entry, taken);
      continue;
    }
    if (typeof type === "string" && MO_BLOCK_TYPES.includes(/** @type {MailBlockType} */ (type))) {
      if (seenSingletons.has(type)) continue;
      seenSingletons.add(type);
    }
    if (blocks.length >= MAIL_TEMPLATE_LIMITS.blocks - 1) continue;
    const b = normalizeMailBlock(entry, taken, { budget });
    if (b) blocks.push(b);
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

/**
 * Every block of a document, depth first in reading order: each top-level
 * block, a section followed by the blocks of its columns.
 * @param {{ blocks?: unknown } | null | undefined} doc
 * @returns {Array<{ block: MailBlock, sectionId: string | null, columnIndex: number | null }>}
 */
export function walkMailBlocks(doc) {
  /** @type {Array<{ block: MailBlock, sectionId: string | null, columnIndex: number | null }>} */
  const out = [];
  for (const b of Array.isArray(doc?.blocks) ? /** @type {any[]} */ (doc.blocks) : []) {
    if (!b || typeof b !== "object") continue;
    out.push({ block: b, sectionId: null, columnIndex: null });
    if (b.type !== "section" || !Array.isArray(b.columns)) continue;
    b.columns.forEach((/** @type {any} */ c, /** @type {number} */ ci) => {
      for (const k of Array.isArray(c?.blocks) ? c.blocks : []) {
        if (k && typeof k === "object") out.push({ block: k, sectionId: b.id, columnIndex: ci });
      }
    });
  }
  return out;
}

/** Every catalog ref of the document's product blocks (products + product, nested ones too), in order, unique. */
export function docProductRefs(doc) {
  const out = [];
  for (const { block: b } of walkMailBlocks(doc)) {
    const list = b.type === "products" ? b.refs ?? [] : b.type === "product" && b.ref ? [b.ref] : [];
    for (const r of list) if (!out.includes(r)) out.push(r);
  }
  return out;
}

/** How many blocks the document has, the ones inside sections included. */
export function docBlockCount(doc) {
  return walkMailBlocks(doc).length;
}

/** Every font key a document uses (style + per-block fonts), unique. */
export function docFontKeys(doc) {
  const out = [];
  const add = (k) => {
    if (isMailFontKey(k) && !out.includes(k)) out.push(k);
  };
  add(doc?.style?.fontFamily);
  add(doc?.style?.headingFont);
  for (const { block } of walkMailBlocks(doc)) add(block.font);
  return out;
}

// ── colour contrast ──────────────────────────────────────────────────────────

/** Relative luminance (WCAG) of #rrggbb. */
function luminance(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex ?? ""));
  if (!m) return null;
  const ch = [0, 2, 4].map((i) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** The WCAG contrast ratio of two #rrggbb colours (1–21), or null. */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  if (la == null || lb == null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** The darker or the lighter ink (#111111 / #ffffff), whichever reads better on `bg`. */
export function strongInk(bg) {
  const dark = contrastRatio("#111111", bg) ?? 21;
  const light = contrastRatio("#ffffff", bg) ?? 1;
  return dark >= light ? "#111111" : "#ffffff";
}

/** `preferred` when it reads on `bg` (WCAG ratio ≥ `min`), else `fallback` (the stronger ink). */
export function readableInk(preferred, bg, min = 4.5, fallback = strongInk(bg)) {
  const ratio = contrastRatio(preferred, bg);
  return ratio == null || ratio >= min ? preferred : fallback;
}

/**
 * The colour `t` (0–1) of the way from `a` to `b` (sRGB, rounded), #rrggbb —
 * `a` itself when either is not a #rrggbb colour.
 * @param {string} a @param {string} b @param {number} t
 */
export function mixColor(a, b, t) {
  const pa = /^#([0-9a-f]{6})$/i.exec(String(a ?? ""));
  const pb = /^#([0-9a-f]{6})$/i.exec(String(b ?? ""));
  if (!pa || !pb) return a;
  const k = Math.min(1, Math.max(0, t));
  return `#${[0, 2, 4]
    .map((i) => {
      const x = parseInt(pa[1].slice(i, i + 2), 16);
      const y = parseInt(pb[1].slice(i, i + 2), 16);
      return Math.round(x + (y - x) * k)
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;
}

/**
 * A muted ink for small print and labels: `base` (else the stronger ink of the
 * first ground) faded toward the first ground as far as it still reads at
 * 4.5 : 1 on every one of `grounds` — at most 35 % of the way.
 * @param {string} base
 * @param {string | ReadonlyArray<string>} grounds
 */
export function mutedInk(base, grounds) {
  const list = (Array.isArray(grounds) ? grounds : [grounds]).filter((g) => luminance(g) != null);
  if (list.length === 0) return base;
  const worst = (/** @type {string} */ c) => Math.min(...list.map((g) => contrastRatio(c, g) ?? 21));
  let solid = luminance(base) != null && worst(base) >= 4.5 ? base : strongInk(list[0]);
  const other = solid === "#111111" ? "#ffffff" : "#111111";
  if (worst(solid) < 4.5 && worst(other) > worst(solid)) solid = other;
  for (const t of [0.35, 0.3, 0.25, 0.2, 0.15, 0.1, 0.05]) {
    const c = mixColor(solid, list[0], t);
    if (worst(c) >= 4.5) return c;
  }
  return solid;
}

/**
 * A shade of `ground` that is visibly different from it — lighter on a dark
 * ground, slightly darker on a light one (#ffffff → #f5f5f5, the classic
 * countdown tile; #111111 → #292929): the first step of 2 % toward white /
 * black that reaches a contrast of 1.22 : 1 (dark) or 1.08 : 1 (light).
 * @param {string} ground
 */
export function shadeOf(ground) {
  const dark = strongInk(ground) === "#ffffff";
  const toward = dark ? "#ffffff" : "#000000";
  const target = dark ? 1.22 : 1.08;
  for (let k = 2; k <= 20; k++) {
    const c = mixColor(ground, toward, k * 0.02);
    if ((contrastRatio(c, ground) ?? 21) >= target) return c;
  }
  return mixColor(ground, toward, 0.4);
}

/**
 * The colours of a countdown block — its own fields over the automatic look
 * of the document style (format 2): `bg` = the block's background, else the
 * card colour (the image's own ground, so it blends into its row); `tile` = a
 * visibly different shade of it (shadeOf); `digit` = the accent colour when
 * it reads on the tiles (≥ 3 : 1), else the heading colour, else the stronger
 * ink; `label` (units, the line in the image, the line under it) = a muted
 * ink that reads on ground and tiles (mutedInk of the text colour).
 * @param {Record<string, any> | null | undefined} block  the countdown block (background, tileColor, digitColor, labelColor)
 * @param {Record<string, any> | null | undefined} style  the document style
 * @returns {{ bg: string, tile: string, digit: string, label: string }}
 */
export function countdownLook(block, style) {
  const s = { ...DEFAULT_MAIL_STYLE, ...(style ?? {}) };
  const bg = color(block?.background) ?? color(s.cardBackground) ?? DEFAULT_MAIL_STYLE.cardBackground;
  const tile = color(block?.tileColor) ?? shadeOf(bg);
  const reads = (/** @type {unknown} */ c) => {
    const hex = color(c);
    return hex && (contrastRatio(hex, tile) ?? 0) >= 3 ? hex : null;
  };
  const digit = color(block?.digitColor) ?? reads(s.accentColor) ?? reads(s.headingColor) ?? strongInk(tile);
  const label = color(block?.labelColor) ?? mutedInk(color(s.textColor) ?? DEFAULT_MAIL_STYLE.textColor, [bg, tile]);
  return { bg, tile, digit, label };
}

// ── format version ───────────────────────────────────────────────────────────

/**
 * The format version a RAW document declares (`v`): 1 for a document written
 * before format 2, else the current version — a document without `v` (an
 * import, a request body, AI output) reads as current. Normalising writes the
 * current version, so only a raw `"v": 1` document reads as 1: the renderer
 * keeps the classic look of the fixed blocks (coupon, countdown, products)
 * there, byte for byte; from format 2 on they take the document's style.
 * @param {unknown} raw
 * @returns {number}
 */
export function docFormatVersion(raw) {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      v = null;
    }
  }
  const n = v && typeof v === "object" && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v).v : undefined;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n < MAIL_TEMPLATE_DOC_VERSION ? n : MAIL_TEMPLATE_DOC_VERSION;
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
 * Where an html block's structure goes wrong, for the message.
 * @param {{ fault: "close" | "place" | "open", tag: string }} f
 */
function htmlStructureHint(f) {
  if (f.fault === "close") return `</${f.tag}> ohne öffnendes <${f.tag}>`;
  if (f.fault === "open") return `<${f.tag}> wird nicht geschlossen`;
  return f.tag === "td" || f.tag === "th" ? `<${f.tag}> außerhalb einer eigenen Tabellenzeile` : `<${f.tag}> außerhalb einer eigenen Tabelle`;
}

/**
 * @typedef {{ blockId: string | null, message: string }} DocIssue
 */

/**
 * Check a NORMALISED document for a use. Errors block saving as a design /
 * sending; warnings are shown. German messages name the block. Blocks inside
 * sections are checked like top-level ones (their own id in `blockId`).
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
  const style = doc?.style ?? DEFAULT_MAIL_STYLE;
  const err = (b, m) => errors.push({ blockId: b?.id ?? null, message: m });
  const warn = (b, m) => warnings.push({ blockId: b?.id ?? null, message: m });
  const nameOf = (b) => MAIL_BLOCK_CATALOG[b.type]?.label ?? b.type;
  const all = walkMailBlocks(doc);
  // Placeholders are never replaced in an address — a link is never personalised.
  const noLinkPlaceholder = (b, ...urls) => {
    if (urls.some(urlHasPlaceholder)) err(b, `${nameOf(b)}: Platzhalter wie {{vorname}} werden in Links nicht ersetzt — Link ohne Platzhalter eintragen.`);
  };
  const noImagePlaceholder = (b, url) => {
    if (urlHasPlaceholder(url)) err(b, `${nameOf(b)}: Platzhalter wie {{vorname}} werden in Bildadressen nicht ersetzt.`);
  };
  const sections = new Map(blocks.filter((b) => b?.type === "section").map((b) => [b.id, b]));

  if (all.filter(({ block: b }) => b.type !== "footer" && b.type !== "section").length === 0) {
    err(null, "Die Vorlage hat noch keinen Inhalt.");
  }
  if (!blocks.some((b) => b.type === "footer")) err(null, "Die Fußzeile mit dem Abmelde-Link fehlt.");
  if (use === "personal" && !docSupportsPersonal(doc)) {
    err(null, "Für persönliche Mails braucht die Vorlage den Baustein „Mos persönlicher Text“.");
  }
  if (use === "bulk") {
    for (const b of blocks) if (!MAIL_BLOCK_CATALOG[b.type]?.bulk) err(b, `„${nameOf(b)}“ gibt es nur in persönlichen Mails — Baustein entfernen.`);
  }
  if (urlHasPlaceholder(style.logoUrl)) err(null, "Stil: Platzhalter wie {{vorname}} werden in der Logo-Adresse nicht ersetzt.");

  /** The background a block's text stands on (null: a picture — not judged). */
  const backgroundOf = (b, sectionId, columnIndex) => {
    if (b.background) return b.background;
    if (sectionId) {
      const sec = sections.get(sectionId);
      const col = sec?.columns?.[columnIndex ?? 0];
      if (col?.background) return col.background;
      // On a background picture the text is judged against its fallback colour
      // (what shows while pictures are blocked); without one it is not judged.
      if (sec?.background) return sec.background;
      if (sec?.bgImage) return null;
    }
    return style.cardBackground ?? "#ffffff";
  };
  const contrast = (b, fg, bg, min, what = "Schrift auf dem Hintergrund") => {
    if (!fg || !bg) return;
    const ratio = contrastRatio(fg, bg);
    if (ratio != null && ratio < min) {
      warn(b, `${nameOf(b)}: ${what} schlecht lesbar (Kontrast ${ratio.toFixed(1).replace(".", ",")} : 1) — kräftigere bzw. hellere Farbe wählen.`);
    }
  };

  for (const { block: b, sectionId, columnIndex } of all) {
    const label = nameOf(b);
    const bg = backgroundOf(b, sectionId, columnIndex);
    switch (b.type) {
      case "heading":
        if (!b.text) err(b, `${label}: Text fehlt.`);
        contrast(b, b.color ?? style.headingColor, bg, 3);
        break;
      case "text":
        if (!b.text) err(b, `${label}: Text fehlt.`);
        contrast(b, b.color ?? style.textColor, bg, (b.fontSize ?? 0) >= 20 ? 3 : 4.5);
        // the targets of [Text](https://…), <a href="…"> and bare addresses — the link text may hold {{vorname}}
        if ([...String(b.text ?? "").matchAll(PROSE_URL_RE)].some((m) => urlHasPlaceholder(m[0]))) {
          err(b, `${label}: Platzhalter wie {{vorname}} werden in Links nicht ersetzt — nur im Linktext verwenden, nicht in der Adresse.`);
        }
        break;
      case "greeting":
        if (!b.text || !b.fallback) err(b, `${label}: Text mit und ohne Vornamen angeben.`);
        contrast(b, b.color ?? style.textColor, bg, 4.5);
        break;
      case "image":
        if (!b.src) err(b, `${label}: Bild fehlt (hochladen oder https-Adresse angeben).`);
        if (!b.alt) warn(b, `${label}: Alternativtext fehlt — er erscheint, wenn Bilder blockiert sind, und hilft gegen Spamfilter.`);
        if (b.src && /\.webp(\?|$)/i.test(b.src)) warn(b, `${label}: WebP zeigt Outlook nicht an — besser JPG, PNG oder GIF.`);
        noImagePlaceholder(b, b.src);
        noLinkPlaceholder(b, b.href);
        break;
      case "button":
        if (!b.label) err(b, `${label}: Beschriftung fehlt.`);
        if (!b.href) err(b, `${label}: Link fehlt (https://…).`);
        noLinkPlaceholder(b, b.href);
        if (b.outline) contrast(b, b.color ?? style.accentColor, bg, 3);
        else contrast(b, b.textColor ?? style.buttonTextColor, b.color ?? style.accentColor, 3);
        break;
      case "products":
        if (b.refs.length === 0) err(b, `${label}: noch kein Produkt gewählt.`);
        // an own text colour stands as set (without one the renderer picks a readable ink)
        contrast(b, b.textColor, b.cardColor ?? bg, 4.5);
        break;
      case "product":
        if (!b.ref) err(b, `${label}: noch kein Produkt gewählt.`);
        // price and description in the text colour, the name in the heading colour (b.color: both)
        if (bg && (contrastRatio(b.color ?? style.textColor, bg) ?? 21) < 4.5) contrast(b, b.color ?? style.textColor, bg, 4.5);
        else if (!b.color) contrast(b, style.headingColor, bg, 3);
        break;
      case "coupon":
        if (!b.code) err(b, `${label}: Code fehlt.`);
        else if (!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(b.code)) err(b, `${label}: Der Code darf nur Buchstaben, Ziffern, - und _ enthalten.`);
        if (!b.headline) warn(b, `${label}: Ohne Text darüber sieht niemand, was der Code bringt.`);
        if (use === "personal") warn(b, `${label}: Ein fester Code steht in JEDER persönlichen Mail — der persönliche Rabatt kommt über „Mos Angebot“.`);
        {
          // Own colours stand as set — judged on the card's own colour (else the
          // colour around it); without them the renderer picks readable inks.
          const ground = b.cardColor ?? bg;
          contrast(b, b.textColor, ground, 4.5);
          contrast(b, b.codeColor, ground, 3, "Code auf der Karte");
          if (b.headline && b.accent && b.cardColor) contrast(b, b.accent, ground, 3, "Überschrift in der Rahmenfarbe");
          if (b.cta === "button") contrast(b, style.buttonTextColor, style.accentColor, 3, "Button-Schrift auf der Buttonfarbe");
        }
        break;
      case "countdown": {
        if (!b.until) err(b, `${label}: Ende fehlt.`);
        else if (Date.parse(b.until) <= now) err(b, `${label}: Das Ende liegt in der Vergangenheit.`);
        const look = countdownLook(b, style);
        if (b.digitColor) contrast(b, b.digitColor, look.tile, 3, "Ziffern auf den Kacheln");
        if (b.labelColor) {
          contrast(b, b.labelColor, look.bg, 4.5, "Beschriftung auf dem Hintergrund");
          contrast(b, b.labelColor, look.tile, 4.5, "Beschriftung auf den Kacheln");
        }
        break;
      }
      case "menu":
        if (!b.items?.length) err(b, `${label}: noch kein Link eingetragen.`);
        else if (b.items.some((it) => !it.label || !it.href)) err(b, `${label}: Jeder Link braucht Text und Adresse (https://…).`);
        contrast(b, b.color ?? style.textColor, bg, 3);
        noLinkPlaceholder(b, ...(b.items ?? []).map((it) => it.href));
        break;
      case "html": {
        if (!b.html.trim()) err(b, `${label}: HTML fehlt.`);
        else warn(b, `${label}: Eigenes HTML — in Outlook und auf dem Handy mit einer Testmail prüfen.`);
        const placeholder = /\{\{/.test(b.html);
        if (placeholder) err(b, `${label}: Platzhalter wie {{vorname}} werden im HTML nicht ersetzt — dafür einen Text-Baustein verwenden.`);
        if (!b.html.trim()) break;
        // Judged as the renderer inserts it (mail-template-html.mjs): a block
        // that closes the mail's table or cell, or leaves one of its own open,
        // would break the mail below it — the legal footer included.
        const report = customHtmlReport(b.html);
        if (report.documentTags) err(b, `${label}: Bitte nur den Inhalt einfügen — ohne <html>, <head> und <body>; den Rahmen der Mail baut die Vorlage.`);
        if (report.structure) err(b, `${label}: unvollständige Tabellen- oder Bereichs-Tags (${htmlStructureHint(report.structure)}) — der Baustein würde die Mail darunter zerstören.`);
        if (!placeholder && report.urls.some(urlHasPlaceholder)) err(b, `${label}: Platzhalter werden in Links und Bildadressen nicht ersetzt — Adresse ohne Platzhalter eintragen.`);
        break;
      }
      case "hero":
        if (b.src && !b.alt) warn(b, `${label}: Alternativtext fehlt.`);
        noImagePlaceholder(b, b.src);
        noLinkPlaceholder(b, b.href);
        break;
      case "section": {
        const filled = (b.columns ?? []).filter((c) => c.blocks?.length > 0).length;
        if (filled === 0) err(b, `${label}: Die Spalten haben noch keinen Inhalt.`);
        else if (filled < (b.columns ?? []).length) warn(b, `${label}: ${b.columns.length - filled === 1 ? "Eine Spalte ist" : "Spalten sind"} noch leer.`);
        if (b.bgImage && /\.webp(\?|$)/i.test(b.bgImage)) warn(b, `${label}: WebP zeigt Outlook nicht an — besser JPG oder PNG.`);
        if (b.bgImage && !b.background) warn(b, `${label}: Zum Hintergrundbild eine passende Hintergrundfarbe setzen — sie erscheint, wenn Bilder blockiert sind.`);
        if (urlHasPlaceholder(b.bgImage)) err(b, `${label}: Platzhalter wie {{vorname}} werden in der Adresse des Hintergrundbilds nicht ersetzt.`);
        break;
      }
      case "footer":
        if (b.textColor || b.background) contrast(b, b.textColor ?? "#000000", b.background ?? "#f9f9f9", 4.5);
        break;
      default:
        break;
    }
    const texts = [b.text, b.fallback, b.label, b.headline, b.terms, b.title, b.heading, b.buttonLabel, ...(b.items ?? []).map((it) => it.label)];
    for (const t of texts) {
      for (const bad of unknownMergeFields(t ?? "")) err(b, `${label}: Unbekannter Platzhalter ${bad} — erlaubt ist {{vorname}} bzw. {{vorname|Ersatz}}.`);
    }
    if (/\{\{/.test(`${b.alt ?? ""}`)) err(b, `${label}: Im Alternativtext werden Platzhalter nicht ersetzt.`);
  }
  const first = blocks[0];
  if (first && !["logo", "image", "hero", "heading", "section", "menu"].includes(first.type)) {
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
    const where = type === "section" ? "nur oben, nicht verschachtelt" : c.inColumns ? "auch in Spalten" : "nur oben, nicht in Spalten";
    const fields = Object.entries(c.fields)
      .map(([k, v]) => `    - ${k}: ${v}`)
      .join("\n");
    return `- ${type} („${c.label}“, ${uses}, ${where}): ${c.description}${fields ? `\n${fields}` : ""}`;
  }).join("\n");
}
