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

// ── Pingen address-window placement (the layout bug this guards) ─────────────
// Pingen rejects the letter unless the recipient address sits fully inside the
// Address Area (x:[22,107.5] y:[60,85.5]mm from the page top/left) and nothing
// else intrudes into the Postage Area above it. A4 height = 841.89pt, 1mm =
// 72/25.4 pt, and PDF y is measured from the BOTTOM — so the area maps to
// x ≥ 62.36pt and y ∈ [599.53, 671.81]pt.
const MM = 72 / 25.4;
const PAGE_H = 841.89;
const ADDR_X_MIN = 22 * MM; // 62.36pt
const ADDR_Y_TOP = PAGE_H - 60 * MM; // 671.81pt (top of the area)
const ADDR_Y_BOTTOM = PAGE_H - 85.5 * MM; // 599.53pt (bottom of the area)

/** The (x, y) of the text-positioning matrix for the line drawing `label`. */
function positionOf(pdfText, label) {
  const m = pdfText.match(
    new RegExp(`1 0 0 1 (\\d+(?:\\.\\d+)?) (\\d+(?:\\.\\d+)?) Tm \\(${label}\\) Tj`)
  );
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

test("buildLetterPdf: the recipient address sits inside the Pingen Address Area", () => {
  const pdf = buildLetterPdf({
    recipient: {
      name: "Marcel Kueck",
      company: null,
      addressLine1: "Hermann-Löns-Straße 22A",
      addressLine2: null,
      postalCode: "82194",
      city: "Gröbenzell",
      country: "DE",
    },
    subject: "Dein Horizon Tread-XP wartet auf dich",
    body: "Hallo Marcel,\n\nschön, dass wir sprechen konnten.",
  });
  const text = pdf.toString("latin1");

  // First line (name) and last line (postal + city) must both be in the window.
  const name = positionOf(text, "Marcel Kueck");
  const city = positionOf(text, "82194 Gröbenzell");
  assert.ok(name, "address name line is present");
  assert.ok(city, "address city line is present");

  for (const [label, p] of [["name", name], ["city", city]]) {
    assert.ok(p.x >= ADDR_X_MIN, `${label} x=${p.x} must be ≥ ${ADDR_X_MIN.toFixed(2)} (22mm)`);
    assert.ok(
      p.y <= ADDR_Y_TOP && p.y >= ADDR_Y_BOTTOM,
      `${label} y=${p.y} must be within [${ADDR_Y_BOTTOM.toFixed(2)}, ${ADDR_Y_TOP.toFixed(2)}]`
    );
  }
  // The name (first line) sits above the city (last line) in the window.
  assert.ok(name.y > city.y, "name is above the city line");
});

test("buildLetterPdf: a full 6-line address still fits inside the Address Area", () => {
  const pdf = buildLetterPdf({
    recipient: {
      name: "Dr. Maximilian Mustermann",
      company: "Muster GmbH & Co. KG",
      addressLine1: "Musterstraße 123",
      addressLine2: "Hinterhaus, 4. OG",
      postalCode: "1000",
      city: "Wien",
      country: "AT",
    },
    subject: null,
    body: "Hallo,\n\nText.",
  });
  const text = pdf.toString("latin1");
  const top = positionOf(text, "Dr\\. Maximilian Mustermann");
  const country = positionOf(text, "AT");
  assert.ok(top && country, "first + last address lines present");
  assert.ok(top.y <= ADDR_Y_TOP, "first line not above the area");
  assert.ok(country.y >= ADDR_Y_BOTTOM, `last line y=${country.y} not below the area`);
});

