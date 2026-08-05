// The personalized email's SPECIAL-OFFER block for an attached bundle (S11).
//
// Rendered ONLY when a created, still-active bundle is attached to the send
// (see shouldRenderBundleBlock). Newsletter-styled: the signature BLACK
// SEPARATOR BAND ("Dein persönliches Angebot"), the component products as the
// shared two-column picture grid, the bundle price and — ONLY when the bundle
// genuinely costs less than its parts — a PAngV-safe red strikethrough
// "statt €<component sum>" (the GENUINE snapshotted sum; otherwise omitted).
// The CTA "Zum Angebot" points at the S10 TRACKED link (/api/r/<token>),
// never straight at Shopify.
//
// Outlook-safe like the rest of email-template.ts: table layout, inline
// styles, the shared bulletproof pill button, fixed image dims + alt text.
// The HTML part is FULL-WIDTH CARD ROWS — callers pass it to the branded
// shell's preCtaRowsHtml slot.

import {
  renderCtaButton,
  renderSectionBand,
  renderSectionRow,
  escapeHtml,
  EMAIL_FONT_FAMILY,
  EMAIL_SALE_STRIKE_COLOR,
  EMAIL_TEXT_STYLE,
} from "./email-template";
import { renderEmailProductGrid } from "./email-products";
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
  /** Label language. The campaign channel is bilingual (contact.language);
   * the marketing channel stays German — hence the "de" default. */
  language?: "de" | "en";
}

function money(value: string | number, currency: string, language: "de" | "en"): string {
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString(language === "en" ? "en-IE" : "de-DE", {
    style: "currency",
    currency,
  });
}

/** The block's fixed labels, per language (PAngV wording stays intact in
 * German; the English mirror keeps the same honest "instead of" framing). */
const BUNDLE_LABELS = {
  de: {
    kicker: "Dein persönliches Angebot",
    price: "Set-Preis",
    instead: "statt",
    cta: "Zum Angebot",
  },
  en: {
    kicker: "Your personal offer",
    price: "Set price",
    instead: "instead of",
    cta: "View offer",
  },
} as const;

/**
 * Render the special-offer block (text + HTML parts) for an attached bundle.
 * Pure (no I/O) so it is previewable/testable; the caller supplies already
 * resolved component images and the tracked offer URL. The HTML part consists
 * of full-width card rows for the branded shell's preCtaRowsHtml slot.
 */
export function renderBundleOfferBlock(input: BundleOfferBlockInput): { text: string; html: string } {
  const currency = input.currency ?? "EUR";
  const language = input.language ?? "de";
  const labels = BUNDLE_LABELS[language];
  const priceLabel = money(input.bundlePrice, currency, language);
  // PAngV: the strike "statt" price is the genuine component sum, ONLY when the
  // bundle is actually cheaper than its parts; otherwise no strike line at all.
  const statt = bundleStattPrice(input.bundlePrice, input.componentsSum);
  const stattLabel = statt != null ? money(statt, currency, language) : null;

  // --- text part ---
  const textLines = [
    "",
    "—",
    `${labels.kicker}: ${input.title}`,
    ...input.components.map((c) => `- ${c.name}`),
    stattLabel
      ? `${labels.price}: ${priceLabel} (${labels.instead} ${stattLabel})`
      : `${labels.price}: ${priceLabel}`,
    `${labels.cta}: ${input.offerUrl}`,
  ];
  const text = textLines.join("\n");

  // --- html part — band + title + component grid + price + pill CTA ---
  const gridHtml = renderEmailProductGrid(
    input.components.map((c) => ({ imageUrl: c.imageUrl, name: c.name }))
  );

  // Price line in the newsletter's sale style: red strikethrough component sum
  // (when genuine), bold bundle price.
  const priceHtml = stattLabel
    ? `<p style="mso-line-height-rule: exactly; direction: ltr; font-family: ${EMAIL_FONT_FAMILY}; font-size: 13px; line-height: 1.5; color: #000000; Margin: 0;" align="center">${escapeHtml(labels.price)}: <span style="text-decoration: line-through; color: ${EMAIL_SALE_STRIKE_COLOR};">${escapeHtml(stattLabel)}</span> <strong style="color: #000000;">${escapeHtml(priceLabel)}</strong></p>`
    : `<p style="mso-line-height-rule: exactly; direction: ltr; font-family: ${EMAIL_FONT_FAMILY}; font-size: 13px; line-height: 1.5; color: #000000; Margin: 0;" align="center">${escapeHtml(labels.price)}: <strong style="color: #000000;">${escapeHtml(priceLabel)}</strong></p>`;

  const html =
    renderSectionBand(labels.kicker) +
    renderSectionRow(
      `
                    <p style="${EMAIL_TEXT_STYLE} font-weight: 700;" align="center"><strong>${escapeHtml(input.title)}</strong></p>`,
      { padding: "25px 60px 10px", align: "center" }
    ) +
    renderSectionRow(gridHtml, { padding: "0 60px", align: "center" }) +
    renderSectionRow(priceHtml, { padding: "0 60px 10px", align: "center" }) +
    renderSectionRow(renderCtaButton({ label: labels.cta, url: input.offerUrl }), {
      padding: "10px 60px 20px",
      align: "center",
    });

  return { text, html };
}
