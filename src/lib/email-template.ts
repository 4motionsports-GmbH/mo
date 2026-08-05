// Shared branded email shell for EVERY outgoing customer email (conversation
// summary, marketing, campaign, double-opt-in confirmation). One template, one
// brand.
//
// The design is lifted from the shop's own Shopify newsletter emails so backend
// emails look exactly like the store's manually sent mail: a 600px white card
// on #fafafa, the centered motion sports logo, Verdana/Geneva 13px type,
// FULL-WIDTH BLACK SEPARATOR BANDS with white text between sections, the
// #008ccb pill button, and the grey footer with social icons, the company
// block and the unsubscribe line.
//
// EMAIL-CLIENT ROBUSTNESS RULES — do NOT "modernise" this file:
//   - table-based layout with role="presentation" and bgcolor= attributes
//   - EVERY visual style is INLINE; the <style> block in <head> is progressive
//     enhancement only (mobile width tweaks) and the email must render
//     correctly in Gmail, Apple Mail and Outlook without it
//   - no flexbox/grid/SVG/background-images/external CSS
//   - images referenced by absolute https URLs only
//   - the header logo is a STATIC image (animated logos do not animate
//     reliably in mail clients)
//   - the OPTIONAL Mo avatar (moAvatar) is the one deliberate exception: an
//     animated GIF is the only animation email clients broadly support
//     (Gmail/Apple Mail play it; Outlook desktop shows the first frame).
//     Everything else stays static.

/** Brand accent used for CTA buttons (matches the shop's newsletter emails). */
export const EMAIL_ACCENT_COLOR = "#008ccb";

/** Red used for struck-through compare-at prices (newsletter product grid). */
export const EMAIL_SALE_STRIKE_COLOR = "#c61724";

/** Font stack used on every inline style (same as the shop's newsletters). */
export const EMAIL_FONT_FAMILY = "Verdana, Geneva, sans-serif";

/**
 * Inline style for a normal body paragraph/text cell. Callers building
 * `bodyHtml` should use this so their content matches the shell.
 */
export const EMAIL_TEXT_STYLE =
  `mso-line-height-rule: exactly; direction: ltr; font-family: ${EMAIL_FONT_FAMILY}; ` +
  `font-size: 13px; line-height: 1.5; font-weight: 400; text-transform: none; ` +
  `color: #000000; Margin: 0;`;

/** Inline style for small print (12px, black like the newsletter footer). */
export const EMAIL_MUTED_TEXT_STYLE =
  `mso-line-height-rule: exactly; direction: ltr; font-family: ${EMAIL_FONT_FAMILY}; ` +
  `font-size: 12px; line-height: 1.5; font-weight: 400; text-transform: none; ` +
  `color: #000000; Margin: 0;`;

// Static brand logo — the SAME square asset the shop's Shopify newsletter
// emails use (absolute https URL on a public CDN, NOT an animated file).
// Override with EMAIL_LOGO_URL to host a different asset.
const DEFAULT_LOGO_URL =
  "https://cdn.shopify.com/shopify-email/5qyp9svuofng6eftj0lt3qeva83o.png?width=960&height=960";

export function emailLogoUrl(): string {
  return process.env.EMAIL_LOGO_URL || DEFAULT_LOGO_URL;
}

/**
 * The Mo brand-orb avatar — the chat widget's ACTUAL animated mark, exported
 * from the frontend (theme) repo: public/moorb.gif (animated, white background
 * to blend into the email card; public/moorb2x.png is the transparent static
 * variant). Served from THIS deployment's public/. Override with
 * EMAIL_MO_ICON_URL to host a different asset.
 */
export function emailMoIconUrl(): string {
  return process.env.EMAIL_MO_ICON_URL || `${getBaseUrl()}/moorb.gif`;
}

import { escapeHtml, escapeAttr } from "./html-escape";
import { getBaseUrl } from "./base-url";
import type { Locale } from "./locale";
export { escapeHtml, escapeAttr };

