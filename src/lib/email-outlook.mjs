// Outlook for Windows (the desktop app that renders with Word) — the shared
// patterns every mail design uses so classic Outlook gets a working mail, and
// the lint that keeps new markup from falling back into the old traps. Pure
// and tested (email-outlook.test.mjs); scripts/check-email-outlook.mjs runs
// the lint over every real render.
//
// Word ignores display:none on images, every @media query, padding on <a>,
// <span> and <p>, width/height on <div>, border-radius and max-width, and it
// collapses raw newlines even under white-space:pre-wrap (owner, 13.10.2026:
// „the hero section is included twice, same as the timer … most of the
// styling is not applied“). Everything here only adds conditional comments,
// mso-* properties and attributes, so Gmail, Apple Mail, Outlook for Mac and
// the new (web-based) Outlook render byte-for-byte what they rendered before.
//
// All *Html parameters must already be escaped (escapeHtml / escapeAttr from
// html-escape.ts, which escape ">" — so no value can close a conditional
// comment early).

/** Attributes for <html>: the VML and Office namespaces (VML hero, DPI block). */
export const MSO_HTML_ATTRS =
  'xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"';

/**
 * The Outlook-only head block: 96 DPI (without it, Outlook at 125/150 %
 * Windows scaling stretches CSS px but not width attributes), PNG support, no
 * table spacing, and one web-safe font for everything (Word takes the first
 * family literally — a web font or "Helvetica Neue" falls back to Times).
 *
 * `fonts`: elements set in another font than the body (a template's heading
 * font, a block's own font, the coupon code) carry a class whose rule —
 * after the `*` rule, so it wins by order and by specificity — gives Word
 * that font's Windows equivalent (msoFontClassName). A first family Office
 * installs but Windows may lack ('Arial Narrow') gets an @font-face with its
 * mso-font-alt, Word's own fallback mechanism (otherwise: Times). Without
 * `fonts` and with a core Windows font the block is exactly the classic one.
 * @param {string} fontStack  web-safe CSS font-family stack, e.g. "Arial, Helvetica, sans-serif"
 * @param {{ fonts?: ReadonlyArray<{ className: string, stack: string }> }} [opts]
 * @returns {string}
 */
export function msoHeadHtml(fontStack, opts = {}) {
  const fonts = opts.fonts ?? [];
  const faces = [...new Set([fontStack, ...fonts.map((f) => f.stack)].map(firstFontFamily))]
    .filter((family) => Object.hasOwn(WORD_FONT_ALTS, family))
    .map((family) => `\n      @font-face { font-family: '${family}'; mso-font-alt: ${WORD_FONT_ALTS[family].alt}; mso-generic-font-family: ${WORD_FONT_ALTS[family].generic}; }`)
    .join("");
  const classes = fonts.map((f) => `\n      .${f.className} { font-family: ${f.stack} !important; }`).join("");
  return `
    <!--[if mso]>
    <noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
    <style type="text/css">${faces}
      table, td, th { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
      * { font-family: ${fontStack} !important; }${classes}
    </style>
    <![endif]-->`;
}

// ── Fonts as Word sees them ─────────────────────────────────────────────────

/**
 * Fonts every Windows machine with classic Outlook has: Windows' core fonts,
 * the ClearType set (Vista / Office 2007 on) and Arial Narrow, which Office
 * installs (WORD_FONT_ALTS names its fallback). Lower case → Word's name.
 */
