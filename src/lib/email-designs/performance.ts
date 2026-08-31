// "Performance" — the image-first conversion design, built from the operator's
// AI-drafted template: bold hero section (kicker, oversized headline, red CTA,
// large lifestyle image), chip navigation under the logo, bordered product
// CARDS with price + outline button, the black BUNDLE-DEAL card with the
// price trio, the "Frag Mo" advisor panel, and a clean minimal footer.
//
// Personalisation hooks:
//   - HERO IMAGE: activeEmailRenderData().heroImageUrl (the operator-generated
//     per-send image, lib/email-hero.ts) with the static brand asset as
//     default (public/email-hero-default.jpg / EMAIL_HERO_DEFAULT_URL).
//   - Headline = the email's heading; kicker/subline are tailored per email
//     type via variants (bilingual for the campaign channel).
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
} from "../email-design-context";
import { activeEmailRenderData } from "../email-design-context";
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
const FONT = "Arial, Helvetica, sans-serif";

const textStyle = () =>
  `font-family: ${FONT}; font-size: 14px; line-height: 22px; color: #333333; Margin: 0;`;
const mutedTextStyle = () =>
  `font-family: ${FONT}; font-size: 11px; line-height: 16px; color: #555555; Margin: 0;`;
const linkStyle = () => `color: ${RED}; text-decoration: underline; word-wrap: break-word;`;

// ── Per-kind hero copy (headline comes from opts.heading) ────────────────────

interface HeroCopy {
  kicker: (en: boolean) => string;
  subline: (en: boolean) => string;
}

const HERO_COPY: Record<"summary" | "doi" | "marketing" | "campaign", HeroCopy> = {
  summary: {
    kicker: (en) => (en ? "Your personal consultation" : "Deine persönliche Beratung"),
    subline: (en) =>
      en
        ? "Your consultation, neatly summarised — with your selection ready to order."
        : "Deine Beratung, übersichtlich zusammengefasst — mit deiner Auswahl zum direkten Bestellen.",
  },
  doi: {
    kicker: (en) => (en ? "Almost there" : "Fast geschafft"),
    subline: (en) =>
      en
        ? "One click to confirm — then your personal recommendations are on their way."
        : "Nur noch ein Klick — dann sind deine persönlichen Empfehlungen unterwegs.",
  },
  marketing: {
    kicker: () => "Persönlich für dich",
    subline: () => "Handverlesen auf Basis deiner Beratung — abgestimmt auf dein Training.",
  },
  campaign: {
    kicker: (en) => (en ? "Picked for you" : "Für dich entdeckt"),
    subline: (en) =>
      en
        ? "Hand-picked based on your recent purchases — matched to your training."
        : "Handverlesen auf Basis deiner letzten Einkäufe — abgestimmt auf dein Training.",
  },
};

// ── Building blocks ──────────────────────────────────────────────────────────

function redButton(cta: EmailCta, block = false): string {
  return `
                    <a href="${escapeAttr(cta.url)}" target="_blank" style="display:${block ? "block" : "inline-block"}; background:${RED}; color:#ffffff; text-align:center; padding:14px 24px; border-radius:3px; font-family:${FONT}; font-size:13px; font-weight:700; letter-spacing:0.2px; text-decoration:none;">${escapeHtml(cta.label.toUpperCase())}&nbsp;&nbsp;&#8594;</a>`;
}

