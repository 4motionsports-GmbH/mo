// Unit tests for the dependency-free PDF primitives in pdf-core.mjs.
//
// These functions are the shared base of BOTH the physical-letter PDF
// (lib/letter-pdf) and the signed-in summary download PDF (lib/summary-pdf).
// The letter goes out as legally-relevant correspondence, so the Latin-1
// coercion (German umlauts/ß must survive, anything else must NOT corrupt the
// byte stream) and the PDF-literal escaping are load-bearing. pdf-core is pure
// and deterministic by design but was the only *-core.mjs without a direct
// test; this covers the primitives in isolation.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escapePdfText,
  toLatin1Safe,
  wrapText,
  textOp,
  assemblePdf,
  assembleImagePdf,
  jpegInfo,
  pdfInfoString,
  PAGE_W,
  PAGE_H,
} from "./pdf-core.mjs";

test("escapePdfText escapes the three PDF-literal metacharacters", () => {
  // Parentheses delimit a PDF string literal; backslash is the escape char.
  assert.equal(escapePdfText("(hi)"), "\\(hi\\)");
  assert.equal(escapePdfText("a\\b"), "a\\\\b");
  // Backslash must be escaped BEFORE the parens, or the inserted escapes get
  // double-escaped — verify the combined case comes out right.
  assert.equal(escapePdfText("x(\\)y"), "x\\(\\\\\\)y");
  // Plain text is untouched (incl. umlauts, which are valid in a literal).
  assert.equal(escapePdfText("Grüße"), "Grüße");
});

test("toLatin1Safe preserves German letters but neutralises non-Latin-1 code points", () => {
  // The whole point: ä ö ü Ä Ö Ü ß are all <= 0xFF, so they survive intact —
  // a German letter must never be mangled.
  assert.equal(toLatin1Safe("Schöne Grüße, äöü ÄÖÜ ß"), "Schöne Grüße, äöü ÄÖÜ ß");
  // Typographic characters WinAnsi has become its byte (they print as themselves).
  assert.equal(toLatin1Safe("5 €"), "5 \x80");
  assert.equal(toLatin1Safe("„Hallo“ – so … — ok"), "\x84Hallo\x93 \x96 so \x85 \x97 ok");
  // C1 control code points never pass through.
  assert.equal(toLatin1Safe("a\u0085b"), "a?b");
  // Emoji (astral plane) iterate as a single code point > 0xFF -> single '?'.
  assert.equal(toLatin1Safe("hi 😀"), "hi ?");
  // Pure ASCII is unchanged.
  assert.equal(toLatin1Safe("Motion Sports"), "Motion Sports");
});

test("wrapText wraps at the width and keeps paragraph breaks", () => {
  assert.deepEqual(wrapText("short line", 90), ["short line"]);
  // Wraps when the running line would exceed maxChars.
  assert.deepEqual(wrapText("aaa bbb ccc", 7), ["aaa bbb", "ccc"]);
  // A blank line between paragraphs is preserved as a blank line.
  assert.deepEqual(wrapText("one\n\ntwo", 90), ["one", "", "two"]);
  // CRLF is normalised to LF before splitting.
  assert.deepEqual(wrapText("a\r\nb", 90), ["a", "b"]);
});

test("wrapText hard-splits a single word longer than the width", () => {
  // A word that cannot fit must be chopped so it can never overflow the frame.
  assert.deepEqual(wrapText("abcdefgh", 3), ["abc", "def", "gh"]);
});

test("textOp emits an escaped, positioned text op in the requested font", () => {
  const op = textOp("F2", 57, 700, 12, "Grüße (1)");
  assert.match(op, /^BT \/F2 12 Tf /); // font + size
  assert.match(op, /1 0 0 1 57\.00 700\.00 Tm/); // position matrix
  assert.match(op, /\(Grüße \\\(1\\\)\) Tj ET/); // escaped literal + show + end
});

test("assemblePdf produces a structurally valid single-page PDF", () => {
  const pdf = assemblePdf([textOp("F1", 57, 700, 11, "Hallo Welt")]);
  assert.ok(Buffer.isBuffer(pdf));
  const text = pdf.toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4\n"), "has the PDF header");
  assert.ok(text.includes("/Type /Catalog"), "has a catalog object");
  assert.ok(text.includes("/Count 1"), "page tree counts one page");
  assert.ok(text.includes("\nxref\n"), "has an xref table");
  assert.ok(text.trimEnd().endsWith("%%EOF"), "ends with the EOF marker");
});

test("assemblePdf scales the page tree /Count to the number of pages", () => {
  const pdf = assemblePdf([
    textOp("F1", 57, 700, 11, "Seite 1"),
    textOp("F1", 57, 700, 11, "Seite 2"),
  ]);
  assert.ok(pdf.toString("latin1").includes("/Count 2"));
});

// ---------------------------------------------------------------------------
// assembleImagePdf — picture pages + invisible text (gift voucher download)
// ---------------------------------------------------------------------------

/** A minimal JPEG header (SOI, APP0/JFIF, SOF0, EOI) — enough for the assembler. */
function fakeJpeg(width, height, components = 3) {
  const sof = [0xff, 0xc0, 0x00, 8 + 3 * components, 0x08, height >> 8, height & 255, width >> 8, width & 255, components];
  for (let i = 0; i < components; i++) sof.push(i + 1, 0x11, 0x00);
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    ...sof, 0xff, 0xd9,
  ]);
}

