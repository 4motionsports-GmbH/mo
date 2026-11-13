// E-mail templates („Vorlagen“) — the renderer: a block document
// (mail-template-doc.mjs) → e-mail HTML and the plain-text part. Pure and
// tested (mail-template-render.test.mjs, mail-template-render-v2.test.mjs);
// docs/EMAIL_TEMPLATES.md.
//
// The output follows every rule of docs/EMAIL_DESIGNS.md: a 600 px table
// card, role="presentation" + bgcolor attributes, every style inline, images
// with numeric width attributes, buttons with their padding on the cell
// (mso-padding-alt), the Outlook head block, the shared shell CSS. The tests
// run lintOutlookHtml (email-outlook.mjs, strict) over real renders. For
// classic Outlook (Word) format 2 adds what browsers never see (13.11.2026,
// docs/EMAIL_TEMPLATES.md §4 „Outlook“): each element's font as its Windows
// equivalent (fontClass), relative line heights in px (typeCss), a VML twin
// of every rounded button (roundButtonTwin), list spacing and lines on cells.
//
// Version 2 (11.11.2026, free layouts): every content block renders into a
// BOX — at the top level the 600 px card with the side padding of the style
// (contentPadding, `content-pad` → 15 px on phones) on the card colour;
// inside a column of a section the column's own width, no side padding, on
// the column's background (block → column → section → card). A section is
// the house td-stack pattern (email-designs/performance.ts): one cell per
// column that becomes a full-width block on phones (.col-stack / .col-gap,
// email-shell-css.mjs), `reverse` through dir="rtl", a background picture
// with its Outlook VML twin; with rounded corners or a border it is a box
// whose colour — or picture — sits inside the frame. Inside a column the
// default spacing above the first and below the last block collapses to 0 —
// the section's padding frames the content; padTop / padBottom always win.
// Texts whose colour the operator cannot set (the coupon's, the legal
// footer's, Mo's heading) switch to a readable ink on a colour they would
// vanish on; Mo's text, written in black for the classic white card, sits on
// a white panel on a dark card. Social icons shrink (and wrap) to fit narrow
// columns. Optional fields only ADD markup when set, so a version-1 document
// renders as before (snapshots in __fixtures__/mail-template-v1/). Custom
// HTML goes through the fence of mail-template-html.mjs, and merge fields are
// never replaced inside a link target.
//
// The fixed blocks in the mail's look (12.11.2026): from format 2 on
// (docFormatVersion — a raw `"v": 1` document keeps the classic look byte for
// byte) the coupon, the countdown and the product lists take the document's
// fonts and colours where their own look fields are unset — the coupon's
// texts in the text colour, its code in the heading font and colour; the
// countdown picture in countdownLook's colours (its ground = the row's
// colour), a phone variant swapped in on small screens; the products' names
// in the heading font and colour, the button in the mail's button look.
//
// Links, texts and phone pictures (13.11.2026): the logo links to its own
// `href` (else the shop); the countdown's line under the picture is the
// block's `caption` with {datum} (by default „Gültig bis {datum}“ — format 2
// never prints a remaining time a frozen Rundmail would carry past its
// moment; the text in the picture rides in the slot's signed URL); a picture
// with a phone version (image / hero `mobileSrc`, section `bgImageMobile`) is
// swapped on phones by the head's media rule (phoneSwapCss — only when a mail
// uses it), Outlook for Windows always keeps the desktop picture.
//
// What needs I/O or the active design context comes in through the context —
// the TypeScript layer (mail-template-design.ts, mailing-render.ts) builds it:
//   * `slots[blockId]`: DATA laid out here in the template's own look — the
//     products of a `products` block (`products`: the rows / grid items), the
//     live countdown of a `countdown` block (`countdown`: the signed picture
//     URLs, already in the block's colours, and the line under it), a
//     `product` block's card (`product`: name, picture, link, price labels,
//     description); pre-rendered `html` rows only for version-1 documents;
//   * `mo`: the pieces of a personal mail the composer produced (Mo's text,
//     the offer rows, the Mo hint, the buttons) — placed by the Mo blocks;
//   * `hero`: the per-mail picture (KI-Hero / Kampagnenbild);
//   * `footer`: the legal unsubscribe block (always rendered);
//   * `merge`: resolves {{vorname}} (or, when a Rundmail freezes, writes a
//     placeholder that is resolved per recipient).
//
// Nothing a composer produced is ever dropped: a Mo piece without its block
// in the template is placed right after Mo's text, all of it before the
// footer when the template lacks Mo's text altogether.

import { EMAIL_SHELL_CSS } from "./email-shell-css.mjs";
import {
  MAIL_SIZE_BUDGET_BYTES,
  MSO_HTML_ATTRS,
  firstFontFamily,
  forOutlook,
  hideFromOutlook,
  msoFontClassName,
  msoHeadHtml,
  msoPaddingAlt,
  msoRoundButton,
  msoTextWidth,
  nbsp,
} from "./email-outlook.mjs";
import { buttonRadiusFor } from "./email-theme.mjs";
import { emailProseToText, renderEmailProseHtml } from "./email-prose.mjs";
import { couponCodeType, discountRedeemUrl } from "./discount-coupon.mjs";
import {
  COUNTDOWN_DATE_RE,
  COUPON_RADIUS,
  MO_BLOCK_TYPES,
  PROSE_URL_RE,
  contrastRatio,
  countdownCaptionTemplate,
  countdownLook,
  docFontKeys,
  docFormatVersion,
  fillCountdownCaption,
  mailFontGoogleFamily,
  mailFontMsoStack,
  mailFontStack,
  mixColor,
  mutedInk,
  normalizeMailTemplateDoc,
  readableInk,
  strongInk,
  walkMailBlocks,
} from "./mail-template-doc.mjs";
import { sanitizeCustomHtml } from "./mail-template-html.mjs";

/**
 * The fence around a custom HTML block (mail-template-html.mjs): what the
 * renderer inserts for an `html` block.
 */
export { sanitizeCustomHtml };

/**
 * Marks where the fixed legal footer starts in the rendered HTML — the checks
 * (mailing-checks.mjs) only judge what the operator wrote, not the mandatory
 * „jederzeit kostenlos abmelden“ notice.
 */
export const MAIL_FOOTER_MARKER = "<!-- mo:footer -->";

/** Card width and the content width inside the default 60 px side padding. */
export const MAIL_CARD_WIDTH = 600;
export const MAIL_CONTENT_WIDTH = 480;

// Same rules as html-escape.ts (escapeHtml: & < >; escapeAttr: + ").
const escapeHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s) => escapeHtml(s).replace(/"/g, "&quot;");

const HEADING_PX = { s: 16, m: 20, l: 26, xl: 34 };
const TEXT_PX = { s: 12, m: 14, l: 16 };

/** Button sizes: the anchor's padding, type size and line height. */
const BUTTON_SIZES = Object.freeze({
  s: { padding: "10px 20px", fontSize: 13, lineHeight: 17 },
  m: { padding: "14px 28px", fontSize: 14, lineHeight: 18 },
  l: { padding: "18px 36px", fontSize: 16, lineHeight: 20 },
});

/** The list marks of a text block (TEXT_BULLETS; "1." numbers the lines). */
const BULLET_GLYPHS = Object.freeze({ "✓": "&#10003;", "→": "&#8594;", "–": "&#8211;", "★": "&#9733;" });

/** The separators of a menu block (MENU_SEPARATORS). */
const MENU_SEPARATOR_HTML = Object.freeze({ "|": "|", "·": "&#183;", "/": "/", none: "" });
/** Menu labels up to this length are kept on one line (&nbsp;). */
const MENU_UNBROKEN_CHARS = 18;

/** Side padding of a block with its own background inside a column (text never touches the colour's edge). */
const COLUMN_BAND_PAD = 16;
/** A column narrower than this gets the compact coupon (smaller code, less padding). */
const NARROW_COLUMN = 300;
/** Gap between picture and text of a product in the side layout. */
const PRODUCT_SIDE_GAP = 16;
/** The struck-through compare-at price — the shop's sale red (EMAIL_SALE_STRIKE_COLOR). */
const SALE_STRIKE_COLOR = "#c61724";
/** The classic link colour of the composer's prose (email-prose.mjs DEFAULT_LINK_STYLE). */
const CLASSIC_LINK_COLOR = "#008ccb";

/**
 * The display data of a `product` block, resolved at send time from the
 * catalog (mail-template-design.ts).
 * @typedef {{ name: string, imageUrl: string | null, url: string | null, priceLabel: string | null,
 *   compareAtLabel: string | null, description: string | null }} MailSlotProduct
 */

/**
 * The data of a `products` block (format 2), resolved at send time from the
 * catalog (mail-template-design.ts): the products of the rows / grid in the
 * shared price projection, drawn here in the mail's look. `description` and
 * `ctaLabel` are the rows' (null in the grid).
 * @typedef {{ layout: "rows" | "grid", items: ReadonlyArray<MailSlotProduct & { ctaLabel?: string | null }> }} MailSlotProducts
 */

/**
 * The live countdown of a `countdown` block (format 2): the signed image URLs
 * — already carrying the block's colours (countdownLook) and its text in the
 * picture, desktop and phone variant (?w=m) — their sizes at 1×, the alt text
 * and the deadline („Sa., 15.11.2026, 23:59 Uhr“) the line under the image
 * puts in place of {datum} (the block's `caption`, by default „Gültig bis
 * {datum}“). No image URL without a signing secret: then only the line.
 * @typedef {{ imageUrl: string | null, imageUrlMobile: string | null, imageAlt: string, imageWidth: number,
 *   imageHeight: number, imageWidthMobile: number, deadline: string }} MailSlotCountdown
 */

/**
 * @typedef {{
 *   subject: string,
 *   preheader?: string | null,
 *   locale?: "de" | "en",
 *   merge?: (text: string) => string,
 *   greeting?: (text: string, fallback: string) => string,
 *   assets: {
 *     logoUrl: string,
 *     shopUrl: string,
 *     imprintUrl: string,
 *     socialLinks: ReadonlyArray<{ alt: string, icon: string, url: string }>,
 *     aiLabelIconUrl?: string | null,
 *   },
 *   slots?: Record<string, { html: string, text: string, product?: MailSlotProduct, products?: MailSlotProducts,
 *     countdown?: MailSlotCountdown } | undefined>,
 *   mo?: {
 *     heading: string,
 *     bodyHtml: string,
 *     moAvatarUrl: string | null,
 *     offerRowsHtml: string | null,
 *     promoRowsHtml: string | null,
 *     ctaRowsHtml: string,
 *     footnoteRowHtml: string,
 *     postCtaRowsHtml: string,
 *     preCtaRowsHtml: string,
 *   } | null,
 *   hero?: { imageUrl: string | null, mobileUrl?: string | null, headline?: string | null, isAi?: boolean } | null,
 *   footer: { unsubscribeHtml?: string | null, unsubscribeText?: string | null },
 *   year?: number,
 *   previewPlaceholders?: boolean,
 *   companyLines?: ReadonlyArray<string>,
 *   outlook?: boolean,
 * }} MailRenderContext
 * `outlook: false` leaves out the Outlook refinements of format 2 (the output
 * as before 13.11.2026 — renderMailTemplateHtml).
 */

/**
 * Where a block renders: the width it may fill, its side padding, the
 * background around it (for colour decisions; at the top level also the
 * row colour) and whether it is the first / last block of a column (whose
 * outer default spacing collapses).
 * @typedef {{ width: number, padX: number, bg: string, top: boolean, first: boolean, last: boolean }} MailBox
 */

/** The company block of the footer — the same lines as the classic shell (email-template.ts). */
export const MAIL_COMPANY_LINES = Object.freeze([
  "4motionsports GmbH",
  "Am Weidegrund 1, 82194 Gröbenzell, Deutschland",
  "Geschäftsführer: Sabine Brunner, Lucas Brunner",
]);

/**
 * A white rounded panel. The composer writes its pieces (Mo's text, the
 * classic product rows, the countdown, Mo's buttons and footnote) in dark ink
 * for the classic white card: on a dark card they sit on one
 * (mail-template-design.ts templateSectionRow, Mo's text here).
 * @param {string} innerHtml
 */
export function mailWhitePanel(innerHtml) {
  return `
                    <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="border-collapse: separate; mso-table-lspace: 0pt; mso-table-rspace: 0pt;">
                      <tr>
                        <td bgcolor="#ffffff" align="center" style="background-color: #ffffff; border-radius: 8px; padding: 16px;">${innerHtml}
                        </td>
                      </tr>
                    </table>`;
}

/** A card colour on which the composer's black ink is unreadable (below 4.5 : 1) — its pieces need the white panel. */
export function isDarkCard(cardBackground) {
  return (contrastRatio("#000000", cardBackground) ?? 21) < 4.5;
}

/** Visible text of an HTML fragment (for the text part of an html block). */
function htmlToText(html) {
  return String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6]|li|table)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── small pure helpers ───────────────────────────────────────────────────────

/** A px length for CSS shorthands ("0" without unit, as version 1 wrote it). */
const px = (n) => (n === 0 ? "0" : `${n}px`);

/** The shortest padding shorthand for top / sides / bottom. */
function padCss(t, x, b) {
  if (t === b && t === x) return px(t);
  if (t === b) return `${px(t)} ${px(x)}`;
  return `${px(t)} ${px(x)} ${px(b)}`;
}

