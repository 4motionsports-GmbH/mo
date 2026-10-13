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
 * @param {string} fontStack  web-safe CSS font-family stack, e.g. "Arial, Helvetica, sans-serif"
 * @returns {string}
 */
export function msoHeadHtml(fontStack) {
  return `
    <!--[if mso]>
    <noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
    <style type="text/css">
      table, td, th { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
      * { font-family: ${fontStack} !important; }
    </style>
    <![endif]-->`;
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

/**
 * Lint rendered mail HTML for the Word-engine traps. Returns findings; an
 * empty list means the mail follows the rules in docs/EMAIL_DESIGNS.md.
 * @param {string} html
 * @param {{ maxImageWidth?: number, sizeBudgetBytes?: number }} [opts]
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
