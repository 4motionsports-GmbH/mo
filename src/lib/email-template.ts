// Shared branded email shell for EVERY outgoing customer email (conversation
// summary, marketing, double-opt-in confirmation). One template, one brand.
//
// The design is lifted from the shop's existing Shopify/OrderlyEmails order
// confirmation so backend emails look exactly like the store's own mail:
// white card on #f6f6f6, the motion sports logo on top, Montserrat/Verdana
// type, the #008ccb pill button, the Shop/Über/Kontakt/Impressum menu bar and
// the legal footer with the company address.
//
// EMAIL-CLIENT ROBUSTNESS RULES — do NOT "modernise" this file:
//   - table-based layout with role="presentation" and bgcolor= attributes
//   - EVERY visual style is INLINE; the <style> block in <head> is progressive
//     enhancement only (mobile width tweaks + webfont) and the email must
//     render correctly in Gmail, Apple Mail and Outlook without it
//   - no flexbox/grid/SVG/background-images/external CSS
//   - images referenced by absolute https URLs only
//   - the header logo is a STATIC image (animated logos do not animate
//     reliably in mail clients)

/** Brand accent used for CTA buttons (matches the shop's order emails). */
export const EMAIL_ACCENT_COLOR = "#008ccb";

/** Font stack used on every inline style (Montserrat is enhancement-only). */
export const EMAIL_FONT_FAMILY = "Verdana,sans-serif,'Montserrat'";

/**
 * Inline style for a normal body paragraph/text cell. Callers building
 * `bodyHtml` should use this so their content matches the shell.
 */
export const EMAIL_TEXT_STYLE =
  `mso-line-height-rule: exactly; direction: ltr; font-family: ${EMAIL_FONT_FAMILY}; ` +
  `font-size: 14px; line-height: 20px; font-weight: 400; text-transform: none; ` +
  `color: #000000; Margin: 0;`;

/** Inline style for muted small print (12px grey). */
export const EMAIL_MUTED_TEXT_STYLE =
  `mso-line-height-rule: exactly; direction: ltr; font-family: ${EMAIL_FONT_FAMILY}; ` +
  `font-size: 12px; line-height: 18px; font-weight: 400; text-transform: none; ` +
  `color: #212121; Margin: 0;`;

// Static brand logo (the same asset the shop's order-confirmation emails use —
// an absolute https URL on a public CDN, NOT an animated file). Override with
// EMAIL_LOGO_URL once a dedicated static Mo logo is hosted somewhere public.
const DEFAULT_LOGO_URL =
  "https://cdn.filepicker.io/api/file/RTi7jHZzSB6uteZL4etr/convert?fit=max&w=422";

