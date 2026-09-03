// "Performance" — the image-first conversion design, built from the operator's
// AI-drafted template: bold hero section (kicker, oversized headline, red CTA,
// large lifestyle image), bordered product
// CARDS with price + outline button, the black BUNDLE-DEAL card with the
// price trio, the "Frag Mo" advisor panel, and a clean minimal footer.
//
// Personalisation hooks:
//   - HERO IMAGE: activeEmailRenderData().heroImageUrl (the operator-generated
//     per-send image, lib/email-hero.ts) with the static brand asset as
//     default (public/email-hero-default.jpg / EMAIL_HERO_DEFAULT_URL).
//   - GREETING: activeEmailRenderData().recipientFirstName renders the bold
//     "Hey <Name>," opener — skipped when the AI prose already greets, so the
//     reader never gets two greetings.
//   - Kicker, headline, subline and the fallback CTA label are tailored per
//     email type via variants (bilingual for the campaign channel).
//
// Brand-critical pieces reuse the REAL assets: emailLogoUrl(), emailMoIconUrl,
// EMAIL_SOCIAL_LINKS, EMAIL_IMPRINT_URL, the company block, and the shell's
// dedicated unsubscribe slot (footer.unsubscribeHtml is ALWAYS rendered when
// present — a design can never drop the legal opt-out).
//
// Email-client rules as everywhere: tables + inline styles, absolute https
// images, no flexbox/grid/SVG. Arial only — no web font needed.

import type { EmailDesignDefinition } from "./registry";
import type {
  BundleBlockComputed,
  EmailSectionRowOptions,
  MoPromoBlockInput,
} from "../email-design-context";
import { activeEmailRenderData } from "../email-design-context";
import { getBaseUrl } from "../base-url";
import { EMAIL_RATING_FACES, emailRatingUrl } from "../email-rating.mjs";
import {
  escapeAttr,
  escapeHtml,
  emailLogoUrl,
  emailMoIconUrl,
  EMAIL_IMPRINT_URL,
  EMAIL_SOCIAL_LINKS,
  type BrandedEmailOptions,
  type EmailCta,
} from "../email-template";
import type { EmailProductGridItem, EmailProductRowItem } from "../email-products";
import type { BundleOfferBlockInput } from "../bundle-email";
import { defaultHeroImageUrl } from "../email-hero";
import { campaignMoDeeplinkUrl } from "../campaign-flags.mjs";

const RED = "#e30613";

/**
 * Whether the DEFAULT hero asset (public/email-hero-default.jpg) is itself
 * AI-generated. It is — it was produced from the same kind of image prompt as
 * the per-send heroes — so every hero this design renders carries the
 * AI-generated disclosure. Flip this to false only if the default is ever
 * replaced by a real photograph; per-send heroes (gpt-image-1) are always
 * labelled regardless.
 */
const DEFAULT_HERO_IS_AI_GENERATED = true;

/**
 * The AI-generated-image disclosure on the hero (EU AI Act transparency
 * obligations, Art. 50 — synthetic image content must be recognisable as
 * such). A small, legible pill in the hero's picture region; plain HTML text
 * so it survives every mail client and is readable by assistive technology.
 * Rendered in the recipient's language.
 */
function aiImageLabel(en: boolean, extraClass = ""): string {
  const text = en ? "AI-generated image" : "KI-generiertes Bild";
  return `<div class="ai-label${extraClass ? ` ${extraClass}` : ""}" title="${escapeAttr(text)}" style="display:inline-block; font-family:${FONT}; font-size:10px; line-height:14px; color:#555555; background-color:#f2f2f2; border:1px solid #d9d9d9; border-radius:3px; padding:2px 7px; letter-spacing:0.2px; white-space:nowrap;">${escapeHtml(text)}</div>`;
}
const FONT = "Arial, Helvetica, sans-serif";

const textStyle = () =>
  `font-family: ${FONT}; font-size: 14px; line-height: 22px; color: #333333; Margin: 0;`;
const mutedTextStyle = () =>
  `font-family: ${FONT}; font-size: 11px; line-height: 16px; color: #555555; Margin: 0;`;
const linkStyle = () => `color: ${RED}; text-decoration: underline; word-wrap: break-word;`;

// ── Per-kind hero copy (headline comes from opts.heading) ────────────────────

