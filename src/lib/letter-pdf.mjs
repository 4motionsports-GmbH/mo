// Letter → PDF, dependency-free, laid out as a proper German business letter and
// branded toward the motion sports email template (accent wordmark + rule, accent
// subject, a legal footer echoing the email's address line).
//
// PINGEN ADDRESS GEOMETRY (this is load-bearing — getting it wrong blocks the
// send). Pingen reads the recipient address from the PDF for the configured
// `address_position` ('left', the DIN-5008 left window) and enforces two zones,
// measured in mm FROM THE PAGE TOP/LEFT:
//   * Address Area  x:[22, 107.5]  y:[60, 85.5]   — the recipient address MUST sit
//     fully inside this box (≈ 5–6 lines tall).
//   * Postage Area  x:[20, 109.5]  y:[40, 87.5]   — reserved; NO other content may
//     intrude here (only the address, within its sub-area above).
//   * Restricted border 5mm on every edge.
// So: the letterhead must end ABOVE 40mm; the recipient address goes in [60,85.5]mm
// at x≥22mm; everything else (date, subject, body, footer) stays BELOW 87.5mm.
// (The previous layout placed the address at ~53mm/20mm — above & left of the area
// — plus a tiny "Absender" line at ~45mm inside the postage area: Pingen rejected
// both. There is no sender line any more; Pingen prints the return address itself.)
//
// Two base-14 fonts (Helvetica + Helvetica-Bold, WinAnsi/Latin-1 so German
// umlauts/ß render); no embedding. We hand-write the PDF (no headless browser / PDF
// dep on Vercel): the layout is fixed and simple → deterministic + unit-testable.
// The low-level assembly + shared chrome live in lib/pdf-core.

import {
  PAGE_W,
  PAGE_H,
  MARGIN_X,
  ACCENT_RGB,
  MUTED_RGB,
  escapePdfText,
  toLatin1Safe,
  wrapText,
  textOp,
  ruleOp,
  brandHeaderOps,
  assemblePdf,
} from "./pdf-core.mjs";

// Re-exported for the existing letter-pdf unit tests + any caller importing them.
export { escapePdfText, toLatin1Safe, wrapText };

// 1mm in PostScript points — the address geometry is specified in mm by Pingen.
const MM = 72 / 25.4;

// Recipient address window (Pingen 'left'). The block is TOP-aligned just inside
// the Address Area: left at 23mm (≥ the 22mm boundary), first baseline at ~63.5mm
// (top of the area + a small inset so ascenders don't clip), flowing DOWN. The
// area is only 25.5mm tall (~5 comfortable lines), so the leading tightens for a
// rare 6-line address to keep the whole block inside [60, 85.5]mm.
export const ADDRESS_LEFT_X = Math.round(23 * MM); // ≈ 65pt, inside the 22mm boundary
export const ADDRESS_TOP_Y = PAGE_H - Math.round(63.5 * MM); // first baseline ≈ 63.5mm from top
const ADDRESS_FONT = 11;

// Date + subject + body frame — all BELOW the postage area (≥ 87.5mm from top).
const DATE_Y = PAGE_H - 300; // ≈ 106mm
const SUBJECT_Y = PAGE_H - 326; // ≈ 115mm
const BODY_LEFT_X = MARGIN_X;
const BODY_TOP_Y_PAGE1 = PAGE_H - 356; // below the subject (≈ 125mm)
const BODY_TOP_Y_PAGEN = PAGE_H - 70; // full height on continuation pages
const BODY_BOTTOM_Y = 78; // clears the two-line footer
const BODY_FONT = 11;
const BODY_LEADING = 15;
// Helvetica 11pt over a ~481pt frame ⇒ ~80 chars; wrap a touch shorter to be safe.
const BODY_MAX_CHARS = 78;

/** The recipient address as ordered display lines (caller passes a validated,
 *  complete address; optional company/line2/country handled). */
