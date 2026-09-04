import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCompareReportHtml, fmtEur, fmtUsd, variantOrder } from "./hero-compare-report.mjs";

const px = Buffer.from("ffd8ffe0", "hex"); // any bytes — embedded verbatim
const variant = (quality, usd, extra = {}) => ({
  label: quality,
  quality,
  ...extra,
  model: "gpt-image-2",
  size: "1536x720",
  desktop: px,
  mobile: px,
  inputTokens: 500,
  outputTokens: 4000,
  usd,
  eur: usd * 0.92,
  seconds: 42,
});
const rows = [
  {
    index: 1,
    source: "campaign #7",
    prompt: "An ATX® Power Rack 620 on the right …",
    headline: "Dein Rack.\nJetzt komplett.",
    variants: [variant("medium", 0.04), variant("high", 0.16)],
  },
  {
    index: 2,
    source: "datei",
    prompt: "A <bench> & rope",
    headline: "Mehr Leistung.\nMehr Fokus.",
    variants: [variant("medium", 0.04), variant("high", 0.16)],
  },
];

test("the sheet embeds every image, hides the labels until revealed and sums the cost", () => {
  const html = buildCompareReportHtml(rows, { generatedAt: new Date("2026-09-03T12:00:00Z") });
  assert.equal((html.match(/data:image\/jpeg;base64,/g) || []).length, 2 * 2 * 3, "desktop + mobile + raw link per variant");
  assert.match(html, /\.secret \{ color: #555; visibility: hidden; \}/);
  assert.match(html, /body\.revealed \.secret \{ visibility: visible; \}/);
  assert.match(html, /Gesamtkosten dieses Vergleichs 0\.400 \$ \(0,37 €\)/);
  assert.match(html, /2 Prompts × 2 Varianten \(medium \/ high\)/);
  assert.match(html, /Dein Rack\.<br>Jetzt komplett\./, "headline over the hero, two lines");
  assert.match(html, /name="pick-1"/);
  assert.match(html, /KI-generiertes Bild/);
});

test("prompt text is escaped", () => {
  const html = buildCompareReportHtml(rows);
  assert.match(html, /A &lt;bench&gt; &amp; rope/);
  assert.doesNotMatch(html, /A <bench> & rope/);
});

test("variant order is a deterministic permutation and not always the same", () => {
  assert.deepEqual(variantOrder("x", 3), variantOrder("x", 3));
  assert.deepEqual([...variantOrder("x", 3)].sort(), [0, 1, 2]);
  const firsts = new Set(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((p) => variantOrder(p, 3)[0]));
  assert.ok(firsts.size >= 2);
});

test("three variants get A/B/C, references and the QA verdict show on reveal", () => {
  const html = buildCompareReportHtml([
    {
      index: 1,
      source: "campaign #7",
      prompt: "p",
      headline: "A.\nB.",
      variants: [
        variant("medium", 0.04),
        variant("high", 0.16),
        variant("high", 0.2, { label: "high + Referenzen", mode: "edit", references: 4, qa: { score: 8, pass: true, reasons: [] } }),
      ],
    },
  ]);
  assert.match(html, /<span class="side">C<\/span>/);
  assert.match(html, /high \+ Referenzen · gpt-image-2 · 1536x720 · 4 Referenzfotos/);
  assert.match(html, /KI-Prüfung 8\/10 ✓/);
  assert.match(html, /\.card \{ flex: 0 0 auto; width: 640px;/, "cards keep the hero's true width");
  assert.match(html, /1 Prompts × 3 Varianten \(medium \/ high \/ high \+ Referenzen\)/);
});

test("money formatting", () => {
  assert.equal(fmtUsd(0.1234), "0.123 $");
  assert.equal(fmtEur(0.1234), "0,12 €");
});