interface HeroCopy {
  kicker: (en: boolean) => string;
  /**
   * The hero HEADLINE. Deliberately NOT the composer's `heading` (which reads
   * "Deine persönliche Empfehlung" and wraps to three cramped lines in the
   * 48% hero column) but a short, punchy two-line claim — the visual anchor
   * of the original design.
   */
  headline: (en: boolean) => string;
  subline: (en: boolean) => string;
  /** Fallback CTA label when the composer's own label is too long for the
   * hero button (it would wrap to two lines). */
  shortCta: (en: boolean) => string;
}

const HERO_COPY: Record<"summary" | "doi" | "marketing" | "campaign", HeroCopy> = {
  summary: {
    kicker: (en) => (en ? "Your personal consultation" : "Deine persönliche Beratung"),
    headline: (en) => (en ? "Your plan.\nAll set." : "Deine Beratung.\nAuf einen Blick."),
    shortCta: (en) => (en ? "To checkout" : "Zur Kasse"),
    subline: (en) =>
      en
        ? "Your consultation, neatly summarised — with your selection ready to order."
        : "Deine Beratung, übersichtlich zusammengefasst — mit deiner Auswahl zum direkten Bestellen.",
  },
  doi: {
    kicker: (en) => (en ? "Almost there" : "Fast geschafft"),
    headline: (en) => (en ? "One click.\nThen you're in." : "Ein Klick.\nDann geht's los."),
    shortCta: (en) => (en ? "Confirm now" : "Jetzt bestätigen"),
    subline: (en) =>
      en
        ? "One click to confirm — then your personal recommendations are on their way."
        : "Nur noch ein Klick — dann sind deine persönlichen Empfehlungen unterwegs.",
  },
  marketing: {
    kicker: () => "Mehr aus deinem Setup",
    headline: () => "Mehr Leistung.\nMehr Fokus.",
    shortCta: () => "Warenkorb öffnen",
    subline: () => "Handverlesen auf Basis deiner Beratung — abgestimmt auf dein Training.",
  },
  campaign: {
    kicker: (en) => (en ? "More from your setup" : "Mehr aus deinem Setup"),
    headline: (en) => (en ? "More power.\nMore focus." : "Mehr Leistung.\nMehr Fokus."),
    shortCta: (en) => (en ? "Start with Mo" : "Beratung starten"),
    subline: (en) =>
      en
        ? "Hand-picked based on your recent purchases — matched to your training."
        : "Handverlesen auf Basis deiner letzten Einkäufe — abgestimmt auf dein Training.",
  },
};

// ── Building blocks ──────────────────────────────────────────────────────────

function redButton(cta: EmailCta, block = false, className = ""): string {
  return `
                    <a href="${escapeAttr(cta.url)}"${className ? ` class="${className}"` : ""} target="_blank" style="display:${block ? "block" : "inline-block"}; background:${RED}; color:#ffffff; text-align:center; padding:14px 24px; border-radius:3px; font-family:${FONT}; font-size:13px; font-weight:700; letter-spacing:0.2px; text-decoration:none;">${escapeHtml(cta.label.toUpperCase())}&nbsp;&nbsp;&#8594;</a>`;
}

function outlineButton(url: string, label: string): string {
  return `
                    <a href="${escapeAttr(url)}" target="_blank" style="display:inline-block; color:#111111; background:#ffffff; border:1px solid ${RED}; padding:10px 15px; border-radius:3px; font-family:${FONT}; font-size:11px; font-weight:700; text-decoration:none; white-space:nowrap;">${escapeHtml(label.toUpperCase())}&nbsp;&#8594;</a>`;
}

/** The "— TITLE —" section divider (replaces the classic black band). */
function sectionBand(title: string): string {
  return `
                <tr>
                  <td class="content-pad" style="padding: 22px 40px 14px 40px;" bgcolor="#ffffff">
                    <table width="100%" role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td width="30%" style="border-top: 1px solid #cfcfcf; font-size: 0; line-height: 0;">&nbsp;</td>
                        <td align="center" style="padding: 0 14px; font-family: ${FONT}; color: #111111; font-size: 17px; line-height: 23px; font-weight: 800; letter-spacing: 0.5px; white-space: nowrap;">${escapeHtml(title.toUpperCase())}</td>
                        <td width="30%" style="border-top: 1px solid #cfcfcf; font-size: 0; line-height: 0;">&nbsp;</td>
                      </tr>
                    </table>
                  </td>
                </tr>`;
}