export interface EmailCta {
  label: string;
  url: string;
}

export interface BrandedEmailOptions {
  /** Used for the <title>; the actual Subject header is set by the sender. */
  subject: string;
  /**
   * Language of the shell chrome (<html lang> + footer unsubscribe hint).
   * Default German.
   */
  locale?: Locale;
  /** Hidden preview line shown next to the subject in inbox lists. */
  preheader?: string;
  /**
   * Heading rendered as the signature FULL-WIDTH BLACK BAND (white 20px text)
   * under the logo — the newsletter's section-separator look.
   */
  heading: string;
  /**
   * Inner HTML of the content block (between heading band and CTA). Callers
   * MUST escape any user-derived data themselves and should style text with
   * EMAIL_TEXT_STYLE / EMAIL_MUTED_TEXT_STYLE.
   */
  bodyHtml: string;
  /**
   * Show the Mo brand-orb avatar (emailMoIconUrl) centered between the heading
   * band and the body — the same mark the shop's chat widget uses, so the
   * reader associates the email with Mo. Animated GIF; clients without GIF
   * playback show its first frame.
   */
  moAvatar?: boolean;
  /**
   * RAW full-width <tr> rows rendered between the body and the CTA — built
   * with renderSectionBand / renderSectionRow so callers can compose
   * newsletter-style sections (black band + product grid) at full card width.
   */
  preCtaRowsHtml?: string;
  /** Table-based "bulletproof" pill CTA button(s) rendered after the body. */
  ctas?: EmailCta[];
  /** Small-print HTML under the CTA(s) (e.g. discount code + expiry note). */
  footnoteHtml?: string;
  /**
   * RAW full-width <tr> rows rendered after the CTA/footnote and before the
   * footer (e.g. the summary's "Vielleicht auch interessant" section).
   */
  postCtaRowsHtml?: string;
  footer?: {
    /**
     * Legal unsubscribe block — REQUIRED on marketing emails; rendered as its
     * own slot inside the grey footer so a content edit can never remove it.
     */
    unsubscribeHtml?: string;
    /** Show the social-icons row in the footer (default true). */
    showSocial?: boolean;
  };
}

// Social profiles — same icons (Shopify CDN, PNG-rendered) and destinations as
// the shop's newsletter footer.
const SOCIAL_LINKS: ReadonlyArray<{ alt: string; icon: string; url: string }> = [
  {
    alt: "facebook",
    icon: "https://cdn.shopify.com/shopify-email/nrqu6w5pn43waa7da6r8ifkgkl9v.svg?width=60&height=60&format=png",
    url: "https://www.facebook.com/people/motion-sports/100075824244572/",
  },
  {
    alt: "instagram",
    icon: "https://cdn.shopify.com/shopify-email/mezbe8bg2srefo0ca2vqbbv13mjg.svg?width=60&height=60&format=png",
    url: "https://www.instagram.com/motionsports_/",
  },
  {
    alt: "pinterest",
    icon: "https://cdn.shopify.com/shopify-email/khppknaggzolc0nmq1zaai69okxu.svg?width=60&height=60&format=png",
    url: "https://de.pinterest.com/0fmasbgzwae9oi9mjc9s6e2q9oamwk/",
  },
  {
    alt: "tiktok",
    icon: "https://cdn.shopify.com/shopify-email/4s0eae5xdawkwa9aals5ya8qujky.svg?width=60&height=60&format=png",
    url: "https://www.tiktok.com/@motionsports_",
  },
  {
    alt: "whatsapp",
    icon: "https://cdn.shopify.com/shopify-email/0rt1gsbm6sbgfm9nay94cxrw7lns.svg?width=60&height=60&format=png",
    url: "https://api.whatsapp.com/send?phone=%2B498142448666&text=",
  },
  {
    alt: "youtube",
    icon: "https://cdn.shopify.com/shopify-email/b44b9z24d10ct9dov9fozqqm8vqf.svg?width=60&height=60&format=png",
    url: "https://www.youtube.com/@motionsports-fitness",
  },
];