/** Every xref entry must point at "<n> 0 obj", startxref at "xref". */
function assertXrefConsistent(pdf) {
  const text = pdf.toString("latin1");
  const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)?.[1]);
  assert.equal(text.slice(startxref, startxref + 5), "xref\n", "startxref points at the xref table");
  const m = /^xref\n0 (\d+)\n/.exec(text.slice(startxref));
  assert.ok(m);
  const size = Number(m[1]);
  const entries = text.slice(startxref + m[0].length).split("\n").slice(0, size);
  assert.equal(entries[0], "0000000000 65535 f ");
  for (let n = 1; n < size; n++) {
    const off = Number(entries[n].slice(0, 10));
    assert.equal(text.slice(off, off + `${n} 0 obj`.length), `${n} 0 obj`, `xref entry ${n}`);
  }
  assert.match(text, new RegExp(`trailer\\n<< /Size ${size} /Root 1 0 R /Info 4 0 R >>`));
  return text;
}

test("jpegInfo reads the frame header and rejects non-JPEG bytes", () => {
  assert.deepEqual(jpegInfo(fakeJpeg(1819, 2572)), { width: 1819, height: 2572, components: 3 });
  assert.deepEqual(jpegInfo(fakeJpeg(10, 20, 1)), { width: 10, height: 20, components: 1 });
  assert.equal(jpegInfo(Buffer.from("%PDF-1.4")), null);
  assert.equal(jpegInfo(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), null);
  assert.equal(jpegInfo(Buffer.alloc(0)), null);
});

test("assembleImagePdf embeds the JPEG as is, with a byte-accurate xref", () => {
  const jpeg = fakeJpeg(1819, 2572);
  const pdf = assembleImagePdf(
    [{ images: [{ data: jpeg, x: 0, y: 0, width: PAGE_W, height: PAGE_H }], texts: [] }],
    { title: "Geschenkgutschein G-2026-00042", lang: "de-DE" }
  );
  assert.ok(Buffer.isBuffer(pdf));
  const text = assertXrefConsistent(pdf);
  assert.ok(text.startsWith("%PDF-1.4\n"));
  assert.ok(text.includes("/Type /Pages /Kids [5 0 R] /Count 1"));
  assert.ok(text.includes(`/MediaBox [0 0 ${PAGE_W} ${PAGE_H}]`));
  assert.ok(text.includes("/Subtype /Image /Width 1819 /Height 2572 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode"));
  assert.ok(text.includes(`/Length ${jpeg.length} >>\nstream\n`));
  assert.ok(pdf.includes(jpeg), "the JPEG bytes are embedded unchanged");
  assert.ok(text.includes(`q ${PAGE_W} 0 0 ${PAGE_H} 0 0 cm /Im1 Do Q`));
  assert.ok(text.includes("/Title (Geschenkgutschein G-2026-00042)"));
  assert.ok(text.includes("/Lang (de-DE)"));
  assert.ok(text.trimEnd().endsWith("%%EOF"));
});

test("assembleImagePdf writes the invisible text layer (render mode 3), stretched to its box", () => {
  const pdf = assembleImagePdf([
    {
      images: [{ data: fakeJpeg(100, 100), x: 0, y: 0, width: PAGE_W, height: PAGE_H }],
      texts: [
        { text: "K7QM 4TXP 9HDA 2RWN", x: 330.5, y: 300.25, size: 12, width: 180 },
        { text: "Gutschein-Nr. G-2026-00042 (Kopie)", x: 40, y: 20, size: 6 },
        { text: "   ", x: 0, y: 0, size: 9 },
      ],
    },
  ]);
  const text = assertXrefConsistent(pdf);
  const code = /BT 3 Tr \/F1 12 Tf ([\d.]+) Tz 1 0 0 1 330\.5 300\.25 Tm \(K7QM 4TXP 9HDA 2RWN\) Tj ET/.exec(text);
  assert.ok(code, "the code is in the text layer");
  assert.ok(Number(code[1]) > 50 && Number(code[1]) < 200, "horizontal scaling fits the printed width");
  assert.ok(text.includes("(Gutschein-Nr. G-2026-00042 \\(Kopie\\)) Tj ET"), "escaped literal");
  assert.equal((text.match(/ 3 Tr /g) ?? []).length, 2, "blank lines are skipped");
  assert.ok(text.includes("/Font << /F1 3 0 R >>"));
});

test("assembleImagePdf: several pages and images, grey JPEGs, and non-JPEG input is refused", () => {
  const pdf = assembleImagePdf([
    { images: [{ data: fakeJpeg(10, 10), x: 0, y: 0, width: 100, height: 100 }, { data: fakeJpeg(20, 10, 1), x: 0, y: 100, width: 200, height: 100 }] },
    { width: 300, height: 200, images: [{ data: fakeJpeg(30, 20), x: 0, y: 0, width: 300, height: 200 }] },
  ]);
  const text = assertXrefConsistent(pdf);
  assert.ok(text.includes("/Count 2"));
  assert.equal((text.match(/\/Subtype \/Image/g) ?? []).length, 3);
  assert.ok(text.includes("/ColorSpace /DeviceGray"));
  assert.ok(text.includes("/MediaBox [0 0 300 200]"));
  assert.ok(text.includes("/Im2 Do"));
  assert.throws(() => assembleImagePdf([{ images: [{ data: Buffer.from("not a jpeg"), x: 0, y: 0, width: 1, height: 1 }] }]), TypeError);
  assert.throws(() => assembleImagePdf([]), TypeError);
});

test("pdfInfoString: ASCII literal, anything else UTF-16BE hex", () => {
  assert.equal(pdfInfoString("Gift voucher (A)"), "(Gift voucher \\(A\\))");
  const hex = pdfInfoString("Gutschein für Zoë");
  assert.match(hex, /^<FEFF([0-9A-F]{4})+>$/);
  const units = hex.slice(5, -1).match(/.{4}/g) ?? [];
  assert.equal(String.fromCharCode(...units.map((u) => parseInt(u, 16))), "Gutschein für Zoë");
});
