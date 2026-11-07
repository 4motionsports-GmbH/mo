// E-mail templates („Vorlagen“) — the renderer: a block document
// (mail-template-doc.mjs) → e-mail HTML and the plain-text part. Pure and
// tested (mail-template-render.test.mjs); docs/EMAIL_TEMPLATES.md.
//
// The output follows every rule of docs/EMAIL_DESIGNS.md: a 600 px table
// card, role="presentation" + bgcolor attributes, every style inline, images
// with numeric width attributes, buttons with their padding on the cell
// (mso-padding-alt), the Outlook head block, the shared shell CSS. The test
// runs lintOutlookHtml (email-outlook.mjs) over real renders.
//
// What needs I/O or the active design context comes in pre-rendered through
// the context — the TypeScript layer (mail-template-design.ts,
// mailing-render.ts) builds it:
//   * `slots[blockId]`: the product rows/grid of a `products` block and the
//     live countdown of a `countdown` block (both through the classic
//     renderers, inside the template's theme tokens);
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
import { MSO_HTML_ATTRS, msoHeadHtml, msoPaddingAlt } from "./email-outlook.mjs";
import { buttonRadiusFor, fontNeedsWebFont, fontStackFor, msoFontStackFor } from "./email-theme.mjs";
import { emailProseToText, renderEmailProseHtml } from "./email-prose.mjs";
import { discountRedeemUrl } from "./discount-coupon.mjs";
import { MO_BLOCK_TYPES, normalizeMailTemplateDoc } from "./mail-template-doc.mjs";

/** Card width and the content width inside the 60 px side padding. */
/**
 * Marks where the fixed legal footer starts in the rendered HTML — the checks
 * (mailing-checks.mjs) only judge what the operator wrote, not the mandatory
 * „jederzeit kostenlos abmelden“ notice.
 */
export const MAIL_FOOTER_MARKER = "<!-- mo:footer -->";

export const MAIL_CARD_WIDTH = 600;
export const MAIL_CONTENT_WIDTH = 480;

