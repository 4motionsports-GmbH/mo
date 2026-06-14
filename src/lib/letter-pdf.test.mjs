import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escapePdfText,
  toLatin1Safe,
  wrapText,
  addressLines,
  buildLetterPdf,
} from "./letter-pdf.mjs";

test("escapePdfText: escapes backslash and parentheses", () => {
  assert.equal(escapePdfText("a(b)c\\d"), "a\\(b\\)c\\\\d");
});

test("toLatin1Safe: keeps umlauts/ß, replaces >0xFF", () => {
  assert.equal(toLatin1Safe("Grüße äöüß"), "Grüße äöüß");
  assert.equal(toLatin1Safe("emoji 😀 x"), "emoji ? x");
});

test("wrapText: wraps to width and preserves blank lines", () => {
  const lines = wrapText("aaaa bbbb cccc", 9);
  assert.deepEqual(lines, ["aaaa bbbb", "cccc"]);
  assert.deepEqual(wrapText("one\n\ntwo", 40), ["one", "", "two"]);
});

test("wrapText: hard-splits an over-long single token", () => {
  const lines = wrapText("xxxxxxxxxxxx", 5);
  assert.deepEqual(lines, ["xxxxx", "xxxxx", "xx"]);
});

test("addressLines: order, optional company/line2, DE omits country", () => {
  assert.deepEqual(
    addressLines({
      name: "Erika Mustermann",
      addressLine1: "Musterstraße 1",
      postalCode: "12345",
      city: "Musterstadt",
      country: "DE",
    }),
    ["Erika Mustermann", "Musterstraße 1", "12345 Musterstadt"]
  );
});

test("addressLines: foreign country is named; company + line2 included", () => {
  assert.deepEqual(
    addressLines({
      name: "Max",
      company: "ACME",
      addressLine1: "Rue 1",
      addressLine2: "Bât B",
      postalCode: "1000",
      city: "Bruxelles",
      country: "be",
    }),
    ["Max", "ACME", "Rue 1", "Bât B", "1000 Bruxelles", "BE"]
  );
});

test("buildLetterPdf: produces a valid-looking PDF with the recipient + EOF", () => {
  const pdf = buildLetterPdf({
    recipient: {
      name: "Erika Mustermann",
      company: null,
      addressLine1: "Musterstraße 1",
      addressLine2: null,
      postalCode: "12345",
      city: "Musterstadt",
      country: "DE",
    },
    subject: "Dein persönliches Angebot",
    body: "Hallo Erika,\n\nschön, dass wir gesprochen haben. Grüße, Mo",
  });
  assert.ok(Buffer.isBuffer(pdf));
  const text = pdf.toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4"), "has a PDF header");
  assert.ok(text.includes("Erika Mustermann"), "renders the recipient name");
  assert.ok(text.includes("/BaseFont /Helvetica"), "embeds the font");
  assert.ok(text.includes("startxref"), "has an xref table");
  assert.ok(text.trimEnd().endsWith("%%EOF"), "ends with EOF");
});

test("buildLetterPdf: long body paginates onto multiple pages", () => {
  const body = Array.from({ length: 120 }, (_, i) => `Zeile ${i} mit etwas Text`).join("\n");
  const pdf = buildLetterPdf({
    recipient: {
      name: "Max",
      company: null,
      addressLine1: "Rue 1",
      addressLine2: null,
      postalCode: "1000",
      city: "Bruxelles",
      country: "BE",
    },
    subject: null,
    body,
  });
  const text = pdf.toString("latin1");
  // /Count N where N > 1 (the Pages object).
  const m = text.match(/\/Count (\d+)/);
  assert.ok(m, "has a Pages /Count");
  assert.ok(Number(m[1]) > 1, "paginated onto more than one page");
});
