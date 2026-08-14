// Shared Outlook-safe product rendering for emails — the newsletter's
// two-column PRODUCT GRID: a big 220×220 image, the product name as a black
// link underneath, and the price line (red strikethrough compare-at price next
// to the bold current price, exactly like the shop's Shopify newsletters).
//
// One renderer for every product presentation (summary "Deine Auswahl",
// summary alternatives, the marketing recommendation grid and the bundle
// special-offer components) so the paths can never drift apart.
//
// Email-client robustness: the two-up layout is inline-block divs with inline
// max-width (Gmail/Apple Mail) wrapped in MSO conditional table cells
// (Outlook). Fixed image dims + alt text, absolute https URLs only.

import {
  escapeAttr,
  escapeHtml,
  EMAIL_ACCENT_COLOR,
  EMAIL_FONT_FAMILY,
  EMAIL_SALE_STRIKE_COLOR,
} from "./email-template";
import type { Product } from "./types";

export interface EmailProductGridItem {
  /** Absolute https image URL, or null to render the tile without an image. */
  imageUrl: string | null;
  name: string;
  /** Product-page link — image + name link there when set. */
  url?: string | null;
  /** Formatted current price (e.g. "669,00 €"). */
  priceLabel?: string | null;
  /**
   * Formatted original price rendered as a red strikethrough BEFORE the bold
   * current price (newsletter sale style). Omit when not on sale.
   */
  compareAtLabel?: string | null;
}

// EUR formatting per locale: German "1.234,00 €" vs English (en-GB) "€1,234.00".
const GRID_PRICE_FORMATS: Record<"de" | "en", Intl.NumberFormat> = {
  de: new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }),
  en: new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" }),
};

/** First usable absolute-https catalog image, or null (mail clients won't load
 * a relative or http image; null renders the tile without an image). */
export function firstProductImageUrl(p: Product): string | null {
  return (
    p.images?.find((u) => typeof u === "string" && u.startsWith("https://")) ?? null
  );
}

/**
 * Grid item for a catalog product: image + name + product-page link, price in
 * the newsletter's sale style (red strikethrough list price when a genuine
 * sale price exists). The ONE mapping every product grid uses, so the summary,
 * marketing and campaign grids can never drift apart.
 */
export function productGridItem(p: Product, locale: "de" | "en" = "de"): EmailProductGridItem {
  const fmt = GRID_PRICE_FORMATS[locale];
  const onSale =
    typeof p.salePrice === "number" && p.salePrice > 0 && p.salePrice < p.price;
  return {
    imageUrl: firstProductImageUrl(p),
    name: p.name,
    url: p.shopifyUrl,
    priceLabel: fmt.format(onSale ? (p.salePrice as number) : p.price),
    compareAtLabel: onSale ? fmt.format(p.price) : null,
  };
}

const NAME_STYLE =
  `font-size: 12px; line-height: 1.2; color: #000000; font-family: ${EMAIL_FONT_FAMILY}; ` +
  `font-weight: 400; font-style: normal; display: block; Margin: 0 0 10px; padding: 0;`;

const PRICE_STYLE =
  `line-height: 1.2; font-size: 12px; color: #000000; font-family: ${EMAIL_FONT_FAMILY}; ` +
  `font-weight: 400; font-style: normal; Margin: 0; padding: 0;`;

