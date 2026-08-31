// The personalized email's SPECIAL-OFFER block for an attached bundle (S11).
//
// Rendered ONLY when a created, still-active bundle is attached to the send
// (see shouldRenderBundleBlock). Newsletter-styled: the signature BLACK
// SEPARATOR BAND ("Dein persönliches Angebot"), the component products as the
// shared personalised ROWS (image/name | description), then the price BLOCK —
// the offer's visual anchor: the component sum struck through in red, the set
// price big and bold, and a "Du sparst …" line. The strike + saving appear
// ONLY when the bundle genuinely costs less than its parts (PAngV: the GENUINE
// snapshotted sum; otherwise both are omitted). The CTA "Zum Angebot" points
// at the S10 TRACKED link (/api/r/<token>), never straight at Shopify.
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
  emailAccentColor,
  emailFontFamily,
  emailTextStyle,
  EMAIL_SALE_STRIKE_COLOR,
} from "./email-template";
import { renderEmailProductRows } from "./email-products";
import { activeEmailDesignRenderers } from "./email-design-context";
import { bundleStattPrice } from "./bundle-email-core.mjs";

export interface BundleEmailComponent {
  name: string;
  imageUrl: string | null;
  /** Personalised (or catalog-fallback) description shown beside the image in
   * the component rows. Null/absent = row without a description paragraph. */
  description?: string | null;
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
    save: "Du sparst",
    cta: "Zum Angebot",
  },
  en: {
    kicker: "Your personal offer",
    price: "Set price",
    instead: "instead of",
    save: "You save",
    cta: "View offer",
  },
} as const;

/** Money string/number → finite number, or null. */
function moneyNumber(value: string | number): number | null {
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

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

  // Genuine saving (amount + percent) — shown ONLY when the strike price is
  // genuine (bundlePrice < componentsSum), same PAngV rule as the strike line.
  const bundleN = moneyNumber(input.bundlePrice);
  const stattN = statt != null ? moneyNumber(statt) : null;
  const savingAmount =
    stattN != null && bundleN != null && stattN > bundleN ? stattN - bundleN : null;
  const savingPct =
    savingAmount != null && stattN != null && stattN > 0
      ? Math.round((savingAmount / stattN) * 100)
      : null;
  const savingLabel = savingAmount != null ? money(savingAmount, currency, language) : null;

  // --- text part ---
  const textLines = [
    "",
    "—",
    `${labels.kicker}: ${input.title}`,
    ...input.components.map((c) => `- ${c.name}`),
    stattLabel
      ? `${labels.price}: ${priceLabel} (${labels.instead} ${stattLabel})`
      : `${labels.price}: ${priceLabel}`,
    ...(savingLabel && savingPct != null
      ? [`${labels.save}: ${savingLabel} (${savingPct} %)`]
      : []),
    `${labels.cta}: ${input.offerUrl}`,
  ];
  const text = textLines.join("\n");

  // --- html part ---
  // A design may restyle the whole block (email-design-context bundleBlock).
  // It receives the PAngV-checked computed labels so it can never invent a
  // strike price or saving the classic path wouldn't show; the text part above
  // stays shared across all designs.
  const override = activeEmailDesignRenderers()?.bundleBlock;
  if (override) {
    return {
      text,
      html: override(input, { priceLabel, stattLabel, savingLabel, savingPct, labels }),
    };
  }

  // Classic: band + title + component rows + price block + pill CTA.
  // Components render as the personalised ROWS layout (image/name in the first
  // third, description in the remaining two thirds) — no per-component prices
  // and no per-component buttons: the set's price block + "Zum Angebot" CTA
  // below are the one offer the block sells.
  const rowsHtml = renderEmailProductRows(
    input.components.map((c) => ({
      imageUrl: c.imageUrl,
      name: c.name,
      description: c.description ?? null,
    }))
  );

  // The price BLOCK — the offer's visual anchor: small label, the genuine
  // component sum struck through in red, the set price big and bold, and a
  // "Du sparst …" line in the accent color (only when the saving is genuine).
  const priceStyleBase =
    `mso-line-height-rule: exactly; direction: ltr; font-family: ${emailFontFamily()}; ` +
    `Margin: 0; padding: 0;`;
  const priceHtml =
    `<p style="${priceStyleBase} font-size: 11px; line-height: 1.5; letter-spacing: 1px; text-transform: uppercase; color: #757575;" align="center">${escapeHtml(labels.price)}</p>` +
    (stattLabel
      ? `<p style="${priceStyleBase} font-size: 15px; line-height: 1.4; padding-top: 4px;" align="center"><span style="text-decoration: line-through; color: ${EMAIL_SALE_STRIKE_COLOR};">${escapeHtml(labels.instead)} ${escapeHtml(stattLabel)}</span></p>`
      : "") +
    `<p style="${priceStyleBase} font-size: 24px; line-height: 1.3; font-weight: 700; color: #000000; padding-top: 2px;" align="center"><strong>${escapeHtml(priceLabel)}</strong></p>` +
    (savingLabel && savingPct != null
      ? `<p style="${priceStyleBase} font-size: 13px; line-height: 1.5; font-weight: 700; color: ${emailAccentColor()}; padding-top: 4px;" align="center"><strong>${escapeHtml(labels.save)} ${escapeHtml(savingLabel)} (${savingPct}&nbsp;%)</strong></p>`
      : "");

  const html =
    renderSectionBand(labels.kicker) +
    renderSectionRow(
      `
                    <p style="${emailTextStyle()} font-size: 15px; font-weight: 700;" align="center"><strong>${escapeHtml(input.title)}</strong></p>`,
      { padding: "25px 60px 0", align: "center" }
    ) +
    renderSectionRow(rowsHtml, { padding: "0 60px 10px", align: "center" }) +
    renderSectionRow(priceHtml, { padding: "14px 60px 10px", align: "center" }) +
    renderSectionRow(renderCtaButton({ label: labels.cta, url: input.offerUrl }), {
      padding: "10px 60px 20px",
      align: "center",
    });

  return { text, html };
}
