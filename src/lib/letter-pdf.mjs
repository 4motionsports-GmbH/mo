// Letter → PDF, dependency-free, laid out as a proper German business letter.
//
// Pingen reads the recipient address FROM THE PDF at the configured
// `address_position` (we use 'left'), so the address block sits in the standard
// DIN-5008 left address window. Above it is a simple letterhead ("motion sports"
// + a rule); below it a date line, a bold subject, then the personalised body
// flowed and paginated. Two base-14 fonts are used (Helvetica + Helvetica-Bold,
// no embedding needed), WinAnsi/Latin-1 so German umlauts/ß render.
//
// We hand-write the PDF (no headless browser / PDF dep on Vercel): the layout is
// fixed and simple, which keeps it deterministic and unit-testable. The body is
// the letter-optimised content from lib/marketing-draft.generateCustomerLetterDraft.
//
// The low-level PDF assembly + brand chrome (fonts, xref, letterhead, footer) live
// in lib/pdf-core, shared with the signed-in summary download PDF (lib/summary-pdf).

import {
  PAGE_W,
  PAGE_H,
  MARGIN_X,
  escapePdfText,
  toLatin1Safe,
  wrapText,
  textOp,
  ruleOp,
  brandHeaderOps,
  footerOp,
  assemblePdf,
} from "./pdf-core.mjs";

// Re-exported for the existing letter-pdf unit tests + any caller importing them
// from here historically.
export { escapePdfText, toLatin1Safe, wrapText };

// DIN-5008 left address field (≈ window-envelope position): ~20mm from the left,
// the address top ~45mm from the page top. Pingen 'left' reads it from here.
export const ADDRESS_LEFT_X = 57; // ≈ 20mm
export const ADDRESS_TOP_Y = PAGE_H - 150; // ≈ 53mm from top (below the letterhead)
const ADDRESS_FONT = 11;
const ADDRESS_LEADING = 14;

// Date + subject + body frame.
const DATE_Y = PAGE_H - 300;
const SUBJECT_Y = PAGE_H - 330;
const BODY_LEFT_X = 57;
const BODY_TOP_Y_PAGE1 = PAGE_H - 360; // below the subject
const BODY_TOP_Y_PAGEN = PAGE_H - 70; // full height on continuation pages
const BODY_BOTTOM_Y = 70;
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

/**
 * Build the letter PDF.
 * @param {{ recipient: { name: string, company?: string|null,
 *           addressLine1: string, addressLine2?: string|null,
 *           postalCode: string, city: string, country: string },
 *           senderLine?: string|null, subject?: string|null, body: string,
 *           date?: string|null }} input
 * @returns {Buffer}
 */
export function buildLetterPdf(input) {
  const { recipient, senderLine, subject, body, date } = input;

  /** @type {string[]} */
  const pages = [];
  let content = "";

  // ── Letterhead (brand accent, matching the email) ─────────────────────────
  content += brandHeaderOps();

  // ── Sender return line (small, just above the address window) ─────────────
  content += textOp(
    "F1",
    ADDRESS_LEFT_X,
    ADDRESS_TOP_Y + ADDRESS_LEADING + 8,
    7,
    senderLine || "motion sports"
  );

  // ── Recipient address — the block Pingen reads ────────────────────────────
  let ay = ADDRESS_TOP_Y;
  for (const line of addressLines(recipient)) {
    content += textOp("F1", ADDRESS_LEFT_X, ay, ADDRESS_FONT, line);
    ay -= ADDRESS_LEADING;
  }

  // ── Date (left-aligned) ───────────────────────────────────────────────────
  content += textOp("F1", BODY_LEFT_X, DATE_Y, 10, date || new Date().toLocaleDateString("de-DE"));

  // ── Subject (bold) ────────────────────────────────────────────────────────
  if (subject && subject.trim()) {
    content += textOp("F2", BODY_LEFT_X, SUBJECT_Y, 12, subject.trim());
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
  return assemblePdf(pages.map((p) => p + footerOp()));
}