function sectionRow(innerHtml: string, opts: EmailSectionRowOptions = {}): string {
  const padding = opts.padding ?? "16px 40px";
  const align = opts.align ?? "left";
  const bgcolor = opts.bgcolor ?? "#ffffff";
  return `
                <tr>
                  <td class="content-pad" align="${align}" bgcolor="${bgcolor}" style="padding: ${padding};" valign="top">${innerHtml}
                  </td>
                </tr>`;
}

/** Longest description a card shows — the original design's cards stay two to
 * three lines; catalog copy can run far longer and would tower over the image. */
const MAX_CARD_DESCRIPTION_CHARS = 150;

function clampDescription(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= MAX_CARD_DESCRIPTION_CHARS) return t;
  const cut = t.slice(0, MAX_CARD_DESCRIPTION_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 60 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\-·]+$/, "")}…`;
}

/** One bordered product card: image | name + rule + description | price + button. */
function productCard(item: EmailProductRowItem): string {
  const href = item.url ? escapeAttr(item.url) : null;
  const image = item.imageUrl
    ? `<img src="${escapeAttr(item.imageUrl)}" width="165" alt="${escapeAttr(item.name)}" class="product-image" style="width:165px; max-width:100%; height:auto; display:block; Margin:0 auto; border:none;">`
    : "";
  const price = item.priceLabel
    ? item.compareAtLabel
      ? `<div style="font-family:${FONT}; font-size:12px; line-height:16px; color:#777777; text-decoration:line-through; margin-bottom:2px;">${escapeHtml(item.compareAtLabel)}</div>
         <div style="font-family:${FONT}; font-size:20px; line-height:24px; font-weight:700; color:${RED}; margin-bottom:14px;">${escapeHtml(item.priceLabel)}</div>`
      : `<div style="font-family:${FONT}; font-size:20px; line-height:24px; font-weight:700; color:#111111; margin-bottom:14px;">${escapeHtml(item.priceLabel)}</div>`
    : "";
  const description = item.description?.trim()
    ? `<div style="font-family:${FONT}; font-size:12px; line-height:18px; color:#444444;">${escapeHtml(clampDescription(item.description))}</div>`
    : "";
  const button = href ? outlineButton(item.url as string, item.ctaLabel?.trim() || "Zum Produkt") : "";
  const name = href
    ? `<a href="${href}" target="_blank" style="color:#111111; text-decoration:none;">${escapeHtml(item.name)}</a>`
    : escapeHtml(item.name);
  return `
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="product-card" style="width:100%; border:1px solid #e5e5e5; border-radius:7px;">
                      <tr>
                        <td width="32%" valign="middle" class="mobile-stack" style="width:32%; padding:16px;">${image || "&nbsp;"}
                        </td>
                        <td width="40%" valign="middle" class="mobile-stack product-content" style="width:40%; padding:16px 10px;">
                          <div style="font-family:${FONT}; font-size:16px; line-height:21px; font-weight:700; color:#111111;">${name}</div>
                          <div style="width:14px; height:2px; background:${RED}; margin:10px 0; font-size:0; line-height:0;">&nbsp;</div>
                          ${description}
                        </td>
                        <td width="28%" valign="middle" align="center" class="mobile-stack product-action" style="width:28%; padding:16px 12px;">
                          ${price}
                          ${button}
                        </td>
                      </tr>
                    </table>
                    <div style="height:8px; font-size:0; line-height:0;">&nbsp;</div>`;
}

function productRows(items: EmailProductRowItem[]): string {
  return items.map(productCard).join("");
}

function productGrid(items: EmailProductGridItem[]): string {
  // Grid callers (summary sections) get the SAME card language — one visual
  // system for every product presentation in this design.
  return items.map((item) => productCard(item)).join("");
}

/** The black BUNDLE-DEAL card with badge, component images and price trio. */
function bundleBlock(input: BundleOfferBlockInput, c: BundleBlockComputed): string {
  const en = (input.language ?? "de") === "en";
  const images = input.components
    .map((comp) => comp.imageUrl)
    .filter((u): u is string => Boolean(u))
    .slice(0, 2)
    .map(
      (u) =>
        `<img src="${escapeAttr(u)}" width="104" alt="" style="width:104px; height:104px; object-fit:cover; display:inline-block; border-radius:4px; background:#ffffff; margin:2px;">`
    )
    .join("");
  const priceCells =
    (c.stattLabel
      ? `
                          <td style="font-family:${FONT}; color:#ffffff; font-size:10px; line-height:14px; padding-right:12px;">${en ? "Separately" : "Einzelkauf"}<br><strong style="font-size:16px; text-decoration:line-through;">${escapeHtml(c.stattLabel)}</strong></td>`
      : "") +
    `
                          <td style="font-family:${FONT}; color:#ffffff; font-size:10px; line-height:14px; padding-right:12px;">${escapeHtml(c.labels.price)}<br><strong style="font-size:22px; color:${RED};">${escapeHtml(c.priceLabel)}</strong></td>` +
    (c.savingLabel && c.savingPct != null
      ? `
                          <td style="font-family:${FONT}; color:#ffffff; font-size:10px; line-height:14px;">${escapeHtml(c.labels.save)}<br><strong style="font-size:16px; color:${RED};">${escapeHtml(c.savingLabel)}</strong></td>`
      : "");
  const componentNames = input.components.map((comp) => escapeHtml(comp.name)).join(" · ");
  return `
                <tr>
                  <td class="content-pad" style="padding: 8px 38px 16px 38px;" bgcolor="#ffffff">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; background:#111111; border-radius:7px;">
                      <tr>
                        <td width="42%" valign="middle" align="center" class="bundle-column" style="width:42%; padding:22px;">
                          <div style="display:inline-block; background:${RED}; color:#ffffff; font-family:${FONT}; font-size:11px; line-height:14px; font-weight:700; padding:9px 12px; border-radius:30px; margin-bottom:12px;">BUNDLE DEAL</div>
                          <div>${images || "&nbsp;"}</div>
                        </td>
                        <td width="58%" valign="middle" class="bundle-column" style="width:58%; padding:24px 24px 24px 0;">
                          <div style="font-family:${FONT}; font-size:20px; line-height:25px; color:#ffffff; font-weight:700; margin-bottom:8px;">${escapeHtml(input.title)}</div>
                          <div style="font-family:${FONT}; font-size:11px; line-height:16px; color:#bbbbbb; margin-bottom:16px;">${componentNames}</div>
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${priceCells}
                          </tr></table>
                          <div style="height:18px; font-size:0; line-height:0;">&nbsp;</div>
                          ${redButton({ label: c.labels.cta, url: input.offerUrl }, true)}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>`;
}

/**
 * The smiley rating row ("Wie hilfreich war diese Empfehlung?"). Anonymous by
 * design: each link carries only the score + email kind (email-rating.mjs), so
 * a forwarded mail can never reveal the recipient. Rendered for the two
 * recommendation mails, where the question actually makes sense.
 */
function ratingRow(kind: string, en: boolean): string {
  const base = getBaseUrl();
  const cells = EMAIL_RATING_FACES.map(
    (face, i) => `
                          <td align="center" style="padding: 0 6px;">
                            <a href="${escapeAttr(emailRatingUrl(base, i + 1, kind))}" target="_blank" style="font-family:${FONT}; font-size:28px; line-height:34px; color:#111111; text-decoration:none;">${face}</a>
                            <div style="font-family:${FONT}; font-size:11px; line-height:16px; color:#111111;">${i + 1}</div>
                          </td>`
  ).join("");
  return `
                <tr>
                  <td class="content-pad" style="padding: 0 38px 16px 38px;" bgcolor="#ffffff">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e5e5e5; border-radius:7px;">
                      <tr>
                        <td align="center" style="padding: 22px 20px 18px 20px;">
                          <div style="font-family:${FONT}; font-size:18px; line-height:23px; color:#111111; font-weight:700;">${
                            en ? "How helpful was this recommendation?" : "Wie hilfreich war diese Empfehlung?"
                          }</div>
                          <div style="margin-top:4px; font-family:${FONT}; font-size:11px; line-height:16px; color:#555555;">${
                            en ? "Rate this email with one click." : "Bewerte diese E-Mail mit einem Klick."
                          }</div>
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="Margin: 16px auto 0;">
                            <tr>${cells}
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>`;
}

/** Greeting words the AI prose may already open with (any language we send). */
const GREETING_RE = /^\s*(hallo|hey|hi|guten|liebe|servus|moin|dear|hello)\b/i;

/**
 * The bold personal opener ("Hey Anna-Sophie,") — rendered only when we know
 * the first name AND the prose does not already greet, so the reader never
 * gets two greetings stacked on each other.
 */
function greetingHtml(bodyHtml: string, en: boolean): string {
  const firstName = (activeEmailRenderData().recipientFirstName ?? "").trim();
  if (!firstName) return "";
  const proseText = bodyHtml.replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").trim();
  if (GREETING_RE.test(proseText)) return "";
  return `
                  <div style="font-family:${FONT}; font-size:18px; line-height:25px; font-weight:700; color:#111111; margin-bottom:13px;">${
                    en ? "Hey" : "Hey"
                  } ${escapeHtml(firstName)},</div>`;
}

/**
 * The campaign mail's Mo promo, rendered as the SAME advisor card the other
 * types get — with the tracked CTA url the campaign funnel counts.
 */
function moPromoCard(input: MoPromoBlockInput): string {
  const en = input.language === "en";
  return `
                <tr>
                  <td class="content-pad" style="padding: 8px 38px 16px 38px;" bgcolor="#ffffff">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fafafa; border:1px solid #e5e5e5; border-radius:7px;">
                      <tr>
                        <td width="22%" align="center" valign="middle" class="mobile-stack" style="padding:18px;">
                          <img src="${escapeAttr(emailMoIconUrl())}" width="74" height="74" alt="Mo" style="width:74px; height:74px; border-radius:50%; display:block; Margin:0 auto;">
                        </td>
                        <td width="45%" valign="middle" class="mobile-stack mobile-center" style="padding:18px 8px;">
                          <div style="font-family:${FONT}; font-size:18px; line-height:23px; font-weight:700; color:#111111;">${
                            en ? "Not sure yet? Ask Mo." : "Noch unsicher? Frag Mo."
                          }</div>
                          <div style="margin-top:6px; font-family:${FONT}; font-size:11px; line-height:16px; color:#444444;">${escapeHtml(
                            input.introText
                          )}</div>
                        </td>
                        <td width="33%" align="center" valign="middle" class="mobile-stack" style="padding:18px;">
                          <a href="${escapeAttr(input.ctaUrl)}" target="_blank" style="display:inline-block; border:1px solid #111111; color:#111111; padding:11px 15px; border-radius:3px; font-family:${FONT}; font-size:10px; font-weight:700; text-decoration:none;">${escapeHtml(
                            input.ctaLabel.toUpperCase()
                          )}&nbsp;&#8594;</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>`;
}

