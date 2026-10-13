// The personalized email's SET block for an attached bundle (S11).
//
// Rendered ONLY when a created, still-active bundle is attached to the send
// (see shouldRenderBundleBlock) — and then the mail is a SET MAIL
// (offer-mode.mjs): the composers show only this block, no single-product
// rows and no discount code; the set price is the offer.
//
// Everything sits in ONE frame that marks it as a bundle:
//   - at the top the EYECATCHER: kicker, the short set headline, a line like
//     „3 Produkte · zusammen günstiger“ and a big badge — „−16 %“ + „Du sparst
//     29,90 €“ for a genuine saving, otherwise „Set-Preis“ + the amount;
//   - the set's items as ROWS in the design's product-row structure (image |
//     „2×“ + name + short description | the SNAPSHOT unit price, „je 49,00 €“)
//     — no per-item links and no „Zum Produkt“ buttons;
//   - at the bottom the price summary (Einzelkauf struck through ONLY when the
//     set genuinely costs less — PAngV; Set-Preis big and bold) and the one
//     action, „Zur Kasse“, on the S10 TRACKED link (/api/r/<token>), which
//     lands on the prefilled checkout — never straight at Shopify.
//
// Every number and label comes from bundleBlockModel (bundle-email-core.mjs,
// tested) — computed once for every design, so a design override
// (email-design-context bundleBlock) only lays them out and can never invent a
// strike price or a saving. The text part (bundleBlockText) is shared too.
//
// Outlook-safe like the rest of email-template.ts: table layout, inline
// styles, the shared bulletproof CTA, fixed image dims + alt text. Outlook
// ignores border-radius (square corners there). The HTML part is FULL-WIDTH
// CARD ROWS — callers pass it to the branded shell's preCtaRowsHtml slot.

import {
  renderCtaButton,
  renderSectionBand,
  renderSectionRow,
  escapeAttr,
  escapeHtml,
  emailAccentColor,
  emailFontFamily,
  EMAIL_SALE_STRIKE_COLOR,
} from "./email-template";
import { activeEmailDesignRenderers, type BundleBlockComputed } from "./email-design-context";
import { firstProductImageUrl, highlightDescriptionFor } from "./email-products";
import { bundleBlockModel, bundleBlockText, tintHex } from "./bundle-email-core.mjs";
import type { Product } from "./types";

export interface BundleEmailComponent {
  name: string;
  imageUrl: string | null;
  /** How many of this item the set contains (default 1) — shown prominently
   * in front of the name ("2× Kettlebell"). */
  quantity?: number;
  /** The SNAPSHOT unit price of the component (bundle_offers.components
   * unitPrice) — never a live catalog price. Shown per row („je 49,00 €“)
   * only when Σ unitPrice × quantity equals componentsSum. */
  unitPrice?: string | number | null;
  /** Short description for the row: the draft's AI highlight for this
   * product when one exists, else the catalog shortDescription (clamped by
   * the model). */
  description?: string | null;
}

export interface BundleOfferBlockInput {
  /** Bundle title (e.g. "Dein persönliches Set"); long generated titles give
   * way to the default headline (bundleHeadline). */
  title: string;
  components: BundleEmailComponent[];
  /** Admin-set selling price (Money string or number). */
  bundlePrice: string | number;
  /** TRUE snapshotted component sum (the "statt" reference). */
  componentsSum: string | number;
  currency?: string;
  /** The tracked redirect link (/api/r/<token>) the "Zur Kasse" button uses —
   * it lands on the prefilled checkout. */
  offerUrl: string;
  /** Label language. The campaign channel is bilingual (contact.language);
   * the marketing channel stays German — hence the "de" default. */
  language?: "de" | "en";
}

/**
 * A stored set's component snapshots as block components — the ONE mapping
 * the campaign and the marketing path share: name, count and unit price from
 * the SNAPSHOT (never live catalog prices), the picture fresh from the catalog
 * (the row snapshots no images), and the row's short description: the draft's
 * AI highlight for that product when one exists (matched like the product
 * rows, highlightDescriptionFor), else the catalog shortDescription.
 */
export function bundleEmailComponents(
  components: ReadonlyArray<{ productId: string; title: string; quantity: number; unitPrice: string | number }>,
  catalogById: ReadonlyMap<string, Product>,
  highlights: Array<{ name: string; description: string }> | null | undefined
): BundleEmailComponent[] {
  return components.map((c) => {
    const product = catalogById.get(c.productId);
    return {
      name: c.title,
      imageUrl: firstProductImageUrl(product),
      quantity: c.quantity,
      unitPrice: c.unitPrice,
      description:
        highlightDescriptionFor(c.title, highlights) ||
        (product ? highlightDescriptionFor(product.name, highlights) : null) ||
        product?.shortDescription?.trim() ||
        null,
    };
  });
}

/** The model for the design hooks: bundleBlockModel's output as the typed
 * BundleBlockComputed. */
