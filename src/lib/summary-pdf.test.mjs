import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSummaryPdf } from "./summary-pdf.mjs";

test("buildSummaryPdf: valid PDF with the summary + both product sections", () => {
  const pdf = buildSummaryPdf({
    summary: "Du suchst ein leises Laufband für die Wohnung. Empfohlen: das ATX Pro.",
    chosen: [{ name: "ATX Treadmill Pro", priceLabel: "1.999,00 €" }],
    cartUrl: "https://www.motionsports.de/cart/123:1",
    alternatives: [
      { name: "ATX Treadmill Silent X", priceLabel: "2.499,00 €", url: "https://www.motionsports.de/products/silent-x" },
    ],
  });

  assert.ok(Buffer.isBuffer(pdf));
  const text = pdf.toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4"), "has a PDF header");
  assert.ok(text.includes("/BaseFont /Helvetica"), "embeds the font");
  assert.ok(text.trimEnd().endsWith("%%EOF"), "ends with EOF");

  // The same sections the email has are present.
  assert.ok(text.includes("Deine Zusammenfassung"), "heading");
  assert.ok(text.includes("ATX Treadmill Pro"), "chosen product");
  assert.ok(text.includes("Deine Auswahl"), "chosen section title");
  assert.ok(text.includes("Zur Kasse"), "cart section");
  assert.ok(text.includes("Vielleicht auch interessant"), "alternatives section title");
  assert.ok(text.includes("ATX Treadmill Silent X"), "alternative product");
});

test("buildSummaryPdf: degrades gracefully with no products / no cart", () => {
  const pdf = buildSummaryPdf({
    summary: "In diesem Gespräch wurde noch kein Beratungsverlauf festgehalten.",
    chosen: [],
    cartUrl: null,
    alternatives: [],
  });
  const text = pdf.toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.ok(text.includes("Deine Zusammenfassung"));
  // No product sections when there are no products.
  assert.ok(!text.includes("Deine Auswahl"), "no chosen section");
  assert.ok(!text.includes("Vielleicht auch interessant"), "no alternatives section");
  assert.ok(text.trimEnd().endsWith("%%EOF"));
});

test("buildSummaryPdf: a long summary paginates onto multiple pages", () => {
  const summary = Array.from({ length: 200 }, (_, i) => `Satz ${i} mit etwas Beratungstext.`).join(" ");
  const pdf = buildSummaryPdf({ summary, chosen: [], cartUrl: null, alternatives: [] });
  const text = pdf.toString("latin1");
  const m = text.match(/\/Count (\d+)/);
  assert.ok(m, "has a Pages /Count");
  assert.ok(Number(m[1]) > 1, "paginated onto more than one page");
});