/** The "Noch unsicher? Frag Mo." advisor panel (rendered when moAvatar set). */
function moPanel(en: boolean): string {
  const url = campaignMoDeeplinkUrl();
  return `
                <tr>
                  <td class="content-pad" style="padding: 0 38px 16px 38px;" bgcolor="#ffffff">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fafafa; border:1px solid #e5e5e5; border-radius:7px;">
                      <tr>
                        <td width="22%" align="center" valign="middle" class="mobile-stack" style="padding:18px;">
                          <img src="${escapeAttr(emailMoIconUrl())}" width="74" height="74" alt="Mo" style="width:74px; height:74px; border-radius:50%; display:block; Margin:0 auto;">
                        </td>
                        <td width="43%" valign="middle" class="mobile-stack mobile-center" style="padding:18px 8px;">
                          <div style="font-family:${FONT}; font-size:18px; line-height:23px; font-weight:700; color:#111111;">${en ? "Not sure yet? Ask Mo." : "Noch unsicher? Frag Mo."}</div>
                          <div style="margin-top:6px; font-family:${FONT}; font-size:11px; line-height:16px; color:#444444;">${
                            en
                              ? "Our personal AI advisor helps you find the right gear for your training and your existing equipment."
                              : "Unser persönlicher KI-Berater hilft dir dabei, passendes Zubehör für dein Training und dein vorhandenes Equipment zu finden."
                          }</div>
                        </td>
                        <td width="35%" align="center" valign="middle" class="mobile-stack" style="padding:18px;">
                          <a href="${escapeAttr(url)}" target="_blank" style="display:inline-block; border:1px solid #111111; color:#111111; padding:11px 15px; border-radius:3px; font-family:${FONT}; font-size:10px; font-weight:700; text-decoration:none;">${en ? "START A CHAT WITH MO" : "BERATUNG MIT MO STARTEN"}&nbsp;&#8594;</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>`;
}