export function emailLogoUrl(): string {
  return process.env.EMAIL_LOGO_URL || DEFAULT_LOGO_URL;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escape a value used inside a double-quoted HTML attribute (e.g. href). */
export function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

export interface EmailCta {
  label: string;
  url: string;
}

export interface BrandedEmailOptions {
  /** Used for the <title>; the actual Subject header is set by the sender. */
  subject: string;
  /** Hidden preview line shown next to the subject in inbox lists. */
  preheader?: string;
  /** Large centered heading at the top of the white card. */
  heading: string;
  /**
   * Inner HTML of the content block (between heading and CTA). Callers MUST
   * escape any user-derived data themselves and should style text with
   * EMAIL_TEXT_STYLE / EMAIL_MUTED_TEXT_STYLE.
   */
  bodyHtml: string;
  /** Table-based "bulletproof" CTA button(s) rendered after the body. */
  ctas?: EmailCta[];
  /** Small-print HTML under the CTA(s) (e.g. discount code + expiry note). */
  footnoteHtml?: string;
  footer?: {
    /**
     * Legal unsubscribe block — REQUIRED on marketing emails; rendered as its
     * own bordered section above the menu/footer so a content edit can never
     * remove it.
     */
    unsubscribeHtml?: string;
    /** Show the Shop/Über/Kontakt/Impressum menu bar (default true). */
    showMenu?: boolean;
  };
}

const MENU_ITEMS: ReadonlyArray<{ label: string; url: string }> = [
  // Same destinations as the shop's order-confirmation emails.
  { label: "Shop", url: "https://www.motionsports.de" },
  { label: "Über", url: "https://motionsports.de/collections/sale" },
  { label: "Kontakt", url: "https://motionsports.de/pages/contact" },
  { label: "Impressum", url: "https://motionsports.de/pages/impressum" },
];

export function renderCtaButton(cta: EmailCta): string {
  // "Bulletproof" pill button straight from the reference design: a one-cell
  // table whose th carries bgcolor + border-radius (works in Outlook) and a
  // block-level <a> with a thick same-color border for the clickable padding.
  return `
              <tr>
                <th class="column_button" style="mso-line-height-rule: exactly; Margin: 0; padding: 10px 0;" align="center" bgcolor="#ffffff" valign="top">
                  <table cellspacing="0" cellpadding="0" border="0" role="presentation" style="direction: ltr; text-align: center; Margin: 0 auto;" bgcolor="transparent">
                    <tr>
                      <th style="mso-line-height-rule: exactly; border-radius: 30px;" align="center" bgcolor="${EMAIL_ACCENT_COLOR}" valign="top">
                        <a href="${escapeAttr(cta.url)}" target="_blank" style="color: #ffffff !important; text-decoration: none !important; word-wrap: break-word; line-height: 14px; font-family: ${EMAIL_FONT_FAMILY}; font-size: 14px; font-weight: 400; text-transform: none; text-align: center; display: block; background-color: ${EMAIL_ACCENT_COLOR}; border-radius: 30px; padding: 1px 20px; border: 15px solid ${EMAIL_ACCENT_COLOR};"><span style="line-height: 14px; color: #ffffff; font-weight: 400; text-decoration: none; letter-spacing: 0.5px;"><!--[if mso]>&nbsp;&nbsp;&nbsp;&nbsp;<![endif]-->${escapeHtml(cta.label)}<!--[if mso]>&nbsp;&nbsp;&nbsp;&nbsp;<![endif]--></span></a>
                      </th>
                    </tr>
                  </table>
                </th>
              </tr>`;
}

function renderMenuBar(): string {
  const count = MENU_ITEMS.length;
  const width = Math.floor(100 / count);
  const cells = MENU_ITEMS.map((item, i) => {
    const borderLeft = i === 0 ? "none" : "solid";
    const borderRight = i === count - 1 ? "none" : "solid";
    return `
                    <th style="width: ${width}%; mso-line-height-rule: exactly; font-family: ${EMAIL_FONT_FAMILY}; font-size: 12px; font-weight: 400; line-height: 20px; color: #212121; text-transform: uppercase; border-right-width: 2px; border-right-color: #e5e5e5; border-right-style: ${borderRight}; border-left-width: 2px; border-left-color: #e5e5e5; border-left-style: ${borderLeft};" align="center" bgcolor="#ffffff">
                      <a href="${escapeAttr(item.url)}" target="_blank" style="color: #212121; text-decoration: none !important; word-wrap: break-word; text-align: center !important; font-family: ${EMAIL_FONT_FAMILY}; font-size: 12px; font-weight: 400; line-height: 20px; text-transform: uppercase;">${escapeHtml(item.label)}</a>
                    </th>`;
  }).join("");

  return `
          <tr>
            <th width="100%" style="mso-line-height-rule: exactly; padding-top: 10px;" bgcolor="#ffffff">
              <p style="mso-line-height-rule: exactly; direction: ltr; font-family: ${EMAIL_FONT_FAMILY}; font-size: 12px; line-height: 20px; font-weight: 400; text-transform: uppercase; color: #212121; Margin: 0;" align="center">Durchsuchen</p>
            </th>
          </tr>
          <tr>
            <td style="mso-line-height-rule: exactly; padding: 20px 0;" bgcolor="#ffffff">
              <table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation" style="direction: ltr; text-align: center;">
                <tr align="center">${cells}
                </tr>
              </table>
            </td>
          </tr>`;
}

/**
 * Render the full branded HTML email. Returns a complete HTML document; the
 * matching plain-text part stays the caller's responsibility.
 */
export function renderBrandedEmail(opts: BrandedEmailOptions): string {
  const logo = emailLogoUrl();
  const showMenu = opts.footer?.showMenu !== false;
  const year = new Date().getFullYear();

  const preheaderHtml = opts.preheader
    ? `
  <div style="display: none; overflow: hidden; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; mso-hide: all;">${escapeHtml(opts.preheader)}</div>
  <div style="display: none; overflow: hidden; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; mso-hide: all;">&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;&#847;&#8204;&nbsp;</div>`
    : "";

  const ctasHtml = (opts.ctas ?? [])
    .filter((c) => c.url && c.label)
    .map(renderCtaButton)
    .join("");

  const footnoteHtml = opts.footnoteHtml
    ? `
              <tr>
                <th style="mso-line-height-rule: exactly; padding: 5px 0 0;" align="center" bgcolor="#ffffff" valign="top">${opts.footnoteHtml}</th>
              </tr>`
    : "";

  const ctaSection =
    ctasHtml || footnoteHtml
      ? `
      <!-- BEGIN SECTION: CTA -->
      <tr>
        <th class="section_border" style="mso-line-height-rule: exactly; padding: 5px 80px;" bgcolor="#ffffff">
          <table border="0" width="100%" cellpadding="0" cellspacing="0" align="center" style="min-width: 100%; direction: ltr;" role="presentation">
            <tr>
              <th class="section_content" style="mso-line-height-rule: exactly; padding: 5px 20px;" bgcolor="#ffffff" valign="top">
                <table cellspacing="0" cellpadding="0" border="0" width="100%" style="direction: ltr;" role="presentation">${ctasHtml}${footnoteHtml}
                </table>
              </th>
            </tr>
          </table>
        </th>
      </tr>
      <!-- END SECTION: CTA -->`
      : "";

  const unsubscribeSection = opts.footer?.unsubscribeHtml
    ? `
      <!-- BEGIN SECTION: Unsubscribe (legally required on marketing email) -->
      <tr>
        <th class="section_border" style="mso-line-height-rule: exactly; padding: 5px 80px;" bgcolor="#ffffff">
          <table border="0" width="100%" cellpadding="0" cellspacing="0" align="center" style="min-width: 100%; direction: ltr;" role="presentation">
            <tr>
              <th class="section_content" style="mso-line-height-rule: exactly; padding: 5px 20px; border-top-width: 1px; border-top-color: #e5e5e5; border-top-style: solid;" align="center" bgcolor="#ffffff" valign="top">${opts.footer.unsubscribeHtml}</th>
            </tr>
          </table>
        </th>
      </tr>
      <!-- END SECTION: Unsubscribe -->`
    : "";

  return `<!DOCTYPE html>
<html lang="de">
  <head>
    <meta name="viewport" content="width=device-width">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="x-apple-disable-message-reformatting">
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light only">
    <title>${escapeHtml(opts.subject)}</title>
    <!--[if !mso]><!-->
    <style type="text/css" data-premailer="ignore">
      @import url("https://fonts.googleapis.com/css?family=Montserrat:400,700&subset=latin-ext");
    </style>
    <!--<![endif]-->
    <style type="text/css">
      /* Progressive enhancement ONLY — every critical style is inline. */
      html, body { Margin: 0 auto !important; padding: 0 !important; width: 100% !important; }
      * { -ms-text-size-adjust: 100%; -webkit-text-size-adjust: 100%; }
      table, th { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
      table { border-spacing: 0 !important; border-collapse: collapse !important; border: none; Margin: 0 auto; }
      img { -ms-interpolation-mode: bicubic; border: none !important; outline: none !important; text-decoration: none !important; }
      @media only screen and (max-width:480px) {
        .email-container { width: 100% !important; min-width: 100% !important; }
        .section_border { padding-right: 10px !important; padding-left: 10px !important; }
        .section_content { padding-right: 20px !important; padding-left: 20px !important; }
        h1, h2, h3 { line-height: 1.4 !important; }
      }
    </style>
  </head>
  <body id="body" bgcolor="#f6f6f6" style="-webkit-text-size-adjust: none; -ms-text-size-adjust: none; Margin: 0; padding: 0;">${preheaderHtml}
    <!-- BEGIN: CONTAINER -->
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; min-width: 100%; direction: ltr;" role="presentation" bgcolor="#f6f6f6">
      <tbody>
        <tr>
          <th valign="top" style="mso-line-height-rule: exactly;">
            <center style="width: 100%;">
              <table border="0" width="640" cellpadding="0" cellspacing="0" align="center" style="width: 640px; min-width: 640px; max-width: 640px; direction: ltr; Margin: auto;" class="email-container" role="presentation">
                <tbody>
                  <tr>
                    <th valign="top" style="mso-line-height-rule: exactly; padding: 10px 0;">
                      <!-- BEGIN : SECTION : HEADER -->
                      <table border="0" width="100%" cellpadding="0" cellspacing="0" align="center" style="min-width: 100%; direction: ltr;" role="presentation" bgcolor="#ffffff">
                        <tr>
                          <th class="section_border" style="mso-line-height-rule: exactly; padding: 20px 80px 0px;" bgcolor="#ffffff">
                            <table border="0" width="100%" cellpadding="0" cellspacing="0" align="center" style="min-width: 100%; direction: ltr;" role="presentation">
                              <tr>
                                <th class="section_content" style="mso-line-height-rule: exactly; padding: 5px 20px;" align="center" bgcolor="#ffffff">
                                  <!-- Logo (STATIC image, absolute https URL) : BEGIN -->
                                  <a href="https://www.motionsports.de" target="_blank" style="text-decoration: none !important;">
                                    <img src="${escapeAttr(logo)}" alt="motion sports" width="211" border="0" style="width: 211px; height: auto !important; display: block; Margin: 0 auto;">
                                  </a>
                                  <!-- Logo : END -->
                                </th>
                              </tr>
                            </table>
                          </th>
                        </tr>
                      </table>
                      <!-- END : SECTION : HEADER -->
                      <!-- BEGIN : SECTION : MAIN -->
                      <table border="0" width="100%" cellpadding="0" cellspacing="0" align="center" style="min-width: 100%; direction: ltr;" role="presentation" bgcolor="#ffffff">
                        <!-- BEGIN SECTION: Heading -->
                        <tr>
                          <th class="section_border" style="mso-line-height-rule: exactly; padding: 10px 80px 0;" bgcolor="#ffffff">
                            <table border="0" width="100%" cellpadding="0" cellspacing="0" align="center" style="min-width: 100%; direction: ltr;" role="presentation">
                              <tr>
                                <th class="section_content" style="mso-line-height-rule: exactly; color: #000000; padding: 20px;" align="center" bgcolor="#ffffff" valign="top">
                                  <h1 style="font-family: ${EMAIL_FONT_FAMILY}; font-size: 30px; line-height: 28px; padding-top: 7px; padding-bottom: 7px; font-weight: 400; color: #000000; text-transform: none; letter-spacing: 0.5px; Margin: 0;" align="center">${escapeHtml(opts.heading)}</h1>
                                </th>
                              </tr>
                            </table>
                          </th>
                        </tr>
                        <!-- END SECTION: Heading -->
                        <!-- BEGIN SECTION: Body content -->
                        <tr>
                          <th class="section_border" style="mso-line-height-rule: exactly; padding: 0 80px 5px;" bgcolor="#ffffff">
                            <table border="0" width="100%" cellpadding="0" cellspacing="0" align="center" style="min-width: 100%; direction: ltr;" role="presentation">
                              <tr>
                                <th class="section_content" style="mso-line-height-rule: exactly; padding: 5px 20px;" align="left" bgcolor="#ffffff" valign="top">${opts.bodyHtml}
                                </th>
                              </tr>
                            </table>
                          </th>
                        </tr>
                        <!-- END SECTION: Body content -->${ctaSection}${unsubscribeSection}${showMenu ? renderMenuBar() : ""}
                      </table>
                      <!-- END : SECTION : MAIN -->
                      <!-- BEGIN : SECTION : FOOTER -->
                      <table border="0" width="100%" cellpadding="0" cellspacing="0" align="center" style="min-width: 100%; direction: ltr;" role="presentation" bgcolor="#f9f9f9">
                        <tr align="center">
                          <td class="section_border" style="mso-line-height-rule: exactly; padding: 30px 80px 20px;" align="center" bgcolor="#f9f9f9">
                            <table border="0" width="100%" cellpadding="0" cellspacing="0" align="center" style="min-width: 100%; direction: ltr; text-align: center;" role="presentation">
                              <tr align="center">
                                <th class="section_content" style="mso-line-height-rule: exactly; padding: 5px 20px;" align="center" bgcolor="#f9f9f9">
                                  <table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation" style="direction: ltr; text-align: center;">
                                    <tr align="center">
                                      <th width="100%" style="mso-line-height-rule: exactly; padding-top: 5px; padding-bottom: 20px; font-family: ${EMAIL_FONT_FAMILY}; font-size: 14px; line-height: 20px; font-weight: 400; color: #3c3c3c; text-transform: none;" align="center" bgcolor="#f9f9f9">
                                        <a href="https://www.motionsports.de" target="_blank" style="color: #000000; text-decoration: none !important; font-size: 14px; font-weight: 400; text-transform: none; text-align: center;">motionsports.de</a>
                                      </th>
                                    </tr>
                                    <tr align="center">
                                      <th width="100%" style="mso-line-height-rule: exactly; padding-top: 5px; padding-bottom: 5px; font-family: ${EMAIL_FONT_FAMILY}; font-size: 14px; line-height: 20px; font-weight: 400; color: #3c3c3c; text-transform: none;" align="center" bgcolor="#f9f9f9">
                                        <p style="mso-line-height-rule: exactly; direction: ltr; font-family: ${EMAIL_FONT_FAMILY}; font-size: 14px; line-height: 20px; font-weight: 400; text-transform: none; color: #3c3c3c; Margin: 0;" align="center">4 motionsports GmbH<br style="text-align: center;">
                                          Am Weidegrund 1<br style="text-align: center;">
                                          82194 Gr&#246;benzell</p>
                                        <br style="text-align: center;">
                                        Copyright &#169; ${year}
                                      </th>
                                    </tr>
                                    <tr align="center">
                                      <th width="50%" style="mso-line-height-rule: exactly; padding-top: 20px; padding-bottom: 20px;" align="center" bgcolor="#f9f9f9">
                                        <a href="https://www.motionsports.de" target="_blank" style="color: #000000; text-decoration: none !important; font-size: 14px; text-align: center;">
                                          <img src="${escapeAttr(logo)}" alt="motion sports" width="100" border="0" style="width: 100px; height: auto !important; display: block; text-align: center; Margin: auto;">
                                        </a>
                                      </th>
                                    </tr>
                                  </table>
                                </th>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                      <!-- END : SECTION : FOOTER -->
                    </th>
                  </tr>
                </tbody>
              </table>
            </center>
          </th>
        </tr>
      </tbody>
    </table>
    <!-- END : CONTAINER -->
  </body>
</html>`;
}