export function addressLines(recipient) {
  const lines = [recipient.name];
  if (recipient.company) lines.push(recipient.company);
  lines.push(recipient.addressLine1);
  if (recipient.addressLine2) lines.push(recipient.addressLine2);
  lines.push(`${recipient.postalCode} ${recipient.city}`.trim());
  if (recipient.country && recipient.country.toUpperCase() !== "DE") {
    lines.push(recipient.country.toUpperCase());
  }
  return lines;
}

/** The branded letterhead (above the 40mm postage area): accent wordmark + rule
 *  (shared brandHeaderOps) plus a small muted brand line, echoing the email. */
function letterHeadOps() {
  return (
    brandHeaderOps() +
    textOp(
      "F1",
      MARGIN_X,
      PAGE_H - Math.round(31 * MM), // ≈ 31mm from top — still above the postage area
      8.5,
      "Dein Shop für Fitnessgeräte · www.motionsports.de",
      MUTED_RGB
    )
  );
}

/** The legal footer on every page — two muted lines under a hairline rule,
 *  mirroring the email footer's address + menu. Sits at ≈13–21mm from the bottom
 *  (clear of the 5mm border). */
function letterFooterOps() {
  return (
    ruleOp(MARGIN_X, PAGE_W - MARGIN_X, 60, 0.5, "0.8 0.8 0.8") +
    textOp(
      "F1",
      MARGIN_X,
      48,
      7.5,
      "4motionsports GmbH · Am Weidegrund 1 · 82194 Gröbenzell",
      MUTED_RGB
    ) +
    textOp(
      "F1",
      MARGIN_X,
      38,
      7.5,
      "www.motionsports.de · Shop · Über · Kontakt · Impressum",
      MUTED_RGB
    )
  );
}

/**
 * Build the letter PDF.
 * @param {{ recipient: { name: string, company?: string|null,
 *           addressLine1: string, addressLine2?: string|null,
 *           postalCode: string, city: string, country: string },
 *           subject?: string|null, body: string, date?: string|null }} input
 * @returns {Buffer}
 */
export function buildLetterPdf(input) {
  const { recipient, subject, body, date } = input;

  /** @type {string[]} */
  const pages = [];
  let content = "";

  // ── Letterhead (brand accent, matching the email) — kept above the 40mm
  //    postage area. NO sender line (it lived in the postage area; Pingen prints
  //    the return address itself).
  content += letterHeadOps();

  // ── Recipient address — the block Pingen reads, TOP-aligned inside the Address
  //    Area [22–107.5 × 60–85.5]mm. Tighten the leading for a rare 6-line address
  //    so the whole block stays inside the 25.5mm-tall window.
  const lines = addressLines(recipient);
  const addressLeading = lines.length >= 6 ? 12 : 14;
  let ay = ADDRESS_TOP_Y;
  for (const line of lines) {
    content += textOp("F1", ADDRESS_LEFT_X, ay, ADDRESS_FONT, line);
    ay -= addressLeading;
  }

  // ── Date (muted, left-aligned) ────────────────────────────────────────────
  content += textOp(
    "F1",
    BODY_LEFT_X,
    DATE_Y,
    10,
    date || new Date().toLocaleDateString("de-DE"),
    MUTED_RGB
  );

  // ── Subject (accent, bold) — the email's heading colour ───────────────────
  if (subject && subject.trim()) {
    content += textOp("F2", BODY_LEFT_X, SUBJECT_Y, 13, subject.trim(), ACCENT_RGB);
  }

  // ── Body (wrapped, paginated) ─────────────────────────────────────────────
  // Pass the letter's OWN width (78) — the shared pdf-core default is wider (90),
  // which would overrun this ~481pt frame at Helvetica 11pt.
  let y = BODY_TOP_Y_PAGE1;
  for (const line of wrapText(body, BODY_MAX_CHARS)) {
    if (y < BODY_BOTTOM_Y) {
      pages.push(content);
      content = "";
      y = BODY_TOP_Y_PAGEN;
    }
    if (line !== "") content += textOp("F1", BODY_LEFT_X, y, BODY_FONT, line);
    y -= BODY_LEADING;
  }
  pages.push(content);

  // Brand footer on every page.
  return assemblePdf(pages.map((p) => p + letterFooterOps()));
}