function renderTile(item: EmailProductGridItem): string {
  const href = item.url ? escapeAttr(item.url) : null;

  const image = item.imageUrl
    ? `<img src="${escapeAttr(item.imageUrl)}" class="grid-image" align="center" alt="${escapeAttr(
        item.name
      )}" border="0" width="220" height="220" style="width: 220px; height: 220px; max-width: 100%; display: block; Margin: 0 auto; border: none; outline: none; object-fit: cover;">`
    : "";
  const imageCell = image
    ? `
                        <tr>
                          <td width="240" border="0" align="center" style="mso-line-height-rule: exactly; width: 100%; max-width: 240px; vertical-align: top; padding: 0 10px;">${
                            href
                              ? `<a href="${href}" target="_blank" style="display: block; text-decoration: none;">${image}</a>`
                              : image
                          }</td>
                        </tr>
                        <tr>
                          <td height="16" style="mso-line-height-rule: exactly; font-size: 0; line-height: 16px;">&nbsp;</td>
                        </tr>`
    : "";

  const name = href
    ? `<a href="${href}" target="_blank" style="text-decoration: none; font-size: 12px; line-height: 1.2; color: #000000; font-family: ${EMAIL_FONT_FAMILY}; font-weight: 400; font-style: normal;">${escapeHtml(item.name)}</a>`
    : escapeHtml(item.name);

  let priceHtml = "";
  if (item.priceLabel) {
    priceHtml = item.compareAtLabel
      ? `
                        <tr>
                          <td align="center" style="mso-line-height-rule: exactly; vertical-align: top; padding: 0 15px;">
                            <p style="${PRICE_STYLE}" align="center"><span style="text-decoration: line-through; color: ${EMAIL_SALE_STRIKE_COLOR};">${escapeHtml(item.compareAtLabel)}</span> <strong style="color: #000000;">${escapeHtml(item.priceLabel)}</strong></p>
                          </td>
                        </tr>`
      : `
                        <tr>
                          <td align="center" style="mso-line-height-rule: exactly; vertical-align: top; padding: 0 15px;">
                            <p style="${PRICE_STYLE}" align="center">${escapeHtml(item.priceLabel)}</p>
                          </td>
                        </tr>`;
  }

  return `<div class="grid-column" style="width: 100%; vertical-align: top; font-size: 0px; display: inline-block; max-width: 50%;"><table cellspacing="0" cellpadding="0" border="0" align="center" width="240" role="presentation" class="grid-tile" style="width: 100%; max-width: 240px; direction: ltr; border-spacing: 0 !important; border-collapse: collapse !important; table-layout: fixed !important;">
                      <tbody>${imageCell}
                        <tr>
                          <td align="center" style="mso-line-height-rule: exactly; vertical-align: top; padding: 0 15px;">
                            <h2 style="${NAME_STYLE}" align="center">${name}</h2>
                          </td>
                        </tr>${priceHtml}
                        <tr>
                          <td height="20" style="mso-line-height-rule: exactly; font-size: 0; line-height: 20px;">&nbsp;</td>
                        </tr>
                      </tbody>
                    </table></div>`;
}

/**
 * Render products as the newsletter's two-column grid. Returns "" for an empty
 * list so callers can drop the section (and its band) entirely. The result is
 * inner HTML for a full-width content row — place it via renderSectionRow.
 */
export function renderEmailProductGrid(items: EmailProductGridItem[]): string {
  if (items.length === 0) return "";

  const tiles = items
    .map((item, i) => {
      // Outlook can't do inline-block wrapping — break the MSO table into
      // explicit two-cell rows (same conditional pattern as the newsletter).
      const msoSeparator =
        i === 0
          ? ""
          : i % 2 === 0
            ? `<!--[if mso]></td></tr><tr><td style="vertical-align: top;"><![endif]-->`
            : `<!--[if mso]></td><td style="vertical-align: top;"><![endif]-->`;
      return `${msoSeparator}${renderTile(item)}`;
    })
    .join("");

  return `
                    <div style="font-size: 0; text-align: center; direction: ltr;">
                      <!--[if mso]><table role="presentation" width="100%" style="text-align: center;"><tr><td style="vertical-align: top;"><![endif]-->
                      ${tiles}
                      <!--[if mso]></td></tr></table><![endif]-->
                    </div>`;
}

// ---------------------------------------------------------------------------
// PRODUCT ROWS — the personalised presentation: per product ONE table row with
// the image + name + price in the left THIRD and a personalised description
// (plus a small product-page button) in the right TWO THIRDS. Divider lines
// between rows, exactly one row per product — the layout the marketing and
// campaign emails use instead of the old two-column tile grid.
// ---------------------------------------------------------------------------