function computeBundleBlock(input: BundleOfferBlockInput): BundleBlockComputed {
  return bundleBlockModel({
    title: input.title,
    components: input.components,
    bundlePrice: input.bundlePrice,
    componentsSum: input.componentsSum,
    currency: input.currency ?? "EUR",
    language: input.language ?? "de",
  });
}

/**
 * Render the set block (text + HTML parts) for an attached bundle. Pure (no
 * I/O) so it is previewable/testable; the caller supplies already resolved
 * component images/descriptions and the tracked offer URL. The HTML part
 * consists of full-width card rows for the branded shell's preCtaRowsHtml slot.
 */
export function renderBundleOfferBlock(input: BundleOfferBlockInput): { text: string; html: string } {
  const computed = computeBundleBlock(input);
  const text = bundleBlockText(computed, input.offerUrl);

  // A design may restyle the whole block (email-design-context bundleBlock).
  // It receives the PAngV-checked model, so it can never show a strike price
  // or saving the classic path wouldn't; the text part above stays shared.
  const override = activeEmailDesignRenderers()?.bundleBlock;
  if (override) return { text, html: override(input, computed) };

  return { text, html: renderClassicBundleBlock(input, computed) };
}

// ── Classic (and every token-only design such as Studio) ─────────────────────

/** Item image size in the classic rows (px, 1×). */
const CLASSIC_ITEM_IMAGE = 84;

