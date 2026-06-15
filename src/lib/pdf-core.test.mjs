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
  // The Euro sign (U+20AC) is > 0xFF and is coerced to '?' (documented behaviour).
  assert.equal(toLatin1Safe("5 €"), "5 ?");
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
