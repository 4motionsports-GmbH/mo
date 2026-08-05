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