function socialRow(): string {
  const cells = EMAIL_SOCIAL_LINKS.map(
    (s) => `
                          <td align="center" valign="middle" style="padding: 0 7px;">
                            <a href="${escapeAttr(s.url)}" target="_blank" style="text-decoration:none;"><img src="${escapeAttr(s.icon)}" alt="${escapeAttr(s.alt)}" width="20" height="20" border="0" style="width:20px; height:20px; display:block; border:none;"></a>
                          </td>`
  ).join("");
  return `
                    <table cellspacing="0" cellpadding="0" border="0" align="center" role="presentation" style="Margin: 0 auto 12px;">
                      <tr>${cells}
                      </tr>
                    </table>`;
}

// ── The shell ────────────────────────────────────────────────────────────────

function makeShell(kind: keyof typeof HERO_COPY) {
  return function shell(opts: BrandedEmailOptions): string {
    const en = (opts.locale ?? "de") === "en";
    const copy = HERO_COPY[kind];
    const year = new Date().getFullYear();
    const heroImage = activeEmailRenderData().heroImageUrl || defaultHeroImageUrl();
    // Per-send heroes are always AI-generated; the default asset is too (see
    // DEFAULT_HERO_IS_AI_GENERATED). The disclosure follows the picture.
    const heroIsAi = Boolean(activeEmailRenderData().heroImageUrl) || DEFAULT_HERO_IS_AI_GENERATED;
    // The hero button reuses the composer's primary CTA (its URL is the tracked
    // one), but swaps an over-long label for the design's short one so the
    // button stays a single line.
    const primaryCta = (opts.ctas ?? []).find((c) => c.url && c.label) ?? null;
    const heroCta = primaryCta
      ? {
          url: primaryCta.url,
          label: primaryCta.label.length > 18 ? copy.shortCta(en) : primaryCta.label,
        }
      : null;
    // Two-line claim: the per-send AI headline (operator-edited, hero panel)
    // wins over the design's per-type default; both carry "\n" line breaks.
    const claim = (activeEmailRenderData().heroHeadline ?? "").trim() || copy.headline(en);
    const headlineHtml = escapeHtml(claim).replace(/\n/g, "<br>");

    const preheaderHtml = opts.preheader
      ? `
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent; font-size:1px; line-height:1px;">${escapeHtml(opts.preheader)}</div>
  <div style="display:none; max-height:0; overflow:hidden; opacity:0;">&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;</div>`
      : "";

    // The hero button already carries the FIRST CTA, so only any additional
    // ones get their own row — otherwise the same call-to-action appeared
    // twice (hero + body), which is exactly what the campaign mail did.
    const ctaRows = (opts.ctas ?? [])
      .filter((c) => c.url && c.label)
      .slice(1)
      .map((c) => sectionRow(redButton(c), { padding: "6px 40px", align: "center" }))
      .join("");

    const footnoteRow = opts.footnoteHtml
      ? sectionRow(opts.footnoteHtml, { padding: "8px 40px", align: "center" })
      : "";

    const unsubscribeBlock = opts.footer?.unsubscribeHtml
      ? `
                <!-- BEGIN: Unsubscribe (legally required on marketing email) -->
                <tr>
                  <td align="center" style="padding: 6px 45px 0 45px;">${opts.footer.unsubscribeHtml}</td>
                </tr>
                <!-- END: Unsubscribe -->`
      : "";

    return `<!DOCTYPE html>
<html lang="${opts.locale ?? "de"}">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light only">
    <title>${escapeHtml(opts.subject)}</title>
    <style type="text/css">
      /* Progressive enhancement ONLY — every critical style is inline. */
      html, body { Margin: 0 auto !important; padding: 0 !important; width: 100% !important; }
      table { border-collapse: collapse !important; border-spacing: 0 !important; }
      img { -ms-interpolation-mode: bicubic; border: none !important; }
      @media only screen and (max-width: 640px) {
        /* border-box matters: these cells are width:100% AND padded — in the
           default content-box that adds up to more than the card width and
           pushes a horizontal scrollbar onto the whole email. */
        .email-container, .mobile-stack, .bundle-column, .content-pad,
        .hero-text, .hero-bg { box-sizing: border-box !important; }
        .email-container { width: 100% !important; min-width: 100% !important; }
        .content-pad { padding-left: 20px !important; padding-right: 20px !important; }
        .mobile-stack { display: block !important; width: 100% !important; }
        .mobile-center { text-align: center !important; }
        .logo-image { width: 170px !important; max-width: 70% !important; }
        /* Phones: no background image behind the text (unreadable at 390px) —
           the artwork moves into its own full-width row below the copy. */
        .hero-bg { background-image: none !important; background-color: #f7f7f7 !important; height: auto !important; }
        .hero-text { width: 100% !important; padding: 28px 22px 24px 22px !important; }
        .hero-spacer { display: none !important; }
        .hero-title { font-size: 32px !important; line-height: 36px !important; letter-spacing: -1px !important; }
        .hero-sub { max-width: 100% !important; }
        .hero-cta { display: block !important; width: 100% !important; box-sizing: border-box !important; text-align: center !important; }
        .hero-mobile-img { display: block !important; }
        .hero-mobile-label { display: block !important; }
        .product-image { width: 100% !important; max-width: 190px !important; margin: 0 auto !important; }
        .product-content { padding: 6px 20px 12px 20px !important; text-align: center !important; }
        .product-action { padding: 0 20px 20px 20px !important; text-align: center !important; }
        .bundle-column { display: block !important; width: 100% !important; text-align: center !important; padding: 22px !important; }
      }
    </style>
  </head>
  <body style="Margin:0; padding:0; background:#f5f5f5; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;" bgcolor="#f5f5f5">${preheaderHtml}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f5f5" style="width:100%; background:#f5f5f5;">
      <tr>
        <td align="center" valign="top">
          <!-- BEGIN: CARD -->
          <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" class="email-container" bgcolor="#ffffff" style="width:640px; max-width:640px; background:#ffffff; table-layout:fixed;">
            <tbody>
              <!-- HEADER: the real brand logo, given the room the original
                   design gives it. No chip nav: the brand asset already carries
                   the "Fitness | Equipment" bar, so a nav row underneath only
                   duplicated it. -->
              <tr>
                <td align="center" style="padding: 30px 30px 22px 30px;" bgcolor="#ffffff">
                  <a href="https://www.motionsports.de" target="_blank" style="text-decoration:none;">
                    <img src="${escapeAttr(emailLogoUrl())}" width="200" alt="motion sports" class="logo-image" style="width:200px; max-width:70%; height:auto; display:block; Margin:0 auto;">
                  </a>
                </td>
              </tr>
              <!-- HERO — the image spans the FULL card width as a background;
                   the headline sits on its deliberately faded left half (the
                   fade is baked into the artwork, see HERO_PROMPT_STYLE_TAIL).
                   Bulletproof pattern: background= attribute + inline
                   background shorthand for Gmail/Apple Mail, VML rect for
                   Outlook desktop, bgcolor fallback when images are blocked.
                   On phones the background is dropped and the picture shows
                   as a normal image UNDER the text (.hero-bg / .hero-mobile-img). -->
              <tr>
                <td class="hero-bg" align="left" valign="middle" background="${escapeAttr(heroImage)}" bgcolor="#f2f2f2" height="300" style="padding:0; background-color:#f2f2f2; background-image:url('${escapeAttr(heroImage)}'); background-position:center right; background-size:cover; background-repeat:no-repeat;">
                  <!--[if gte mso 9]>
                  <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:640px;height:300px;">
                    <v:fill type="frame" src="${escapeAttr(heroImage)}" color="#f2f2f2" />
                    <v:textbox inset="0,0,0,0"><![endif]-->
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
                    <tr>
                      <td class="hero-text" width="55%" valign="middle" style="width:55%; padding:36px 20px 36px 40px;">
                        <div style="font-family:${FONT}; color:${RED}; font-size:11px; line-height:16px; font-weight:700; letter-spacing:0.4px; text-transform:uppercase; margin-bottom:12px;">${escapeHtml(copy.kicker(en))}</div>
                        <div class="hero-title" style="font-family:${FONT}; font-size:40px; line-height:44px; color:#111111; font-weight:800; letter-spacing:-1.5px; margin-bottom:14px;">${headlineHtml}</div>
                        <div class="hero-sub" style="font-family:${FONT}; font-size:14px; line-height:21px; color:#333333; margin-bottom:22px; max-width:300px;">${escapeHtml(copy.subline(en))}</div>
                        ${heroCta ? redButton(heroCta, false, "hero-cta") : ""}
                      </td>
                      <td width="45%" class="hero-spacer" valign="bottom" align="right" style="width:45%; font-size:0; line-height:0; padding:0 12px 10px 0;">${heroIsAi ? aiImageLabel(en) : "&nbsp;"}</td>
                    </tr>
                  </table>
                  <!--[if gte mso 9]></v:textbox></v:rect><![endif]-->
                </td>
              </tr>
              <!-- Mobile-only hero picture: the background is switched off on
                   phones (a 640px-wide crop behind 20px-padded text is
                   unreadable), so the artwork gets its own full-width row. -->
              <tr class="hero-mobile-row">
                <td class="hero-mobile-cell" style="padding:0; font-size:0; line-height:0;">
                  <img src="${escapeAttr(heroImage)}" width="640" alt="${heroIsAi ? (en ? "AI-generated image — motion sports" : "KI-generiertes Bild — motion sports") : "motion sports"}" class="hero-mobile-img" style="width:100%; max-width:100%; height:auto; display:none;">${
                    heroIsAi
                      ? `<div class="hero-mobile-label" style="display:none; padding:6px 20px 0 20px; text-align:right; font-size:0; line-height:0;">${aiImageLabel(en)}</div>`
                      : ""
                  }
                </td>
              </tr>
              <!-- BODY (personal greeting + prose from the composer) -->
              <tr>
                <td class="content-pad" style="padding: 30px 44px 6px 44px;" bgcolor="#ffffff" valign="top">${greetingHtml(
                  opts.bodyHtml,
                  en
                )}${opts.bodyHtml}
                </td>
              </tr>
              <!-- SECTIONS (products / bundle / promo rows from the composer) -->${opts.preCtaRowsHtml ?? ""}${ctaRows}${footnoteRow}${opts.postCtaRowsHtml ?? ""}${
                opts.moAvatar ? moPanel(en) : ""
              }${kind === "marketing" || kind === "campaign" ? ratingRow(kind, en) : ""}
              <!-- FOOTER -->
              <tr>
                <td align="center" style="padding: 14px 30px 12px 30px; border-top: 1px solid #eeeeee;" bgcolor="#ffffff">
                  ${socialRow()}
                  <div style="font-family:${FONT}; font-size:10px; line-height:15px; color:#333333;">
                    <strong>4motionsports GmbH</strong><br>
                    Am Weidegrund 1, 82194 Gr&#246;benzell, Deutschland<br>
                    Gesch&#228;ftsf&#252;hrer: Sabine Brunner, Lucas Brunner<br><br>
                    <a href="tel:+49(0)8142%20448666" style="color:#111111; text-decoration:underline;">+49(0)8142 448666</a>
                    &nbsp;&#183;&nbsp;
                    <a href="mailto:info@motionsports.de" style="color:#111111; text-decoration:underline;">info@motionsports.de</a>
                  </div>
                </td>
              </tr>${unsubscribeBlock}
              <tr>
                <td align="center" style="padding: 10px 45px 28px 45px;" bgcolor="#ffffff">
                  <div style="font-family:${FONT}; font-size:10px; line-height:15px; color:#666666;">&#169; ${year} motion sports &#183; <a href="${escapeAttr(EMAIL_IMPRINT_URL)}" target="_blank" style="color:#666666; text-decoration:underline;">${en ? "Imprint" : "Impressum"}</a></div>
                </td>
              </tr>
            </tbody>
          </table>
          <!-- END: CARD -->
        </td>
      </tr>
    </table>
  </body>
</html>`;
  };
}

// ── The definition ───────────────────────────────────────────────────────────

export const performanceDesign: EmailDesignDefinition = {
  key: "performance",
  name: "Performance",
  description:
    "Bild-orientiertes Conversion-Design: großer Hero mit (KI-generierbarem) Lifestyle-Bild, Produkt-Karten mit Preis & Button, schwarze Bundle-Deal-Karte, Frag-Mo-Panel.",
  addedAt: "2026-08-31",

  renderers: {
    shell: makeShell("marketing"),
    sectionBand,
    sectionRow,
    ctaButton: (cta) => redButton(cta),
    productRows,
    productGrid,
    bundleBlock,
    moPromoBlock: moPromoCard,
    textStyle,
    mutedTextStyle,
    linkStyle,
  },

  variants: {
    summary: { renderers: { shell: makeShell("summary") } },
    doi: { renderers: { shell: makeShell("doi") } },
    marketing: { renderers: { shell: makeShell("marketing") } },
    campaign: { renderers: { shell: makeShell("campaign") } },
  },
};