function outlineButton(url: string, label: string): string {
  return `
                    <a href="${escapeAttr(url)}" target="_blank" style="display:inline-block; color:#111111; background:#ffffff; border:1px solid ${RED}; padding:10px 15px; border-radius:3px; font-family:${FONT}; font-size:11px; font-weight:700; text-decoration:none;">${escapeHtml(label.toUpperCase())}&nbsp;&#8594;</a>`;
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

/** One bordered product card: image | name + rule + description | price + button. */
function productCard(item: EmailProductRowItem): string {
  const href = item.url ? escapeAttr(item.url) : null;
  const image = item.imageUrl
    ? `<img src="${escapeAttr(item.imageUrl)}" width="150" alt="${escapeAttr(item.name)}" class="product-image" style="width:150px; max-width:100%; height:auto; display:block; Margin:0 auto; border:none;">`
    : "";
  const price = item.priceLabel
    ? item.compareAtLabel
      ? `<div style="font-family:${FONT}; font-size:12px; line-height:16px; color:#777777; text-decoration:line-through; margin-bottom:2px;">${escapeHtml(item.compareAtLabel)}</div>
         <div style="font-family:${FONT}; font-size:20px; line-height:24px; font-weight:700; color:${RED}; margin-bottom:14px;">${escapeHtml(item.priceLabel)}</div>`
      : `<div style="font-family:${FONT}; font-size:20px; line-height:24px; font-weight:700; color:#111111; margin-bottom:14px;">${escapeHtml(item.priceLabel)}</div>`
    : "";
  const description = item.description?.trim()
    ? `<div style="font-family:${FONT}; font-size:12px; line-height:18px; color:#444444;">${escapeHtml(item.description.trim())}</div>`
    : "";
  const button = href ? outlineButton(item.url as string, item.ctaLabel?.trim() || "Zum Produkt") : "";
  const name = href
    ? `<a href="${href}" target="_blank" style="color:#111111; text-decoration:none;">${escapeHtml(item.name)}</a>`
    : escapeHtml(item.name);
  return `
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="product-card" style="width:100%; border:1px solid #e5e5e5; border-radius:7px;">
                      <tr>
                        <td width="34%" valign="middle" class="mobile-stack" style="width:34%; padding:18px;">${image || "&nbsp;"}
                        </td>
                        <td width="42%" valign="middle" class="mobile-stack product-content" style="width:42%; padding:18px 10px;">
                          <div style="font-family:${FONT}; font-size:16px; line-height:21px; font-weight:700; color:#111111;">${name}</div>
                          <div style="width:14px; height:2px; background:${RED}; margin:10px 0; font-size:0; line-height:0;">&nbsp;</div>
                          ${description}
                        </td>
                        <td width="24%" valign="middle" align="center" class="mobile-stack product-action" style="width:24%; padding:18px;">
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
    const heroCta = (opts.ctas ?? []).find((c) => c.url && c.label) ?? null;

    const preheaderHtml = opts.preheader
      ? `
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent; font-size:1px; line-height:1px;">${escapeHtml(opts.preheader)}</div>
  <div style="display:none; max-height:0; overflow:hidden; opacity:0;">&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;</div>`
      : "";

    const ctaRows = (opts.ctas ?? [])
      .filter((c) => c.url && c.label)
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
        .email-container { width: 100% !important; min-width: 100% !important; }
        .content-pad { padding-left: 20px !important; padding-right: 20px !important; }
        .mobile-stack { display: block !important; width: 100% !important; }
        .mobile-center { text-align: center !important; }
        .hero-title { font-size: 34px !important; line-height: 38px !important; }
        .hero-image { width: 100% !important; max-width: 280px !important; margin: 0 auto !important; }
        .product-image { width: 100% !important; max-width: 200px !important; margin: 0 auto !important; }
        .product-content { padding: 10px 20px 14px 20px !important; text-align: center !important; }
        .product-action { padding: 0 20px 22px 20px !important; text-align: center !important; }
        .bundle-column { display: block !important; width: 100% !important; text-align: center !important; padding: 22px !important; }
      }
    </style>
  </head>
  <body style="Margin:0; padding:0; background:#f5f5f5; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;" bgcolor="#f5f5f5">${preheaderHtml}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f5f5" style="width:100%; background:#f5f5f5;">
      <tr>
        <td align="center" valign="top">
          <!-- BEGIN: CARD -->
          <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" class="email-container" bgcolor="#ffffff" style="width:640px; max-width:640px; background:#ffffff;">
            <tbody>
              <!-- HEADER: real brand logo + chip nav -->
              <tr>
                <td align="center" style="padding: 30px 30px 12px 30px;" bgcolor="#ffffff">
                  <a href="https://www.motionsports.de" target="_blank" style="text-decoration:none;">
                    <img src="${escapeAttr(emailLogoUrl())}" width="140" alt="motion sports" style="width:140px; max-width:100%; height:auto; display:block; Margin:0 auto;">
                  </a>
                </td>
              </tr>
              <tr>
                <td align="center" style="padding: 0 20px 20px 20px;" bgcolor="#ffffff">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="font-family:${FONT}; font-size:13px; color:#111111; padding:0 14px;"><a href="https://www.motionsports.de" target="_blank" style="color:#111111; text-decoration:none;">Fitness</a></td>
                      <td style="font-family:${FONT}; font-size:13px; color:#111111; font-weight:700; border-bottom:2px solid ${RED}; padding:0 14px 5px 14px;"><a href="https://www.motionsports.de" target="_blank" style="color:#111111; text-decoration:none;">Equipment</a></td>
                    </tr>
                  </table>
                </td>
              </tr>
              <!-- HERO -->
              <tr>
                <td style="padding: 0 24px;" bgcolor="#ffffff">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f7f7; border-radius:8px;">
                    <tr>
                      <td width="48%" valign="middle" class="mobile-stack mobile-center" style="width:48%; padding:40px 15px 40px 32px;">
                        <div style="font-family:${FONT}; color:${RED}; font-size:11px; line-height:16px; font-weight:700; letter-spacing:0.4px; text-transform:uppercase; margin-bottom:14px;">${escapeHtml(copy.kicker(en))}</div>
                        <div class="hero-title" style="font-family:${FONT}; font-size:40px; line-height:44px; color:#111111; font-weight:800; letter-spacing:-1.5px; margin-bottom:16px;">${escapeHtml(opts.heading)}</div>
                        <div style="font-family:${FONT}; font-size:14px; line-height:21px; color:#444444; margin-bottom:24px;">${escapeHtml(copy.subline(en))}</div>
                        ${heroCta ? redButton(heroCta) : ""}
                      </td>
                      <td width="52%" valign="bottom" class="mobile-stack" align="center" style="width:52%;">
                        <img src="${escapeAttr(heroImage)}" width="310" alt="motion sports" class="hero-image" style="width:100%; max-width:310px; height:auto; display:block; border-radius:0 8px 8px 0;">
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <!-- BODY (personal intro / prose from the composer) -->
              <tr>
                <td class="content-pad" style="padding: 30px 44px 6px 44px;" bgcolor="#ffffff" valign="top">${opts.bodyHtml}
                </td>
              </tr>
              <!-- SECTIONS (products / bundle / promo rows from the composer) -->${opts.preCtaRowsHtml ?? ""}${ctaRows}${footnoteRow}${opts.postCtaRowsHtml ?? ""}${
                opts.moAvatar ? moPanel(en) : ""
              }
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
