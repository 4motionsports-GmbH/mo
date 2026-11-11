// E-mail templates („Vorlagen“) — the renderer: a block document
// (mail-template-doc.mjs) → e-mail HTML and the plain-text part. Pure and
// tested (mail-template-render.test.mjs, mail-template-render-v2.test.mjs);
// docs/EMAIL_TEMPLATES.md.
//
// The output follows every rule of docs/EMAIL_DESIGNS.md: a 600 px table
// card, role="presentation" + bgcolor attributes, every style inline, images
// with numeric width attributes, buttons with their padding on the cell
// (mso-padding-alt), the Outlook head block, the shared shell CSS. The tests
// run lintOutlookHtml (email-outlook.mjs) over real renders.
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
// whose colour sits inside the frame. Inside a column the default spacing
// above the first and below the last block collapses to 0 — the section's
// padding frames the content; padTop / padBottom always win. Texts whose
// colour the operator cannot set (the coupon's, the legal footer's) switch
// to a readable ink on a colour they would vanish on. Optional fields only
// ADD markup when set, so a version-1 document renders as before (snapshots
// in __fixtures__/mail-template-v1/).
//
// What needs I/O or the active design context comes in pre-rendered through
// the context — the TypeScript layer (mail-template-design.ts,
// mailing-render.ts) builds it:
//   * `slots[blockId]`: the product rows/grid of a `products` block and the
//     live countdown of a `countdown` block (both through the classic
//     renderers, inside the template's theme tokens), and the DATA of a
//     `product` block (`product`: name, picture, link, price labels,
//     description) — laid out here in the template's own look;
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
import { MSO_HTML_ATTRS, msoHeadHtml, msoPaddingAlt, nbsp } from "./email-outlook.mjs";
import { buttonRadiusFor } from "./email-theme.mjs";
import { emailProseToText, renderEmailProseHtml } from "./email-prose.mjs";
import { couponCodeType, discountRedeemUrl } from "./discount-coupon.mjs";
import {
  MO_BLOCK_TYPES,
  contrastRatio,
  docFontKeys,
  mailFontGoogleFamily,
  mailFontMsoStack,
  mailFontStack,
  normalizeMailTemplateDoc,
  walkMailBlocks,
} from "./mail-template-doc.mjs";

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

/**
 * The display data of a `product` block, resolved at send time from the
 * catalog (mail-template-design.ts).
 * @typedef {{ name: string, imageUrl: string | null, url: string | null, priceLabel: string | null,
 *   compareAtLabel: string | null, description: string | null }} MailSlotProduct
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
 *   slots?: Record<string, { html: string, text: string, product?: MailSlotProduct } | undefined>,
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
 * }} MailRenderContext
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
 * Strip what has no place in a mail from a custom HTML block: scripts,
 * styles, frames, forms, embeds, document wrappers, comments (an unbalanced
 * conditional comment would swallow the rest of the mail), event handlers
 * and script/data URLs. Link targets are written double-quoted
 * (href='…' and href=… become href="…"), the only form the Rundmail link
 * tracking (mailing-core.mjs freezeLinks) rewrites. A fence, not a full
 * sanitizer: the block is written by the operator in the admin (trusted),
 * and every admin preview is a sandboxed iframe. <img> without a numeric
 * width attribute is left alone (no width is invented).
 * @param {string} html
 * @returns {string}
 */