/** A URL inside CSS url('…'): quotes, brackets, backslashes and spaces percent-encoded. */
function cssUrl(url) {
  return String(url).replace(/['()\\\s"]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}

// ── phone versions ───────────────────────────────────────────────────────────
//
// A picture may have a phone version (image / hero `mobileSrc`, a section's
// `bgImageMobile`). The desktop picture stays as it is; the phone picture of
// an image follows it in a wrapper hidden every way a client may honour
// (display:none, max-height:0, overflow:hidden, mso-hide:all — and inside
// hideFromOutlook, so Outlook for Windows never sees it), and the head's
// 480-px media rule swaps the two; a section's phone background is a rule of
// its own that swaps the background-image of the section's picture cell (the
// VML of Outlook keeps the desktop picture). A client without media queries
// shows the desktop picture. The head carries the rules only when a mail uses
// them (phoneSwapCss), so a mail without phone versions keeps its head.

/** The class of a desktop picture with a phone version: hidden on phones. */
const PHONE_HIDE_CLASS = "ph-desk";
/** The class of the wrapper of a phone picture: opened on phones. */
const PHONE_SHOW_CLASS = "ph-phone";
/** The wrapper of a phone picture, closed everywhere until the phone rule opens it. */
const PHONE_WRAPPER_CSS = "display: none; max-height: 0; overflow: hidden; mso-hide: all;";

/** A URL inside url('…') of the head's <style> — raw text, no entities: cssUrl plus < and > percent-encoded. */
function styleSheetUrl(url) {
  return cssUrl(url).replace(/[<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * The phone swaps of the head's <style> — only what the mail uses: the
 * 350-px countdown (.cd-desk / .cd-phone, exactly as before, so a mail with
 * only a countdown keeps its head byte for byte), the phone pictures (the
 * desktop picture hidden, its wrapper opened) and one background rule per
 * section with a phone background. "" when the mail has none.
 * @param {{ phoneCountdown: boolean, phonePictures: boolean, phoneBackgrounds: Array<{ className: string, url: string }> }} R
 */
function phoneSwapCss(R) {
  const rules = [];
  if (R.phoneCountdown) rules.push(".cd-desk { display: none !important; }", ".cd-phone { display: block !important; }");
  if (R.phonePictures) {
    rules.push(`.${PHONE_HIDE_CLASS} { display: none !important; }`, `.${PHONE_SHOW_CLASS} { display: block !important; max-height: none !important; overflow: visible !important; }`);
  }
  for (const bg of R.phoneBackgrounds) rules.push(`.${bg.className} { background-image: url('${bg.url}') !important; }`);
  if (!rules.length) return "";
  return `
      @media only screen and (max-width:480px) {
${rules.map((r) => `        ${r}`).join("\n")}
      }`;
}

/**
 * The type of a coupon code inside a column: couponCodeType's size for its
 * length; when the code does not fit the room on one line, first the
 * tracking goes, then the size shrinks (down to 11 px). Bold capitals and
 * digits of the wide template fonts (Montserrat, Poppins) are up to about
 * 0.75 em wide.
 * @param {string} code
 * @param {number} room  px available for the code
 */
function couponCodeFit(code, room) {
  const chars = Math.max(1, String(code).length);
  let { fontSize, lineHeight, letterSpacing } = couponCodeType(code);
  while (chars * (fontSize * 0.75 + letterSpacing) > room) {
    if (letterSpacing > 0) {
      letterSpacing = Math.max(0, letterSpacing - 1);
    } else if (fontSize > 11) {
      fontSize -= 1;
      lineHeight = fontSize + 6;
    } else {
      break;
    }
  }
  return { fontSize, lineHeight, letterSpacing };
}

/** `preferred` when it reads on `bg` (WCAG ratio ≥ `min`), else `fallback` (mail-template-doc.mjs readableInk). */
const ink = readableInk;

/**
 * The inline type of a text element. Optional settings only add declarations
 * when set, so a version-1 block keeps its exact style string.
 *
 * Outlook for Windows (Word, format 2 — `word`): a relative line height
 * („1.5“) means nothing to Word under mso-line-height-rule:exactly, so its
 * px value follows as mso-line-height-alt (every other client ignores mso-*
 * properties). `exact: false` leaves the rule out — Word then takes the line
 * height as a minimum: a line set tighter than the font (an own line height
 * under 125 %) would cut the tops of its letters and the dots of „Ä Ö Ü“.
 * @param {{ font: string, size: number, lineHeight: string, weight: number, color: string,
 *   italic?: boolean, uppercase?: boolean, letterSpacing?: number | null, margin?: string, word?: boolean, exact?: boolean }} t
 */
function typeCss({ font, size, lineHeight, weight, color, italic = false, uppercase = false, letterSpacing = null, margin = "0", word = true, exact = true }) {
  const factor = /^\d+(?:\.\d+)?$/.test(lineHeight) ? Number(lineHeight) : null;
  const alt = word && factor ? ` mso-line-height-alt: ${Math.round(size * factor * 10) / 10}px;` : "";
  return `${exact ? "mso-line-height-rule: exactly; " : ""}direction: ltr; font-family: ${font}; font-size: ${size}px; line-height: ${lineHeight};${alt} font-weight: ${weight};${italic ? " font-style: italic;" : ""}${uppercase ? " text-transform: uppercase;" : ""}${letterSpacing ? ` letter-spacing: ${letterSpacing}px;` : ""} color: ${color}; Margin: ${margin};`;
}

/**
 * The class an element in font `key` carries so Word shows that font's
 * Windows equivalent instead of the body's (msoHeadHtml: its rule follows
 * the `*` rule) — ` class="mso-font-…"`, or "" when Word shows the same font
 * anyway or the document is version 1 (whose output stays as it was).
 * @param {any} R
 * @param {string | null | undefined} key  a font key
 */
function fontClass(R, key) {
  if (!R.word || !key) return "";
  const stack = mailFontMsoStack(key);
  if (firstFontFamily(stack) === firstFontFamily(R.bodyMso)) return "";
  const name = msoFontClassName(key);
  R.msoFonts.set(name, stack);
  return ` class="${name}"`;
}

/** The class of `fontClass` on the links and bold runs of prose too — Word's `*` rule would hit them directly. */
function classifyProse(html, cls) {
  return cls ? html.replace(/<a href="/g, `<a${cls} href="`).replace(/<strong>/g, `<strong${cls}>`) : html;
}

/**
 * The type of a heading / text / greeting block: its own settings (fontSize,
 * weight, italic, uppercase, letterSpacing, lineHeight %, font) over the
 * block type's defaults. `css(margin)` is the inline style, `cls` the
 * element's class for Word (fontClass).
 */
function blockType(R, b, { size, lineHeight, weight, color, fontKey }) {
  const fs = b.fontSize ?? size;
  const lh = b.lineHeight != null ? `${Math.round((fs * b.lineHeight) / 100)}px` : lineHeight(fs);
  const fw = b.weight === "bold" ? 700 : b.weight === "normal" ? 400 : weight;
  const key = b.font ?? fontKey;
  const font = mailFontStack(key);
  // A line height under 125 % of the font is a minimum for Word (no cut-off letters).
  const exact = !(R.word && b.lineHeight != null && b.lineHeight < 125);
  return {
    size: fs,
    exact,
    cls: fontClass(R, key),
    css: (margin = "0") =>
      typeCss({ font, size: fs, lineHeight: lh, weight: fw, color, italic: b.italic, uppercase: b.uppercase, letterSpacing: b.letterSpacing, margin, word: R.word, exact }),
  };
}

/** A row of the current table: <tr><td …>inner</td></tr> (no bgcolor when null — the colour around shows). */
function row(inner, { padding = "10px 60px", align = "left", bgcolor = "#ffffff", pad = true } = {}) {
  return `
                <tr>
                  <td${pad ? ' class="content-pad"' : ""} align="${align}"${bgcolor ? ` bgcolor="${bgcolor}"` : ""} style="mso-line-height-rule: exactly; padding: ${padding};" valign="top">${inner}
                  </td>
                </tr>`;
}

/** A fixed-height empty row (spacer block, column padding). */
function spacerRow(height, bgcolor = null) {
  return `
                <tr>
                  <td height="${height}"${bgcolor ? ` bgcolor="${bgcolor}"` : ""} style="mso-line-height-rule: exactly; font-size: 0; line-height: ${height}px;">&nbsp;</td>
                </tr>`;
}

/**
 * The vertical spacing of a block: its own padTop / padBottom, else the
 * default — 0 at a column's edge, unless the block has its own background
 * (then the spacing lies inside its colour).
 */
function vpad(b, box, top, bottom) {
  const keep = Boolean(b.background);
  return [b.padTop ?? (box.first && !keep ? 0 : top), b.padBottom ?? (box.last && !keep ? 0 : bottom)];
}

/**
 * The side padding of a block: the card's at the top level; in a column only
 * around its own background (16 px, less in narrow columns, at least 8).
 */
function sidePad(b, box) {
  if (box.top) return box.padX;
  return b.background ? Math.min(COLUMN_BAND_PAD, Math.max(8, Math.round(box.width / 12))) : 0;
}

/** The colour of a block's row: its own background; at the top level else the card colour. */
const rowBg = (b, box) => b.background ?? (box.top ? box.bg : null);
/** The colour a block's content stands on (for colour decisions). */
const envBg = (b, box) => b.background ?? box.bg;

/** The image alignment inside its cell (browsers; Word follows the cell's align). */
const blockMargin = (align) => (align === "left" ? "Margin: 0;" : align === "right" ? "Margin: 0 0 0 auto;" : "Margin: 0 auto;");

/**
 * The px widths of a section's columns: the card width minus the section's
 * side padding (and its 1 px border), minus the gaps, shared by the column
 * percentages — the last column takes the rounding remainder.
 * @param {{ columns?: Array<{ width?: number }>, padX?: number | null, gap?: number, borderColor?: string | null }} section
 * @param {number} [contentPadding]  the style's side padding (padX null → this)
 * @returns {{ padX: number, inner: number, gap: number, widths: number[] }}
 */
export function sectionColumnWidths(section, contentPadding = 60) {
  const cols = Array.isArray(section?.columns) ? section.columns : [];
  const n = cols.length;
  const padX = section?.padX ?? contentPadding;
  const inner = Math.max(n, MAIL_CARD_WIDTH - 2 * padX - (section?.borderColor ? 2 : 0));
  const gap = n > 1 ? Math.max(0, Math.min(section?.gap ?? 20, Math.floor((inner - n) / (n - 1)))) : 0;
  const available = inner - gap * Math.max(0, n - 1);
  /** @type {number[]} */
  const widths = [];
  let used = 0;
  cols.forEach((c, i) => {
    const w = i === n - 1 ? available - used : Math.max(1, Math.round((available * (Number(c?.width) || 0)) / 100));
    widths.push(w);
    used += w;
  });
  return { padX, inner, gap, widths };
}

// ── the renderer ─────────────────────────────────────────────────────────────

/**
 * Everything the block renderers share for one render. `auto`: the document
 * is format 2 (docFormatVersion) — its fixed blocks (coupon, countdown,
 * products) take the look of its style where their own fields are unset; a
 * raw version-1 document keeps their classic look byte for byte.
 * @param {ReturnType<typeof normalizeMailTemplateDoc>} doc
 * @param {MailRenderContext} ctx
 * @param {boolean} [auto]
 * @param {{ twins: "all" | "primary" | "none" } | null} [word]  the Outlook refinements (WORD_STEPS)
 */
function environment(doc, ctx, auto = true, word = WORD_STEPS[0]) {
  const style = doc.style;
  const locale = ctx.locale === "en" ? "en" : "de";
  return {
    ctx,
    style,
    locale,
    en: locale === "en",
    auto,
    /**
     * Outlook for Windows refinements (format 2; a version-1 document keeps
     * its output byte for byte): every element in its own font gets Word's
     * equivalent (fontClass), relative line heights their px value for Word,
     * rounded buttons a VML twin, list and divider spacing on cells.
     */
    word: auto && Boolean(word),
    /** Which rounded buttons get their VML twin (WORD_STEPS — fewer when the mail would get too big). */
    twins: auto && word ? word.twins : "none",
    /** The mso font classes in use (class → Word stack): the head declares them. */
    msoFonts: new Map(),
    /** Set once a countdown with a phone variant is rendered: the head then carries the swap rule. */
    phoneCountdown: false,
    /** Set once a picture with a phone version (image, hero) is rendered: the head then carries its swap rules. */
    phonePictures: false,
    /**
     * The phone backgrounds of sections: one rule per section cell — its class and the picture's URL for the head's CSS.
     * @type {Array<{ className: string, url: string }>}
     */
    phoneBackgrounds: [],
    merge: ctx.merge ?? ((t) => t),
    bodyFont: mailFontStack(style.fontFamily),
    /** The font Word shows for the body (the `*` rule of msoHeadHtml). */
    bodyMso: mailFontMsoStack(style.fontFamily),
    headingFontKey: style.headingFont ?? style.fontFamily,
    linkStyle: `color: ${style.linkColor ?? style.accentColor}; text-decoration: underline; word-wrap: break-word;`,
    /** @type {MailBox} */
    top: { width: MAIL_CARD_WIDTH, padX: style.contentPadding, bg: style.cardBackground, top: true, first: false, last: false },
  };
}

/** Does a (content) block render anything? (A column's first / last visible block gets the edge spacing.) */
function blockRenders(R, b) {
  switch (b.type) {
    case "heading":
    case "text":
      return Boolean(b.text);
    case "image":
      return Boolean(b.src) || Boolean(R.ctx.previewPlaceholders);
    case "button":
      return Boolean(b.label && b.href);
    case "coupon":
      return Boolean(b.code);
    case "html":
      return Boolean(sanitizeCustomHtml(b.html));
    case "menu":
      return (b.items ?? []).some((it) => it.label) || Boolean(R.ctx.previewPlaceholders);
    case "product":
      return Boolean(R.ctx.slots?.[b.id]?.product) || Boolean(R.ctx.previewPlaceholders);
    case "logo":
    case "greeting":
    case "divider":
    case "spacer":
    case "social":
      return true;
    default:
      return false;
  }
}

/** One content block (top level or inside a column). */
function renderBlock(R, b, box) {
  if (!blockRenders(R, b)) return "";
  switch (b.type) {
    case "logo":
      return logoRows(R, b, box);
    case "heading":
      return headingRows(R, b, box, R.merge(b.text));
    case "text":
      return textRows(R, b, box);
    case "greeting":
      return greetingRows(R, b, box);
    case "image":
      return imageRows(R, { ...b, placeholder: R.en ? "Image missing" : "Bild fehlt" }, box);
    case "button": {
      const [t, bt] = vpad(b, box, 12, 12);
      const x = sidePad(b, box);
      return row(buttonTable(R, { ...b, room: box.width - 2 * x, backdrop: envBg(b, box) }, R.merge(b.label)), { padding: padCss(t, x, bt), align: b.align, bgcolor: rowBg(b, box), pad: box.top });
    }
    case "coupon":
      return couponRows(R, b, box);
    case "divider":
      return dividerRows(R, b, box);
    case "spacer":
      return spacerRow(b.height, rowBg(b, box));
    case "social": {
      const [t, bt] = vpad(b, box, 14, 14);
      const align = b.align ?? "center";
      const x = sidePad(b, box);
      return row(socialRow(R.ctx.assets.socialLinks, align, box.width - 2 * x), { padding: padCss(t, x, bt), align, bgcolor: rowBg(b, box), pad: box.top });
    }
    case "html": {
      const [t, bt] = vpad(b, box, 0, 0);
      return row(`\n${sanitizeCustomHtml(b.html)}`, { padding: padCss(t, 0, bt), align: "center", bgcolor: rowBg(b, box), pad: false });
    }
    case "menu":
      return menuRows(R, b, box);
    case "product":
      return productRows(R, b, box);
    default:
      return "";
  }
}

/**
 * The blocks of one column: the first and the last block that render get
 * the column's edge (their default outer spacing collapses).
 */
function renderChildren(R, blocks, box) {
  const list = (blocks ?? []).filter((b) => blockRenders(R, b));
  return list.map((b, i) => renderBlock(R, b, { ...box, first: i === 0, last: i === list.length - 1 })).join("");
}

/** A placeholder line in previews (empty slots, products to come). */
function placeholderRow(R, text, { padding, bgcolor = null, pad = true }) {
  return row(
    `
                    <p style="${typeCss({ font: R.bodyFont, size: TEXT_PX.s, lineHeight: "1.5", weight: 400, color: "#777777", word: R.word })}" align="center">${escapeHtml(text)}</p>`,
    { padding, align: "center", bgcolor, pad }
  );
}

/** The logo, linked to its own `href` (any https page, mailto:, tel:) or — unset — the shop's start page. */
function logoRows(R, b, box) {
  const x = sidePad(b, box);
  const [t, bt] = vpad(b, box, 30, 20);
  const w = Math.min(b.width, Math.max(20, box.width - 2 * x));
  const margin = b.align === "center" ? " Margin: 0 auto;" : b.align === "right" ? " Margin: 0 0 0 auto;" : "";
  const bg = rowBg(b, box);
  return `
                <tr>
                  <td${box.top ? ' class="content-pad"' : ""} align="${b.align}"${bg ? ` bgcolor="${bg}"` : ""} style="mso-line-height-rule: exactly; padding: ${padCss(t, x, bt)};">
                    <a href="${escapeAttr(b.href || R.ctx.assets.shopUrl)}" target="_blank" style="text-decoration: none !important;">
                      <img src="${escapeAttr(R.style.logoUrl ?? R.ctx.assets.logoUrl)}" alt="motion sports" width="${w}" border="0" style="width: ${w}px; height: auto !important; max-width: 100%; display: block;${margin}">
                    </a>
                  </td>
                </tr>`;
}

/** A heading (also the titles of slots, the hero headline and Mo's heading). `text` is merged already. */
function headingRows(R, b, box, text) {
  const type = blockType(R, b, {
    size: HEADING_PX[b.size] ?? HEADING_PX.l,
    lineHeight: (fs) => `${Math.round(fs * 1.25)}px`,
    weight: 700,
    color: b.color ?? R.style.headingColor,
    fontKey: R.headingFontKey,
  });
  const inner = `
                    <p${type.cls} style="${type.css()}" align="${b.align}">${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
  const band = Boolean(b.background);
  const [t, bt] = vpad(b, box, band ? 26 : 24, band ? 26 : 8);
  return row(inner, { padding: padCss(t, sidePad(b, box), bt), align: b.align, bgcolor: rowBg(b, box), pad: box.top });
}

/** A heading without own settings (slot titles, hero headline, Mo's heading). */
const plainHeading = (size, align) => ({ size, align, color: null, background: null });

function textRows(R, b, box) {
  const color = b.color ?? R.style.textColor;
  const type = blockType(R, b, { size: TEXT_PX[b.size] ?? TEXT_PX.m, lineHeight: () => "1.5", weight: 400, color, fontKey: R.style.fontFamily });
  let inner = paragraphs(R, b, type);
  if (b.accentBar) {
    // The bar is the left border of a cell (Word draws cell borders), the text indented beside it.
    inner = `
                    <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" style="direction: ltr;">
                      <tr>
                        <td valign="top" style="mso-line-height-rule: exactly; border-left: 4px solid ${b.accentBar}; padding: 2px 0 2px 16px;">${inner}
                        </td>
                      </tr>
                    </table>`;
  }
  const band = Boolean(b.background);
  const [t, bt] = vpad(b, box, band ? 20 : 10, band ? 20 : 10);
  return row(inner, { padding: padCss(t, sidePad(b, box), bt), align: b.align, bgcolor: rowBg(b, box), pad: box.top });
}

/**
 * Merge the visible text of prose, never its link targets (PROSE_URL_RE): a
 * merge field inside a URL stays as written — validation refuses it there —
 * so a link is never personalised, the same in preview, test mail and the
 * frozen Rundmail. Link texts ([Hallo {{vorname}}](…)) are merged.
 * @param {(t: string) => string} merge
 * @param {string} text
 */
function mergeProse(merge, text) {
  /** @type {string[]} */
  const urls = [];
  const masked = String(text ?? "").replace(PROSE_URL_RE, (u) => `\u0001${urls.push(u) - 1}\u0002`);
  if (urls.length === 0) return merge(masked);
  return merge(masked).replace(/\u0001(\d+)\u0002/g, (_m, i) => urls[Number(i)] ?? "");
}

/**
 * The prose of a text block: blank line = new paragraph, a chunk whose every
 * line starts with "- " / "• " = a list (the block's bullet, "1." numbered).
 * The space after a list sits in its last row's cells for Word (format 2),
 * which drops a table's margin.
 */
function paragraphs(R, b, type) {
  const chunks = mergeProse(R.merge, b.text)
    .split(/\n\s*\n/)
    .map((c) => c.trim())
    .filter(Boolean);
  const numbered = b.bullet === "1.";
  const prose = (/** @type {string} */ text) => classifyProse(renderEmailProseHtml(text, { linkStyle: R.linkStyle }), type.cls);
  return chunks
    .map((chunk, i) => {
      const last = i === chunks.length - 1;
      const lines = chunk.split("\n");
      if (lines.every((l) => /^\s*[-•]\s+/.test(l))) {
        const cell = type.css();
        const rule = type.exact ? "mso-line-height-rule: exactly; " : "";
        const markWidth = numbered
          ? Math.max(22, Math.round(type.size * (lines.length >= 10 ? 2 : 1.5)))
          : b.fontSize
            ? Math.max(18, Math.round(type.size * 1.3))
            : 18;
        const gapInCells = R.word && !last;
        const items = lines
          .map((l, n) => {
            const after = gapInCells && n === lines.length - 1 ? " padding-bottom: 12px;" : "";
            return `
                      <tr>
                        <td${type.cls} valign="top" width="${markWidth}" style="${rule}${cell}${after}">${numbered ? `${n + 1}.` : BULLET_GLYPHS[b.bullet] ?? "&#8226;"}</td>
                        <td${type.cls} valign="top" style="${rule}${cell}${after}">${prose(l.replace(/^\s*[-•]\s+/, ""))}</td>
                      </tr>`;
          })
          .join("");
        return `
                    <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" style="direction: ltr;${last || gapInCells ? "" : " Margin: 0 0 12px;"}">${items}
                    </table>`;
      }
      return `
                    <p${type.cls} style="${type.css(last ? "0" : "0 0 12px")}" align="${b.align}">${prose(chunk)}</p>`;
    })
    .join("");
}

function greetingRows(R, b, box) {
  const type = blockType(R, b, { size: TEXT_PX.m, lineHeight: () => "1.5", weight: 400, color: b.color ?? R.style.textColor, fontKey: R.style.fontFamily });
  const [t, bt] = vpad(b, box, 20, 4);
  return row(
    `
                    <p${type.cls} style="${type.css()}" align="${b.align}">${escapeHtml(greetingText(b, R.ctx, R.merge))}</p>`,
    { padding: padCss(t, sidePad(b, box), bt), align: b.align, bgcolor: rowBg(b, box), pad: box.top }
  );
}

/**
 * An image (also the hero). `width`: "full" = the whole box (card or
 * column) without side padding, "content" = inside the side padding, a
 * number = that many px (never wider than the room it has). Inside a column
 * an image as wide as the column fills the stacked column on phones
 * (col-img). A phone picture (`mobileSrc`) follows the desktop one in a
 * hidden wrapper that only the head's phone rule opens (phoneSwapCss) — the
 * same size attributes, alt text and link; hidden from Outlook for Windows,
 * which ignores media queries; clients without them show the desktop picture.
 * @param {any} R
 * @param {{ src: string, mobileSrc?: string, alt: string, href: string, width: "full" | "content" | number, align?: string,
 *   radius?: number, padTop?: number, padBottom?: number, background?: string | null, placeholder: string }} img
 * @param {MailBox} box
 */
function imageRows(R, img, box) {
  const align = img.align ?? "center";
  const full = img.width === "full" || (typeof img.width === "number" && img.width >= box.width);
  const x = full ? 0 : sidePad(img, box);
  const room = Math.max(20, box.width - 2 * x);
  const w = full ? box.width : typeof img.width === "number" ? Math.min(img.width, room) : room;
  const [t, bt] = vpad(img, box, full ? 0 : 10, full ? 0 : 10);
  const opts = { padding: padCss(t, x, bt), align, bgcolor: rowBg(img, box), pad: box.top && !full };
  if (!img.src) {
    if (!R.ctx.previewPlaceholders) return "";
    const h = box.top ? 160 : Math.max(60, Math.min(160, Math.round(w * 0.6)));
    const sized = typeof img.width === "number" && !full;
    return row(
      `
                    <table cellspacing="0" cellpadding="0" border="0" width="${sized ? w : "100%"}"${sized && align === "center" ? ' align="center"' : ""} role="presentation"><tr><td align="center" bgcolor="#eeeeee" height="${h}" style="mso-line-height-rule: exactly; height: ${h}px; font-family: ${R.bodyFont}; font-size: 13px; color: #777777;">${escapeHtml(img.placeholder)}</td></tr></table>`,
      opts
    );
  }
  const fills = !box.top && w >= room;
  const phone = img.mobileSrc && img.mobileSrc !== img.src ? img.mobileSrc : "";
  const tagOf = (/** @type {string} */ src, /** @type {string | null} */ swap) => {
    const classes = [fills ? "col-img" : null, swap].filter(Boolean).join(" ");
    return `<img src="${escapeAttr(src)}" width="${w}" alt="${escapeAttr(img.alt)}" border="0"${classes ? ` class="${classes}"` : ""} style="width: 100%; max-width: ${w}px; height: auto; display: block; ${blockMargin(align)}${img.radius ? ` border-radius: ${img.radius}px;` : ""}">`;
  };
  const link = (/** @type {string} */ tag) => (img.href ? `<a href="${escapeAttr(img.href)}" target="_blank" style="text-decoration: none;">${tag}</a>` : tag);
  let linked = link(tagOf(img.src, phone ? PHONE_HIDE_CLASS : null));
  if (phone) {
    R.phonePictures = true;
    linked += hideFromOutlook(`<div class="${PHONE_SHOW_CLASS}" style="${PHONE_WRAPPER_CSS}">${link(tagOf(phone, null))}</div>`);
  }
  return row(
    `
                    ${linked}`,
    opts
  );
}

/** The tracking of a button label (px, every client). */
const BUTTON_LETTER_SPACING = 0.5;
/** The border every button draws: its own colour, the fill's or the outline's. */
const BUTTON_BORDER = 2;

/**
 * The button table: the cell carries the colour and Word's padding
 * (mso-padding-alt), the anchor the padding of every other client. A border
 * (outline, borderColor) is drawn by the cell — Word draws cell borders, the
 * separate border model lets browsers round it.
 *
 * Word draws that cell square. A rounded or pill button of a format-2
 * document therefore gets an Outlook twin (roundButtonTwin): a VML roundrect
 * of the browser button's size, colours and label. `room` is the width the
 * button may take (a full-width button takes all of it), `backdrop` the
 * colour behind an outline button, `list` marks the repeated button of a
 * product list (the first twins to go when the mail gets too big).
 * @param {any} R
 * @param {{ href: string, align: string, color?: string | null, textColor?: string | null, fullWidth?: boolean,
 *   size?: string, shape?: string, outline?: boolean, borderColor?: string | null, room?: number, backdrop?: string | null,
 *   list?: boolean }} b
 * @param {string} label  merged already
 */
function buttonTable(R, b, label) {
  const size = BUTTON_SIZES[/** @type {"s" | "m" | "l"} */ (b.size ?? "m")] ?? BUTTON_SIZES.m;
  const radius = buttonRadiusFor(b.shape ?? R.style.buttonShape);
  const color = b.color ?? R.style.accentColor;
  const tableAttrs = b.fullWidth ? ' width="100%"' : b.align === "center" ? ' align="center"' : ` align="${b.align}"`;
  const border = b.outline ? b.borderColor ?? color : b.borderColor ?? null;
  const type = `font-size: ${size.fontSize}px; line-height: ${size.lineHeight}px;`;
  const fill = border && b.outline ? null : color;
  const fg = border && b.outline ? color : b.textColor ?? R.style.buttonTextColor;
  const twin = roundButtonTwin(R, b, label, { size, radius, fill, border, fg });
  const table = border
    ? `
                    <table cellspacing="0" cellpadding="0" border="0"${tableAttrs} role="presentation" style="direction: ltr; border-spacing: 0 !important; border-collapse: separate !important;">
                      <tr>
                        <td align="center"${fill ? ` bgcolor="${fill}"` : ""} style="mso-line-height-rule: exactly; mso-padding-alt: ${msoPaddingAlt(size.padding)}; border: ${BUTTON_BORDER}px solid ${border}; border-radius: ${radius};${fill ? ` background-color: ${fill};` : ""}" valign="top">
                          <a href="${escapeAttr(b.href)}" target="_blank" style="${type} color: ${fg}; text-decoration: none; border-radius: ${radius}; display: block; font-family: ${R.bodyFont}; font-weight: 700; text-align: center; letter-spacing: ${BUTTON_LETTER_SPACING}px; word-break: break-word; padding: ${size.padding}; mso-padding-alt: 0;"><span style="color: ${fg};">${escapeHtml(label)}</span></a>
                        </td>
                      </tr>
                    </table>`
    : `
                    <table cellspacing="0" cellpadding="0" border="0"${tableAttrs} role="presentation" style="direction: ltr; border-spacing: 0 !important; border-collapse: collapse !important;">
                      <tr>
                        <td align="center" bgcolor="${color}" style="mso-line-height-rule: exactly; mso-padding-alt: ${msoPaddingAlt(size.padding, BUTTON_BORDER)}; border-radius: ${radius};" valign="top">
                          <a href="${escapeAttr(b.href)}" target="_blank" style="${type} color: ${fg}; text-decoration: none; border-radius: ${radius}; background-color: ${color}; display: block; font-family: ${R.bodyFont}; font-weight: 700; text-align: center; letter-spacing: ${BUTTON_LETTER_SPACING}px; word-break: break-word; padding: ${size.padding}; border: ${BUTTON_BORDER}px solid ${color}; mso-padding-alt: 0;"><span style="color: ${fg};">${escapeHtml(label)}</span></a>
                        </td>
                      </tr>
                    </table>`;
  return twin ? `\n                    ${forOutlook(twin, `${table}\n                    `)}` : table;
}

/**
 * The Outlook twin of a rounded button (format 2): a VML roundrect as large
 * as the button in a browser — its padding, line and border; as wide as the
 * room for a full-width one — with the same fill, border, label and link
 * (msoRoundButton). Only when the label is known now (a Rundmail's
 * per-recipient placeholder is not) and fits its room on one line in the
 * font Word shows (msoTextWidth, generous): otherwise the square cell stays,
 * which grows with its label. Square buttons need no twin.
 * @returns {string | null}
 */
function roundButtonTwin(R, b, label, { size, radius, fill, border, fg }) {
  const r = Number.parseFloat(radius) || 0;
  if (!R.word || R.twins === "none" || (R.twins === "primary" && b.list)) return null;
  if (r <= 0 || !(b.room > 0) || /\{\{|\}\}/.test(label)) return null;
  const [padY, padX] = String(size.padding)
    .split(/\s+/)
    .map((p) => Number.parseFloat(p));
  const text = msoTextWidth(label, { fontSize: size.fontSize, fontStack: R.bodyMso, letterSpacing: BUTTON_LETTER_SPACING });
  const natural = text + 2 * padX + 2 * BUTTON_BORDER;
  if (natural > b.room) return null;
  return msoRoundButton({
    hrefAttr: escapeAttr(b.href),
    labelHtml: escapeHtml(label),
    color: fg,
    fill,
    border,
    borderPx: BUTTON_BORDER,
    width: b.fullWidth ? Math.floor(b.room) : natural,
    height: 2 * padY + size.lineHeight + 2 * BUTTON_BORDER,
    radius: r,
    fontFamily: R.bodyMso,
    fontSize: size.fontSize,
    letterSpacing: `${BUTTON_LETTER_SPACING}px`,
    backdrop: fill ? null : b.backdrop ?? null,
  });
}

/**
 * The coupon card: kicker, code, headline, terms and „Code einlösen“ (a link,
 * or with `cta: "button"` a button in the mail's button look). Its own
 * fields — card colour, frame style, corners, text and code colour, code
 * font — come first. Without them a format-2 document takes the mail's look:
 * the texts in its text colour (the terms muted), the code in the heading
 * colour and font, each a readable ink on the card's ground. A version-1
 * document keeps the classic coupon (dark code, grey terms, the template's
 * colours only where they read on a foreign colour).
 */
function couponRows(R, b, box) {
  const en = R.en;
  const bg = envBg(b, box);
  const accent = R.style.accentColor;
  const card = b.cardColor ?? null;
  // what the texts stand on: the card's own colour, else the colour around it
  const ground = card ?? bg;
  // The frame in the accent colour — unless it vanishes on the colour around
  // an unfilled card (white on white): then the stronger ink.
  const vanishes = R.auto ? !card && (contrastRatio(accent, bg) ?? 21) < 1.2 : accent === bg;
  const frame = b.accent ?? (vanishes ? strongInk(bg) : accent);
  const borderStyle = b.borderStyle ?? "dashed";
  const borderPx = borderStyle === "none" ? 0 : 2;
  const radius = b.radius ?? COUPON_RADIUS;
  const narrow = !box.top && box.width < NARROW_COLUMN;
  const cellPadX = box.top ? 28 : narrow ? 10 : 20;
  // In a column the code shrinks to its room (frame, cell padding); the card keeps 24 px.
  const code = box.top
    ? { fontSize: 24, lineHeight: 30, letterSpacing: 2 }
    : couponCodeFit(b.code, box.width - 2 * sidePad(b, box) - 2 * borderPx - 2 * cellPadX);
  let textColor;
  let linkStyle;
  let codeColor;
  let termsColor;
  let codeFont;
  let codeKey;
  if (R.auto) {
    textColor = b.textColor ?? ink(R.style.textColor, ground);
    linkStyle = `color: ${ink(R.style.linkColor ?? accent, ground, 3, ink(accent, ground, 3))}; text-decoration: underline; word-wrap: break-word;`;
    // bold from ~18.7 px on is large text (3 : 1); a code shrunk for a narrow column needs 4.5 : 1
    codeColor = b.codeColor ?? ink(R.style.headingColor, ground, code.fontSize >= 19 ? 3 : 4.5);
    termsColor = b.textColor ?? mutedInk(textColor, ground);
    codeKey = b.codeFont ?? R.headingFontKey;
    codeFont = mailFontStack(codeKey);
  } else {
    // Version 1: on a colour other than the card's (its own background, a
    // coloured column) the template's text and link colours give way to
    // readable ones.
    const foreign = ground !== R.style.cardBackground;
    textColor = b.textColor ?? (foreign ? ink(R.style.textColor, ground) : R.style.textColor);
    linkStyle = foreign
      ? `color: ${ink(R.style.linkColor ?? accent, ground, 3, ink(accent, ground, 3))}; text-decoration: underline; word-wrap: break-word;`
      : R.linkStyle;
    codeColor = b.codeColor ?? ink("#111111", ground);
    termsColor = b.textColor ?? ink("#555555", ground, 4.5, textColor);
    codeKey = b.codeFont ?? null;
    codeFont = b.codeFont ? mailFontStack(b.codeFont) : R.bodyFont;
  }
  // the kicker is small print: muted like the terms from format 2 on
  const kickerColor = R.auto ? termsColor : textColor;
  const t = (size, color) => typeCss({ font: R.bodyFont, size, lineHeight: "1.5", weight: 400, color, word: R.word });
  // The room of the card's content: the box minus the frame and the cell padding (a button never grows the card past it).
  const cardRoom = box.width - 2 * sidePad(b, box) - 2 * borderPx - 2 * cellPadX;
  const redeem = discountRedeemUrl(b.code) ?? R.ctx.assets.shopUrl;
  const ctaLabel = en ? "Redeem code" : "Code einlösen";
  const terms = b.terms ? R.merge(b.terms) : "";
  const frameCss = borderPx ? ` border: ${borderPx}px ${borderStyle} ${frame};` : "";
  // The card's colour fills the cell, rounded inside the frame (Word: square, the bgcolor).
  const fill = card
    ? ` bgcolor="${card}" style="mso-line-height-rule: exactly; padding: ${narrow ? 14 : 16}px ${cellPadX}px; background-color: ${card};${radius > borderPx ? ` border-radius: ${radius - borderPx}px;` : ""}"`
    : ` style="mso-line-height-rule: exactly; padding: ${narrow ? 14 : 16}px ${cellPadX}px;"`;
  // The button in the mail's button look — unless the accent vanishes on the
  // card's ground (a black button on a black column): then the frame's colour
  // (or the stronger ink) fills it, with a label that reads on it.
  const shows = (/** @type {string} */ c) => (contrastRatio(c, ground) ?? 21) >= 1.3;
  const buttonFill = shows(accent) ? accent : shows(frame) ? frame : strongInk(ground);
  const buttonText = buttonFill === accent ? R.style.buttonTextColor : ink(R.style.buttonTextColor, buttonFill, 3);
  const cta =
    b.cta === "button"
      ? `
                          <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" style="direction: ltr;">
                            <tr>
                              <td align="center" style="mso-line-height-rule: exactly; padding: 12px 0 0;">${buttonTable(R, { href: redeem, align: "center", size: narrow ? "s" : undefined, fullWidth: narrow, color: buttonFill, textColor: buttonText, room: cardRoom, backdrop: ground }, ctaLabel)}
                              </td>
                            </tr>
                          </table>`
      : `
                          <p style="${t(TEXT_PX.m, textColor)} Margin-top: 8px;" align="center"><a href="${escapeAttr(redeem)}" target="_blank" style="${linkStyle} font-weight: 700;">${ctaLabel} &#8594;</a></p>`;
  const inner = `
                    <table cellspacing="0" cellpadding="0" border="0"${box.top ? "" : ' width="100%"'} align="center" role="presentation" style="direction: ltr; Margin: 0 auto; border-collapse: separate !important; border-spacing: 0;${frameCss} border-radius: ${radius}px;">
                      <tr>
                        <td align="center"${fill}>
                          <p style="${t(TEXT_PX.s, kickerColor)} text-transform: uppercase; letter-spacing: 1px;" align="center">${en ? "Your code" : "Dein Code"}</p>
                          <p${fontClass(R, codeKey)} style="mso-line-height-rule: exactly; font-family: ${codeFont}; font-size: ${code.fontSize}px; line-height: ${code.lineHeight}px; font-weight: 700; letter-spacing: ${code.letterSpacing}px; color: ${codeColor}; Margin: 4px 0 6px;${narrow ? " word-break: break-all;" : ""}" align="center">${escapeHtml(b.code)}</p>${
                            b.headline
                              ? `
                          <p style="${t(TEXT_PX.m, b.accent ?? textColor)} font-weight: 700;" align="center">${escapeHtml(R.merge(b.headline))}</p>`
                              : ""
                          }${
                            terms
                              ? `
                          <p style="${t(TEXT_PX.s, termsColor)}" align="center">${escapeHtml(terms)}</p>`
                              : ""
                          }${cta}
                        </td>
                      </tr>
                    </table>`;
  const [tp, bp] = vpad(b, box, 14, 14);
  return row(inner, { padding: padCss(tp, sidePad(b, box), bp), align: "center", bgcolor: rowBg(b, box), pad: box.top });
}

/**
 * The caption of a countdown as HTML — the block's `caption` (else „Gültig
 * bis {datum}“ / „Valid until {date}“), its merge fields resolved, the
 * deadline in bold in place of {datum}; "" when it is switched off.
 * @param {any} R
 * @param {any} b
 * @param {string} deadline
 */
function countdownCaptionHtml(R, b, deadline) {
  const runs = countdownCaptionTemplate(b, R.locale).split(COUNTDOWN_DATE_RE);
  // nothing to say: switched off, or a line about a deadline that is not known
  if (!runs.join("") || (runs.length > 1 && !deadline)) return "";
  return runs.map((run) => escapeHtml(R.merge(run))).join(`<strong>${escapeHtml(deadline)}</strong>`);
}

/**
 * The live countdown of a format-2 document (top level only) in the mail's
 * look: its heading in the heading font and a readable heading colour, the
 * image drawn in the block's colours (countdownLook — its ground is the
 * row's colour, so it blends into the row; the signed URLs carry the colours
 * and the text in the picture, mail-template-design.ts), the phone variant
 * swapped in on small screens (hidden from Outlook, which keeps the desktop
 * image at the content width), and the caption in the label colour under it
 * — by default the exact deadline („Gültig bis …“), never a remaining time a
 * Rundmail opened later would still claim. With its own background the
 * block is one band (heading and image on it).
 * @param {any} R
 * @param {any} b
 * @param {MailSlotCountdown} cd
 */
function countdownRows(R, b, cd) {
  const top = R.top;
  const look = countdownLook(b, R.style);
  const band = Boolean(b.background);
  const heading = b.heading ? R.merge(b.heading) : "";
  const out = [];
  if (heading) {
    const h = { ...plainHeading("m", "center"), color: ink(R.style.headingColor, look.bg, 3), background: b.background ?? null, padTop: b.padTop, padBottom: 8 };
    out.push(headingRows(R, h, top, heading));
  }
  const room = Math.max(20, top.width - 2 * top.padX);
  const w = Math.min(cd.imageWidth, room);
  const h = Math.max(1, Math.round((w * cd.imageHeight) / Math.max(1, cd.imageWidth)));
  const alt = escapeAttr(cd.imageAlt);
  let media = "";
  if (cd.imageUrl) {
    // Word sizes the image by its attributes (the content width); browsers follow the CSS.
    media = `
                    <img src="${escapeAttr(cd.imageUrl)}" width="${w}" height="${h}" alt="${alt}" border="0" class="cd-desk" style="width: 100%; max-width: ${cd.imageWidth}px; height: auto; display: block; Margin: 0 auto;">`;
    if (cd.imageUrlMobile) {
      R.phoneCountdown = true;
      media += `
                    ${hideFromOutlook(`<img src="${escapeAttr(cd.imageUrlMobile)}" width="${cd.imageWidthMobile}" alt="${alt}" border="0" class="cd-phone" style="width: 100%; max-width: ${cd.imageWidthMobile}px; height: auto; display: none; Margin: 0 auto;">`)}`;
    }
  }
  const captionHtml = countdownCaptionHtml(R, b, cd.deadline ?? "");
  const caption = captionHtml
    ? `
                    <p style="${typeCss({ font: R.bodyFont, size: 13, lineHeight: "1.5", weight: 400, color: look.label, margin: media ? "8px 0 0" : "0" })}" align="center">${captionHtml}</p>`
    : "";
  const t = heading ? 4 : b.padTop ?? (band ? 12 : 4);
  const bt = b.padBottom ?? (band ? 22 : 14);
  if (media || caption) out.push(row(`${media}${caption}`, { padding: padCss(t, top.padX, bt), align: "center", bgcolor: rowBg(b, top) }));
  return out.join("");
}

/** The product rows / grid of a format-2 `products` block. */
const LIST_ROW_IMAGE = 140;
const LIST_GRID_TILE = 240;
const LIST_GRID_IMAGE = 220;
/** Inner padding and corners of the card behind each product (`cardColor`). */
const LIST_CARD_PAD = 12;
const LIST_CARD_RADIUS = 8;
/** The inner padding of mailWhitePanel. */
const PANEL_PAD = 16;

/**
 * The fixed products of a format-2 document (top level only) in the mail's
 * look, from the slot's data — the classic rows (picture | name, price,
 * description, „Zum Produkt“) or the 2-up grid, in the same Outlook-safe
 * structure, but the names in the heading font and colour, prices and
 * descriptions in the body font and text colour (or the block's
 * `textColor`), the button in the mail's button look and, with `cardColor`,
 * each product on a card of its own. On a dark card whose colours read on it
 * the products stand on the dark card; when they do not, the classic white
 * panel carries them (with inks that read on white).
 * @param {any} R
 * @param {any} b
 * @param {MailSlotProducts} data
 */
function productListRows(R, b, data) {
  const top = R.top;
  const ground = top.bg;
  const card = b.cardColor ?? null;
  const onCard = card ?? ground;
  const reads = (/** @type {string} */ c, /** @type {string} */ g, /** @type {number} */ min) => (contrastRatio(c, g) ?? 21) >= min;
  let name = b.textColor ?? R.style.headingColor;
  let text = b.textColor ?? R.style.textColor;
  const panel = !card && isDarkCard(ground) && !(reads(text, ground, 4.5) && reads(name, ground, 3));
  const textGround = panel ? "#ffffff" : onCard;
  // An own text colour stands as set (validation warns) — except on the white panel.
  if (panel || !b.textColor) {
    name = ink(name, textGround, 3);
    text = ink(text, textGround);
  }
  const look = {
    name,
    text,
    card,
    /** What the texts and buttons stand on: the card, else the white panel or the card colour of the mail. */
    ground: card ?? textGround,
    /** Word's class for the names in the heading font (fontClass). */
    nameCls: fontClass(R, R.headingFontKey),
    strike: ink(SALE_STRIKE_COLOR, textGround, 3, text),
    line: mixColor(textGround, strongInk(textGround), 0.12),
  };
  const parts = [];
  if (b.title) parts.push(headingRows(R, { ...plainHeading("m", "center"), color: ink(R.style.headingColor, ground, 3) }, top, R.merge(b.title)));
  const room = Math.max(160, top.width - 2 * top.padX);
  const items = (data.items ?? []).filter((it) => it && it.name);
  const inner = data.layout === "grid" ? productGridHtml(R, items, look) : productRowsHtml(R, items, look, room);
  // The panel's own padding comes out of the row's, so the products keep their room.
  const side = panel ? Math.max(0, top.padX - PANEL_PAD) : top.padX;
  parts.push(row(panel ? mailWhitePanel(inner) : inner, { padding: padCss(10, side, 20), align: "center", bgcolor: ground }));
  return parts.join("");
}

/** A product's link around `html` (name, picture), or the html itself without a link; `cls`: Word's font class (fontClass). */
function productLink(it, html, style, cls = "") {
  return it.url ? `<a${cls} href="${escapeAttr(it.url)}" target="_blank" style="${style}">${html}</a>` : html;
}

/** The price line of a listed product: the struck compare-at price before the current one. */
function productPriceHtml(it, look, css, align) {
  if (!it.priceLabel) return "";
  const strike = it.compareAtLabel ? `<span style="text-decoration: line-through; color: ${look.strike};">${escapeHtml(it.compareAtLabel)}</span> ` : "";
  return `
                          <p style="${css}" align="${align}">${strike}<strong style="color: ${look.text};">${escapeHtml(it.priceLabel)}</strong></p>`;
}

/**
 * The rows: picture in the left third, name, price, description and the
 * button in the right two thirds; a hairline between the rows — or, with a
 * card colour, each row a card of its own (12 px apart).
 */
function productRowsHtml(R, items, look, room) {
  const nameCss = typeCss({ font: mailFontStack(R.headingFontKey), size: 14, lineHeight: "1.35", weight: 700, color: look.name, margin: "0 0 4px", word: R.word });
  const priceCss = typeCss({ font: R.bodyFont, size: 13, lineHeight: "1.4", weight: 400, color: look.text, margin: "0 0 8px", word: R.word });
  const descCss = typeCss({ font: R.bodyFont, size: 13, lineHeight: "1.6", weight: 400, color: look.text, word: R.word });
  const card = look.card;
  const imageCell = Math.round(room * 0.33);
  // Word sizes a picture by its attribute: never wider than its cell's room.
  const img = Math.max(40, Math.min(LIST_ROW_IMAGE, imageCell - LIST_CARD_PAD));
  // The room of the text beside the picture (or of the whole row), inside the cells' padding.
  const textRoom = (/** @type {boolean} */ withImage) => (withImage ? Math.round(room * 0.67) : room) - (card ? 2 * LIST_CARD_PAD : withImage ? 4 : 0);
  const rows = items.map((it, i) => {
    const image = it.imageUrl
      ? productLink(
          it,
          `<img src="${escapeAttr(it.imageUrl)}" class="prow-image" alt="${escapeAttr(it.name)}" border="0" width="${img}" height="${img}" style="width: ${img}px; height: ${img}px; max-width: 100%; display: block; Margin: 0 auto; border: none; outline: none; object-fit: cover;">`,
          "display: block; text-decoration: none;"
        )
      : "";
    const description = it.description?.trim()
      ? `
                          <p style="${descCss}" align="left">${escapeHtml(it.description.trim())}</p>`
      : "";
    // full width: the shell CSS centres every table without a margin of its own
    const button = it.url
      ? `
                          <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" style="direction: ltr;">
                            <tr>
                              <td align="left" style="mso-line-height-rule: exactly; padding: 12px 0 0;">${buttonTable(R, { href: it.url, align: "left", size: "s", room: textRoom(Boolean(image)), backdrop: look.ground, list: true }, it.ctaLabel?.trim() || (R.en ? "View product" : "Zum Produkt"))}
                              </td>
                            </tr>
                          </table>`
      : "";
    const text = `
                          <p${look.nameCls} style="${nameCss}" align="left">${productLink(it, escapeHtml(it.name), `text-decoration: none; color: ${look.name};`, look.nameCls)}</p>${productPriceHtml(it, look, priceCss, "left")}${description}${button}`;
    if (card) {
      const cells = image
        ? `
                            <td width="33%" align="center" valign="middle" style="mso-line-height-rule: exactly; width: 33%; padding: ${LIST_CARD_PAD}px 0 ${LIST_CARD_PAD}px ${LIST_CARD_PAD}px; vertical-align: middle;">${image}</td>
                            <td width="67%" align="left" valign="middle" style="mso-line-height-rule: exactly; width: 67%; padding: ${LIST_CARD_PAD}px; vertical-align: middle;">${text}
                            </td>`
        : `
                            <td align="left" valign="middle" style="mso-line-height-rule: exactly; padding: ${LIST_CARD_PAD}px; vertical-align: middle;">${text}
                            </td>`;
      return `
                      <tr>
                        <td style="mso-line-height-rule: exactly; padding: ${i === 0 ? 0 : LIST_CARD_PAD}px 0 0;">
                          <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" bgcolor="${card}" style="width: 100%; direction: ltr; border-collapse: separate !important; border-spacing: 0; border-radius: ${LIST_CARD_RADIUS}px; background-color: ${card};">
                            <tr>${cells}
                            </tr>
                          </table>
                        </td>
                      </tr>`;
    }
    // the hairline: the top border of a cell for Word (dividerRows)
    const hairline = `border-top: 1px solid ${look.line};`;
    const divider =
      i === 0
        ? ""
        : `
                      <tr>
                        <td colspan="2" style="mso-line-height-rule: exactly; padding: 18px 0 0;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${R.word ? "" : `${hairline} `}border-spacing: 0 !important; border-collapse: collapse !important;"><tr><td style="${R.word ? `${hairline} ` : ""}font-size: 0; line-height: 0; mso-line-height-rule: exactly; mso-line-height-alt: 1px;">&nbsp;</td></tr></table>
                        </td>
                      </tr>`;
    if (!image) {
      return `${divider}
                      <tr>
                        <td colspan="2" align="left" valign="middle" style="mso-line-height-rule: exactly; padding: 18px 0 0; vertical-align: middle;">${text}
                        </td>
                      </tr>`;
    }
    return `${divider}
                      <tr>
                        <td width="33%" align="center" valign="middle" style="mso-line-height-rule: exactly; width: 33%; padding: 18px 12px 0 0; vertical-align: middle;">${image}</td>
                        <td width="67%" align="left" valign="middle" style="mso-line-height-rule: exactly; width: 67%; padding: 18px 0 0 4px; vertical-align: middle;">${text}
                        </td>
                      </tr>`;
  });
  return `
                    <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" style="width: 100%; direction: ltr; border-spacing: 0 !important; border-collapse: collapse !important;${card ? "" : " table-layout: fixed !important;"}">
                      <tbody>${rows.join("")}
                      </tbody>
                    </table>`;
}

/**
 * The 2-up grid: inline-block tiles of 240 px (two per row, wrapping), in
 * Outlook explicit two-cell rows of a ghost table — the classic grid's
 * structure. With a card colour each tile is a card (6 px apart).
 */
function productGridHtml(R, items, look) {
  const card = look.card;
  const nameCss = typeCss({ font: mailFontStack(R.headingFontKey), size: 13, lineHeight: "1.3", weight: 700, color: look.name, word: R.word });
  const priceCss = typeCss({ font: R.bodyFont, size: 13, lineHeight: "1.4", weight: 400, color: look.text, margin: "4px 0 0", word: R.word });
  const gutter = card ? 6 : 0;
  const pad = card ? LIST_CARD_PAD : 10;
  const img = LIST_GRID_TILE - 2 * gutter - 2 * pad;
  const imgH = card ? img : LIST_GRID_IMAGE;
  const spacer = (h) => `
                        <tr>
                          <td height="${h}" style="mso-line-height-rule: exactly; font-size: 0; line-height: ${h}px;">&nbsp;</td>
                        </tr>`;
  const tile = (it) => {
    const image = it.imageUrl
      ? `
                        <tr>
                          <td align="center" style="mso-line-height-rule: exactly; vertical-align: top; padding: ${card ? `${pad}px ${pad}px 0` : `0 ${pad}px`};">${productLink(
                            it,
                            `<img src="${escapeAttr(it.imageUrl)}" class="grid-image" alt="${escapeAttr(it.name)}" border="0" width="${img}" height="${imgH}" style="width: ${img}px; height: ${imgH}px; max-width: 100%; display: block; Margin: 0 auto; border: none; outline: none; object-fit: cover;">`,
                            "display: block; text-decoration: none;"
                          )}</td>
                        </tr>${spacer(card ? 12 : 16)}`
      : card
        ? spacer(pad)
        : "";
    const body = `${image}
                        <tr>
                          <td align="center" style="mso-line-height-rule: exactly; vertical-align: top; padding: 0 ${card ? pad : 15}px;">
                            <p${look.nameCls} style="${nameCss}" align="center">${productLink(it, escapeHtml(it.name), `text-decoration: none; color: ${look.name};`, look.nameCls)}</p>${productPriceHtml(it, look, priceCss, "center")}
                          </td>
                        </tr>${spacer(card ? 14 : 20)}`;
    const content = card
      ? `
                        <tr>
                          <td style="mso-line-height-rule: exactly; padding: 0 ${gutter}px ${LIST_CARD_PAD}px;">
                            <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" bgcolor="${card}" style="width: 100%; direction: ltr; border-collapse: separate !important; border-spacing: 0; border-radius: ${LIST_CARD_RADIUS}px; background-color: ${card};">${body}
                            </table>
                          </td>
                        </tr>`
      : body;
    return `<div class="grid-column" style="width: 100%; vertical-align: top; font-size: 0px; display: inline-block; max-width: 50%;"><table cellspacing="0" cellpadding="0" border="0" align="center" width="${LIST_GRID_TILE}" role="presentation" class="grid-tile" style="width: 100%; max-width: ${LIST_GRID_TILE}px; direction: ltr; border-spacing: 0 !important; border-collapse: collapse !important; table-layout: fixed !important;">
                      <tbody>${content}
                      </tbody>
                    </table></div>`;
  };
  // Outlook cannot wrap inline-blocks: explicit two-cell rows of fixed halves;
  // an odd last tile spans both columns so it stays centred.
  const cell = (/** @type {number} */ i) => (i === items.length - 1 && i % 2 === 0 ? `<td colspan="2" align="center" valign="top">` : `<td width="50%" valign="top">`);
  const tiles = items
    .map((it, i) => {
      const separator = i === 0 ? "" : i % 2 === 0 ? `<!--[if mso]></td></tr><tr>${cell(i)}<![endif]-->` : `<!--[if mso]></td>${cell(i)}<![endif]-->`;
      return `${separator}${tile(it)}`;
    })
    .join("");
  return `
                    <div style="font-size: 0; text-align: center; direction: ltr;">
                      <!--[if mso]><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cell(0)}<![endif]-->
                      ${tiles}
                      <!--[if mso]></td></tr></table><![endif]-->
                    </div>`;
}

/**
 * A line: the top border of a cell (Word draws cell borders; format 2 — a
 * version-1 document keeps the border of its 100 % table), the cell flat
 * (font-size / line-height 0, 1 px for Word). Shorter lines are a cell of
 * that width beside empty cells — no floating table, which Word would let
 * content flow around.
 */
function dividerRows(R, b, box) {
  const line = `border-top: ${b.thickness ?? 1}px ${b.lineStyle ?? "solid"} ${b.color ?? "#e0e0e0"};`;
  const pct = b.widthPct ?? 100;
  const flat = "font-size: 0; line-height: 0; mso-line-height-rule: exactly; mso-line-height-alt: 1px;";
  let inner;
  if (pct >= 100 && R.word) {
    inner = `
                    <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" style="border-spacing: 0 !important; border-collapse: collapse !important;"><tr><td style="${line} ${flat}">&nbsp;</td></tr></table>`;
  } else if (pct >= 100) {
    inner = `
                    <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" style="${line} border-spacing: 0 !important; border-collapse: collapse !important;"><tr><td style="${flat}">&nbsp;</td></tr></table>`;
  } else {
    const align = b.align ?? "center";
    const before = align === "left" ? 0 : align === "right" ? 100 - pct : Math.floor((100 - pct) / 2);
    const after = 100 - pct - before;
    const blank = (w) => (w > 0 ? `<td width="${w}%" style="${flat}">&nbsp;</td>` : "");
    inner = `
                    <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" style="border-spacing: 0 !important; border-collapse: collapse !important;"><tr>${blank(before)}<td width="${pct}%" style="${line} ${flat}">&nbsp;</td>${blank(after)}</tr></table>`;
  }
  const [t, bt] = vpad(b, box, 14, 14);
  return row(inner, { padding: padCss(t, sidePad(b, box), bt), bgcolor: rowBg(b, box), pad: box.top });
}

/** The link bar: one paragraph, the links separated by the separator (wrapping only between links). */
function menuRows(R, b, box) {
  const [t, bt] = vpad(b, box, 14, 14);
  const opts = { padding: padCss(t, sidePad(b, box), bt), align: b.align, bgcolor: rowBg(b, box), pad: box.top };
  const items = (b.items ?? []).filter((it) => it.label);
  if (items.length === 0) return placeholderRow(R, R.en ? "Navigation: no links yet." : "Navigation: noch keine Links.", opts);
  const size = b.fontSize ?? 13;
  const color = b.color ?? R.style.textColor;
  const key = b.font ?? R.style.fontFamily;
  const css = typeCss({
    font: mailFontStack(key),
    size,
    lineHeight: `${Math.round(size * 1.6)}px`,
    weight: b.bold ? 700 : 400,
    color,
    uppercase: b.uppercase,
    letterSpacing: b.letterSpacing,
  });
  // Word's font class on the paragraph and on each link and separator (Word's `*` rule hits them directly).
  const cls = fontClass(R, key);
  const links = items.map((it) => {
    // A short label never breaks („Home Gym“); a long one may wrap in a narrow column.
    const text = R.merge(it.label);
    const label = text.length <= MENU_UNBROKEN_CHARS ? nbsp(escapeHtml(text)) : escapeHtml(text);
    return it.href ? `<a${cls} href="${escapeAttr(it.href)}" target="_blank" style="color: ${color}; text-decoration: none;">${label}</a>` : label;
  });
  const mark = MENU_SEPARATOR_HTML[/** @type {"|"} */ (b.separator)] ?? "|";
  const separator = ` <span${cls} style="color: ${color};">${mark ? `&nbsp;${mark}&nbsp;` : "&nbsp;&nbsp;"}</span> `;
  return row(
    `
                    <p${cls} style="${css}" align="${b.align}">${links.join(separator)}</p>`,
    opts
  );
}

/**
 * One catalog product in the template's look, from the slot's data:
 * stacked (picture, name, price, description, button) or side by side
 * (picture 40 % | text 60 %, stacking on phones). Without data (sold out,
 * unknown) nothing in a mail and a placeholder in previews.
 */
function productRows(R, b, box) {
  const p = R.ctx.slots?.[b.id]?.product ?? null;
  const x = sidePad(b, box);
  const [t, bt] = vpad(b, box, 14, 14);
  const opts = { padding: padCss(t, x, bt), align: b.align, bgcolor: rowBg(b, box), pad: box.top };
  if (!p) {
    if (!R.ctx.previewPlaceholders) return "";
    return placeholderRow(R, R.en ? "The chosen product appears here." : "Hier erscheint das gewählte Produkt.", opts);
  }
  const bg = envBg(b, box);
  const room = Math.max(40, box.width - 2 * x);
  const image = b.showImage && p.imageUrl ? p.imageUrl : null;
  const side = b.layout === "side" && Boolean(image);
  const imageWidth = side ? Math.round((room - PRODUCT_SIDE_GAP) * 0.4) : room;
  const textWidth = side ? room - PRODUCT_SIDE_GAP - imageWidth : room;
  const align = b.align;
  const nameColor = b.color ?? R.style.headingColor;
  const textColor = b.color ?? R.style.textColor;
  const nameSize = b.nameSize ?? (textWidth < 180 ? 14 : textWidth < 300 ? 16 : 20);
  const small = textWidth < 180;
  const link = (html, color, cls = "") => (p.url ? `<a${cls} href="${escapeAttr(p.url)}" target="_blank" style="color: ${color}; text-decoration: none;">${html}</a>` : html);
  const nameCls = fontClass(R, R.headingFontKey);

  const name = `
                          <p${nameCls} style="${typeCss({ font: mailFontStack(R.headingFontKey), size: nameSize, lineHeight: `${Math.round(nameSize * 1.3)}px`, weight: 700, color: nameColor })}" align="${align}">${link(escapeHtml(p.name), nameColor, nameCls)}</p>`;
  const priceSize = small ? 13 : 15;
  const price =
    b.showPrice && p.priceLabel
      ? `
                          <p style="${typeCss({ font: R.bodyFont, size: priceSize, lineHeight: `${Math.round(priceSize * 1.4)}px`, weight: 700, color: textColor, margin: "6px 0 0" })}" align="${align}">${
                            p.compareAtLabel
                              ? `<span style="text-decoration: line-through; font-weight: 400; color: ${ink(SALE_STRIKE_COLOR, bg, 3, textColor)};">${escapeHtml(p.compareAtLabel)}</span>&nbsp; `
                              : ""
                          }${escapeHtml(p.priceLabel)}</p>`
      : "";
  const description =
    b.showDescription && p.description
      ? `
                          <p style="${typeCss({ font: R.bodyFont, size: small ? 12 : 13, lineHeight: "1.5", weight: 400, color: textColor, margin: "8px 0 0", word: R.word })}" align="${align}">${escapeHtml(p.description)}</p>`
      : "";
  const label = b.buttonLabel && p.url ? R.merge(b.buttonLabel) : "";
  const button =
    label
      ? `
                      <tr>
                        <td align="${align}" style="mso-line-height-rule: exactly; padding: 14px 0 0;">${buttonTable(R, { href: p.url, align, size: small ? "s" : undefined, room: textWidth, backdrop: bg }, label)}
                        </td>
                      </tr>`
      : "";
  const textRowsHtml = `
                      <tr>
                        <td align="${align}" style="mso-line-height-rule: exactly; padding: 0;">${name}${price}${description}
                        </td>
                      </tr>${button}`;
  const picture = (w) => {
    const tag = `<img src="${escapeAttr(image)}" width="${w}" alt="${escapeAttr(p.name)}" border="0" class="col-img" style="width: 100%; max-width: ${w}px; height: auto; display: block; ${blockMargin(side ? "center" : align)}">`;
    return p.url ? `<a href="${escapeAttr(p.url)}" target="_blank" style="text-decoration: none;">${tag}</a>` : tag;
  };

  if (!side) {
    return row(
      `
                    <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" style="direction: ltr;">${
                      image
                        ? `
                      <tr>
                        <td align="${align}" style="mso-line-height-rule: exactly; padding: 0 0 12px; font-size: 0; line-height: 0;">${picture(imageWidth)}</td>
                      </tr>`
                        : ""
                    }${textRowsHtml}
                    </table>`,
      opts
    );
  }
  return row(
    `
                    <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" style="direction: ltr;">
                      <tr>
                        <td class="col-stack" width="${imageWidth}" valign="top" align="center" style="mso-line-height-rule: exactly; width: ${imageWidth}px; font-size: 0; line-height: 0;">${picture(imageWidth)}</td>
                        <td class="col-gap" width="${PRODUCT_SIDE_GAP}" style="mso-line-height-rule: exactly; width: ${PRODUCT_SIDE_GAP}px; font-size: 0; line-height: 0;">&nbsp;</td>
                        <td class="col-stack" width="${textWidth}" valign="middle" align="${align}" style="mso-line-height-rule: exactly; width: ${textWidth}px;">
                          <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" style="direction: ltr;">${textRowsHtml}
                          </table>
                        </td>
                      </tr>
                    </table>`,
    opts
  );
}

/**
 * A section: its columns side by side in the td-stack pattern — each column
 * a cell (.col-stack: a full-width block on phones), gap cells between them
 * (.col-gap: a 16 px row on phones). `reverse` reverses the DOM order and
 * lays the cells out right to left, so desktops show the original order and
 * phones stack the last column first. A background picture comes with its
 * Outlook VML twin; with rounded corners or a border the section is a box
 * whose colour — or picture — sits inside the frame (the padding stays
 * around it, on the card colour).
 */
function sectionRows(R, s) {
  const cardBg = R.style.cardBackground;
  const { padX, inner, gap, widths } = sectionColumnWidths(s, R.style.contentPadding);
  const boxed = s.radius > 0 || Boolean(s.borderColor);
  const image = s.bgImage || "";
  const fallback = s.background ?? cardBg;
  // A box (rounded corners or a border) stands on the card colour, its own colour (or picture) inside the frame.
  const outerBg = boxed ? cardBg : fallback;
  const stack = s.stack !== false;
  // Columns that never stack keep their share on phones: whole percentages
  // (gaps included) that add up to 100.
  const gapPct = gap > 0 ? Math.max(1, Math.round((gap / inner) * 100)) : 0;
  const colPct = (() => {
    const room = 100 - gapPct * (widths.length - 1);
    const sum = widths.reduce((a, w) => a + w, 0) || 1;
    let used = 0;
    return widths.map((w, i) => {
      const p = i === widths.length - 1 ? room - used : Math.round((w / sum) * room);
      used += p;
      return p;
    });
  })();
  const size = (w, p) => (stack ? { attr: `${w}`, css: `${w}px` } : { attr: `${p}%`, css: `${p}%` });

  const cells = s.columns.map((c, i) => {
    const w = widths[i];
    const pad = c.padding ?? 0;
    /** @type {MailBox} */
    const box = { width: Math.max(20, w - 2 * pad), padX: 0, bg: c.background ?? s.background ?? cardBg, top: false, first: false, last: false };
    const rows = renderChildren(R, c.blocks, box) || spacerRow(1);
    const blocks = `
                          <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" style="direction: ltr;">
                            <tbody>${rows}
                            </tbody>
                          </table>`;
    // The column cell itself stays unpadded — its width is exact in every
    // client (a padded cell grows by its padding), and Word cannot hand the
    // padding to the other columns of the row (it gives every cell of a row
    // the largest vertical padding). The padding sits on a cell inside.
    const content = pad
      ? `
                          <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" style="direction: ltr;">
                            <tr>
                              <td style="mso-line-height-rule: exactly; padding: ${pad}px;">${blocks}
                              </td>
                            </tr>
                          </table>`
      : blocks;
    const { attr, css } = size(w, colPct[i]);
    return `
                        <td${stack ? ' class="col-stack"' : ""} width="${attr}" valign="${c.valign}"${s.reverse ? ' dir="ltr"' : ""}${c.background ? ` bgcolor="${c.background}"` : ""} style="mso-line-height-rule: exactly; width: ${css}; padding: 0;${c.background ? ` background-color: ${c.background};` : ""}${s.reverse ? " direction: ltr;" : ""}">${content}
                        </td>`;
  });
  const gapCell = gap > 0
    ? (() => {
        const { attr, css } = size(gap, gapPct);
        return `
                        <td${stack ? ' class="col-gap"' : ""} width="${attr}" style="mso-line-height-rule: exactly; width: ${css}; font-size: 0; line-height: 0;">&nbsp;</td>`;
      })()
    : "";
  const ordered = s.reverse ? [...cells].reverse() : cells;
  // The frame of a box: border and rounded corners (the separate border model lets browsers round it).
  const frame = boxed
    ? ` border-collapse: separate !important; border-spacing: 0;${s.borderColor ? ` border: 1px solid ${s.borderColor};` : ""}${s.radius ? ` border-radius: ${s.radius}px; overflow: hidden;` : ""}`
    : "";
  /** The table of the columns — with the frame and the box colour of a box without a picture. */
  const columnsTable = (/** @type {string} */ framing, /** @type {string | null} */ bg) => `
                    <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation"${s.reverse ? ' dir="rtl"' : ""}${bg ? ` bgcolor="${bg}"` : ""} style="direction: ${s.reverse ? "rtl" : "ltr"};${framing}${bg ? ` background-color: ${bg};` : ""}">
                      <tr>${ordered.join(gapCell)}
                      </tr>
                    </table>`;
  const padding = padCss(s.padTop, padX, s.padBottom);
  const pad = padX > 0 ? ' class="content-pad"' : "";

  if (!image) {
    return `
                <tr>
                  <td${pad} align="left" valign="top" bgcolor="${outerBg}" style="mso-line-height-rule: exactly; padding: ${padding}; background-color: ${outerBg};">${columnsTable(frame, boxed ? s.background : null)}
                  </td>
                </tr>`;
  }
  // Background picture: CSS for every client, the VML rectangle for Word
  // (frame fill = cover, centred; the text box grows with its content).
  const valigns = new Set(s.columns.map((c) => c.valign));
  const valign = s.minHeight > 0 && valigns.size === 1 ? [...valigns][0] : "top";
  const src = escapeAttr(image);
  const pictureCss = `background-color: ${fallback}; background-image: url('${escapeAttr(cssUrl(image))}'); background-size: cover; background-position: center; background-repeat: no-repeat;`;
  // A phone background: the head's phone rule swaps the picture cell's background-image (phoneSwapCss); the VML stays desktop.
  const phone = s.bgImageMobile && s.bgImageMobile !== image ? s.bgImageMobile : "";
  let phoneClass = "";
  if (phone) {
    const className = `ph-bg${R.phoneBackgrounds.length + 1}`;
    R.phoneBackgrounds.push({ className, url: styleSheetUrl(phone) });
    phoneClass = ` class="${className}"`;
  }
  if (boxed) {
    // A box with a picture: the picture carries the frame. The framed table
    // holds ONE cell with the picture (CSS, background attribute and the
    // Outlook rectangle, the fallback colour while pictures are blocked) and
    // the columns over it — nothing opaque between picture and content; the
    // card colour and the section's padding around the box. `minHeight` is
    // the picture's height.
    const h = s.minHeight;
    const cellRadius = s.radius ? Math.max(0, s.radius - (s.borderColor ? 1 : 0)) : 0;
    return `
                <tr>
                  <td${pad} align="left" valign="top" bgcolor="${cardBg}" style="mso-line-height-rule: exactly; padding: ${padding}; background-color: ${cardBg};">
                    <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" style="direction: ltr;${frame}">
                      <tr>
                        <td${phoneClass} align="left" valign="${valign}" bgcolor="${fallback}" background="${src}"${h ? ` height="${h}"` : ""} style="mso-line-height-rule: exactly; padding: 0;${h ? ` height: ${h}px;` : ""} ${pictureCss}${cellRadius ? ` border-radius: ${cellRadius}px;` : ""}">
                          <!--[if gte mso 9]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:${inner}px;${h ? `height:${h}px;` : ""}"><v:fill type="frame" src="${src}" color="${fallback}" size="1,1" aspect="atleast" origin="0.5,0.5" position="0.5,0.5" /><v:textbox style="mso-fit-shape-to-text:true" inset="0,0,0,0"><table role="presentation" width="${inner}" cellpadding="0" cellspacing="0" border="0"><tr><td${h ? ` height="${h}"` : ""} valign="${valign}"${h ? ` style="height:${h}px;"` : ""}><![endif]-->${columnsTable("", null)}
                          <!--[if gte mso 9]></td></tr></table></v:textbox></v:rect><![endif]-->
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>`;
  }
  const columns = columnsTable("", null);
  const innerHeight = s.minHeight > 0 ? Math.max(0, s.minHeight - s.padTop - s.padBottom) : 0;
  return `
                <tr>
                  <td${phoneClass} align="left" valign="top" bgcolor="${fallback}" background="${src}" style="mso-line-height-rule: exactly; padding: 0; ${pictureCss}">
                    <!--[if gte mso 9]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:${MAIL_CARD_WIDTH}px;${s.minHeight > 0 ? `height:${s.minHeight}px;` : ""}"><v:fill type="frame" src="${src}" color="${fallback}" size="1,1" aspect="atleast" origin="0.5,0.5" position="0.5,0.5" /><v:textbox style="mso-fit-shape-to-text:true" inset="0,0,0,0"><table role="presentation" width="${MAIL_CARD_WIDTH}" cellpadding="0" cellspacing="0" border="0"><tr><td${s.minHeight > 0 ? ` height="${s.minHeight}"` : ""} valign="${valign}"${s.minHeight > 0 ? ` style="height:${s.minHeight}px;"` : ""}><![endif]-->
                    <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" style="direction: ltr;">
                      <tr>
                        <td${pad} valign="${valign}"${innerHeight ? ` height="${innerHeight}"` : ""} style="mso-line-height-rule: exactly; padding: ${padding};${innerHeight ? ` height: ${innerHeight}px;` : ""}">${columns}
                        </td>
                      </tr>
                    </table>
                    <!--[if gte mso 9]></td></tr></table></v:textbox></v:rect><![endif]-->
                  </td>
                </tr>`;
}

/**
 * How much of the Outlook refinements a format-2 render carries, from the
 * most to the least: the VML twins of every rounded button; of the prominent
 * ones only (not the „Zum Produkt“ of product rows, up to 8 per list); none.
 * @type {ReadonlyArray<{ twins: "all" | "primary" | "none" }>}
 */
const WORD_STEPS = Object.freeze([{ twins: "all" }, { twins: "primary" }, { twins: "none" }]);
/**
 * The sizes a mail must not cross for Outlook's sake: the Rundmail checks
 * warn above 80 KB (mailing-checks.mjs MAILING_HTML_SOFT_LIMIT), the lint
 * budget is 90 KB (Gmail clips at 102 KB, the checks refuse above 100 KB).
 */
const SIZE_ZONES = Object.freeze([80 * 1024, MAIL_SIZE_BUDGET_BYTES]);

const utf8Bytes = (/** @type {string} */ s) => new TextEncoder().encode(s).length;

/**
 * Render a document to the full HTML mail.
 *
 * A format-2 document carries the Outlook refinements (WORD_STEPS) as far as
 * they keep the mail in the size zone it has without them (SIZE_ZONES): no
 * new size warning, no error, never over Gmail's limit for Outlook's look —
 * a mail above the budget without them renders exactly as before 13.11.2026.
 * @param {unknown} rawDoc
 * @param {MailRenderContext} ctx
 * @returns {string}
 */
export function renderMailTemplateHtml(rawDoc, ctx) {
  const doc = normalizeMailTemplateDoc(rawDoc);
  if (docFormatVersion(rawDoc) < 2) return renderDocHtml(doc, ctx, false, null);
  const plain = renderDocHtml(doc, ctx, true, null);
  if (ctx.outlook === false) return plain;
  const plainBytes = utf8Bytes(plain);
  const limit = SIZE_ZONES.find((z) => plainBytes <= z);
  if (limit === undefined) return plain;
  for (const word of WORD_STEPS) {
    const html = renderDocHtml(doc, ctx, true, word);
    if (utf8Bytes(html) <= limit) return html;
    // no twin left to drop: the later steps would render the same
    if (!html.includes("<v:roundrect ")) break;
  }
  return plain;
}

/**
 * One render of a normalised document. `word`: the Outlook refinements it
 * carries (WORD_STEPS; null = none).
 * @param {ReturnType<typeof normalizeMailTemplateDoc>} doc
 * @param {MailRenderContext} ctx
 * @param {boolean} auto  format 2 (docFormatVersion)
 * @param {{ twins: "all" | "primary" | "none" } | null} word
 * @returns {string}
 */
function renderDocHtml(doc, ctx, auto, word) {
  const R = environment(doc, ctx, auto, word);
  const { style, merge, en } = R;
  const top = R.top;

  const has = new Set(doc.blocks.map((b) => b.type));
  const mo = ctx.mo ?? null;
  const moHasBlocks = Boolean(mo && (mo.offerRowsHtml != null || mo.promoRowsHtml != null));
  const offerRows = mo?.offerRowsHtml ?? "";
  const promoRows = mo ? `${mo.promoRowsHtml ?? ""}${mo.ctaRowsHtml}${mo.footnoteRowHtml}${mo.postCtaRowsHtml}` : "";
  // Mo's pieces stay readable on any card. The composer writes Mo's text in
  // black for the classic white card, and the avatar is a picture on white:
  // on a dark card both sit on the white panel of the classic pieces (whose
  // rows mail-template-design.ts puts on it). Mo's heading and the hero
  // headline take the heading colour — a readable ink where it would vanish.
  const darkCard = isDarkCard(top.bg);
  const moHeading = (/** @type {string} */ size, /** @type {string} */ align) => ({ ...plainHeading(size, align), color: ink(style.headingColor, top.bg, 3) });
  const avatarRow = (/** @type {string} */ url) =>
    row(
      `
                    <img src="${escapeAttr(url)}" alt="Mo" width="64" height="64" border="0" style="width: 64px; height: 64px; display: block; Margin: 0 auto;">`,
      { padding: padCss(25, top.padX, 0), align: "center", bgcolor: top.bg }
    );
  /** Mo's text — on a dark card on the white panel, with the avatar above it when given. */
  const moBody = (/** @type {string | null} */ avatarUrl = null) => {
    const bodyHtml = mo?.bodyHtml ?? "";
    const opts = { padding: padCss(25, top.padX, 10), bgcolor: top.bg };
    if (!darkCard) return `${avatarUrl ? avatarRow(avatarUrl) : ""}${row(bodyHtml, opts)}`;
    const avatar = avatarUrl
      ? `
                    <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" style="direction: ltr;">
                      <tr>
                        <td align="center" style="mso-line-height-rule: exactly; padding: 0 0 16px;"><img src="${escapeAttr(avatarUrl)}" alt="Mo" width="64" height="64" border="0" style="width: 64px; height: 64px; display: block; Margin: 0 auto;"></td>
                      </tr>
                    </table>`
      : "";
    // Mo's links come in the accent colour (email-template.ts emailLinkStyle) —
    // chosen for the dark card; on the white panel one that does not read
    // gives way to the classic link blue.
    const linkInk = ink(style.accentColor, "#ffffff", 3, CLASSIC_LINK_COLOR);
    const text = linkInk === style.accentColor ? bodyHtml : bodyHtml.replace(new RegExp(`color:\\s*${style.accentColor}\\b`, "gi"), `color: ${linkInk}`);
    return row(mailWhitePanel(`${avatar}${text}`), opts);
  };

  /** Everything of the composer that the template does not place itself. */
  const moTail = () => {
    if (!mo) return "";
    if (!moHasBlocks) return `${mo.preCtaRowsHtml}${mo.ctaRowsHtml}${mo.footnoteRowHtml}${mo.postCtaRowsHtml}`;
    return `${has.has("mo_offer") ? "" : offerRows}${has.has("mo_promo") ? "" : promoRows}`;
  };

  const parts = [];
  for (const b of doc.blocks) {
    switch (b.type) {
      case "section":
        parts.push(sectionRows(R, b));
        break;
      case "products":
      case "countdown": {
        const slot = ctx.slots?.[b.id];
        // Format 2 draws them from the slot's data in the mail's look; a
        // version-1 document (or a slot of pre-rendered rows only) keeps the rows.
        if (R.auto && b.type === "products" && slot?.products?.items?.some((it) => it?.name)) {
          parts.push(productListRows(R, b, slot.products));
          break;
        }
        if (R.auto && b.type === "countdown" && slot?.countdown) {
          parts.push(countdownRows(R, b, slot.countdown));
          break;
        }
        const title = b.type === "products" ? b.title : b.heading;
        if (slot?.html) {
          if (title) parts.push(headingRows(R, plainHeading("m", "center"), top, merge(title)));
          parts.push(slot.html);
        } else if (ctx.previewPlaceholders) {
          const text =
            b.type === "products"
              ? en ? "Products appear here." : "Hier erscheinen die gewählten Produkte."
              : en ? "The countdown appears here." : "Hier erscheint der Countdown.";
          parts.push(placeholderRow(R, text, { padding: padCss(14, top.padX, 14), bgcolor: top.bg }));
        }
        break;
      }
      case "hero": {
        const h = ctx.hero ?? null;
        const src = h?.mobileUrl || h?.imageUrl || b.src;
        const fromMail = Boolean(h?.mobileUrl || h?.imageUrl);
        // the block's phone picture belongs to its fallback picture — a mail's own hero shows as before
        const mobileSrc = fromMail ? "" : b.mobileSrc ?? "";
        parts.push(imageRows(R, { src, mobileSrc, alt: b.alt, href: b.href, width: "full", placeholder: en ? "Title image" : "Titelbild" }, top));
        if (src && fromMail && h?.isAi && ctx.assets.aiLabelIconUrl) {
          const alt = en ? "AI-generated image" : "KI-generiertes Bild";
          parts.push(
            row(
              `<img src="${escapeAttr(ctx.assets.aiLabelIconUrl)}" width="73" height="14" alt="${alt}" border="0" style="width: 73px; height: 14px; display: inline-block;">`,
              { padding: padCss(6, top.padX, 0), align: "right", bgcolor: top.bg }
            )
          );
        }
        if (b.showHeadline && h?.headline) parts.push(headingRows(R, moHeading("l", "left"), top, h.headline));
        break;
      }
      case "mo_content":
        if (!mo) break;
        if (b.showHeading && mo.heading) parts.push(headingRows(R, moHeading("m", "center"), top, mo.heading));
        parts.push(moBody(mo.moAvatarUrl));
        parts.push(moTail());
        break;
      case "mo_offer":
        if (mo && moHasBlocks) parts.push(offerRows);
        break;
      case "mo_promo":
        if (mo && moHasBlocks) parts.push(promoRows);
        break;
      case "footer":
        // Mo's content of a template without „Mos persönlicher Text“ — never lost.
        if (mo && !has.has("mo_content")) parts.push(moBody(), moTail());
        parts.push(footerRows(R, b));
        break;
      default:
        parts.push(renderBlock(R, b, top));
        break;
    }
  }

  const outerBg = style.outerBackground;
  const families = [...new Set(docFontKeys(doc).map((k) => mailFontGoogleFamily(k)).filter(Boolean))];
  const fontUrl = families.length ? `https://fonts.googleapis.com/css2?${families.map((f) => `family=${f}`).join("&")}&display=swap` : null;
  const webFontHead = fontUrl
    ? `
    <!--[if !mso]><!-->
    <link href="${fontUrl.replace(/&/g, "&amp;")}" rel="stylesheet" type="text/css">
    <style type="text/css">
      @import url('${fontUrl}');
    </style>
    <!--<![endif]-->`
    : "";
  const preheaderHtml = ctx.preheader
    ? `
  <div style="display: none; overflow: hidden; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; mso-hide: all;">${escapeHtml(ctx.preheader)}</div>
  <div style="display: none; overflow: hidden; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; mso-hide: all;">${"&#847;&#8204;&nbsp;".repeat(20)}</div>`
    : "";
  const cardRadius =
    style.cardRadius > 0 ? ` border-radius: ${style.cardRadius}px; border-collapse: separate !important; border-spacing: 0; overflow: hidden;` : "";

  return `<!DOCTYPE html>
<html lang="${R.locale}" ${MSO_HTML_ATTRS}>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="x-apple-disable-message-reformatting">
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light only">
    <title>${escapeHtml(merge(ctx.subject))}</title>${msoHeadHtml(R.bodyMso, { fonts: [...R.msoFonts].map(([className, stack]) => ({ className, stack })) })}${webFontHead}
    <style type="text/css">
${EMAIL_SHELL_CSS}${phoneSwapCss(R)}
    </style>
  </head>
  <body id="body" bgcolor="${outerBg}" style="-webkit-text-size-adjust: none; -ms-text-size-adjust: none; background-color: ${outerBg}; Margin: 0; padding: 0;">${preheaderHtml}
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; min-width: 100%; direction: ltr;" role="presentation" bgcolor="${outerBg}">
      <tbody>
        <tr>
          <td align="center" valign="top" style="mso-line-height-rule: exactly; padding: 20px 0;">
            <center style="width: 100%;">
            <table border="0" width="${MAIL_CARD_WIDTH}" cellpadding="0" cellspacing="0" align="center" style="width: ${MAIL_CARD_WIDTH}px; max-width: ${MAIL_CARD_WIDTH}px; direction: ltr; Margin: 0 auto; table-layout: fixed;${cardRadius}" class="email-container" role="presentation" bgcolor="${style.cardBackground}">
              <tbody>${parts.join("")}
              </tbody>
            </table>
            </center>
          </td>
        </tr>
      </tbody>
    </table>
  </body>
</html>`;
}

/**
 * The greeting with or without the first name — the one block that switches
 * whole texts: with a name the text (its {{vorname}} filled), without one the
 * fallback. A Rundmail freeze passes `ctx.greeting` to write a placeholder
 * that is resolved per recipient.
 */
function greetingText(b, ctx, merge) {
  if (ctx.greeting) return ctx.greeting(b.text, b.fallback);
  const probe = merge("{{vorname|}}");
  return probe ? merge(b.text) : b.fallback;
}

/** The social icons: 20 px with 6 px on each side; in narrow columns the padding shrinks to 2 px, the icon to 16 px. */
const SOCIAL_ICON = 20;
const SOCIAL_PAD = 6;
const SOCIAL_MIN_ICON = 16;
const SOCIAL_MIN_PAD = 2;
/** The space between two rows of icons. */
const SOCIAL_ROW_GAP = 8;

/**
 * How `count` social icons fit `room` px: the fewest rows (filled as evenly
 * as possible) in which every icon keeps at least 16 px and 2 px on each
 * side — within them the padding shrinks first, then the icon. A row is
 * never wider than the room (unless not even one 16 px icon fits).
 * @param {number} count
 * @param {number} room
 * @returns {{ perRow: number, size: number, pad: number }}
 */
export function socialIconLayout(count, room) {
  const n = Math.max(1, count);
  for (let rows = 1; rows <= n; rows++) {
    const perRow = Math.ceil(n / rows);
    const slot = Math.floor(room / perRow);
    if (slot >= SOCIAL_ICON + 2 * SOCIAL_PAD) return { perRow, size: SOCIAL_ICON, pad: SOCIAL_PAD };
    if (slot >= SOCIAL_ICON + 2 * SOCIAL_MIN_PAD) return { perRow, size: SOCIAL_ICON, pad: Math.floor((slot - SOCIAL_ICON) / 2) };
    if (slot >= SOCIAL_MIN_ICON + 2 * SOCIAL_MIN_PAD) return { perRow, size: slot - 2 * SOCIAL_MIN_PAD, pad: SOCIAL_MIN_PAD };
  }
  return { perRow: 1, size: SOCIAL_MIN_ICON, pad: SOCIAL_MIN_PAD };
}

/**
 * The social icons in `room` px (socialIconLayout): one row as in version 1
 * where they fit, else smaller and, if need be, in several rows — each row
 * its own table in a cell of its own, aligned like the block.
 */
function socialRow(links, align = "center", room = MAIL_CARD_WIDTH) {
  const list = links ?? [];
  const { perRow, size, pad } = socialIconLayout(list.length, room);
  const iconRow = (/** @type {typeof list} */ items) => `
                    <table cellspacing="0" cellpadding="0" border="0" align="${align}" role="presentation" style="direction: ltr; ${blockMargin(align)}">
                      <tr>${items
                        .map(
                          (s) => `
                        <td align="center" valign="middle" style="mso-line-height-rule: exactly; padding: 0 ${pad}px;">
                          <a href="${escapeAttr(s.url)}" target="_blank" style="text-decoration: none;"><img src="${escapeAttr(s.icon)}" alt="${escapeAttr(s.alt)}" width="${size}" height="${size}" border="0" style="width: ${size}px; height: ${size}px; display: block; border: none; outline: none;"></a>
                        </td>`
                        )
                        .join("")}
                      </tr>
                    </table>`;
  if (list.length <= perRow) return iconRow(list);
  const rows = [];
  for (let i = 0; i < list.length; i += perRow) rows.push(list.slice(i, i + perRow));
  return `
                    <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" style="direction: ltr;">${rows
                      .map(
                        (items, i) => `
                      <tr>
                        <td align="${align}" style="mso-line-height-rule: exactly; padding: ${i === 0 ? "0" : `${SOCIAL_ROW_GAP}px 0 0`};">${iconRow(items)}
                        </td>
                      </tr>`
                      )
                      .join("")}
                    </table>`;
}

/**
 * The legal footer. Its colours follow the block (background, textColor) —
 * the legal texts themselves are fixed, and they always stay readable: a
 * text colour below 4.5 : 1 on the background falls back to black or white.
 */
function footerRows(R, b) {
  const { ctx, en } = R;
  const bg = b.background ?? "#f9f9f9";
  const fg = ink(b.textColor ?? "#000000", bg);
  const small = (size) => typeCss({ font: R.bodyFont, size, lineHeight: "1.5", weight: 400, color: fg, word: R.word });
  const company = (ctx.companyLines ?? MAIL_COMPANY_LINES).map((l) => escapeHtml(l)).join("<br>");
  const year = ctx.year ?? new Date().getFullYear();
  // The unsubscribe notice comes pre-rendered in black (consent-copy.ts).
  const unsubscribe = ctx.footer.unsubscribeHtml && fg !== "#000000" ? ctx.footer.unsubscribeHtml.replace(/color:\s*#000000/gi, `color: ${fg}`) : ctx.footer.unsubscribeHtml;
  return `
                ${MAIL_FOOTER_MARKER}
                <tr>
                  <td height="20" bgcolor="${R.style.cardBackground}" style="mso-line-height-rule: exactly; font-size: 0; line-height: 20px;">&nbsp;</td>
                </tr>
                <tr>
                  <td class="content-pad" align="center" bgcolor="${bg}" style="mso-line-height-rule: exactly; padding: ${padCss(24, R.style.contentPadding, 24)};">
                    <table border="0" width="100%" cellpadding="0" cellspacing="0" align="center" style="min-width: 100%; direction: ltr; text-align: center;" role="presentation">
                      <tbody>${
                        b.showSocial
                          ? `
                          <tr>
                            <td align="center" style="mso-line-height-rule: exactly; padding-bottom: 12px;" valign="top">${socialRow(ctx.assets.socialLinks, "center", MAIL_CARD_WIDTH - 2 * R.style.contentPadding)}
                            </td>
                          </tr>`
                          : ""
                      }
                          <tr>
                            <td align="center" style="mso-line-height-rule: exactly; padding-bottom: 8px;" valign="top">
                              <p style="${small(11)}" align="center">${company}</p>
                              <p style="${small(11)}" align="center"><a href="tel:+49(0)8142%20448666" style="color: ${fg}; text-decoration: underline;">+49(0)8142 448666</a> <strong>&#183;</strong> <a href="mailto:info@motionsports.de" style="color: ${fg}; text-decoration: underline;">info@motionsports.de</a></p>
                            </td>
                          </tr>${
                            unsubscribe
                              ? `
                          <tr>
                            <td align="center" style="mso-line-height-rule: exactly; padding: 8px 0 0;" valign="top">${unsubscribe}</td>
                          </tr>`
                              : ""
                          }
                          <tr>
                            <td align="center" style="mso-line-height-rule: exactly; padding-top: 8px;" valign="top">
                              <p style="${small(12)}" align="center">&#169; ${year} motion sports &#183; <a href="${escapeAttr(ctx.assets.imprintUrl)}" target="_blank" style="color: ${fg}; text-decoration: underline;">${en ? "Imprint" : "Impressum"}</a></p>
                            </td>
                          </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>`;
}

/**
 * The plain-text part of a document (Rundmail; personal mails keep the text
 * part their composer writes), in reading order — the blocks of a section
 * column by column. Links are written out as "Label: URL".
 * @param {unknown} rawDoc
 * @param {MailRenderContext} ctx
 * @returns {string}
 */
export function renderMailTemplateText(rawDoc, ctx) {
  const doc = normalizeMailTemplateDoc(rawDoc);
  const merge = ctx.merge ?? ((t) => t);
  const en = ctx.locale === "en";
  // format 2 writes the countdown from its block (its texts and the slot's deadline), version 1 the slot's line
  const auto = docFormatVersion(rawDoc) >= 2;
  const out = [];
  for (const { block: b } of walkMailBlocks(doc)) {
    switch (b.type) {
      case "heading":
        if (b.text) out.push(merge(b.text));
        break;
      case "text":
        if (b.text) out.push(emailProseToText(mergeProse(merge, b.text)).replace(/^\s*•\s+/gm, "- "));
        break;
      case "greeting":
        out.push(greetingText(b, ctx, merge));
        break;
      case "image":
        if (b.src && b.href && b.alt) out.push(`${b.alt}: ${b.href}`);
        break;
      case "button":
        if (b.label && b.href) out.push(`${merge(b.label)}: ${b.href}`);
        break;
      case "menu": {
        const lines = (b.items ?? []).filter((it) => it.label && it.href).map((it) => `${merge(it.label)}: ${it.href}`);
        if (lines.length) out.push(lines.join("\n"));
        break;
      }
      case "product": {
        // Only a product the HTML shows (it has data); the slot's own line when the TS layer wrote one.
        const slot = ctx.slots?.[b.id];
        const p = slot?.product;
        if (p?.name) out.push(slot?.text || [`${p.name}${b.showPrice && p.priceLabel ? ` — ${p.priceLabel}` : ""}`, p.url].filter(Boolean).join("\n"));
        break;
      }
      case "products":
      case "countdown": {
        const slot = ctx.slots?.[b.id];
        const title = b.type === "products" ? b.title : b.heading;
        if (auto && b.type === "countdown" && slot?.countdown) {
          // what the HTML shows: the heading, the block's own text in the picture, the caption with its deadline
          const caption = countdownCaptionTemplate(b, en ? "en" : "de");
          const deadline = slot.countdown.deadline ?? "";
          const shown = caption && (deadline || caption.split(COUNTDOWN_DATE_RE).length === 1);
          const lines = [
            title ? merge(title) : null,
            b.label && b.showLabel !== false ? b.label : null,
            shown ? merge(fillCountdownCaption(caption, deadline)) : null,
          ];
          out.push(lines.filter(Boolean).join("\n"));
          break;
        }
        if (slot?.text) out.push([title ? merge(title) : null, slot.text].filter(Boolean).join("\n"));
        break;
      }
      case "coupon":
        if (b.code) {
          out.push(
            [
              `${en ? "Your code" : "Dein Code"}: ${b.code}${b.headline ? ` — ${merge(b.headline)}` : ""}`,
              b.terms ? merge(b.terms) : null,
              `${en ? "Redeem code" : "Code einlösen"}: ${discountRedeemUrl(b.code)}`,
            ]
              .filter(Boolean)
              .join("\n")
          );
        }
        break;
      case "html": {
        const t = htmlToText(sanitizeCustomHtml(b.html));
        if (t) out.push(t);
        break;
      }
      case "footer":
        out.push("—");
        if (ctx.footer.unsubscribeText) out.push(ctx.footer.unsubscribeText);
        out.push(`${(ctx.companyLines ?? MAIL_COMPANY_LINES).join(" · ")} · ${en ? "Imprint" : "Impressum"}: ${ctx.assets.imprintUrl}`);
        break;
      default:
        break;
    }
  }
  return out.filter((s) => s && s.trim()).join("\n\n");
}

/** Does the document place a Mo piece itself? (UI hint: where unplaced pieces go.) */
export function docMoPlacement(rawDoc) {
  const doc = normalizeMailTemplateDoc(rawDoc);
  const types = new Set(doc.blocks.map((b) => b.type));
  return Object.fromEntries(MO_BLOCK_TYPES.map((t) => [t, types.has(t)]));
}
