// "Studio" — the first AI-authored email design and the reference example for
// docs/EMAIL_DESIGNS.md. An editorial-minimal look: warm paper background,
// Helvetica, black square buttons, and instead of the classic black separator
// bands a quiet uppercase kicker with a thin rule.
//
// It demonstrates all three layers of the design system:
//   - theme TOKENS for the cheap restyles (colors, font, button shape),
//   - a RENDERER override (sectionBand) for a structurally different element,
//   - a per-kind VARIANT (doi) tailoring one email type.
//
// Email-client rules apply to every renderer override (see the header of
// email-template.ts): tables + inline styles only, absolute https images,
// no flexbox/grid/SVG.

import type { EmailDesignDefinition } from "./registry";
import { escapeHtml, emailFontFamily } from "../email-template";

export const studioDesign: EmailDesignDefinition = {
  key: "studio",
  name: "Studio",
  description:
    "Editorial-minimal: warmer Papierton, Helvetica, schwarze eckige Buttons, ruhige Kicker-Zeilen statt schwarzer Bänder.",
  addedAt: "2026-08-31",

  // ── The GENERAL template ───────────────────────────────────────────────────
  theme: {
    accentColor: "#111111",
    outerBackground: "#f4f3f1",
    fontFamily: "helvetica",
    buttonShape: "square",
  },
  renderers: {
    // Quiet editorial kicker instead of the classic full-width black band:
    // small uppercase letter-spaced title over a thin rule, on the white card.
    sectionBand: (title: string) => `
                <tr>
                  <td class="content-pad" align="center" bgcolor="#ffffff" style="mso-line-height-rule: exactly; padding: 28px 60px 6px;">
                    <p style="mso-line-height-rule: exactly; direction: ltr; font-family: ${emailFontFamily()}; font-size: 13px; line-height: 1.4; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: #111111; Margin: 0;" align="center">${escapeHtml(title)}</p>
                  </td>
                </tr>
                <tr>
                  <td align="center" bgcolor="#ffffff" style="mso-line-height-rule: exactly; padding: 0 60px 4px;">
                    <table cellspacing="0" cellpadding="0" border="0" role="presentation" style="direction: ltr; border-spacing: 0 !important; border-collapse: collapse !important;">
                      <tr>
                        <td width="48" height="2" bgcolor="#111111" style="font-size: 0; line-height: 0; width: 48px; height: 2px;">&nbsp;</td>
                      </tr>
                    </table>
                  </td>
                </tr>`,
  },

  // ── Per-email-type tailoring ───────────────────────────────────────────────
  variants: {
    // The double-opt-in mail is a calm legal confirmation — no social row.
    doi: {
      theme: { showSocial: false },
    },
  },
};
