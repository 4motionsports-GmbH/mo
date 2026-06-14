// Letter → PDF, dependency-free.
//
// Pingen reads the recipient address FROM THE PDF at the configured
// `address_position` (we use 'left'), so the address block MUST sit in the
// standard DIN-5008 left address window. This builds a minimal, valid A4 PDF
// (base-14 Helvetica, WinAnsi/Latin-1 so German umlauts/ß render) with the
// address placed exactly there and the personalised body flowed below it,
// paginating onto further pages when long.
//
// We hand-write the PDF (no puppeteer/headless Chrome on Vercel, no PDF dep):
// the layout is fixed and simple, which keeps it deterministic and unit-testable
// (wrapText/escape are pure). The same personalised content that drives the
// email draft (lib/marketing-draft) is the body here — see lib/physical-mail.

// A4 in PostScript points (1pt = 1/72").
const PAGE_W = 595.28;
const PAGE_H = 841.89;

// DIN-5008 left address field (≈ window-envelope position): ~20mm from the left,
// the address top ~45mm from the page top. Pingen 'left' reads it from here.
export const ADDRESS_LEFT_X = 57; // ≈ 20mm
export const ADDRESS_TOP_Y = PAGE_H - 128; // ≈ 45mm from top
const ADDRESS_FONT = 11;
const ADDRESS_LEADING = 14;

// Body text frame.
const BODY_LEFT_X = 57; // align under the address
const BODY_TOP_Y_PAGE1 = PAGE_H - 300; // below the address block
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
      // Hard-split an over-long single token.
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

/** The recipient address as ordered display lines (no part-filling — callers
 *  pass a validated, complete address; optional company/line2/country handled). */
export function addressLines(recipient) {
  const lines = [recipient.name];
  if (recipient.company) lines.push(recipient.company);
  lines.push(recipient.addressLine1);
  if (recipient.addressLine2) lines.push(recipient.addressLine2);
  lines.push(`${recipient.postalCode} ${recipient.city}`.trim());
  // Domestic (DE) letters omit the country line; foreign mail names it.
  if (recipient.country && recipient.country.toUpperCase() !== "DE") {
    lines.push(recipient.country.toUpperCase());
  }
  return lines;
}

/** One PDF text line at an absolute position (own BT/ET so positioning is
 *  independent and trivial to reason about). */
function textOp(x, y, size, str) {
  const safe = escapePdfText(toLatin1Safe(str));
  return `BT /F1 ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${safe}) Tj ET\n`;
}

/**
 * Build the letter PDF.
 * @param {{ recipient: { name: string, company?: string|null,
 *           addressLine1: string, addressLine2?: string|null,
 *           postalCode: string, city: string, country: string },
 *           senderLine?: string|null, subject?: string|null, body: string }} input
 * @returns {Buffer}
 */
export function buildLetterPdf(input) {
  const { recipient, senderLine, subject, body } = input;

  // ── Lay out content into per-page content streams ────────────────────────
  /** @type {string[]} */
  const pages = [];
  let content = "";

  // Optional small sender line just above the address window.
  if (senderLine) {
    content += textOp(ADDRESS_LEFT_X, ADDRESS_TOP_Y + ADDRESS_LEADING + 6, 8, senderLine);
  }
  // Recipient address — the block Pingen reads.
  let ay = ADDRESS_TOP_Y;
  for (const line of addressLines(recipient)) {
    content += textOp(ADDRESS_LEFT_X, ay, ADDRESS_FONT, line);
    ay -= ADDRESS_LEADING;
  }

  // Body lines (subject as a bold-ish first line — we only have Helvetica, so
  // it's just emphasised by spacing).
  const bodyLines = [];
  if (subject && subject.trim()) {
    bodyLines.push(subject.trim());
    bodyLines.push("");
  }
  bodyLines.push(...wrapText(body));

  let y = BODY_TOP_Y_PAGE1;
  for (const line of bodyLines) {
    if (y < BODY_BOTTOM_Y) {
      pages.push(content);
      content = "";
      y = BODY_TOP_Y_PAGEN;
    }
    if (line !== "") content += textOp(BODY_LEFT_X, y, BODY_FONT, line);
    y -= BODY_LEADING;
  }
  pages.push(content);

  return assemblePdf(pages);
}

// ── Low-level PDF assembly: objects + a byte-accurate xref table ────────────
function assemblePdf(pageStreams) {
  // Object plan: 1 catalog, 2 pages, 3 font, then per page a Page + a Contents.
  const pageCount = pageStreams.length;
  const firstPageObj = 4;
  const pageObjNums = [];
  for (let i = 0; i < pageCount; i++) pageObjNums.push(firstPageObj + i * 2);
  const kids = pageObjNums.map((n) => `${n} 0 R`).join(" ");

  /** @type {string[]} */
  const objects = [];
  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`;
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;

  for (let i = 0; i < pageCount; i++) {
    const pageNum = pageObjNums[i];
    const contentNum = pageNum + 1;
    const stream = pageStreams[i] || "";
    const length = Buffer.byteLength(stream, "latin1");
    objects[pageNum] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNum} 0 R >>`;
    objects[contentNum] = `<< /Length ${length} >>\nstream\n${stream}endstream`;
  }

  const totalObjects = 3 + pageCount * 2;

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