export function sanitizeCustomHtml(html) {
  let s = String(html ?? "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<(script|style|iframe|object|embed|form|textarea|select|noscript|template|svg|math)\b[\s\S]*?<\/\1\s*>/gi, "");
  s = s.replace(/<\/?(script|style|iframe|object|embed|form|input|button|textarea|select|option|link|meta|base|html|head|body|title|frame|frameset|applet|noscript|template|svg|math)\b[^>]*>/gi, "");
  s = s.replace(/\s(on[a-z]+|srcdoc|formaction|xmlns:[a-z]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  s = s.replace(/\s(href|src|background|action|poster)\s*=\s*("|')\s*(?:javascript|vbscript|data|file):[^"']*\2/gi, ' $1="#"');
  s = s.replace(/\s(href|src|background|action|poster)\s*=\s*(?:javascript|vbscript|data|file):[^\s>]*/gi, ' $1="#"');
  s = s.replace(/\shref\s*=\s*(?:'([^']*)'|([^\s"'>]+))/gi, (_all, single, bare) => ` href="${String(single ?? bare).replace(/"/g, "&quot;")}"`);
  s = s.replace(/expression\s*\(/gi, "(");
  return s.trim();
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

/** The darker or the lighter ink, whichever reads better on `bg`. */
function strongInk(bg) {
  const dark = contrastRatio("#111111", bg) ?? 21;
  const light = contrastRatio("#ffffff", bg) ?? 1;
  return dark >= light ? "#111111" : "#ffffff";
}

/** `preferred` when it reads on `bg` (WCAG ratio ≥ `min`), else `fallback`. */
function ink(preferred, bg, min = 4.5, fallback = strongInk(bg)) {
  const ratio = contrastRatio(preferred, bg);
  return ratio == null || ratio >= min ? preferred : fallback;
}

/**
 * The inline type of a text element. Optional settings only add declarations
 * when set, so a version-1 block keeps its exact style string.
 * @param {{ font: string, size: number, lineHeight: string, weight: number, color: string,
 *   italic?: boolean, uppercase?: boolean, letterSpacing?: number | null, margin?: string }} t
 */
function typeCss({ font, size, lineHeight, weight, color, italic = false, uppercase = false, letterSpacing = null, margin = "0" }) {
  return `mso-line-height-rule: exactly; direction: ltr; font-family: ${font}; font-size: ${size}px; line-height: ${lineHeight}; font-weight: ${weight};${italic ? " font-style: italic;" : ""}${uppercase ? " text-transform: uppercase;" : ""}${letterSpacing ? ` letter-spacing: ${letterSpacing}px;` : ""} color: ${color}; Margin: ${margin};`;
}

/**
 * The type of a heading / text / greeting block: its own settings (fontSize,
 * weight, italic, uppercase, letterSpacing, lineHeight %, font) over the
 * block type's defaults. `css(margin)` is the inline style.
 */
function blockType(b, { size, lineHeight, weight, color, fontKey }) {
  const fs = b.fontSize ?? size;
  const lh = b.lineHeight != null ? `${Math.round((fs * b.lineHeight) / 100)}px` : lineHeight(fs);
  const fw = b.weight === "bold" ? 700 : b.weight === "normal" ? 400 : weight;
  const font = mailFontStack(b.font ?? fontKey);
  return {
    size: fs,
    css: (margin = "0") =>
      typeCss({ font, size: fs, lineHeight: lh, weight: fw, color, italic: b.italic, uppercase: b.uppercase, letterSpacing: b.letterSpacing, margin }),
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
 * Everything the block renderers share for one render.
 * @param {ReturnType<typeof normalizeMailTemplateDoc>} doc
 * @param {MailRenderContext} ctx
 */
function environment(doc, ctx) {
  const style = doc.style;
  const locale = ctx.locale === "en" ? "en" : "de";
  return {
    ctx,
    style,
    locale,
    en: locale === "en",
    merge: ctx.merge ?? ((t) => t),
    bodyFont: mailFontStack(style.fontFamily),
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
      return row(buttonTable(R, b, R.merge(b.label)), { padding: padCss(t, sidePad(b, box), bt), align: b.align, bgcolor: rowBg(b, box), pad: box.top });
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
      return row(socialRow(R.ctx.assets.socialLinks, align), { padding: padCss(t, sidePad(b, box), bt), align, bgcolor: rowBg(b, box), pad: box.top });
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
                    <p style="${typeCss({ font: R.bodyFont, size: TEXT_PX.s, lineHeight: "1.5", weight: 400, color: "#777777" })}" align="center">${escapeHtml(text)}</p>`,
    { padding, align: "center", bgcolor, pad }
  );
}

function logoRows(R, b, box) {
  const x = sidePad(b, box);
  const [t, bt] = vpad(b, box, 30, 20);
  const w = Math.min(b.width, Math.max(20, box.width - 2 * x));
  const margin = b.align === "center" ? " Margin: 0 auto;" : b.align === "right" ? " Margin: 0 0 0 auto;" : "";
  const bg = rowBg(b, box);
  return `
                <tr>
                  <td${box.top ? ' class="content-pad"' : ""} align="${b.align}"${bg ? ` bgcolor="${bg}"` : ""} style="mso-line-height-rule: exactly; padding: ${padCss(t, x, bt)};">
                    <a href="${escapeAttr(R.ctx.assets.shopUrl)}" target="_blank" style="text-decoration: none !important;">
                      <img src="${escapeAttr(R.style.logoUrl ?? R.ctx.assets.logoUrl)}" alt="motion sports" width="${w}" border="0" style="width: ${w}px; height: auto !important; max-width: 100%; display: block;${margin}">
                    </a>
                  </td>
                </tr>`;
}

/** A heading (also the titles of slots, the hero headline and Mo's heading). `text` is merged already. */
function headingRows(R, b, box, text) {
  const type = blockType(b, {
    size: HEADING_PX[b.size] ?? HEADING_PX.l,
    lineHeight: (fs) => `${Math.round(fs * 1.25)}px`,
    weight: 700,
    color: b.color ?? R.style.headingColor,
    fontKey: R.headingFontKey,
  });
  const inner = `
                    <p style="${type.css()}" align="${b.align}">${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
  const band = Boolean(b.background);
  const [t, bt] = vpad(b, box, band ? 26 : 24, band ? 26 : 8);
  return row(inner, { padding: padCss(t, sidePad(b, box), bt), align: b.align, bgcolor: rowBg(b, box), pad: box.top });
}

/** A heading without own settings (slot titles, hero headline, Mo's heading). */
const plainHeading = (size, align) => ({ size, align, color: null, background: null });

function textRows(R, b, box) {
  const color = b.color ?? R.style.textColor;
  const type = blockType(b, { size: TEXT_PX[b.size] ?? TEXT_PX.m, lineHeight: () => "1.5", weight: 400, color, fontKey: R.style.fontFamily });
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
 * The prose of a text block: blank line = new paragraph, a chunk whose every
 * line starts with "- " / "• " = a list (the block's bullet, "1." numbered).
 */
function paragraphs(R, b, type) {
  const chunks = R.merge(b.text)
    .split(/\n\s*\n/)
    .map((c) => c.trim())
    .filter(Boolean);
  const numbered = b.bullet === "1.";
  return chunks
    .map((chunk, i) => {
      const last = i === chunks.length - 1;
      const lines = chunk.split("\n");
      if (lines.every((l) => /^\s*[-•]\s+/.test(l))) {
        const cell = type.css();
        const markWidth = numbered
          ? Math.max(22, Math.round(type.size * (lines.length >= 10 ? 2 : 1.5)))
          : b.fontSize
            ? Math.max(18, Math.round(type.size * 1.3))
            : 18;
        const items = lines
          .map(
            (l, n) => `
                      <tr>
                        <td valign="top" width="${markWidth}" style="mso-line-height-rule: exactly; ${cell}">${numbered ? `${n + 1}.` : BULLET_GLYPHS[b.bullet] ?? "&#8226;"}</td>
                        <td valign="top" style="mso-line-height-rule: exactly; ${cell}">${renderEmailProseHtml(l.replace(/^\s*[-•]\s+/, ""), { linkStyle: R.linkStyle })}</td>
                      </tr>`
          )
          .join("");
        return `
                    <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" style="direction: ltr;${last ? "" : " Margin: 0 0 12px;"}">${items}
                    </table>`;
      }
      return `
                    <p style="${type.css(last ? "0" : "0 0 12px")}" align="${b.align}">${renderEmailProseHtml(chunk, { linkStyle: R.linkStyle })}</p>`;
    })
    .join("");
}

function greetingRows(R, b, box) {
  const type = blockType(b, { size: TEXT_PX.m, lineHeight: () => "1.5", weight: 400, color: b.color ?? R.style.textColor, fontKey: R.style.fontFamily });
  const [t, bt] = vpad(b, box, 20, 4);
  return row(
    `
                    <p style="${type.css()}" align="${b.align}">${escapeHtml(greetingText(b, R.ctx, R.merge))}</p>`,
    { padding: padCss(t, sidePad(b, box), bt), align: b.align, bgcolor: rowBg(b, box), pad: box.top }
  );
}

/**
 * An image (also the hero). `width`: "full" = the whole box (card or
 * column) without side padding, "content" = inside the side padding, a
 * number = that many px (never wider than the room it has). Inside a column
 * an image as wide as the column fills the stacked column on phones
 * (col-img).
 * @param {any} R
 * @param {{ src: string, alt: string, href: string, width: "full" | "content" | number, align?: string,
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
  const tag = `<img src="${escapeAttr(img.src)}" width="${w}" alt="${escapeAttr(img.alt)}" border="0"${fills ? ' class="col-img"' : ""} style="width: 100%; max-width: ${w}px; height: auto; display: block; ${blockMargin(align)}${img.radius ? ` border-radius: ${img.radius}px;` : ""}">`;
  const linked = img.href ? `<a href="${escapeAttr(img.href)}" target="_blank" style="text-decoration: none;">${tag}</a>` : tag;
  return row(
    `
                    ${linked}`,
    opts
  );
}

/**
 * The button table: the cell carries the colour and Word's padding
 * (mso-padding-alt), the anchor the padding of every other client. A border
 * (outline, borderColor) is drawn by the cell — Word draws cell borders, the
 * separate border model lets browsers round it.
 * @param {any} R
 * @param {{ href: string, align: string, color?: string | null, textColor?: string | null, fullWidth?: boolean,
 *   size?: string, shape?: string, outline?: boolean, borderColor?: string | null }} b
 * @param {string} label  merged already
 */
function buttonTable(R, b, label) {
  const size = BUTTON_SIZES[/** @type {"s" | "m" | "l"} */ (b.size ?? "m")] ?? BUTTON_SIZES.m;
  const radius = buttonRadiusFor(b.shape ?? R.style.buttonShape);
  const color = b.color ?? R.style.accentColor;
  const tableAttrs = b.fullWidth ? ' width="100%"' : b.align === "center" ? ' align="center"' : ` align="${b.align}"`;
  const border = b.outline ? b.borderColor ?? color : b.borderColor ?? null;
  const type = `font-size: ${size.fontSize}px; line-height: ${size.lineHeight}px;`;
  if (!border) {
    const fg = b.textColor ?? R.style.buttonTextColor;
    return `
                    <table cellspacing="0" cellpadding="0" border="0"${tableAttrs} role="presentation" style="direction: ltr; border-spacing: 0 !important; border-collapse: collapse !important;">
                      <tr>
                        <td align="center" bgcolor="${color}" style="mso-line-height-rule: exactly; mso-padding-alt: ${msoPaddingAlt(size.padding, 2)}; border-radius: ${radius};" valign="top">
                          <a href="${escapeAttr(b.href)}" target="_blank" style="${type} color: ${fg}; text-decoration: none; border-radius: ${radius}; background-color: ${color}; display: block; font-family: ${R.bodyFont}; font-weight: 700; text-align: center; letter-spacing: 0.5px; word-break: break-word; padding: ${size.padding}; border: 2px solid ${color}; mso-padding-alt: 0;"><span style="color: ${fg};">${escapeHtml(label)}</span></a>
                        </td>
                      </tr>
                    </table>`;
  }
  const fill = b.outline ? null : color;
  const fg = b.outline ? color : b.textColor ?? R.style.buttonTextColor;
  return `
                    <table cellspacing="0" cellpadding="0" border="0"${tableAttrs} role="presentation" style="direction: ltr; border-spacing: 0 !important; border-collapse: separate !important;">
                      <tr>
                        <td align="center"${fill ? ` bgcolor="${fill}"` : ""} style="mso-line-height-rule: exactly; mso-padding-alt: ${msoPaddingAlt(size.padding)}; border: 2px solid ${border}; border-radius: ${radius};${fill ? ` background-color: ${fill};` : ""}" valign="top">
                          <a href="${escapeAttr(b.href)}" target="_blank" style="${type} color: ${fg}; text-decoration: none; border-radius: ${radius}; display: block; font-family: ${R.bodyFont}; font-weight: 700; text-align: center; letter-spacing: 0.5px; word-break: break-word; padding: ${size.padding}; mso-padding-alt: 0;"><span style="color: ${fg};">${escapeHtml(label)}</span></a>
                        </td>
                      </tr>
                    </table>`;
}

function couponRows(R, b, box) {
  const en = R.en;
  const bg = envBg(b, box);
  const accent = R.style.accentColor;
  // The frame in the accent colour — unless the accent IS the background (white on white).
  const frame = b.accent ?? (accent === bg ? strongInk(bg) : accent);
  const narrow = !box.top && box.width < NARROW_COLUMN;
  const cellPadX = box.top ? 28 : narrow ? 10 : 20;
  // In a column the code shrinks to its room (frame 2 × 2 px, cell padding); the card keeps 24 px.
  const code = box.top
    ? { fontSize: 24, lineHeight: 30, letterSpacing: 2 }
    : couponCodeFit(b.code, box.width - 2 * sidePad(b, box) - 4 - 2 * cellPadX);
  // The coupon has no text colour of its own: on a colour other than the
  // card's (its own background, a coloured column) the template's text and
  // link colours give way to readable ones.
  const foreign = bg !== R.style.cardBackground;
  const textColor = foreign ? ink(R.style.textColor, bg) : R.style.textColor;
  const linkStyle = foreign
    ? `color: ${ink(R.style.linkColor ?? accent, bg, 3, ink(accent, bg, 3))}; text-decoration: underline; word-wrap: break-word;`
    : R.linkStyle;
  const t = (size, color) => typeCss({ font: R.bodyFont, size, lineHeight: "1.5", weight: 400, color });
  const redeem = discountRedeemUrl(b.code);
  const terms = b.terms ? R.merge(b.terms) : "";
  const inner = `
                    <table cellspacing="0" cellpadding="0" border="0"${box.top ? "" : ' width="100%"'} align="center" role="presentation" style="direction: ltr; Margin: 0 auto; border-collapse: separate !important; border-spacing: 0; border: 2px dashed ${frame}; border-radius: 8px;">
                      <tr>
                        <td align="center" style="mso-line-height-rule: exactly; padding: ${narrow ? 14 : 16}px ${cellPadX}px;">
                          <p style="${t(TEXT_PX.s, textColor)} text-transform: uppercase; letter-spacing: 1px;" align="center">${en ? "Your code" : "Dein Code"}</p>
                          <p style="mso-line-height-rule: exactly; font-family: ${R.bodyFont}; font-size: ${code.fontSize}px; line-height: ${code.lineHeight}px; font-weight: 700; letter-spacing: ${code.letterSpacing}px; color: ${ink("#111111", bg)}; Margin: 4px 0 6px;${narrow ? " word-break: break-all;" : ""}" align="center">${escapeHtml(b.code)}</p>${
                            b.headline
                              ? `
                          <p style="${t(TEXT_PX.m, b.accent ?? textColor)} font-weight: 700;" align="center">${escapeHtml(R.merge(b.headline))}</p>`
                              : ""
                          }${
                            terms
                              ? `
                          <p style="${t(TEXT_PX.s, ink("#555555", bg, 4.5, textColor))}" align="center">${escapeHtml(terms)}</p>`
                              : ""
                          }
                          <p style="${t(TEXT_PX.m, textColor)} Margin-top: 8px;" align="center"><a href="${escapeAttr(redeem ?? R.ctx.assets.shopUrl)}" target="_blank" style="${linkStyle} font-weight: 700;">${en ? "Redeem code" : "Code einlösen"} &#8594;</a></p>
                        </td>
                      </tr>
                    </table>`;
  const [tp, bp] = vpad(b, box, 14, 14);
  return row(inner, { padding: padCss(tp, sidePad(b, box), bp), align: "center", bgcolor: rowBg(b, box), pad: box.top });
}

/**
 * A line. Full width: the border of a 100 % table (as version 1); shorter
 * lines are a cell of that width beside empty cells — no floating table,
 * which Word would let content flow around.
 */
function dividerRows(R, b, box) {
  const line = `border-top: ${b.thickness ?? 1}px ${b.lineStyle ?? "solid"} ${b.color ?? "#e0e0e0"};`;
  const pct = b.widthPct ?? 100;
  const flat = "font-size: 0; line-height: 0; mso-line-height-rule: exactly; mso-line-height-alt: 1px;";
  let inner;
  if (pct >= 100) {
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
  const css = typeCss({
    font: mailFontStack(b.font ?? R.style.fontFamily),
    size,
    lineHeight: `${Math.round(size * 1.6)}px`,
    weight: b.bold ? 700 : 400,
    color,
    uppercase: b.uppercase,
    letterSpacing: b.letterSpacing,
  });
  const links = items.map((it) => {
    // A short label never breaks („Home Gym“); a long one may wrap in a narrow column.
    const text = R.merge(it.label);
    const label = text.length <= MENU_UNBROKEN_CHARS ? nbsp(escapeHtml(text)) : escapeHtml(text);
    return it.href ? `<a href="${escapeAttr(it.href)}" target="_blank" style="color: ${color}; text-decoration: none;">${label}</a>` : label;
  });
  const mark = MENU_SEPARATOR_HTML[/** @type {"|"} */ (b.separator)] ?? "|";
  const separator = ` <span style="color: ${color};">${mark ? `&nbsp;${mark}&nbsp;` : "&nbsp;&nbsp;"}</span> `;
  return row(
    `
                    <p style="${css}" align="${b.align}">${links.join(separator)}</p>`,
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
  const link = (html, color) => (p.url ? `<a href="${escapeAttr(p.url)}" target="_blank" style="color: ${color}; text-decoration: none;">${html}</a>` : html);

  const name = `
                          <p style="${typeCss({ font: mailFontStack(R.headingFontKey), size: nameSize, lineHeight: `${Math.round(nameSize * 1.3)}px`, weight: 700, color: nameColor })}" align="${align}">${link(escapeHtml(p.name), nameColor)}</p>`;
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
                          <p style="${typeCss({ font: R.bodyFont, size: small ? 12 : 13, lineHeight: "1.5", weight: 400, color: textColor, margin: "8px 0 0" })}" align="${align}">${escapeHtml(p.description)}</p>`
      : "";
  const label = b.buttonLabel && p.url ? R.merge(b.buttonLabel) : "";
  const button =
    label
      ? `
                      <tr>
                        <td align="${align}" style="mso-line-height-rule: exactly; padding: 14px 0 0;">${buttonTable(R, { href: p.url, align, size: small ? "s" : undefined }, label)}
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
 * whose colour sits inside the frame (the padding stays around it).
 */
function sectionRows(R, s) {
  const cardBg = R.style.cardBackground;
  const { padX, inner, gap, widths } = sectionColumnWidths(s, R.style.contentPadding);
  const boxed = s.radius > 0 || Boolean(s.borderColor);
  const image = s.bgImage || "";
  const fallback = s.background ?? cardBg;
  const outerBg = boxed && !image ? cardBg : fallback;
  const innerBg = boxed ? s.background : null;
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
  const frame = boxed
    ? ` border-collapse: separate !important; border-spacing: 0;${s.borderColor ? ` border: 1px solid ${s.borderColor};` : ""}${s.radius ? ` border-radius: ${s.radius}px; overflow: hidden;` : ""}${innerBg ? ` background-color: ${innerBg};` : ""}`
    : "";
  const columns = `
                    <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation"${s.reverse ? ' dir="rtl"' : ""}${innerBg ? ` bgcolor="${innerBg}"` : ""} style="direction: ${s.reverse ? "rtl" : "ltr"};${frame}">
                      <tr>${ordered.join(gapCell)}
                      </tr>
                    </table>`;
  const padding = padCss(s.padTop, padX, s.padBottom);
  const pad = padX > 0 ? ' class="content-pad"' : "";

  if (!image) {
    return `
                <tr>
                  <td${pad} align="left" valign="top" bgcolor="${outerBg}" style="mso-line-height-rule: exactly; padding: ${padding}; background-color: ${outerBg};">${columns}
                  </td>
                </tr>`;
  }
  // Background picture: CSS for every client, the VML rectangle for Word
  // (frame fill = cover, centred; the text box grows with its content).
  const valigns = new Set(s.columns.map((c) => c.valign));
  const valign = s.minHeight > 0 && valigns.size === 1 ? [...valigns][0] : "top";
  const innerHeight = s.minHeight > 0 ? Math.max(0, s.minHeight - s.padTop - s.padBottom) : 0;
  const src = escapeAttr(image);
  return `
                <tr>
                  <td align="left" valign="top" bgcolor="${outerBg}" background="${src}" style="mso-line-height-rule: exactly; padding: 0; background-color: ${outerBg}; background-image: url('${escapeAttr(cssUrl(image))}'); background-size: cover; background-position: center; background-repeat: no-repeat;">
                    <!--[if gte mso 9]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:${MAIL_CARD_WIDTH}px;${s.minHeight > 0 ? `height:${s.minHeight}px;` : ""}"><v:fill type="frame" src="${src}" color="${outerBg}" size="1,1" aspect="atleast" origin="0.5,0.5" position="0.5,0.5" /><v:textbox style="mso-fit-shape-to-text:true" inset="0,0,0,0"><table role="presentation" width="${MAIL_CARD_WIDTH}" cellpadding="0" cellspacing="0" border="0"><tr><td${s.minHeight > 0 ? ` height="${s.minHeight}"` : ""} valign="${valign}"${s.minHeight > 0 ? ` style="height:${s.minHeight}px;"` : ""}><![endif]-->
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
 * Render a document to the full HTML mail.
 * @param {unknown} rawDoc
 * @param {MailRenderContext} ctx
 * @returns {string}
 */
export function renderMailTemplateHtml(rawDoc, ctx) {
  const doc = normalizeMailTemplateDoc(rawDoc);
  const R = environment(doc, ctx);
  const { style, merge, en } = R;
  const top = R.top;

  const has = new Set(doc.blocks.map((b) => b.type));
  const mo = ctx.mo ?? null;
  const moHasBlocks = Boolean(mo && (mo.offerRowsHtml != null || mo.promoRowsHtml != null));
  const offerRows = mo?.offerRowsHtml ?? "";
  const promoRows = mo ? `${mo.promoRowsHtml ?? ""}${mo.ctaRowsHtml}${mo.footnoteRowHtml}${mo.postCtaRowsHtml}` : "";
  const moBody = () => row(mo?.bodyHtml ?? "", { padding: padCss(25, top.padX, 10), bgcolor: top.bg });

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
        parts.push(imageRows(R, { src, alt: b.alt, href: b.href, width: "full", placeholder: en ? "Title image" : "Titelbild" }, top));
        if (src && fromMail && h?.isAi && ctx.assets.aiLabelIconUrl) {
          const alt = en ? "AI-generated image" : "KI-generiertes Bild";
          parts.push(
            row(
              `<img src="${escapeAttr(ctx.assets.aiLabelIconUrl)}" width="73" height="14" alt="${alt}" border="0" style="width: 73px; height: 14px; display: inline-block;">`,
              { padding: padCss(6, top.padX, 0), align: "right", bgcolor: top.bg }
            )
          );
        }
        if (b.showHeadline && h?.headline) parts.push(headingRows(R, plainHeading("l", "left"), top, h.headline));
        break;
      }
      case "mo_content":
        if (!mo) break;
        if (b.showHeading && mo.heading) parts.push(headingRows(R, plainHeading("m", "center"), top, mo.heading));
        if (mo.moAvatarUrl) {
          parts.push(
            row(
              `
                    <img src="${escapeAttr(mo.moAvatarUrl)}" alt="Mo" width="64" height="64" border="0" style="width: 64px; height: 64px; display: block; Margin: 0 auto;">`,
              { padding: padCss(25, top.padX, 0), align: "center", bgcolor: top.bg }
            )
          );
        }
        parts.push(moBody());
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
    <title>${escapeHtml(merge(ctx.subject))}</title>${msoHeadHtml(mailFontMsoStack(style.fontFamily))}${webFontHead}
    <style type="text/css">
${EMAIL_SHELL_CSS}
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

function socialRow(links, align = "center") {
  const cells = (links ?? [])
    .map(
      (s) => `
                        <td align="center" valign="middle" style="mso-line-height-rule: exactly; padding: 0 6px;">
                          <a href="${escapeAttr(s.url)}" target="_blank" style="text-decoration: none;"><img src="${escapeAttr(s.icon)}" alt="${escapeAttr(s.alt)}" width="20" height="20" border="0" style="width: 20px; height: 20px; display: block; border: none; outline: none;"></a>
                        </td>`
    )
    .join("");
  return `
                    <table cellspacing="0" cellpadding="0" border="0" align="${align}" role="presentation" style="direction: ltr; ${blockMargin(align)}">
                      <tr>${cells}
                      </tr>
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
  const small = (size) => typeCss({ font: R.bodyFont, size, lineHeight: "1.5", weight: 400, color: fg });
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
                            <td align="center" style="mso-line-height-rule: exactly; padding-bottom: 12px;" valign="top">${socialRow(ctx.assets.socialLinks)}
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
  const out = [];
  for (const { block: b } of walkMailBlocks(doc)) {
    switch (b.type) {
      case "heading":
        if (b.text) out.push(merge(b.text));
        break;
      case "text":
        if (b.text) out.push(emailProseToText(merge(b.text)).replace(/^\s*•\s+/gm, "- "));
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
