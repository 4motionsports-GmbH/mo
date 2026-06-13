// Renders the consultation summary email to an HTML file so the new layout can
// be eyeballed in a browser WITHOUT a DB, the AI summarizer, or Shopify.
//
//   npx tsx scripts/preview-summary-email.mjs
//
// (tsx is used rather than bare `node` because the production module graph uses
// extensionless TypeScript imports, which Node's strip-types loader won't
// resolve on its own.)
//
// It feeds a few REAL catalog products through the exact production assembly
// (buildSummaryEmailContent) and writes preview-summary-email.html to the repo
// root.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSummaryEmailContent } from "../src/lib/summary-email.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const catalog = JSON.parse(
  await readFile(path.join(ROOT, "src/data/product-catalog.json"), "utf8")
);

// Pick a couple of products WITH images for a representative render.
const withImages = catalog.filter(
  (p) => Array.isArray(p.images) && p.images.some((u) => typeof u === "string" && u.startsWith("https://"))
);
const chosenProducts = withImages.slice(0, 2);
const alternatives = withImages.slice(2, 5);

const { html, text } = buildSummaryEmailContent({
  summary:
    "Du suchst eine kompakte Ausstattung für dein Heimstudio mit Fokus auf " +
    "Krafttraining auf begrenzter Fläche. Wir haben passende Hantelscheiben " +
    "und ergänzendes Zubehör besprochen, die leise und platzsparend sind.",
  chosenProducts,
  alternatives,
  cartUrl: "https://motionsports.de/cart/40123456789:1,40123456790:1",
});

const outHtml = path.join(ROOT, "preview-summary-email.html");
const outText = path.join(ROOT, "preview-summary-email.txt");
await writeFile(outHtml, html, "utf8");
await writeFile(outText, text, "utf8");

console.log("Wrote:");
console.log("  " + outHtml);
console.log("  " + outText);
console.log("\nChosen products:", chosenProducts.map((p) => p.name).join(", "));
console.log("Alternatives:", alternatives.map((p) => p.name).join(", "));
