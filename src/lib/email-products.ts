// Shared Outlook-safe product-row rendering for emails.
//
// Extracted from the S5 summary-email "chosen products" list so the personalized
// marketing email's bundle SPECIAL-OFFER block renders its component products
// with the EXACT same conventions: a table-based row, a fixed 80×80 image (alt
// text = product name, absolute https only) and the name (optionally a price
// line). One renderer, so the two paths can never drift apart.

import { escapeAttr, escapeHtml, EMAIL_TEXT_STYLE } from "./email-template";

export interface EmailProductRow {
  /** Absolute https image URL, or null to render the row without an image cell. */
  imageUrl: string | null;
  name: string;
  /** Optional formatted price line under the name (e.g. "149,00 €"). */
  priceLabel?: string | null;
}

/**
 * Render a list of product rows as an Outlook-safe table (fixed image dims, alt
 * text, inline styles). Returns "" for an empty list so callers can drop the
 * block entirely. `marginTop` (default true) adds the 10px top margin the
 * summary email uses; the bundle block turns it off (it supplies its own).
 */
export function renderEmailProductRows(
  rows: EmailProductRow[],
  opts: { marginTop?: boolean } = {}
): string {
  if (rows.length === 0) return "";

  const body = rows
    .map((r) => {
      const imageCell = r.imageUrl
        ? `<td width="96" valign="top" style="mso-line-height-rule: exactly; padding: 8px 12px 8px 0;"><img src="${escapeAttr(
            r.imageUrl
          )}" alt="${escapeAttr(
            r.name
          )}" width="80" height="80" border="0" style="width: 80px; height: 80px; display: block; border: none; outline: none; object-fit: cover;"></td>`
        : "";
      const priceLine = r.priceLabel
        ? `
                    <p style="${EMAIL_TEXT_STYLE} text-align: left; padding-top: 2px;" align="left">${escapeHtml(
                      r.priceLabel
                    )}</p>`
        : "";
      return `
                <tr>${imageCell}
                  <td valign="middle" style="mso-line-height-rule: exactly; padding: 8px 0;">
                    <p style="${EMAIL_TEXT_STYLE} text-align: left; font-weight: 700;" align="left">${escapeHtml(
                      r.name
                    )}</p>${priceLine}
                  </td>
                </tr>`;
    })
    .join("");

  const margin = opts.marginTop === false ? "" : " Margin-top: 10px;";
  return `
                <table cellspacing="0" cellpadding="0" border="0" width="100%" style="min-width: 100%; direction: ltr;${margin}" role="presentation">${body}
                </table>`;
}