export interface EmailProductRowItem extends EmailProductGridItem {
  /**
   * The personalised description shown in the right column. Callers resolve it
   * as: AI-personalised highlight (draft) → catalog shortDescription → null
   * (the row still renders, just without a description paragraph).
   */
  description?: string | null;
  /** Label of the small per-product button (default "Zum Produkt"). */
  ctaLabel?: string | null;
}

const ROW_NAME_STYLE =
  `mso-line-height-rule: exactly; direction: ltr; font-family: ${EMAIL_FONT_FAMILY}; ` +
  `font-size: 13px; line-height: 1.4; color: #000000; font-weight: 700; ` +
  `Margin: 12px 0 4px; padding: 0;`;

const ROW_PRICE_STYLE =
  `mso-line-height-rule: exactly; direction: ltr; font-family: ${EMAIL_FONT_FAMILY}; ` +
  `font-size: 13px; line-height: 1.4; color: #000000; font-weight: 400; Margin: 0; padding: 0;`;

const ROW_DESC_STYLE =
  `mso-line-height-rule: exactly; direction: ltr; font-family: ${EMAIL_FONT_FAMILY}; ` +
  `font-size: 13px; line-height: 1.6; color: #000000; font-weight: 400; Margin: 0; padding: 0;`;

/** Small accent pill linking to the product page (right column, under the
 * description). Same visual language as the shell's bulletproof CTA, scaled
 * down so the cart button below stays the email's primary action. */
function rowCtaButton(url: string, label: string): string {
  return `
                          <table cellspacing="0" cellpadding="0" border="0" role="presentation" style="direction: ltr; border-spacing: 0 !important; border-collapse: collapse !important; Margin-top: 12px;">
                            <tr>
                              <td align="center" bgcolor="${EMAIL_ACCENT_COLOR}" style="mso-line-height-rule: exactly; border-radius: 200px;" valign="top">
                                <a href="${escapeAttr(url)}" target="_blank" style="font-size: 11px; color: #ffffff; text-decoration: none; border-radius: 200px; background-color: ${EMAIL_ACCENT_COLOR}; display: block; font-family: ${EMAIL_FONT_FAMILY}; font-weight: 700; font-style: normal; text-align: center; text-transform: uppercase; letter-spacing: 0.5px; padding: 8px 18px; border: 2px solid ${EMAIL_ACCENT_COLOR};">${escapeHtml(label)}</a>
                              </td>
                            </tr>
                          </table>`;
}