const IMPRINT_URL = "https://motionsports.de/pages/impressum";

/**
 * The signature newsletter element: a FULL-WIDTH black band with white 20px
 * text, used to separate sections ("Deine Auswahl", "Bestseller", …). Returns
 * a raw <tr> for the 600px card table — use in preCtaRowsHtml/postCtaRowsHtml,
 * or rely on the shell's heading which renders through this too.
 */
export function renderSectionBand(title: string): string {
  return `
                <tr>
                  <td class="content-pad" align="center" bgcolor="#000000" style="mso-line-height-rule: exactly; padding: 25px 60px;">
                    <p style="mso-line-height-rule: exactly; direction: ltr; font-family: ${EMAIL_FONT_FAMILY}; font-size: 20px; line-height: 1.4; font-weight: 400; color: #ffffff; Margin: 0;" align="center">${escapeHtml(title)}</p>
                  </td>
                </tr>`;
}

/**
 * A white content row with the card's standard 60px side padding (15px on
 * mobile via .content-pad). Returns a raw <tr> for preCtaRowsHtml /
 * postCtaRowsHtml. `padding` overrides the default vertical rhythm.
 */
export function renderSectionRow(
  innerHtml: string,
  opts: { padding?: string; align?: "left" | "center"; bgcolor?: string } = {}
): string {
  const padding = opts.padding ?? "20px 60px";
  const align = opts.align ?? "left";
  const bgcolor = opts.bgcolor ?? "#ffffff";
  return `
                <tr>
                  <td class="content-pad" align="${align}" bgcolor="${bgcolor}" style="mso-line-height-rule: exactly; padding: ${padding};" valign="top">${innerHtml}
                  </td>
                </tr>`;
}

/**
 * "Bulletproof" pill button in the newsletter style: full-width #008ccb pill
 * (border-radius 200px), bold white 12px label, generous padding. Returns a
 * standalone table — the shell (or a section like the bundle card) places it.
 */
export function renderCtaButton(cta: EmailCta): string {
  return `
                    <table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" style="direction: ltr; border-spacing: 0 !important; border-collapse: collapse !important;">
                      <tr>
                        <td align="center" bgcolor="${EMAIL_ACCENT_COLOR}" style="mso-line-height-rule: exactly; border-radius: 200px;" valign="top">
                          <a href="${escapeAttr(cta.url)}" target="_blank" style="font-size: 12px; color: #ffffff; text-decoration: none; border-radius: 200px; background-color: ${EMAIL_ACCENT_COLOR}; display: block; min-width: 80px; font-family: ${EMAIL_FONT_FAMILY}; font-weight: 400; font-style: normal; text-align: center; text-transform: uppercase; letter-spacing: 0.5px; word-break: break-word; padding: 14px 28px; border: 3px solid ${EMAIL_ACCENT_COLOR};"><strong>${escapeHtml(cta.label)}</strong></a>
                        </td>
                      </tr>
                    </table>`;
}

function renderSocialRow(): string {
  const cells = SOCIAL_LINKS.map(
    (s) => `
                          <td align="center" valign="middle" style="mso-line-height-rule: exactly; padding: 0 6px;">
                            <a href="${escapeAttr(s.url)}" target="_blank" style="text-decoration: none;"><img src="${escapeAttr(s.icon)}" alt="${escapeAttr(s.alt)}" width="20" height="20" border="0" style="width: 20px; height: 20px; display: block; border: none; outline: none;"></a>
                          </td>`
  ).join("");
  return `
                    <table cellspacing="0" cellpadding="0" border="0" align="center" role="presentation" style="direction: ltr; Margin: 0 auto 12px;">
                      <tr>${cells}
                      </tr>
                    </table>`;
}

/**
 * Render the full branded HTML email. Returns a complete HTML document; the
 * matching plain-text part stays the caller's responsibility.
 */