// Same rules as html-escape.ts (escapeHtml: & < >; escapeAttr: + ").
const escapeHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s) => escapeHtml(s).replace(/"/g, "&quot;");

const HEADING_PX = { s: 16, m: 20, l: 26, xl: 34 };
const TEXT_PX = { s: 12, m: 14, l: 16 };

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
 *   slots?: Record<string, { html: string, text: string } | undefined>,
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
 * and script/data URLs. A fence, not a full sanitizer: the block is written
 * by the operator in the admin (trusted), and every admin preview is a
 * sandboxed iframe.
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

/** A row of the card: <tr><td …>inner</td></tr>. */
function row(inner, { padding = "10px 60px", align = "left", bgcolor = "#ffffff", pad = true } = {}) {
  return `
                <tr>
                  <td${pad ? ' class="content-pad"' : ""} align="${align}" bgcolor="${bgcolor}" style="mso-line-height-rule: exactly; padding: ${padding};" valign="top">${inner}
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
  const style = doc.style;
  const font = fontStackFor(style.fontFamily);
  const locale = ctx.locale === "en" ? "en" : "de";
  const merge = ctx.merge ?? ((t) => t);
  const radius = buttonRadiusFor(style.buttonShape);
  const textStyle = (px, colorHex) =>
    `mso-line-height-rule: exactly; direction: ltr; font-family: ${font}; font-size: ${px}px; line-height: 1.5; font-weight: 400; color: ${colorHex}; Margin: 0;`;
  const linkStyle = `color: ${style.accentColor}; text-decoration: underline; word-wrap: break-word;`;

  const has = new Set(doc.blocks.map((b) => b.type));
  const mo = ctx.mo ?? null;
  const moHasBlocks = Boolean(mo && (mo.offerRowsHtml != null || mo.promoRowsHtml != null));
  const offerRows = mo?.offerRowsHtml ?? "";
  const promoRows = mo ? `${mo.promoRowsHtml ?? ""}${mo.ctaRowsHtml}${mo.footnoteRowHtml}${mo.postCtaRowsHtml}` : "";

  /** Everything of the composer that the template does not place itself. */
  const moTail = () => {
    if (!mo) return "";
    if (!moHasBlocks) return `${mo.preCtaRowsHtml}${mo.ctaRowsHtml}${mo.footnoteRowHtml}${mo.postCtaRowsHtml}`;
    return `${has.has("mo_offer") ? "" : offerRows}${has.has("mo_promo") ? "" : promoRows}`;
  };

  const heading = (text, size, align, colorHex, background) => {
    const px = HEADING_PX[size] ?? HEADING_PX.l;
    const lineHeight = Math.round(px * 1.25);
    const inner = `
                    <p style="mso-line-height-rule: exactly; direction: ltr; font-family: ${font}; font-size: ${px}px; line-height: ${lineHeight}px; font-weight: 700; color: ${colorHex}; Margin: 0;" align="${align}">${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
    return row(inner, { padding: background ? "26px 60px" : "24px 60px 8px", align, bgcolor: background ?? "#ffffff" });
  };

  const button = (b) => {
    const bg = b.color ?? style.accentColor;
    const fg = b.textColor ?? style.buttonTextColor;
    const padding = "14px 28px";
    const tableAttrs = b.fullWidth ? ' width="100%"' : b.align === "center" ? ' align="center"' : ` align="${b.align}"`;
    const label = merge(b.label);
    return row(
      `
                    <table cellspacing="0" cellpadding="0" border="0"${tableAttrs} role="presentation" style="direction: ltr; border-spacing: 0 !important; border-collapse: collapse !important;">
                      <tr>
                        <td align="center" bgcolor="${bg}" style="mso-line-height-rule: exactly; mso-padding-alt: ${msoPaddingAlt(padding, 2)}; border-radius: ${radius};" valign="top">
                          <a href="${escapeAttr(b.href)}" target="_blank" style="font-size: 14px; line-height: 18px; color: ${fg}; text-decoration: none; border-radius: ${radius}; background-color: ${bg}; display: block; font-family: ${font}; font-weight: 700; text-align: center; letter-spacing: 0.5px; word-break: break-word; padding: ${padding}; border: 2px solid ${bg}; mso-padding-alt: 0;"><span style="color: ${fg};">${escapeHtml(label)}</span></a>
                        </td>
                      </tr>
                    </table>`,
      { padding: "12px 60px", align: b.align }
    );
  };

  const image = (src, alt, href, width, placeholderLabel) => {
    const full = width === "full";
    const w = full ? MAIL_CARD_WIDTH : MAIL_CONTENT_WIDTH;
    if (!src) {
      if (!ctx.previewPlaceholders) return "";
      return row(
        `
                    <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation"><tr><td align="center" bgcolor="#eeeeee" height="160" style="mso-line-height-rule: exactly; height: 160px; font-family: ${font}; font-size: 13px; color: #777777;">${escapeHtml(placeholderLabel)}</td></tr></table>`,
        { padding: full ? "0" : "10px 60px", align: "center", pad: !full }
      );
    }
    const img = `<img src="${escapeAttr(src)}" width="${w}" alt="${escapeAttr(alt)}" border="0" style="width: 100%; max-width: ${w}px; height: auto; display: block; Margin: 0 auto;">`;
    const linked = href ? `<a href="${escapeAttr(href)}" target="_blank" style="text-decoration: none;">${img}</a>` : img;
    return row(`
                    ${linked}`, { padding: full ? "0" : "10px 60px", align: "center", pad: !full });
  };

  const paragraphs = (text, align, px, colorHex) => {
    const chunks = merge(text).split(/\n\s*\n/).map((c) => c.trim()).filter(Boolean);
    return chunks
      .map((chunk, i) => {
        const margin = i === chunks.length - 1 ? "Margin: 0;" : "Margin: 0 0 12px;";
        const lines = chunk.split("\n");
        if (lines.every((l) => /^\s*[-•]\s+/.test(l))) {
          const items = lines
            .map(
              (l) => `
                      <tr>
                        <td valign="top" width="18" style="mso-line-height-rule: exactly; ${textStyle(px, colorHex)}">&#8226;</td>
                        <td valign="top" style="mso-line-height-rule: exactly; ${textStyle(px, colorHex)}">${renderEmailProseHtml(l.replace(/^\s*[-•]\s+/, ""), { linkStyle })}</td>
                      </tr>`
            )
            .join("");
          return `
                    <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" style="direction: ltr;${i === chunks.length - 1 ? "" : " Margin: 0 0 12px;"}">${items}
                    </table>`;
        }
        return `
                    <p style="${textStyle(px, colorHex).replace("Margin: 0;", margin)}" align="${align}">${renderEmailProseHtml(chunk, { linkStyle })}</p>`;
      })
      .join("");
  };

  const parts = [];
  for (const b of doc.blocks) {
    switch (b.type) {
      case "logo":
        parts.push(`
                <tr>
                  <td class="content-pad" align="${b.align}" bgcolor="#ffffff" style="mso-line-height-rule: exactly; padding: 30px 60px 20px;">
                    <a href="${escapeAttr(ctx.assets.shopUrl)}" target="_blank" style="text-decoration: none !important;">
                      <img src="${escapeAttr(style.logoUrl ?? ctx.assets.logoUrl)}" alt="motion sports" width="${b.width}" border="0" style="width: ${b.width}px; height: auto !important; max-width: 100%; display: block;${b.align === "center" ? " Margin: 0 auto;" : ""}">
                    </a>
                  </td>
                </tr>`);
        break;
      case "heading":
        if (b.text) parts.push(heading(merge(b.text), b.size, b.align, b.color ?? style.headingColor, b.background));
        break;
      case "text":
        if (b.text) {
          parts.push(
            row(paragraphs(b.text, b.align, TEXT_PX[b.size] ?? TEXT_PX.m, b.color ?? style.textColor), {
              padding: b.background ? "20px 60px" : "10px 60px",
              align: b.align,
              bgcolor: b.background ?? "#ffffff",
            })
          );
        }
        break;
      case "greeting":
        parts.push(
          row(
            `
                    <p style="${textStyle(TEXT_PX.m, style.textColor)}" align="${b.align}">${escapeHtml(greetingText(b, ctx, merge))}</p>`,
            { padding: "20px 60px 4px", align: b.align }
          )
        );
        break;
      case "image":
        parts.push(image(b.src, b.alt, b.href, b.width, locale === "en" ? "Image missing" : "Bild fehlt"));
        break;
      case "button":
        if (b.label && b.href) parts.push(button(b));
        break;
      case "products":
      case "countdown": {
        const slot = ctx.slots?.[b.id];
        const title = b.type === "products" ? b.title : b.heading;
        if (slot?.html) {
          if (title) parts.push(heading(merge(title), "m", "center", style.headingColor, null));
          parts.push(slot.html);
        } else if (ctx.previewPlaceholders) {
          parts.push(
            row(
              `
                    <p style="${textStyle(TEXT_PX.s, "#777777")}" align="center">${escapeHtml(
                      b.type === "products"
                        ? locale === "en" ? "Products appear here." : "Hier erscheinen die gewählten Produkte."
                        : locale === "en" ? "The countdown appears here." : "Hier erscheint der Countdown."
                    )}</p>`,
              { padding: "14px 60px", align: "center" }
            )
          );
        }
        break;
      }
      case "coupon": {
        if (!b.code) break;
        const redeem = discountRedeemUrl(b.code);
        const en = locale === "en";
        parts.push(
          row(
            `
                    <table cellspacing="0" cellpadding="0" border="0" align="center" role="presentation" style="direction: ltr; Margin: 0 auto; border: 2px dashed ${style.accentColor === "#ffffff" ? "#111111" : style.accentColor}; border-radius: 8px;">
                      <tr>
                        <td align="center" style="mso-line-height-rule: exactly; padding: 16px 28px;">
                          <p style="${textStyle(TEXT_PX.s, style.textColor)} text-transform: uppercase; letter-spacing: 1px;" align="center">${en ? "Your code" : "Dein Code"}</p>
                          <p style="mso-line-height-rule: exactly; font-family: ${font}; font-size: 24px; line-height: 30px; font-weight: 700; letter-spacing: 2px; color: #111111; Margin: 4px 0 6px;" align="center">${escapeHtml(b.code)}</p>${
                            b.headline
                              ? `
                          <p style="${textStyle(TEXT_PX.m, style.textColor)} font-weight: 700;" align="center">${escapeHtml(merge(b.headline))}</p>`
                              : ""
                          }${
                            b.terms
                              ? `
                          <p style="${textStyle(TEXT_PX.s, "#555555")}" align="center">${escapeHtml(b.terms)}</p>`
                              : ""
                          }
                          <p style="${textStyle(TEXT_PX.m, style.textColor)} Margin-top: 8px;" align="center"><a href="${escapeAttr(redeem ?? ctx.assets.shopUrl)}" target="_blank" style="${linkStyle} font-weight: 700;">${en ? "Redeem code" : "Code einlösen"} &#8594;</a></p>
                        </td>
                      </tr>
                    </table>`,
            { padding: "14px 60px", align: "center" }
          )
        );
        break;
      }
      case "divider":
        parts.push(
          row(
            `
                    <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" style="border-top: 1px solid ${b.color ?? "#e0e0e0"}; border-spacing: 0 !important; border-collapse: collapse !important;"><tr><td style="font-size: 0; line-height: 0; mso-line-height-rule: exactly; mso-line-height-alt: 1px;">&nbsp;</td></tr></table>`,
            { padding: "14px 60px" }
          )
        );
        break;
      case "spacer":
        parts.push(`
                <tr>
                  <td height="${b.height}" bgcolor="#ffffff" style="mso-line-height-rule: exactly; font-size: 0; line-height: ${b.height}px;">&nbsp;</td>
                </tr>`);
        break;
      case "social":
        parts.push(row(socialRow(ctx.assets.socialLinks), { padding: "14px 60px", align: "center" }));
        break;
      case "html": {
        const clean = sanitizeCustomHtml(b.html);
        if (clean) parts.push(row(`\n${clean}`, { padding: "0", align: "center", pad: false }));
        break;
      }
      case "hero": {
        const h = ctx.hero ?? null;
        const src = h?.mobileUrl || h?.imageUrl || b.src;
        const fromMail = Boolean(h?.mobileUrl || h?.imageUrl);
        parts.push(image(src, b.alt, b.href, "full", locale === "en" ? "Title image" : "Titelbild"));
        if (src && fromMail && h?.isAi && ctx.assets.aiLabelIconUrl) {
          const alt = locale === "en" ? "AI-generated image" : "KI-generiertes Bild";
          parts.push(
            row(
              `<img src="${escapeAttr(ctx.assets.aiLabelIconUrl)}" width="73" height="14" alt="${alt}" border="0" style="width: 73px; height: 14px; display: inline-block;">`,
              { padding: "6px 60px 0", align: "right" }
            )
          );
        }
        if (b.showHeadline && h?.headline) parts.push(heading(h.headline, "l", "left", style.headingColor, null));
        break;
      }
      case "mo_content":
        if (!mo) break;
        if (b.showHeading && mo.heading) parts.push(heading(mo.heading, "m", "center", style.headingColor, null));
        if (mo.moAvatarUrl) {
          parts.push(
            row(
              `
                    <img src="${escapeAttr(mo.moAvatarUrl)}" alt="Mo" width="64" height="64" border="0" style="width: 64px; height: 64px; display: block; Margin: 0 auto;">`,
              { padding: "25px 60px 0", align: "center" }
            )
          );
        }
        parts.push(row(mo.bodyHtml, { padding: "25px 60px 10px" }));
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
        if (mo && !has.has("mo_content")) {
          parts.push(row(mo.bodyHtml, { padding: "25px 60px 10px" }), moTail());
        }
        parts.push(footerRows(b, ctx, font, locale));
        break;
      default:
        break;
    }
  }

  const outerBg = style.outerBackground;
  const webFontHead = fontNeedsWebFont(style.fontFamily)
    ? `
    <!--[if !mso]><!-->
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&amp;display=swap" rel="stylesheet" type="text/css">
    <style type="text/css">
      @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&display=swap');
    </style>
    <!--<![endif]-->`
    : "";
  const preheaderHtml = ctx.preheader
    ? `
  <div style="display: none; overflow: hidden; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; mso-hide: all;">${escapeHtml(ctx.preheader)}</div>
  <div style="display: none; overflow: hidden; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; mso-hide: all;">${"&#847;&#8204;&nbsp;".repeat(20)}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="${locale}" ${MSO_HTML_ATTRS}>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="x-apple-disable-message-reformatting">
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light only">
    <title>${escapeHtml(merge(ctx.subject))}</title>${msoHeadHtml(msoFontStackFor(style.fontFamily))}${webFontHead}
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
            <table border="0" width="${MAIL_CARD_WIDTH}" cellpadding="0" cellspacing="0" align="center" style="width: ${MAIL_CARD_WIDTH}px; max-width: ${MAIL_CARD_WIDTH}px; direction: ltr; Margin: 0 auto; table-layout: fixed;" class="email-container" role="presentation" bgcolor="#ffffff">
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

function socialRow(links) {
  const cells = (links ?? [])
    .map(
      (s) => `
                        <td align="center" valign="middle" style="mso-line-height-rule: exactly; padding: 0 6px;">
                          <a href="${escapeAttr(s.url)}" target="_blank" style="text-decoration: none;"><img src="${escapeAttr(s.icon)}" alt="${escapeAttr(s.alt)}" width="20" height="20" border="0" style="width: 20px; height: 20px; display: block; border: none; outline: none;"></a>
                        </td>`
    )
    .join("");
  return `
                    <table cellspacing="0" cellpadding="0" border="0" align="center" role="presentation" style="direction: ltr; Margin: 0 auto;">
                      <tr>${cells}
                      </tr>
                    </table>`;
}

function footerRows(b, ctx, font, locale) {
  const en = locale === "en";
  const small = (px) => `mso-line-height-rule: exactly; direction: ltr; font-family: ${font}; font-size: ${px}px; line-height: 1.5; font-weight: 400; color: #000000; Margin: 0;`;
  const company = (ctx.companyLines ?? MAIL_COMPANY_LINES).map((l) => escapeHtml(l)).join("<br>");
  const year = ctx.year ?? new Date().getFullYear();
  return `
                ${MAIL_FOOTER_MARKER}
                <tr>
                  <td height="20" bgcolor="#ffffff" style="mso-line-height-rule: exactly; font-size: 0; line-height: 20px;">&nbsp;</td>
                </tr>
                <tr>
                  <td class="content-pad" align="center" bgcolor="#f9f9f9" style="mso-line-height-rule: exactly; padding: 24px 60px;">
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
                              <p style="${small(11)}" align="center"><a href="tel:+49(0)8142%20448666" style="color: #000000; text-decoration: underline;">+49(0)8142 448666</a> <strong>&#183;</strong> <a href="mailto:info@motionsports.de" style="color: #000000; text-decoration: underline;">info@motionsports.de</a></p>
                            </td>
                          </tr>${
                            ctx.footer.unsubscribeHtml
                              ? `
                          <tr>
                            <td align="center" style="mso-line-height-rule: exactly; padding: 8px 0 0;" valign="top">${ctx.footer.unsubscribeHtml}</td>
                          </tr>`
                              : ""
                          }
                          <tr>
                            <td align="center" style="mso-line-height-rule: exactly; padding-top: 8px;" valign="top">
                              <p style="${small(12)}" align="center">&#169; ${year} motion sports &#183; <a href="${escapeAttr(ctx.assets.imprintUrl)}" target="_blank" style="color: #000000; text-decoration: underline;">${en ? "Imprint" : "Impressum"}</a></p>
                            </td>
                          </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>`;
}

/**
 * The plain-text part of a document (Rundmail; personal mails keep the text
 * part their composer writes). Links are written out as "Label: URL".
 * @param {unknown} rawDoc
 * @param {MailRenderContext} ctx
 * @returns {string}
 */
export function renderMailTemplateText(rawDoc, ctx) {
  const doc = normalizeMailTemplateDoc(rawDoc);
  const merge = ctx.merge ?? ((t) => t);
  const en = ctx.locale === "en";
  const out = [];
  for (const b of doc.blocks) {
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
              b.terms || null,
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