function renderProductRow(item: EmailProductRowItem, isFirst: boolean): string {
  const href = item.url ? escapeAttr(item.url) : null;

  const image = item.imageUrl
    ? `<img src="${escapeAttr(item.imageUrl)}" class="prow-image" alt="${escapeAttr(
        item.name
      )}" border="0" width="140" height="140" style="width: 140px; height: 140px; max-width: 100%; display: block; Margin: 0 auto; border: none; outline: none; object-fit: cover;">`
    : "";
  const linkedImage = image && href
    ? `<a href="${href}" target="_blank" style="display: block; text-decoration: none;">${image}</a>`
    : image;

  const name = href
    ? `<a href="${href}" target="_blank" style="text-decoration: none; color: #000000;">${escapeHtml(item.name)}</a>`
    : escapeHtml(item.name);

  const price = item.priceLabel
    ? item.compareAtLabel
      ? `<p style="${ROW_PRICE_STYLE}" align="center"><span style="text-decoration: line-through; color: ${EMAIL_SALE_STRIKE_COLOR};">${escapeHtml(item.compareAtLabel)}</span> <strong style="color: #000000;">${escapeHtml(item.priceLabel)}</strong></p>`
      : `<p style="${ROW_PRICE_STYLE}" align="center"><strong style="color: #000000;">${escapeHtml(item.priceLabel)}</strong></p>`
    : "";

  const description = item.description?.trim()
    ? `<p style="${ROW_DESC_STYLE}" align="left">${escapeHtml(item.description.trim())}</p>`
    : "";
  const cta = href ? rowCtaButton(href, item.ctaLabel?.trim() || "Zum Produkt") : "";

  // Divider line ABOVE every row except the first (Atletica-style separators).
  const divider = isFirst
    ? ""
    : `
                      <tr>
                        <td colspan="2" style="mso-line-height-rule: exactly; padding: 18px 0 0;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top: 1px solid #e0e0e0; border-spacing: 0 !important; border-collapse: collapse !important;"><tr><td style="font-size: 0; line-height: 0;">&nbsp;</td></tr></table>
                        </td>
                      </tr>`;

  // First column = ONE THIRD of the table (image + name + price), second
  // column = TWO THIRDS (personalised description + product button). Fixed
  // pixel widths for Outlook (480px usable card width → 160/320); the mobile
  // media query (.prow-col) stacks the two cells.
  return `${divider}
                      <tr>
                        <td class="prow-col" width="33%" align="center" valign="top" style="mso-line-height-rule: exactly; width: 33%; padding: 18px 10px 0 0; vertical-align: top;">
                          ${linkedImage}
                          <p style="${ROW_NAME_STYLE}" align="center">${name}</p>
                          ${price}
                        </td>
                        <td class="prow-col" width="67%" align="left" valign="middle" style="mso-line-height-rule: exactly; width: 67%; padding: 18px 0 0 10px; vertical-align: middle;">
                          ${description}
                          ${cta}
                        </td>
                      </tr>`;
}

/**
 * Render products as personalised rows (1/3 image+name+price | 2/3 description
 * + button). Returns "" for an empty list so callers can drop the section (and
 * its band) entirely. The result is inner HTML for a full-width content row —
 * place it via renderSectionRow.
 */
export function renderEmailProductRows(items: EmailProductRowItem[]): string {
  if (items.length === 0) return "";
  const rows = items.map((item, i) => renderProductRow(item, i === 0)).join("");
  return `
                    <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" style="width: 100%; direction: ltr; border-spacing: 0 !important; border-collapse: collapse !important; table-layout: fixed !important;">
                      <tbody>${rows}
                      </tbody>
                    </table>`;
}

const norm = (s: string) => s.trim().toLowerCase();

/** The personalised description for a product name from the draft's stored
 * highlights (matched case-insensitively), or null. */
export function highlightDescriptionFor(
  name: string,
  highlights: Array<{ name: string; description: string }> | null | undefined
): string | null {
  if (!highlights?.length) return null;
  const key = norm(name);
  return highlights.find((h) => norm(h.name) === key)?.description ?? null;
}

/**
 * Row items for a product list — the ONE mapping the marketing and campaign
 * emails share so the presentation can't drift: catalog price/image/link via
 * productGridItem, the description resolved as personalised highlight →
 * catalog shortDescription → none, and products that already appear in an
 * attached set (excludeNames) dropped so nothing shows twice.
 */
export function productRowItems(
  products: Product[],
  opts: {
    locale?: "de" | "en";
    /** The draft's stored per-product personalised descriptions. */
    highlights?: Array<{ name: string; description: string }> | null;
    /** Names of set components already shown in the bundle block. */
    excludeNames?: string[] | null;
  } = {}
): EmailProductRowItem[] {
  const locale = opts.locale ?? "de";
  const excluded = new Set((opts.excludeNames ?? []).map(norm));
  return products
    .filter((p) => !excluded.has(norm(p.name)))
    .map((p) => ({
      ...productGridItem(p, locale),
      description:
        highlightDescriptionFor(p.name, opts.highlights) || p.shortDescription?.trim() || null,
      ctaLabel: locale === "en" ? "View product" : "Zum Produkt",
    }));
}