const WORD_FONTS = new Map(
  [
    "Arial",
    "Arial Black",
    "Arial Narrow",
    "Calibri",
    "Cambria",
    "Candara",
    "Comic Sans MS",
    "Consolas",
    "Constantia",
    "Corbel",
    "Courier New",
    "Franklin Gothic Medium",
    "Georgia",
    "Impact",
    "Lucida Console",
    "Lucida Sans Unicode",
    "Palatino Linotype",
    "Segoe UI",
    "Tahoma",
    "Times New Roman",
    "Trebuchet MS",
    "Verdana",
  ].map((f) => [f.toLowerCase(), f])
);
/** Names Windows maps onto one of its own fonts (its FontSubstitutes). */
const WORD_FONT_ALIASES = Object.freeze({ helvetica: "Arial", times: "Times New Roman", courier: "Courier New" });
/** Generic and system families: what they become depends on the client — no expectation. */
const GENERIC_FAMILY_RE = /^(?:serif|sans-serif|monospace|cursive|fantasy|math|emoji|system-ui|ui-[a-z-]+|-apple-system|blinkmacsystemfont|inherit|initial|unset)$/;
/**
 * Fonts Office installs but Windows alone may lack: Word takes the first
 * family literally, so the head declares Word's fallback (mso-font-alt).
 */
const WORD_FONT_ALTS = Object.freeze({ "Arial Narrow": { alt: "Arial", generic: "swiss" } });