export function renderBrandedEmail(opts: BrandedEmailOptions): string {
  const logo = emailLogoUrl();
  const showSocial = opts.footer?.showSocial !== false;
  const year = new Date().getFullYear();
  const locale: Locale = opts.locale ?? "de";
  const en = locale === "en";

  const preheaderHtml = opts.preheader
    ? `
  <div style="display: none; overflow: hidden; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; mso-hide: all;">${escapeHtml(opts.preheader)}</div>
  <div style="display: none; overflow: hidden; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; mso-hide: all;">&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;</div>`
    : "";

  const moAvatarRow = opts.moAvatar
    ? `
                <!-- BEGIN SECTION: Mo avatar (brand orb, animated GIF) -->
                <tr>
                  <td class="content-pad" align="center" bgcolor="#ffffff" style="mso-line-height-rule: exactly; padding: 25px 60px 0;">
                    <img src="${escapeAttr(emailMoIconUrl())}" alt="Mo" width="64" height="64" border="0" style="width: 64px; height: 64px; display: block; Margin: 0 auto;">
                  </td>
                </tr>
                <!-- END SECTION: Mo avatar -->`
    : "";

  const ctaRows = (opts.ctas ?? [])
    .filter((c) => c.url && c.label)
    .map((c) =>
      renderSectionRow(renderCtaButton(c), { padding: "10px 60px", align: "center" })
    )
    .join("");

  const footnoteRow = opts.footnoteHtml
    ? renderSectionRow(opts.footnoteHtml, { padding: "10px 60px", align: "center" })
    : "";

  const unsubscribeBlock = opts.footer?.unsubscribeHtml
    ? `
                          <!-- BEGIN: Unsubscribe (legally required on marketing email) -->
                          <tr>
                            <td align="center" style="mso-line-height-rule: exactly; padding: 8px 0 0;" valign="top">${opts.footer.unsubscribeHtml}</td>
                          </tr>
                          <!-- END: Unsubscribe -->`
    : "";

  return `<!DOCTYPE html>
<html lang="${locale}">
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="x-apple-disable-message-reformatting">
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light only">
    <title>${escapeHtml(opts.subject)}</title>
    <!--[if mso]>
    <style>
      * { font-family: sans-serif !important; }
    </style>
    <![endif]-->
    <style type="text/css">
      /* Progressive enhancement ONLY — every critical style is inline. */
      html, body { Margin: 0 auto !important; padding: 0 !important; width: 100% !important; }
      * { -ms-text-size-adjust: 100%; -webkit-text-size-adjust: 100%; }
      table, th, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
      table { border-spacing: 0 !important; border-collapse: collapse !important; border: none; Margin: 0 auto; }
      img { -ms-interpolation-mode: bicubic; border: none !important; outline: none !important; text-decoration: none !important; }
      .grid-column { max-width: 50%; }
      @media only screen and (max-width:480px) {
        .email-container { width: 100% !important; min-width: 100% !important; }
        .content-pad { padding-right: 15px !important; padding-left: 15px !important; }
        .grid-tile { width: 100% !important; max-width: 100% !important; }
        .grid-image { width: 100% !important; height: auto !important; }
      }
    </style>
  </head>
  <body id="body" bgcolor="#fafafa" style="-webkit-text-size-adjust: none; -ms-text-size-adjust: none; background-color: #fafafa; Margin: 0; padding: 0;">${preheaderHtml}
    <!-- BEGIN: CONTAINER -->
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; min-width: 100%; direction: ltr;" role="presentation" bgcolor="#fafafa">
      <tbody>
        <tr>
          <td align="center" valign="top" style="mso-line-height-rule: exactly;">
            <center style="width: 100%;">
            <!-- BEGIN: CARD -->
            <table border="0" width="600" cellpadding="0" cellspacing="0" align="center" style="width: 600px; max-width: 600px; direction: ltr; Margin: 0 auto; table-layout: fixed;" class="email-container" role="presentation" bgcolor="#ffffff">
              <tbody>
                <!-- BEGIN SECTION: Header (logo — STATIC image, absolute https URL) -->
                <tr>
                  <td class="content-pad" align="center" bgcolor="#ffffff" style="mso-line-height-rule: exactly; padding: 30px 60px 20px;">
                    <a href="https://www.motionsports.de" target="_blank" style="text-decoration: none !important;">
                      <img src="${escapeAttr(logo)}" alt="motion sports" width="144" border="0" style="width: 144px; height: auto !important; max-width: 100%; display: block; Margin: 0 auto;">
                    </a>
                  </td>
                </tr>
                <!-- END SECTION: Header -->
                <!-- BEGIN SECTION: Heading band (signature black separator) -->${renderSectionBand(opts.heading)}
                <!-- END SECTION: Heading band -->${moAvatarRow}
                <!-- BEGIN SECTION: Body content -->
                <tr>
                  <td class="content-pad" align="left" bgcolor="#ffffff" style="mso-line-height-rule: exactly; padding: 25px 60px 10px;" valign="top">${opts.bodyHtml}
                  </td>
                </tr>
                <!-- END SECTION: Body content -->${opts.preCtaRowsHtml ?? ""}${ctaRows}${footnoteRow}${opts.postCtaRowsHtml ?? ""}
                <tr>
                  <td height="20" bgcolor="#ffffff" style="mso-line-height-rule: exactly; font-size: 0; line-height: 20px;">&nbsp;</td>
                </tr>
                <!-- BEGIN : SECTION : FOOTER (newsletter style: social + company + unsubscribe) -->
                <tr>
                  <td class="content-pad" align="center" bgcolor="#f9f9f9" style="mso-line-height-rule: exactly; padding: 24px 60px;">
                    <table border="0" width="100%" cellpadding="0" cellspacing="0" align="center" style="min-width: 100%; direction: ltr; text-align: center;" role="presentation">
                      <tbody>${
                        showSocial
                          ? `
                          <tr>
                            <td align="center" style="mso-line-height-rule: exactly;" valign="top">${renderSocialRow()}
                            </td>
                          </tr>`
                          : ""
                      }
                          <tr>
                            <td align="center" style="mso-line-height-rule: exactly; padding-bottom: 8px;" valign="top">
                              <p style="mso-line-height-rule: exactly; direction: ltr; font-family: ${EMAIL_FONT_FAMILY}; font-size: 11px; line-height: 1.5; font-weight: 400; color: #000000; Margin: 0;" align="center">4motionsports GmbH<br>Am Weidegrund 1, 82194 Gr&#246;benzell, Deutschland<br>Gesch&#228;ftsf&#252;hrer: Sabine Brunner, Lucas Brunner</p>
                              <p style="mso-line-height-rule: exactly; direction: ltr; font-family: ${EMAIL_FONT_FAMILY}; font-size: 11px; line-height: 1.5; font-weight: 400; color: #000000; Margin: 0;" align="center"><a href="tel:+49(0)8142%20448666" style="color: #000000; text-decoration: underline;">+49(0)8142 448666</a> <strong>&#183;</strong> <a href="mailto:info@motionsports.de" style="color: #000000; text-decoration: underline;">info@motionsports.de</a></p>
                            </td>
                          </tr>${unsubscribeBlock}
                          <tr>
                            <td align="center" style="mso-line-height-rule: exactly; padding-top: 8px;" valign="top">
                              <p style="mso-line-height-rule: exactly; direction: ltr; font-family: ${EMAIL_FONT_FAMILY}; font-size: 12px; line-height: 1.5; font-weight: 400; color: #000000; Margin: 0;" align="center">&#169; ${year} motion sports &#183; <a href="${escapeAttr(IMPRINT_URL)}" target="_blank" style="color: #000000; text-decoration: underline;">${en ? "Imprint" : "Impressum"}</a></p>
                            </td>
                          </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
                <!-- END : SECTION : FOOTER -->
              </tbody>
            </table>
            <!-- END: CARD -->
            </center>
          </td>
        </tr>
      </tbody>
    </table>
    <!-- END : CONTAINER -->
  </body>
</html>`;
}
