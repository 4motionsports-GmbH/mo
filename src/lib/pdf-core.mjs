// Dependency-free PDF primitives, shared by the physical-letter PDF
// (lib/letter-pdf) and the signed-in summary download PDF (lib/summary-pdf).
//
// We hand-write the PDF rather than pull a headless browser / PDF dependency onto
// Vercel: both documents are simple flowed text with a brand letterhead + footer,
// which keeps generation deterministic, fast, and unit-testable. Two base-14
// fonts (Helvetica + Helvetica-Bold, WinAnsi/Latin-1 so German umlauts/ß render)
// need no embedding.
//
// Kept in plain .mjs so `node --test` exercises it with no build step.

// A4 in PostScript points (1pt = 1/72").
export const PAGE_W = 595.28;
export const PAGE_H = 841.89;

export const MARGIN_X = 57; // ≈ 20mm left/right margin

// Brand palette — matches the email template (lib/email-template): the shop
// accent #008ccb (= rgb 0, 0.549, 0.796) for the wordmark + rule; a muted grey
// footer. PDF colours are 0–1 "r g b" operands.
export const ACCENT_RGB = "0 0.549 0.796";
export const MUTED_RGB = "0.45 0.45 0.45";
export const BLACK_RGB = "0 0 0";

// Letterhead position (the "motion sports" wordmark + accent rule).
export const BRAND_Y = PAGE_H - 64;
const RULE_Y = BRAND_Y - 10;

// Footer line (every page), echoing the email's Shop/Über/Kontakt/Impressum bar.
const FOOTER_Y = 40;
const FOOTER_TEXT =
  "motion sports  ·  www.motionsports.de  ·  Shop · Über · Kontakt · Impressum";

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
export function wrapText(text, maxChars = 90) {
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

/** One PDF text line at an absolute position in the given font (F1=Helvetica,
 *  F2=Helvetica-Bold) and fill colour ("r g b", default black). Own BT/ET so
 *  positioning is trivial to reason about. */
export function textOp(font, x, y, size, str, color = BLACK_RGB) {
  const safe = escapePdfText(toLatin1Safe(str));
  return (
    `BT /${font} ${size} Tf ${color} rg 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm ` +
    `(${safe}) Tj ET\n`
  );
}

/** A horizontal rule (stroked line) at y from x1→x2 with the given width + stroke colour. */
export function ruleOp(x1, x2, y, width, color = BLACK_RGB) {
  return (
    `${color} RG ${width} w ${x1.toFixed(2)} ${y.toFixed(2)} m ` +
    `${x2.toFixed(2)} ${y.toFixed(2)} l S\n`
  );
}

/** The "motion sports" brand letterhead (wordmark + accent rule) for the top of
 *  the first page. */
export function brandHeaderOps() {
  return (
    textOp("F2", MARGIN_X, BRAND_Y, 22, "motion sports", ACCENT_RGB) +
    ruleOp(MARGIN_X, PAGE_W - MARGIN_X, RULE_Y, 1.2, ACCENT_RGB)
  );
}

/** The muted footer line, repeated on every page (the email's menu bar echo). */
export function footerOp() {
  return textOp("F1", MARGIN_X, FOOTER_Y, 7.5, FOOTER_TEXT, MUTED_RGB);
}

/**
 * Low-level PDF assembly: catalog + pages + two fonts (F1 Helvetica, F2
 * Helvetica-Bold) + one Page/Contents pair per page, with a byte-accurate xref
 * table. `pageStreams` is the content stream string of each page (already
 * including its footer). Returns a latin1 Buffer.
 * @param {string[]} pageStreams
 * @returns {Buffer}
 */
export function assemblePdf(pageStreams) {
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