/** The families of a CSS font-family value, unquoted, without !important. */
function fontFamilies(stack) {
  return String(stack ?? "")
    .replace(/!\s*important/i, "")
    .split(",")
    .map((f) => f.trim().replace(/^(["'])(.*)\1$/, "$2").trim())
    .filter(Boolean);
}

/** The first family of a CSS font-family value ("'Arial Narrow', Arial" → "Arial Narrow"). */
export function firstFontFamily(stack) {
  return fontFamilies(stack)[0] ?? "";
}

/**
 * The font a stack shows on Windows when its web font is not loaded (Gmail,
 * Outlook.com, the new Outlook — and what Word should show): its first
 * family Windows has, by Word's name ('Montserrat', Verdana → "Verdana";
 * 'Helvetica Neue', Helvetica → "Arial"). Null when a generic or system
 * family comes first (no fixed expectation) or none is known.
 * @param {string} stack
 * @returns {string | null}
 */
export function windowsFontOf(stack) {
  for (const family of fontFamilies(stack)) {
    const key = family.toLowerCase();
    if (GENERIC_FAMILY_RE.test(key)) return null;
    if (Object.hasOwn(WORD_FONT_ALIASES, key)) return WORD_FONT_ALIASES[/** @type {keyof typeof WORD_FONT_ALIASES} */ (key)];
    const known = WORD_FONTS.get(key);
    if (known) return known;
  }
  return null;
}

/** The class an element in its own font carries for Word ("mso-font-oswald"); `key`: a font key. */
export const msoFontClassName = (key) => `mso-font-${String(key).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

// ── Rounded buttons (VML) ───────────────────────────────────────────────────

/**
 * Advance widths of Arial Bold (= Liberation Sans Bold) for U+0020–U+007E in
 * 1/1000 em — the base of msoTextWidth.
 */
const ARIAL_BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584,
  584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333,
  278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556,
  500, 389, 280, 389, 584,
];
/**
 * How much wider a label is in the bold of a Word font than in Arial Bold —
 * measured on German labels (DejaVu Sans Bold for Verdana: up to 1.21) and
 * rounded up; an unknown font counts as wide.
 */
const WORD_FONT_WIDTH_SCALE = Object.freeze({
  Arial: 1,
  "Arial Narrow": 0.9,
  Impact: 0.95,
  Tahoma: 1.05,
  "Trebuchet MS": 1.1,
  "Times New Roman": 1,
  Georgia: 1.2,
  Verdana: 1.25,
});

/**
 * A generous estimate of a bold label's width in px as Word draws it in the
 * first family of `fontStack` — never narrower than the real text, so a VML
 * button sized by it holds its label on one line.
 * @param {string} text  the plain label (not escaped)
 * @param {{ fontSize: number, fontStack: string, letterSpacing?: number }} opts
 * @returns {number}
 */
export function msoTextWidth(text, { fontSize, fontStack, letterSpacing = 0 }) {
  const chars = [...String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")];
  let units = 0;
  for (const ch of chars) {
    const code = ch.codePointAt(0) ?? 0;
    units += code >= 32 && code <= 126 ? ARIAL_BOLD_WIDTHS[code - 32] : ch === "ß" ? 611 : ch === " " ? 278 : 1000;
  }
  const family = firstFontFamily(fontStack);
  const scale = WORD_FONT_WIDTH_SCALE[/** @type {keyof typeof WORD_FONT_WIDTH_SCALE} */ (family)] ?? 1.3;
  return Math.ceil((units / 1000) * fontSize * scale * 1.05 + Math.max(0, letterSpacing) * chars.length);
}

/**
 * The Word side of a rounded button: a VML roundrect — Word draws neither
 * border-radius nor an anchor's box, so a button cell is square there. Used
 * through forOutlook(msoRoundButton(...), originalButton): same URL, same
 * label, the whole shape clickable. `width` × `height` is the button's outer
 * size in a browser (border included; a stroke is drawn on the edge, so the
 * shape is that much smaller); the width must hold the label on one line
 * (msoTextWidth) — the label cannot wrap. `backdrop`: the colour behind an
 * unfilled (outline) button, its fill should Word not honour fill="f".
 * @param {{ hrefAttr: string, labelHtml: string, color: string, fill?: string | null, border?: string | null,
 *   borderPx?: number, width: number, height: number, radius: number, fontFamily: string, fontSize: number,
 *   letterSpacing?: string | null, backdrop?: string | null }} b
 * @returns {string}
 */
export function msoRoundButton(b) {
  const stroke = b.border ? Math.max(1, b.borderPx ?? 2) : 0;
  const width = Math.max(1, Math.round(b.width - stroke));
  const height = Math.max(1, Math.round(b.height - stroke));
  const arc = Math.max(0, Math.min(50, Math.round((b.radius / Math.max(1, Math.min(width, height))) * 100)));
  const strokeAttrs = stroke ? `strokecolor="${b.border}" strokeweight="${stroke}px"` : 'stroke="f"';
  const fillAttrs = b.fill ? `fillcolor="${b.fill}"` : `fill="f"${b.backdrop ? ` fillcolor="${b.backdrop}"` : ""}`;
  const type = `color:${b.color};font-family:${b.fontFamily};font-size:${b.fontSize}px;font-weight:bold;${b.letterSpacing ? `letter-spacing:${b.letterSpacing};` : ""}`;
  return `<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${b.hrefAttr}" style="height:${height}px;v-text-anchor:middle;width:${width}px;" arcsize="${arc}%" ${strokeAttrs} ${fillAttrs}><w:anchorlock/><center style="${type}">${nbsp(b.labelHtml)}</center></v:roundrect>`;
}

/** Markup only Outlook for Windows renders. */
export const outlookOnly = (html) => `<!--[if mso]>${html}<![endif]-->`;

/** Markup every client renders EXCEPT Outlook for Windows. */
export const hideFromOutlook = (html) => `<!--[if !mso]><!-->${html}<!--<![endif]-->`;

/** An Outlook twin of `html`: Outlook gets `msoHtml`, every other client `html`. */
export const forOutlook = (msoHtml, html) => outlookOnly(msoHtml) + hideFromOutlook(html);

/** Join the words of an already-escaped label so Word cannot wrap it. */
export const nbsp = (escapedText) => escapedText.replace(/ /g, "&nbsp;");

/**
 * A CSS padding shorthand plus a border width — the cell padding Word needs
 * to draw the box a browser draws from the anchor's padding and border.
 * "14px 28px" + 3 → "17px 31px".
 * @param {string} padding  1–4 px values
 * @param {number} [borderPx]
 * @returns {string}
 */
export function msoPaddingAlt(padding, borderPx = 0) {
  const parts = String(padding).trim().split(/\s+/).map((p) => parseFloat(p));
  if (parts.length < 1 || parts.length > 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`msoPaddingAlt: not a px padding: ${padding}`);
  }
  const [t, r = t, b = t, l = r] = parts;
  const add = (n) => `${n + borderPx}px`;
  return [add(t), add(r), add(b), add(l)].join(" ");
}

/**
 * The Word side of a button: a table cell carries background, border and
 * padding (the one place Word applies them); the anchor inside carries only
 * the text. Used through forOutlook(msoButton(...), originalAnchor) so every
 * other client keeps the original anchor. Square corners in Outlook; only
 * the label is clickable there. `align` is "center" or nothing — Word floats
 * a table aligned left or right.
 * @param {{ hrefAttr: string, labelHtml: string, color: string, bg?: string | null,
 *   border?: string | null, padding: string, fontSize: number, lineHeight: number,
 *   letterSpacing?: string | null, fullWidth?: boolean, align?: "center" | null,
 *   nowrap?: boolean, fontFamily?: string }} b
 * @returns {string}
 */
export function msoButton(b) {
  const font = b.fontFamily ?? "Arial, Helvetica, sans-serif";
  const label = b.nowrap ? nbsp(b.labelHtml) : b.labelHtml;
  const tableAttrs = `${b.fullWidth ? ' width="100%"' : ""}${b.align === "center" ? ' align="center"' : ""}`;
  const cellAttrs = `${b.bg ? ` bgcolor="${b.bg}"` : ""}${b.nowrap ? " nowrap" : ""}`;
  const cellStyle = [
    `padding:${b.padding};`,
    b.border ? ` border:${b.border};` : "",
    b.bg ? ` background:${b.bg};` : "",
    ` mso-line-height-rule:exactly; line-height:${b.lineHeight}px;`,
  ].join("");
  const linkStyle = `color:${b.color}; font-family:${font}; font-size:${b.fontSize}px; font-weight:bold;${b.letterSpacing ? ` letter-spacing:${b.letterSpacing};` : ""} text-decoration:none;`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"${tableAttrs}><tr><td align="center"${cellAttrs} style="${cellStyle}"><a href="${b.hrefAttr}" target="_blank" style="${linkStyle}"><span style="color:${b.color};">${label}</span></a></td></tr></table>`;
}

/**
 * A small coloured rule (the 14×2 px blue stroke under card titles) as Word
 * draws it: a sized, coloured table cell inside a padded one. The browser
 * version is a sized <div>, whose width and height Word ignores.
 * @param {{ width?: number, height?: number, color: string, padTop?: number, padBottom?: number }} r
 * @returns {string}
 */
export function msoRule({ width = 14, height = 2, color, padTop = 0, padBottom = 0 }) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:${padTop}px 0 ${padBottom}px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="${width}" height="${height}" bgcolor="${color}" style="width:${width}px; height:${height}px; font-size:1px; line-height:${height}px; mso-line-height-rule:exactly;">&nbsp;</td></tr></table></td></tr></table>`;
}

// ── The lint ────────────────────────────────────────────────────────────────

/** Gmail clips a mail above 102 KB (the unsubscribe footer would vanish). */
export const MAIL_SIZE_BUDGET_BYTES = 90 * 1024;

const TOKEN_RE = /<!--[\s\S]*?-->|<\/?[a-zA-Z][a-zA-Z0-9:-]*\b[^>]*>/g;
const NOT_MSO_OPEN = "<!--[if !mso]><!-->";
const NOT_MSO_CLOSE = "<!--<![endif]-->";

const attrOf = (tag, name) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4] ?? "") : null;
};
const styleOf = (tag) => (attrOf(tag, "style") ?? "").toLowerCase();
const tagName = (tag) => (/^<\/?([a-zA-Z][a-zA-Z0-9:-]*)/.exec(tag)?.[1] ?? "").toLowerCase();
const hasDecl = (style, prop, valueRe = /.*/) => {
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]*)`, "gi");
  let m;
  while ((m = re.exec(style))) if (valueRe.test(m[1].trim())) return true;
  return false;
};
const NONZERO = /^(?!0(px)?(\s+0(px)?)*\s*(!important)?$).+/;
const excerpt = (s) => s.replace(/\s+/g, " ").slice(0, 140);
const hrefs = (html) => Array.from(html.matchAll(/\shref\s*=\s*"([^"]*)"/gi), (m) => m[1]).sort();
/** The (last) value of a declaration in a lower-cased style, or null. */
const declValue = (style, prop) => {
  let value = null;
  for (const m of style.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]*)`, "gi"))) value = m[1].replace(/!\s*important/, "").trim();
  return value;
};
/** A non-zero length of a margin ("0", "0px" and "auto" are none). */
const isSpace = (v) => Boolean(v) && !/^(?:0(?:px|pt|em|%)?|auto)$/.test(v);
/** Does a lower-cased style give the element a vertical margin? */
function verticalMargin(style) {
  const shorthand = declValue(style, "margin");
  if (shorthand) {
    const [t, , b = t] = shorthand.split(/\s+/);
    if (isSpace(t) || isSpace(b)) return true;
  }
  return isSpace(declValue(style, "margin-top") ?? "") || isSpace(declValue(style, "margin-bottom") ?? "");
}
/** Word's name of a font family it has ("helvetica" → "Arial"), or null. */
const wordFontName = (family) => {
  const key = String(family ?? "").toLowerCase();
  return WORD_FONTS.get(key) ?? (Object.hasOwn(WORD_FONT_ALIASES, key) ? WORD_FONT_ALIASES[/** @type {keyof typeof WORD_FONT_ALIASES} */ (key)] : null);
};

/**
 * The font rules of the Outlook-only head blocks (msoHeadHtml): the family of
 * the `*` rule (every element), of each mso font class, and the families an
 * @font-face gives an mso-font-alt.
 * @param {string} html
 */
function msoHeadFonts(html) {
  /** @type {{ body: { family: string, rule: string } | null, classes: Map<string, { family: string, rule: string }>, alts: Set<string> }} */
  const out = { body: null, classes: new Map(), alts: new Set() };
  for (const m of html.matchAll(/<!--\[if\s+(?:gte?\s+|lte?\s+)?mso\b[^\]]*\]>([\s\S]*?)<!\[endif\]-->/gi)) {
    for (const s of m[1].matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
      for (const r of s[1].matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = r[1].trim();
        const family = /(?:^|;)\s*font-family\s*:\s*([^;]*)/i.exec(r[2])?.[1] ?? null;
        if (!family) continue;
        if (selector === "@font-face") {
          if (/(?:^|;)\s*mso-font-alt\s*:/i.test(r[2])) out.alts.add(firstFontFamily(family).toLowerCase());
          continue;
        }
        if (selector === "*") out.body = { family: firstFontFamily(family), rule: r[0] };
        const cls = /^\.(mso-font-[a-z0-9-]+)$/i.exec(selector)?.[1];
        if (cls) out.classes.set(cls.toLowerCase(), { family: firstFontFamily(family), rule: r[0] });
      }
    }
  }
  return out;
}

/**
 * Lint rendered mail HTML for the Word-engine traps. Returns findings; an
 * empty list means the mail follows the rules in docs/EMAIL_DESIGNS.md.
 *
 * `strict` adds the rules the template renderer (mail-template-render.mjs)
 * meets and the composers' own pieces do not yet: every element shows in
 * Word the Windows font it shows everywhere else without the web font
 * (font-word), and a relative line height under mso-line-height-rule:exactly
 * comes with its px value for Word (line-height-word).
 * @param {string} html
 * @param {{ maxImageWidth?: number, sizeBudgetBytes?: number, strict?: boolean }} [opts]
 * @returns {Array<{ rule: string, message: string, excerpt: string }>}
 */
export function lintOutlookHtml(html, opts = {}) {
  /** @type {Array<{ rule: string, message: string, excerpt: string }>} */
  const findings = [];
  const add = (rule, message, at) => findings.push({ rule, message, excerpt: excerpt(at) });
  const budget = opts.sizeBudgetBytes ?? MAIL_SIZE_BUDGET_BYTES;
  const bytes = new TextEncoder().encode(html).length;
  if (bytes > budget) add("size", `${bytes} bytes — over the ${budget}-byte budget (Gmail clips at 102 KB)`, html.slice(0, 60));

  // Head: a full document needs the namespaces and the 96-DPI block.
  const htmlTag = /<html\b[^>]*>/i.exec(html)?.[0];
  if (htmlTag) {
    if (!/xmlns:v=/i.test(htmlTag) || !/xmlns:o=/i.test(htmlTag)) add("head-namespaces", "<html> lacks xmlns:v / xmlns:o (use MSO_HTML_ATTRS)", htmlTag);
    if (!/<o:PixelsPerInch>\s*96\s*<\/o:PixelsPerInch>/i.test(html)) add("head-dpi", "no <o:PixelsPerInch>96 block (use msoHeadHtml)", htmlTag);
  }

  // Fonts of the Outlook head: Word takes the first family literally — one
  // it lacks is Times New Roman, an Office font needs its mso-font-alt.
  const head = msoHeadFonts(html);
  for (const r of [head.body, ...head.classes.values()]) {
    if (!r) continue;
    const name = wordFontName(r.family);
    if (!name) add("font-word-unsafe", `Word has no font "${r.family}" and shows Times New Roman — start the stack with a Windows font`, r.rule);
    else if (Object.hasOwn(WORD_FONT_ALTS, name) && !head.alts.has(name.toLowerCase())) add("font-word-alt", `"${name}" comes with Office, not with Windows — declare its mso-font-alt (@font-face, msoHeadHtml) or Word may show Times New Roman`, r.rule);
  }

  let notMso = 0;
  /** @type {string | null} the mso block just closed, for the twin check */
  let lastMsoBlock = null;
  let lastTokenEnd = 0;
  let lastTd = null;
  let twinStart = null;
  /** the innermost white-space:pre* element: its tag, name and same-name depth */
  /** @type {Array<{ tag: string, name: string, depth: number }>} */
  const preStack = [];
  for (const m of html.matchAll(TOKEN_RE)) {
    const tok = m[0];
    const between = html.slice(lastTokenEnd, m.index);
    lastTokenEnd = m.index + tok.length;
    if (between.trim()) lastMsoBlock = null;
    // A raw newline BETWEEN words of a pre-wrap element collapses in Word.
    if (preStack.length && /\S[^\S\r\n]*[\r\n]\s*\S/.test(between)) {
      add("raw-newline", "raw newline inside a white-space:pre* element — Word collapses it (use <br>)", preStack[preStack.length - 1].tag + between);
    }
    if (tok.startsWith("<!--")) {
      if (tok === NOT_MSO_OPEN) {
        if (notMso) add("conditional-nesting", "nested <!--[if !mso]> block", tok);
        notMso++;
        twinStart = lastMsoBlock;
        lastMsoBlock = null;
        continue;
      }
      if (tok === NOT_MSO_CLOSE) {
        if (!notMso) add("conditional-syntax", "<!--<![endif]--> without an open <!--[if !mso]><!-->", tok);
        notMso = Math.max(0, notMso - 1);
        // Only an Outlook block with links is a button/link twin (a head
        // <style> block followed by the hidden web-font link is not).
        if (twinStart !== null && hrefs(twinStart).length) {
          const nonMso = html.slice(html.lastIndexOf(NOT_MSO_OPEN, m.index) + NOT_MSO_OPEN.length, m.index);
          if (hrefs(twinStart).join(" ") !== hrefs(nonMso).join(" ")) add("twin-links", "the Outlook twin and the original link to different URLs", twinStart);
          twinStart = null;
        }
        continue;
      }
      if (/^<!--\[if\s+!mso/i.test(tok)) {
        add("conditional-syntax", "use the downlevel-revealed form <!--[if !mso]><!-->…<!--<![endif]-->", tok);
        continue;
      }
      if (/^<!--\[if\b/i.test(tok)) {
        if (!/<!\[endif\]-->$/.test(tok)) add("conditional-syntax", "conditional block not closed by <![endif]--> (a '-->' inside it?)", tok);
        const body = tok.replace(/^<!--\[if[^\]]*\]>/i, "").replace(/<!\[endif\]-->$/, "");
        if (/<!--\[if/i.test(body)) add("conditional-nesting", "nested conditional comment", tok);
        for (const t of body.match(/<table\b[^>]*>/gi) ?? []) {
          const align = attrOf(t, "align");
          if (align && /^(left|right)$/i.test(align)) add("mso-table-align", "Word floats a table aligned left/right — use center or none", t);
        }
        if (/<v:fill\b[^>]*type="frame"/i.test(body) && !/<v:fill\b[^>]*aspect=/i.test(body)) add("vml-fill-aspect", "v:fill type=frame without aspect= stretches the image", tok);
        if (/<v:textbox\b/i.test(body) && !/<v:textbox\b[^>]*mso-fit-shape-to-text/i.test(body)) add("vml-textbox-fit", "v:textbox without mso-fit-shape-to-text clips taller content", tok);
        // A VML button: clickable, sized in px, rounded by arcsize, its namespaces declared.
        for (const t of body.match(/<v:roundrect\b[^>]*>/gi) ?? []) {
          const s = (attrOf(t, "style") ?? "").toLowerCase();
          if (!attrOf(t, "href")) add("vml-roundrect", "a VML button without href — not clickable in Outlook", t);
          if (!/(?:^|;)\s*width\s*:\s*\d+px/.test(s) || !/(?:^|;)\s*height\s*:\s*\d+px/.test(s)) add("vml-roundrect", "a VML button needs a px width and height in its style", t);
          if (!/^\d+%$/.test(attrOf(t, "arcsize") ?? "")) add("vml-roundrect", "a VML button needs arcsize=\"N%\" (radius ÷ shorter side)", t);
          if (!/xmlns:v=/i.test(t) && !/xmlns:v=/i.test(htmlTag ?? "")) add("vml-roundrect", "v:roundrect without the xmlns:v namespace", t);
        }
        if (/<v:roundrect\b/i.test(body) && (body.match(/<v:roundrect\b/gi) ?? []).length !== (body.match(/<\/v:roundrect>/gi) ?? []).length) add("vml-roundrect", "v:roundrect not closed in the same conditional block", tok);
        if (/<w:anchorlock\b/i.test(body) && !/xmlns:w=/i.test(body) && !/xmlns:w=/i.test(htmlTag ?? "")) add("vml-roundrect", "<w:anchorlock/> without the xmlns:w namespace", tok);
        lastMsoBlock = tok;
        continue;
      }
      continue; // a plain comment
    }
    const name = tagName(tok);
    const closing = tok.startsWith("</");
    lastMsoBlock = null; // a twin's original must follow its Outlook block directly
    const top = preStack[preStack.length - 1];
    if (closing) {
      if (top && name === top.name && --top.depth === 0) preStack.pop();
      if (name === "td") lastTd = null;
      continue;
    }
    if (name === "td" || name === "th") lastTd = tok;
    const style = styleOf(tok);
    if (name !== "pre" && hasDecl(style, "white-space", /^pre/)) preStack.push({ tag: tok, name, depth: 1 });
    else if (top && name === top.name && !/\/>$/.test(tok)) top.depth++;
    if (notMso) continue; // Outlook never sees it

    if (hasDecl(style, "display", /^none/)) {
      if (name === "img") add("hidden-img", "an <img> hidden by display:none shows in Outlook — wrap it in hideFromOutlook()", tok);
      else if (!/mso-hide\s*:\s*all/.test(style)) add("hidden-element", "display:none without mso-hide:all (or hideFromOutlook) shows in Outlook", tok);
    }
    if (name === "a" && (hasDecl(style, "padding", NONZERO) || hasDecl(style, "padding-(?:top|right|bottom|left)", NONZERO))) {
      if (!lastTd || !/mso-padding-alt/.test(styleOf(lastTd))) add("padded-link", "a padded <a> button collapses in Outlook — give its cell mso-padding-alt or use forOutlook(msoButton(...))", tok);
    }
    if ((name === "p" || name === "span") && (hasDecl(style, "padding", NONZERO) || hasDecl(style, "padding-(?:top|right|bottom|left)", NONZERO))) {
      add(`padded-${name}`, `Word ignores padding on <${name}> — use margin (p) or a table cell`, tok);
    }
    if (name === "div" && hasDecl(style, "background(?:-color)?") && (hasDecl(style, "width") || hasDecl(style, "height"))) {
      add("drawn-div", "a sized, coloured <div> (rule/shape) — Word ignores its size; add an msoRule twin", tok);
    }
    if (name === "div" && hasDecl(style, "height", /^\d+px/) && !/mso-line-height-rule\s*:\s*exactly/.test(style)) {
      add("spacer-div", "a <div> spacer needs line-height = height and mso-line-height-rule:exactly", tok);
    }
    if (name === "table" && verticalMargin(style)) {
      add("table-margin", "Word drops a table's margin — put the space in a cell's padding or a spacer row", tok);
    }
    // Fonts: an element in its own font carries a class the Outlook head defines.
    const fontClass = (attrOf(tok, "class") ?? "").toLowerCase().split(/\s+/).find((c) => c.startsWith("mso-font-")) ?? null;
    if (fontClass && !head.classes.has(fontClass)) add("font-word-class", `class ${fontClass} has no rule in the Outlook head (msoHeadHtml fonts)`, tok);
    if (opts.strict && head.body) {
      const stack = declValue(style, "font-family");
      const expected = stack ? windowsFontOf(stack) : null;
      const actual = wordFontName((fontClass && head.classes.get(fontClass)?.family) || head.body.family);
      if (expected && actual && expected !== actual) {
        add("font-word", `Word shows ${actual} where every other client without the web font shows ${expected} — give the element its mso font class`, tok);
      }
    }
    if (opts.strict && hasDecl(style, "mso-line-height-rule", /^exactly/)) {
      const lh = declValue(style, "line-height") ?? "";
      if (/^(?:\d*\.)?\d+(?:%|em|rem)?$/.test(lh) && Number.parseFloat(lh) > 0 && !hasDecl(style, "mso-line-height-alt")) {
        add("line-height-word", `line-height: ${lh} is relative — Word needs its px value under mso-line-height-rule:exactly (mso-line-height-alt)`, tok);
      }
    }
    if (name === "img") {
      const w = attrOf(tok, "width");
      if (!w || !/^\d+$/.test(w)) add("img-width", "<img> without a numeric width attribute — Word renders it at its natural size", tok);
      else if (opts.maxImageWidth && Number(w) > opts.maxImageWidth) add("img-width", `width="${w}" is wider than the ${opts.maxImageWidth}px content area — Word uses the attribute`, tok);
    }
    if (name === "link" && /fonts\.googleapis\.com/i.test(attrOf(tok, "href") ?? "")) add("web-font", "a web-font <link> outside hideFromOutlook() — Outlook falls back to Times", tok);
    if (name === "style") {
      const end = html.indexOf("</style>", m.index);
      const css = html.slice(m.index, end > 0 ? end : undefined);
      if (/@import|@font-face/i.test(css)) add("web-font", "@import / @font-face outside hideFromOutlook() — Outlook falls back to Times", tok + css.slice(tok.length, tok.length + 80));
    }
  }
  if (notMso) add("conditional-syntax", "<!--[if !mso]><!--> never closed", html.slice(-80));
  return findings;
}
