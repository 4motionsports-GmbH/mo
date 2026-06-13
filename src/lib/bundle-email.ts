// The personalized email's SPECIAL-OFFER block for an attached bundle (S11).
//
// Rendered ONLY when a created, still-active bundle is attached to the send
// (see shouldRenderBundleBlock). Shows the bundle title, its component products
// (image + name, via the shared S5 product-row renderer), the bundle price and
// — ONLY when the bundle genuinely costs less than its parts — a PAngV-safe
// "statt €<component sum>" strike line (the GENUINE snapshotted sum; otherwise
// omitted). The CTA "Zum Angebot" points at the S10 TRACKED link
// (/api/r/<token>), never straight at Shopify.
//
// Outlook-safe like the rest of email-template.ts: table layout, inline styles,
// the shared bulletproof CTA button, fixed image dims + alt text on the rows.

import {
  renderCtaButton,
  escapeHtml,
  EMAIL_TEXT_STYLE,
  EMAIL_MUTED_TEXT_STYLE,
  EMAIL_FONT_FAMILY,
} from "./email-template";
import { renderEmailProductRows } from "./email-products";
import { bundleStattPrice } from "./bundle-email-core.mjs";

export interface BundleEmailComponent {
  name: string;
  imageUrl: string | null;
}

export interface BundleOfferBlockInput {
  /** Bundle title (e.g. "Dein persönliches Set"). */
  title: string;
  components: BundleEmailComponent[];
  /** Admin-set selling price (Money string or number). */
  bundlePrice: string | number;
  /** TRUE snapshotted component sum (the "statt" reference). */
  componentsSum: string | number;
  currency?: string;
  /** The tracked redirect link (/api/r/<token>) the "Zum Angebot" button uses. */
  offerUrl: string;
}

function money(value: string | number, currency: string): string {
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString("de-DE", { style: "currency", currency });
}

/**
 * Render the special-offer block (text + HTML parts) for an attached bundle.
 * Pure (no I/O) so it is previewable/testable; the caller supplies already
 * resolved component images and the tracked offer URL.
 */
export function renderBundleOfferBlock(input: BundleOfferBlockInput): { text: string; html: string } {
  const currency = input.currency ?? "EUR";
  const priceLabel = money(input.bundlePrice, currency);
  // PAngV: the strike "statt" price is the genuine component sum, ONLY when the
  // bundle is actually cheaper than its parts; otherwise no strike line at all.
  const statt = bundleStattPrice(input.bundlePrice, input.componentsSum);
  const stattLabel = statt != null ? money(statt, currency) : null;

  // --- text part ---
  const textLines = [
    "",
    "—",
    `Dein persönliches Angebot: ${input.title}`,
    ...input.components.map((c) => `- ${c.name}`),
    stattLabel ? `Set-Preis: ${priceLabel} (statt ${stattLabel})` : `Set-Preis: ${priceLabel}`,
    `Zum Angebot: ${input.offerUrl}`,
  ];
  const text = textLines.join("\n");

  // --- html part ---
  const rowsHtml = renderEmailProductRows(
    input.components.map((c) => ({ imageUrl: c.imageUrl, name: c.name })),
    { marginTop: false }
  );

  const priceHtml = stattLabel
    ? `<p style="${EMAIL_TEXT_STYLE} font-weight: 700; padding-top: 8px;" align="left">${escapeHtml(
        priceLabel
      )} <span style="${EMAIL_MUTED_TEXT_STYLE} text-decoration: line-through; font-weight: 400;">statt ${escapeHtml(
        stattLabel
      )}</span></p>`
    : `<p style="${EMAIL_TEXT_STYLE} font-weight: 700; padding-top: 8px;" align="left">${escapeHtml(
        priceLabel
      )}</p>`;

  // A self-contained bordered "special offer" card placed in the email body,
  // ending in the shared bulletproof "Zum Angebot" button (tracked link).
  const html = `
                <table cellspacing="0" cellpadding="0" border="0" width="100%" style="min-width: 100%; direction: ltr; Margin-top: 16px;" role="presentation">
                  <tr>
                    <td style="mso-line-height-rule: exactly; padding: 16px 20px; border: 2px solid #e5e5e5; border-radius: 8px;" bgcolor="#f6f6f6" valign="top">
                      <p style="mso-line-height-rule: exactly; direction: ltr; font-family: ${EMAIL_FONT_FAMILY}; font-size: 12px; line-height: 16px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #008ccb; Margin: 0 0 4px;" align="left">Dein persönliches Angebot</p>
                      <h3 style="font-family: ${EMAIL_FONT_FAMILY}; color: #000000; font-size: 16px; line-height: 22px; font-weight: 700; text-align: left; Margin: 0 0 6px;" align="left">${escapeHtml(
                        input.title
                      )}</h3>${rowsHtml}
                      ${priceHtml}
                      <table cellspacing="0" cellpadding="0" border="0" width="100%" style="direction: ltr; Margin-top: 6px;" role="presentation">${renderCtaButton(
                        { label: "Zum Angebot", url: input.offerUrl }
                      )}
                      </table>
                    </td>
                  </tr>
                </table>`;

  return { text, html };
}