function renderClassicBundleBlock(input: BundleOfferBlockInput, c: BundleBlockComputed): string {
  const accent = emailAccentColor();
  const tint = tintHex(accent, 0.08);
  const font = emailFontFamily();
  // Gaps between paragraphs are margins (Margin-top after the reset): Outlook/
  // Word ignores padding on <p>, and inside a cell browsers render both alike.
  const p = `mso-line-height-rule: exactly; direction: ltr; font-family: ${font}; Margin: 0; padding: 0;`;

  // EYECATCHER — a pale band in the accent tint: kicker, headline, tagline on
  // the left; the solid accent badge on the right (saving or set price).
  const badgeInner =
    c.eyecatcher === "saving"
      ? `<p style="${p} font-size: 36px; line-height: 40px; font-weight: 700; color: #ffffff; white-space: nowrap;" align="center"><strong>${escapeHtml(c.eyecatcherCopy.value)}</strong></p>` +
        (c.eyecatcherCopy.note
          ? `<p style="${p} font-size: 12px; line-height: 17px; font-weight: 700; color: #ffffff; Margin-top: 4px; white-space: nowrap;" align="center"><strong>${escapeHtml(c.eyecatcherCopy.note)}</strong></p>`
          : "")
      : (c.eyecatcherCopy.label
          ? `<p style="${p} font-size: 11px; line-height: 15px; letter-spacing: 1px; text-transform: uppercase; color: #ffffff;" align="center">${escapeHtml(c.eyecatcherCopy.label)}</p>`
          : "") +
        `<p style="${p} font-size: 24px; line-height: 30px; font-weight: 700; color: #ffffff; Margin-top: 2px; white-space: nowrap;" align="center"><strong>${escapeHtml(c.eyecatcherCopy.value)}</strong></p>`;
  const badge = `
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="right" class="set-badge" style="border-collapse: separate !important; border-spacing: 0;">
                            <tr>
                              <td align="center" bgcolor="${accent}" style="mso-line-height-rule: exactly; background-color: ${accent}; border-radius: 10px; padding: 14px 18px;">${badgeInner}
                              </td>
                            </tr>
                          </table>`;
  const eyecatcher = `
                      <tr>
                        <td bgcolor="${tint}" class="set-eye" style="mso-line-height-rule: exactly; background-color: ${tint}; border-radius: 8px 8px 0 0; padding: 20px 20px 20px 22px;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%;">
                            <tr>
                              <td valign="middle" class="set-eye-text" style="mso-line-height-rule: exactly; padding-right: 14px;">
                                <p style="${p} font-size: 11px; line-height: 15px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: ${accent};" align="left">${escapeHtml(c.labels.deal)}</p>
                                <p style="${p} font-size: 20px; line-height: 26px; font-weight: 700; color: #000000; Margin-top: 6px;" align="left"><strong>${escapeHtml(c.headline)}</strong></p>
                                <p style="${p} font-size: 13px; line-height: 19px; color: #333333; Margin-top: 4px;" align="left">${escapeHtml(c.tagline)}</p>
                              </td>
                              <td valign="middle" align="right" width="170" class="set-eye-badge" style="mso-line-height-rule: exactly; width: 170px;">${badge}
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>`;

  // ROWS — image | count + name + short description | snapshot unit price.
  // No per-item link and no button: the set is bought as one.
  const rows = c.items
    .map((item, i) => {
      const divider = i === 0 ? "" : "border-top: 1px solid #e6e6e6;";
      const image = item.imageUrl
        ? `<img src="${escapeAttr(item.imageUrl)}" alt="${escapeAttr(item.name)}" width="${CLASSIC_ITEM_IMAGE}" height="${CLASSIC_ITEM_IMAGE}" border="0" class="set-item-img" style="width: ${CLASSIC_ITEM_IMAGE}px; height: ${CLASSIC_ITEM_IMAGE}px; max-width: 100%; display: block; border: none; outline: none; object-fit: contain; background-color: #ffffff;">`
        : "&nbsp;";
      const description = item.description
        ? `<p style="${p} font-size: 12px; line-height: 17px; color: #555555; Margin-top: 4px;" align="left">${escapeHtml(item.description)}</p>`
        : "";
      const price = item.unitPriceLabel
        ? `<p style="${p} font-size: 12px; line-height: 17px; color: #757575; white-space: nowrap;" align="right">${escapeHtml(item.unitPriceLabel)}</p>`
        : "&nbsp;";
      // Text and price share an inner table so phones can stack the price
      // under the name while the picture stays on the left.
      // Outlook/Word gives every cell of a row the largest vertical padding:
      // the outer text cell inherits the picture cell's 14px there, so the
      // inner cells drop theirs (mso-padding-alt) — same geometry as browsers.
      return `
                            <tr>
                              <td width="${CLASSIC_ITEM_IMAGE + 14}" valign="middle" class="set-item-img-cell" style="mso-line-height-rule: exactly; width: ${CLASSIC_ITEM_IMAGE + 14}px; padding: 14px 14px 14px 0; ${divider}">${image}</td>
                              <td valign="middle" style="mso-line-height-rule: exactly; padding: 0; ${divider}">
                                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%;">
                                  <tr>
                                    <td valign="middle" class="set-item-text" style="mso-line-height-rule: exactly; padding: 14px 10px 14px 0; mso-padding-alt: 0 10px 0 0;">
                                      <p style="${p} font-size: 14px; line-height: 19px; font-weight: 700; color: #000000;" align="left"><span style="color: ${accent};">${item.quantity}&times;</span>&nbsp; ${escapeHtml(item.name)}</p>${description}
                                    </td>
                                    <td width="92" valign="middle" align="right" class="set-item-price" style="mso-line-height-rule: exactly; width: 92px; padding: 14px 0; mso-padding-alt: 0;">${price}</td>
                                  </tr>
                                </table>
                              </td>
                            </tr>`;
    })
    .join("");
  const items = `
                      <tr>
                        <td style="mso-line-height-rule: exactly; padding: 6px 20px 4px 22px;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; table-layout: auto;">${rows}
                          </table>
                        </td>
                      </tr>`;

  // PRICE SUMMARY — Einzelkauf struck through ONLY when genuine, the set price
  // big and bold — and the one CTA in the theme's button style. The 3px that
  // lifts the struck price is a paragraph margin, not cell padding: Outlook/
  // Word would copy a cell's bottom padding to the set-price cell as well.
  const label = `${p} font-size: 11px; line-height: 15px; letter-spacing: 1px; text-transform: uppercase; color: #757575;`;
  const summary = `
                      <tr>
                        <td align="center" style="mso-line-height-rule: exactly; padding: 16px 22px 0; border-top: 1px solid #e6e6e6;">
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="Margin: 0 auto;">
                            <tr>${
                              c.stattLabel
                                ? `
                              <td valign="bottom" style="mso-line-height-rule: exactly; padding: 0 22px 0 0;">
                                <p style="${label}" align="left">${escapeHtml(c.labels.separately)}</p>
                                <p style="${p} font-size: 16px; line-height: 22px; color: ${EMAIL_SALE_STRIKE_COLOR}; text-decoration: line-through; white-space: nowrap; Margin-bottom: 3px;" align="left">${escapeHtml(c.stattLabel)}</p>
                              </td>`
                                : ""
                            }
                              <td valign="bottom" style="mso-line-height-rule: exactly;">
                                <p style="${label}" align="left">${escapeHtml(c.labels.price)}</p>
                                <p style="${p} font-size: 28px; line-height: 34px; font-weight: 700; color: #000000; white-space: nowrap;" align="left"><strong>${escapeHtml(c.priceLabel)}</strong></p>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td align="center" style="mso-line-height-rule: exactly; padding: 16px 22px 22px;">${renderCtaButton({ label: c.labels.cta, url: input.offerUrl })}
                        </td>
                      </tr>`;

  const frame = `
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="set-frame" style="width: 100%; border: 2px solid ${accent}; border-radius: 10px; border-collapse: separate !important; border-spacing: 0; background-color: #ffffff;">${eyecatcher}${items}${summary}
                    </table>`;

  return (
    renderSectionBand(c.labels.kicker) +
    renderSectionRow(frame, { padding: "22px 40px 18px", align: "center" })
  );
}
