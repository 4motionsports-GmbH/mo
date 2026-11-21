// Dependency-free PDF primitives, shared by the physical-letter PDF
// (lib/letter-pdf) and the signed-in summary download PDF (lib/summary-pdf);
// assembleImagePdf (picture pages + invisible text) serves the gift voucher
// download (lib/gift-voucher-render).
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
const BLACK_RGB = "0 0 0";

// Letterhead position (the "motion sports" wordmark + accent rule).
const BRAND_Y = PAGE_H - 64;
const RULE_Y = BRAND_Y - 10;

// Footer line (every page), echoing the email's Shop/Über/Kontakt/Impressum bar.
const FOOTER_Y = 40;
const FOOTER_TEXT =
  "motion sports  ·  www.motionsports.de  ·  Shop · Über · Kontakt · Impressum";
const FOOTER_TEXT_EN =
  "motion sports  ·  www.motionsports.de  ·  Shop · About · Contact · Imprint";

/** Escape the three characters that are special inside a PDF literal string. */
export function escapePdfText(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Typographic characters WinAnsiEncoding (the fonts' encoding) has in its
 *  0x80–0x9F range: written as that byte they print as themselves. */
const WIN_ANSI = new Map([
  [0x20ac, 0x80], // €
  [0x201a, 0x82], // ‚
  [0x201e, 0x84], // „
  [0x2026, 0x85], // …
  [0x2018, 0x91], // ‘
  [0x2019, 0x92], // ’
  [0x201c, 0x93], // “
  [0x201d, 0x94], // ”
  [0x2022, 0x95], // •
  [0x2013, 0x96], // –
  [0x2014, 0x97], // —
  [0x2122, 0x99], // ™
]);

/** Coerce to Latin-1-safe text: the typographic characters WinAnsi knows
 *  („“ – — … € …) become their WinAnsi byte, any other code point > 0xFF
 *  (emoji etc.) → '?', so the latin1 byte encoding the PDF uses can never be
 *  corrupted. Bytes 0x80–0x9F that are not WinAnsi glyphs (C1 controls) → '?'. */
export function toLatin1Safe(s) {
  let out = "";
  for (const ch of String(s)) {
    const cp = /** @type {number} */ (ch.codePointAt(0));
    const mapped = WIN_ANSI.get(cp);
    if (mapped != null) out += String.fromCharCode(mapped);
    else if (cp > 0xff || (cp >= 0x80 && cp <= 0x9f)) out += "?";
    else out += ch;
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

/**
 * The muted footer line, repeated on every page (the email's menu bar echo);
 * German unless `locale` is "en".
 * @param {unknown} [locale]
 */
export function footerOp(locale) {
  return textOp("F1", MARGIN_X, FOOTER_Y, 7.5, locale === "en" ? FOOTER_TEXT_EN : FOOTER_TEXT, MUTED_RGB);
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

// ---------------------------------------------------------------------------
// Image pages (the gift voucher download PDF)
// ---------------------------------------------------------------------------
//
// assembleImagePdf builds pages that are pictures: every page shows one or
// more JPEGs (embedded as they are — DCTDecode, no re-encoding) and may carry
// an INVISIBLE text layer (text render mode 3) on top, so a code printed in
// the picture can still be selected, searched and copied. The text layer uses
// the base-14 Helvetica (WinAnsi, not embedded); `width` stretches a line
// horizontally (Tz) so the selection covers the printed text.

/** Helvetica advance widths (1/1000 em) for printable ASCII, from the AFM. */
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // 32–47
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, // 48–63
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, // 64–79
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, // 80–95
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, // 96–111
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, // 112–126
];

/** Width of a WinAnsi string in Helvetica at `size` pt (non-ASCII ≈ 556). @param {string} s @param {number} size */
function helveticaWidth(s, size) {
  let w = 0;
  for (const ch of s) {
    const cp = /** @type {number} */ (ch.codePointAt(0));
    w += cp >= 32 && cp <= 126 ? HELVETICA_WIDTHS[cp - 32] : 556;
  }
  return (w / 1000) * size;
}

/**
 * Width, height and colour components of a JPEG (from its SOF marker), or
 * null when the bytes are not a JPEG.
 * @param {Uint8Array} bytes
 * @returns {{ width: number, height: number, components: number } | null}
 */
export function jpegInfo(bytes) {
  if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // EOI / SOS before a frame header
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (i + 9 >= bytes.length) return null;
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      const components = bytes[i + 9];
      return width > 0 && height > 0 && components > 0 ? { width, height, components } : null;
    }
    i += 2 + len;
  }
  return null;
}

/** A number for a content stream (≤ 3 decimals, no exponent, no "-0"). @param {number} v */
function pdfNum(v) {
  const r = Math.round(v * 1000) / 1000;
  return r === 0 ? "0" : String(r);
}

/**
 * A PDF text string for the document info: a literal for printable ASCII,
 * else UTF-16BE with BOM as hex.
 * @param {string} s
 */
export function pdfInfoString(s) {
  const str = String(s);
  if (/^[\x20-\x7e]*$/.test(str)) return `(${escapePdfText(str)})`;
  let hex = "FEFF";
  for (let i = 0; i < str.length; i++) hex += str.charCodeAt(i).toString(16).padStart(4, "0").toUpperCase();
  return `<${hex}>`;
}

/**
 * @typedef {{ data: Uint8Array, x: number, y: number, width: number, height: number }} PdfJpegPlacement
 *   A JPEG drawn into the box (pt, origin bottom left).
 * @typedef {{ text: string, x: number, y: number, size: number, width?: number }} PdfHiddenText
 *   An invisible line: baseline start (pt), font size; `width` stretches it to that many pt.
 * @typedef {{ width?: number, height?: number, images: PdfJpegPlacement[], texts?: PdfHiddenText[] }} PdfImagePage
 *   Page size in pt (default A4 portrait).
 */

/**
 * Pages made of JPEG pictures plus an optional invisible text layer, with a
 * byte-accurate xref table. Throws a TypeError for bytes that are not a JPEG.
 * @param {PdfImagePage[]} pages
 * @param {{ title?: string, subject?: string, author?: string, lang?: string }} [meta]
 * @returns {Buffer}
 */
export function assembleImagePdf(pages, meta = {}) {
  if (!Array.isArray(pages) || pages.length === 0) throw new TypeError("assembleImagePdf: no pages");
  // Object plan: 1 catalog, 2 pages, 3 font F1 (Helvetica, invisible text),
  // 4 document info, then per page: Page, Contents, one XObject per image.
  /** @type {Array<string | Array<string | Uint8Array>>} */
  const objects = [];
  /** @type {number[]} */
  const pageObjNums = [];
  let next = 5;
  for (const page of pages) {
    const pageNum = next++;
    const contentNum = next++;
    pageObjNums.push(pageNum);
    const w = typeof page.width === "number" && page.width > 0 ? page.width : PAGE_W;
    const h = typeof page.height === "number" && page.height > 0 ? page.height : PAGE_H;
    const xobjects = [];
    let content = "";
    (page.images ?? []).forEach((img, k) => {
      const info = jpegInfo(img.data);
      if (!info) throw new TypeError("assembleImagePdf: image is not a JPEG");
      const num = next++;
      const name = `Im${k + 1}`;
      xobjects.push(`/${name} ${num} 0 R`);
      const colorSpace =
        info.components === 1 ? "/DeviceGray" : info.components === 4 ? "/DeviceCMYK /Decode [1 0 1 0 1 0 1 0]" : "/DeviceRGB";
      objects[num] = [
        `<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace ${colorSpace} ` +
          `/BitsPerComponent 8 /Filter /DCTDecode /Length ${img.data.length} >>\nstream\n`,
        img.data,
        "\nendstream",
      ];
      content += `q ${pdfNum(img.width)} 0 0 ${pdfNum(img.height)} ${pdfNum(img.x)} ${pdfNum(img.y)} cm /${name} Do Q\n`;
    });
    for (const t of page.texts ?? []) {
      const str = toLatin1Safe(String(t.text ?? "").replace(/[\r\n]+/g, " "));
      if (!str.trim() || !(t.size > 0)) continue;
      const natural = helveticaWidth(str, t.size);
      const tz = typeof t.width === "number" && t.width > 0 && natural > 0 ? (t.width / natural) * 100 : 100;
      content +=
        `BT 3 Tr /F1 ${pdfNum(t.size)} Tf ${pdfNum(tz)} Tz 1 0 0 1 ${pdfNum(t.x)} ${pdfNum(t.y)} Tm ` +
        `(${escapePdfText(str)}) Tj ET\n`;
    }
    objects[pageNum] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfNum(w)} ${pdfNum(h)}] ` +
      `/Resources << /Font << /F1 3 0 R >> /XObject << ${xobjects.join(" ")} >> /ProcSet [/PDF /Text /ImageC] >> ` +
      `/Contents ${contentNum} 0 R >>`;
    objects[contentNum] = `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}endstream`;
  }
  const lang = typeof meta.lang === "string" && /^[A-Za-z]{2}(-[A-Za-z]{2})?$/.test(meta.lang) ? ` /Lang (${meta.lang})` : "";
  objects[1] = `<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /DisplayDocTitle true >>${lang} >>`;
  objects[2] = `<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;
  const info = [];
  if (meta.title) info.push(`/Title ${pdfInfoString(meta.title)}`);
  if (meta.subject) info.push(`/Subject ${pdfInfoString(meta.subject)}`);
  if (meta.author) info.push(`/Author ${pdfInfoString(meta.author)}`);
  info.push(`/Producer (motion sports)`);
  objects[4] = `<< ${info.join(" ")} >>`;

  const total = next - 1;
  /** @type {Buffer[]} */
  const chunks = [];
  let offset = 0;
  /** @param {string | Uint8Array} part */
  const push = (part) => {
    const buf = typeof part === "string" ? Buffer.from(part, "latin1") : Buffer.from(part.buffer, part.byteOffset, part.byteLength);
    chunks.push(buf);
    offset += buf.length;
  };
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  const offsets = new Array(total + 1).fill(0);
  for (let n = 1; n <= total; n++) {
    offsets[n] = offset;
    push(`${n} 0 obj\n`);
    const obj = objects[n];
    if (Array.isArray(obj)) obj.forEach(push);
    else push(obj);
    push("\nendobj\n");
  }
  const xrefOffset = offset;
  let xref = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= total; n++) xref += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${total + 1} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return Buffer.concat(chunks);
}
