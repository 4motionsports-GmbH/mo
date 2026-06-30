import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAnalyticsReportPdf, mdToBlocks, stripInline } from "./analytics-report-pdf.mjs";

function sampleSections() {
  return {
    notes: ["Nur die ersten 2000 Gespräche analysiert."],
    kpis: {
      conversations: 42,
      analyzed: 40,
      tiers: { anonymous: 30, emailOnly: 8, signedIn: 4 },
      withError: 1,
      emailCaptured: 9,
      cartUsed: 5,
      checkoutOffered: 12,
    },
    spend: { totalEur: 1.2345, byCallSite: [{ callSite: "chat", eur: 0.9 }] },
    categories: [
      { label: "Produktberatung", count: 20 },
      { label: "Größe & Maße", count: 12 },
    ],
    qualities: [
      { label: "Gut gelöst", count: 25 },
      { label: "Offener Bedarf", count: 7 },
    ],
    insightsMd: "## Top-Themen\n\n- Laufbänder fürs Wohnzimmer\n- **Leise** Geräte\n\nMehr Beratung nötig.",
    personas: [
      {
        personaDisplay: "Pragmatischer Einsteiger",
        chatCount: 18,
        favoriteProducts: [
          { name: "ATX Treadmill Pro", count: 6 },
          { name: "Kettlebell 16kg", count: 3 },
        ],
        topQuestionsMd: "- Wie laut ist das Laufband?\n- Passt es in 10 m²?",
      },
    ],
    customerKnowledgeMd: "### Aggregiert\n\nKunden suchen vor allem leise Geräte fürs Zuhause.",
    profiles: [
      {
        name: "Max Mustermann",
        sessionCount: 3,
        lastSeenAt: "2026-06-20T10:00:00.000Z",
        profileSummary: "Sucht ein Power Rack, Budget ~1500€, fortgeschritten.",
      },
    ],
    appendix: [
      {
        conversationKey: "abc123",
        createdAt: "2026-06-18T09:00:00.000Z",
        tier: "emailOnly",
        personaDisplay: "Kraftsportler",
        category: "Produktberatung",
        quality: "Gut gelöst",
        summary: "Kunde wollte ein Rack, wurde gut beraten und legte es in den Warenkorb.",
      },
    ],
  };
}

test("buildAnalyticsReportPdf: valid PDF containing every section", () => {
  const pdf = buildAnalyticsReportPdf({
    title: "Komplettanalyse · Juni 2026",
    label: "01.06.2026 – 30.06.2026",
    from: "2026-06-01",
    to: "2026-06-30",
    generatedAt: "2026-06-30T12:00:00.000Z",
    costEur: 1.2345,
    sections: sampleSections(),
  });

  assert.ok(Buffer.isBuffer(pdf));
  const text = pdf.toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4"), "has a PDF header");
  assert.ok(text.includes("/BaseFont /Helvetica"), "embeds the font");
  assert.ok(text.trimEnd().endsWith("%%EOF"), "ends with EOF");

  // Section headings + key content render.
  assert.ok(text.includes("Komplettanalyse"), "title");
  assert.ok(text.includes("Kennzahlen"), "kpi section");
  assert.ok(text.includes("Verteilung der Gespr"), "distribution section");
  assert.ok(text.includes("Produktberatung"), "category label");
  assert.ok(text.includes("Aggregierte Insights"), "insights section");
  assert.ok(text.includes("Personas"), "personas section");
  assert.ok(text.includes("Pragmatischer Einsteiger"), "persona label");
  assert.ok(text.includes("ATX Treadmill Pro"), "favourite product");
  assert.ok(text.includes("Kundenwissen"), "customer knowledge section");
  assert.ok(text.includes("Max Mustermann"), "per-customer profile name");
  assert.ok(text.includes("Anhang"), "appendix section");
  // Markdown markers are flattened, not printed raw.
  assert.ok(!text.includes("**Leise**"), "bold markers stripped");
});

test("buildAnalyticsReportPdf: degrades gracefully with an empty report", () => {
  const pdf = buildAnalyticsReportPdf({
    title: "Leer",
    from: "2026-06-01",
    to: "2026-06-01",
    sections: { kpis: {}, categories: [], qualities: [], personas: [], profiles: [], appendix: [] },
  });
  const text = pdf.toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.ok(text.includes("Keine Insights verf"), "insights fallback");
  assert.ok(text.trimEnd().endsWith("%%EOF"));
});

test("buildAnalyticsReportPdf: a large appendix paginates", () => {
  const sections = sampleSections();
  sections.appendix = Array.from({ length: 120 }, (_, i) => ({
    conversationKey: `k${i}`,
    createdAt: "2026-06-18T09:00:00.000Z",
    tier: "anonymous",
    personaDisplay: "Cardio / Gesundheit",
    category: "Produktberatung",
    quality: "Zufrieden",
    summary: `Gespräch ${i}: ausführliche Beratung über mehrere Sätze hinweg, damit der Text umbricht und paginiert.`,
  }));
  const pdf = buildAnalyticsReportPdf({ title: "x", from: "2026-06-01", to: "2026-06-30", sections });
  const text = pdf.toString("latin1");
  const m = text.match(/\/Count (\d+)/);
  assert.ok(m && Number(m[1]) > 1, "paginated onto more than one page");
});

test("stripInline flattens emphasis, code and links", () => {
  assert.equal(stripInline("**bold** and `code`"), "bold and code");
  assert.equal(stripInline("see [docs](https://x.io)"), "see docs (https://x.io)");
  assert.equal(stripInline("an *italic* word"), "an italic word");
});

test("mdToBlocks classifies headings, bullets and paragraphs", () => {
  const blocks = mdToBlocks("# H1\n\n- one\n- two\n\nplain paragraph line");
  assert.equal(blocks[0].type, "heading");
  assert.equal(blocks[0].level, 1);
  assert.equal(blocks[1].type, "bullet");
  assert.equal(blocks[2].type, "bullet");
  assert.equal(blocks[3].type, "para");
  assert.equal(blocks[3].text, "plain paragraph line");
});
