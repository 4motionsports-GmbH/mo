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

// A4 in PostScript points (1pt = 1/72").
const PAGE_W = 595.28;
const PAGE_H = 841.89;

const MARGIN_X = 57; // ≈ 20mm left/right margin

// Brand palette — matches the email template (lib/email-template): the shop
// accent #008ccb (= rgb 0, 0.549, 0.796) for the wordmark + rule; a muted grey
// footer. PDF colours are 0–1 "r g b" operands.
const ACCENT_RGB = "0 0.549 0.796";
const MUTED_RGB = "0.45 0.45 0.45";
const BLACK_RGB = "0 0 0";

// Footer line (every page), echoing the email's Shop/Über/Kontakt/Impressum bar.
const FOOTER_Y = 40;
const FOOTER_TEXT =
  "motion sports  ·  www.motionsports.de  ·  Shop · Über · Kontakt · Impressum";

// Letterhead.
const BRAND_Y = PAGE_H - 64;
const RULE_Y = BRAND_Y - 10;

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

/** Escape the three characters that are special inside a PDF literal string. */
export function escapePdfText(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Coerce to Latin-1-safe text: any code point > 0xFF (emoji etc.) → '?', so the
 *  latin1 byte encoding the PDF uses can never be corrupted. */
export function toLatin1Safe(s) {
  let out = "";
  for (const ch of String(s)) {
    out += ch.codePointAt(0) > 0xff ? "?" : ch;
  }
  return out;
}

/**
 * Word-wrap text to a max character width, preserving explicit newlines as
 * hard paragraph breaks (a blank line stays a blank line). A single word longer
 * than the width is hard-split so it can't overflow the frame.
 * @param {string} text
 * @param {number} [maxChars]
 * @returns {string[]}
 */
export function wrapText(text, maxChars = BODY_MAX_CHARS) {
  const lines = [];
  for (const para of String(text).replace(/\r\n/g, "\n").split("\n")) {
    if (para.trim() === "") {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of para.split(/\s+/)) {
      let w = word;
      while (w.length > maxChars) {
        if (current) {
          lines.push(current);
          current = "";
        }
        lines.push(w.slice(0, maxChars));
        w = w.slice(maxChars);
      }
      if (!current) current = w;
      else if (current.length + 1 + w.length <= maxChars) current += " " + w;
      else {
        lines.push(current);
        current = w;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

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

/** One PDF text line at an absolute position in the given font (F1=Helvetica,
 *  F2=Helvetica-Bold) and fill colour ("r g b", default black). Own BT/ET so
 *  positioning is trivial to reason about. */
function textOp(font, x, y, size, str, color = BLACK_RGB) {
  const safe = escapePdfText(toLatin1Safe(str));
  return (
    `BT /${font} ${size} Tf ${color} rg 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm ` +
    `(${safe}) Tj ET\n`
  );
}

/** A horizontal rule (stroked line) at y from x1→x2 with the given width + stroke colour. */
function ruleOp(x1, x2, y, width, color = BLACK_RGB) {
  return (
    `${color} RG ${width} w ${x1.toFixed(2)} ${y.toFixed(2)} m ` +
    `${x2.toFixed(2)} ${y.toFixed(2)} l S\n`
  );
}

/** The muted footer line, repeated on every page (the email's menu bar echo). */
function footerOp() {
  return textOp("F1", MARGIN_X, FOOTER_Y, 7.5, FOOTER_TEXT, MUTED_RGB);
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
  content += textOp("F2", MARGIN_X, BRAND_Y, 22, "motion sports", ACCENT_RGB);
  content += ruleOp(MARGIN_X, PAGE_W - MARGIN_X, RULE_Y, 1.2, ACCENT_RGB);

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
  let y = BODY_TOP_Y_PAGE1;
  for (const line of wrapText(body)) {
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

// ── Low-level PDF assembly: objects + a byte-accurate xref table ────────────
function assemblePdf(pageStreams) {
  // Object plan: 1 catalog, 2 pages, 3 font F1, 4 font F2, then per page a Page
  // + a Contents.
  const pageCount = pageStreams.length;
  const firstPageObj = 5;
  const pageObjNums = [];
  for (let i = 0; i < pageCount; i++) pageObjNums.push(firstPageObj + i * 2);
  const kids = pageObjNums.map((n) => `${n} 0 R`).join(" ");

  /** @type {string[]} */
  const objects = [];
  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`;
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;
  objects[4] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`;

  for (let i = 0; i < pageCount; i++) {
    const pageNum = pageObjNums[i];
    const contentNum = pageNum + 1;
    const stream = pageStreams[i] || "";
    const length = Buffer.byteLength(stream, "latin1");
    objects[pageNum] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNum} 0 R >>`;
    objects[contentNum] = `<< /Length ${length} >>\nstream\n${stream}endstream`;
  }

  const totalObjects = 4 + pageCount * 2;

  // Serialise, tracking each object's byte offset for the xref.
  const header = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  let body = header;
  const offsets = new Array(totalObjects + 1).fill(0);
  for (let n = 1; n <= totalObjects; n++) {
    offsets[n] = Buffer.byteLength(body, "latin1");
    body += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(body, "latin1");
  let xref = `xref\n0 ${totalObjects + 1}\n`;
  xref += "0000000000 65535 f \n";
  for (let n = 1; n <= totalObjects; n++) {
    xref += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  }
  const trailer =
    `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(body + xref + trailer, "latin1");
}
