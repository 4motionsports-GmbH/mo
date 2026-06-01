#!/usr/bin/env node
// Convert a Shopify product CSV export into the chatbot's product-catalog.json.
//
// Run: node scripts/convert-catalog.mjs
//   or: INPUT=src/data/other.csv OUTPUT=src/data/product-catalog.json node scripts/convert-catalog.mjs
//
// Designed to be re-run whenever the Shopify export changes. Idempotent —
// overwrites the output file. After running, re-run `npm run index` to refresh
// embeddings.
//
// Filter rules (Path A — recommendable subset):
//   - Published=TRUE
//   - Variant Price > 0
//   - Has at least one image
//   - Status=active
//   - Not a Gift Card
//
// Output: products that pass the filter, mapped to the Product schema in
// src/lib/types.ts. Persona-relevant fields without CSV equivalents
// (medicalCertification, noiseLevelDb) default to "unknown" and can be
// hand-curated later for top products.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const INPUT = process.env.INPUT
  ? path.resolve(process.env.INPUT)
  : path.join(ROOT, "src/data/products_export_1.csv");
const OUTPUT = process.env.OUTPUT
  ? path.resolve(process.env.OUTPUT)
  : path.join(ROOT, "src/data/product-catalog.json");

const SHOP_DOMAIN = "https://motionsports.de";

// ---------- CSV parsing ----------

// RFC 4180-compliant CSV parser. Handles quoted fields, embedded commas,
// embedded newlines, and "" escapes. Returns array of arrays of strings.
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (c === '"') {
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
    } else {
      if (c === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (c === ",") {
        row.push(field);
        field = "";
        i++;
        continue;
      }
      if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        i++;
        continue;
      }
      if (c === "\r") {
        i++;
        continue;
      }
      field += c;
      i++;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ---------- Helpers ----------

function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&ouml;/g, "ö")
    .replace(/&auml;/g, "ä")
    .replace(/&uuml;/g, "ü")
    .replace(/&Ouml;/g, "Ö")
    .replace(/&Auml;/g, "Ä")
    .replace(/&Uuml;/g, "Ü")
    .replace(/&szlig;/g, "ß")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Extract bullet points from <ul><li>...</li></ul> as feature list.
function extractFeatures(html) {
  if (!html) return [];
  const features = [];
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = liRe.exec(html)) !== null) {
    const text = stripHtml(m[1]);
    if (text && text.length > 3 && text.length < 250) {
      features.push(text);
    }
  }
  // De-dupe while keeping order, cap at 12
  const seen = new Set();
  const unique = [];
  for (const f of features) {
    if (!seen.has(f)) {
      seen.add(f);
      unique.push(f);
    }
    if (unique.length >= 12) break;
  }
  return unique;
}

// Extract spec table from <table>…</table>: rows with two cells become key→value.
function extractSpecsFromTable(html) {
  const specs = {};
  if (!html) return specs;
  const tableRe = /<table[\s\S]*?<\/table>/gi;
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const tdRe = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
  let tm;
  while ((tm = tableRe.exec(html)) !== null) {
    const table = tm[0];
    let trm;
    while ((trm = trRe.exec(table)) !== null) {
      const tdMatches = [];
      let tdm;
      const trContent = trm[1];
      const tdReLocal = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
      while ((tdm = tdReLocal.exec(trContent)) !== null) {
        tdMatches.push(stripHtml(tdm[1]));
      }
      if (tdMatches.length >= 2) {
        const k = tdMatches[0].replace(/[:：]\s*$/, "").trim();
        const v = tdMatches.slice(1).join(" / ").trim();
        if (k && v && k.length < 80 && v.length < 200) specs[k] = v;
      }
    }
  }
  return specs;
}

function parseNumber(s) {
  if (s == null) return null;
  const cleaned = String(s).replace(/\s/g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function isTruthy(s) {
  if (s == null) return false;
  const v = String(s).trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

function trimToWords(s, max) {
  if (!s) return "";
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim() + "…";
}

function deriveCategory(productCategoryFull, type) {
  // "Sporting Goods > Fitness & General Exercise Equipment > … > Kettlebells"
  // Pick the last meaningful segment, falling back to Type column.
  const t = (type || "").trim();
  if (productCategoryFull) {
    const segments = productCategoryFull
      .split(">")
      .map((s) => s.trim())
      .filter(Boolean);
    if (segments.length > 0) {
      const last = segments[segments.length - 1];
      // Avoid "Sporting Goods" generic root
      if (last && !/^Sporting Goods$/i.test(last)) return last;
    }
  }
  return t || "Sonstiges";
}

function deliveryTimeLabel(minDays) {
  if (minDays == null) return "Nach Verfügbarkeit";
  if (minDays <= 1) return "1-3 Werktage";
  if (minDays <= 3) return "3-5 Werktage";
  if (minDays <= 5) return "5-7 Werktage";
  if (minDays <= 10) return "7-14 Werktage";
  return `${minDays}+ Werktage`;
}

// ---------- Main ----------

async function main() {
  console.log(`[convert-catalog] reading ${path.relative(ROOT, INPUT)}`);
  const text = await fs.readFile(INPUT, "utf8");
  const rows = parseCSV(text);
  if (rows.length < 2) {
    throw new Error("CSV appears empty");
  }

  const header = rows[0];
  const idx = (name) => {
    const i = header.indexOf(name);
    if (i < 0) return -1;
    return i;
  };
  const get = (row, name) => {
    const i = idx(name);
    return i < 0 ? "" : row[i] ?? "";
  };

  // Build column-name lookups ahead of time for hot-path columns
  const COLS = {
    handle: idx("Handle"),
    title: idx("Title"),
    body: idx("Body (HTML)"),
    vendor: idx("Vendor"),
    productCategory: idx("Product Category"),
    type: idx("Type"),
    tags: idx("Tags"),
    published: idx("Published"),
    sku: idx("Variant SKU"),
    grams: idx("Variant Grams"),
    price: idx("Variant Price"),
    comparePrice: idx("Variant Compare At Price"),
    image: idx("Image Src"),
    imagePos: idx("Image Position"),
    seoDescription: idx("SEO Description"),
    giftCard: idx("Gift Card"),
    status: idx("Status"),
  };

  // Find metafield columns by suffix match (column names contain the path)
  const metaCol = (suffix) =>
    header.findIndex((h) => h && h.toLowerCase().includes(suffix.toLowerCase()));
  const META = {
    height: metaCol("metafields.custom.hoehe"),
    length: metaCol("metafields.custom.laenge"),
    weight: metaCol("metafields.custom.gewicht"),
    deliveryMin: metaCol("metafields.custom.lieferzeit_min"),
    serie: metaCol("metafields.custom.serie"),
    typ: metaCol("metafields.custom.typ"),
    material: metaCol("metafields.shopify.material"),
    color: metaCol("metafields.shopify.color-pattern"),
    certification: metaCol("metafields.custom.zertifizierung"),
    complementary: metaCol("complementary_products"),
  };

  if (COLS.handle < 0 || COLS.title < 0 || COLS.price < 0) {
    throw new Error(
      "Required CSV columns missing (Handle / Title / Variant Price)"
    );
  }

  // Group rows by handle
  const groups = new Map();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const h = (row[COLS.handle] || "").trim();
    if (!h) continue;
    if (!groups.has(h)) groups.set(h, []);
    groups.get(h).push(row);
  }

  console.log(`[convert-catalog] ${groups.size} unique handles`);

  const products = [];
  const stats = {
    notPublished: 0,
    noPrice: 0,
    noImage: 0,
    giftCard: 0,
    notActive: 0,
    kept: 0,
  };

  for (const [handle, groupRows] of groups) {
    const first = groupRows[0];

    // Filters (Path A)
    if (!isTruthy(first[COLS.published])) {
      stats.notPublished++;
      continue;
    }
    if (
      COLS.giftCard >= 0 &&
      isTruthy(first[COLS.giftCard])
    ) {
      stats.giftCard++;
      continue;
    }
    if (
      COLS.status >= 0 &&
      first[COLS.status] &&
      first[COLS.status].toLowerCase() !== "active"
    ) {
      stats.notActive++;
      continue;
    }
    const variantPrice = parseNumber(first[COLS.price]);
    if (!variantPrice || variantPrice <= 0) {
      stats.noPrice++;
      continue;
    }

    // Images: collect all non-empty Image Src across rows for this handle,
    // ordered by Image Position. De-dupe.
    const imgEntries = [];
    for (const row of groupRows) {
      const src = (row[COLS.image] || "").trim();
      if (!src) continue;
      const pos = parseInt(row[COLS.imagePos] || "999", 10) || 999;
      imgEntries.push({ src, pos });
    }
    imgEntries.sort((a, b) => a.pos - b.pos);
    const seenImg = new Set();
    const images = [];
    for (const e of imgEntries) {
      if (seenImg.has(e.src)) continue;
      seenImg.add(e.src);
      images.push(e.src);
    }
    if (images.length === 0) {
      stats.noImage++;
      continue;
    }

    // Pricing: Shopify uses "Compare At Price" as the strikethrough/regular
    // price when on sale. If compare > price, treat compare as the regular
    // price and variantPrice as salePrice.
    const comparePrice = parseNumber(first[COLS.comparePrice]);
    let price = variantPrice;
    let salePrice;
    if (comparePrice && comparePrice > variantPrice) {
      price = comparePrice;
      salePrice = variantPrice;
    }

    const bodyHtml = first[COLS.body] || "";
    const detailedDescription = stripHtml(bodyHtml);
    const specsFromTable = extractSpecsFromTable(bodyHtml);
    const features = extractFeatures(bodyHtml);

    // Augment specs with metafield-derived facts
    const specs = { ...specsFromTable };
    if (META.material >= 0 && first[META.material]) {
      specs["Material"] = first[META.material];
    }
    if (META.color >= 0 && first[META.color]) {
      specs["Farbe"] = first[META.color];
    }
    if (META.certification >= 0 && first[META.certification]) {
      specs["Zertifizierung"] = first[META.certification];
    }
    if (META.serie >= 0 && first[META.serie]) {
      specs["Serie"] = first[META.serie];
    }

    // Dimensions: prefer metafields, fallback to Variant Grams for weight.
    const heightCm = META.height >= 0 ? parseNumber(first[META.height]) : null;
    const lengthCm = META.length >= 0 ? parseNumber(first[META.length]) : null;
    const weightKgMeta =
      META.weight >= 0 ? parseNumber(first[META.weight]) : null;
    const grams = parseNumber(first[COLS.grams]);
    const weightKg = weightKgMeta ?? (grams != null ? grams / 1000 : 0);
    const dimensions = {
      width: 0, // not in Shopify export
      height: heightCm ?? 0,
      depth: lengthCm ?? 0,
      weight: weightKg ?? 0,
    };

    // Footprint estimate: only when both height and length known (they're cm).
    let footprintM2;
    if (heightCm && lengthCm) {
      footprintM2 = Math.round(((heightCm * lengthCm) / 10000) * 10) / 10;
    }

    // Tags
    const tagStr = first[COLS.tags] || "";
    const tags = tagStr
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    // Compatible products
    let compatibleWith;
    if (META.complementary >= 0 && first[META.complementary]) {
      compatibleWith = first[META.complementary]
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter(Boolean);
    }

    // Description
    const seoDesc = (first[COLS.seoDescription] || "").trim();
    const shortDescription =
      seoDesc || trimToWords(detailedDescription, 240);

    // Series
    const series =
      META.serie >= 0 && first[META.serie] ? first[META.serie] : undefined;

    // Delivery time
    const deliveryMinDays =
      META.deliveryMin >= 0
        ? parseNumber(first[META.deliveryMin])
        : null;
    const deliveryTime = deliveryTimeLabel(deliveryMinDays);

    // Category
    const productCategoryFull = first[COLS.productCategory] || "";
    const typeRaw = first[COLS.type] || "";
    const category = deriveCategory(productCategoryFull, typeRaw);

    // Brand
    const brand = (first[COLS.vendor] || "").trim() || "Motion Sports";

    const product = {
      id: handle,
      name: (first[COLS.title] || "").trim(),
      slug: handle,
      category,
      brand,
      price: Math.round(price * 100) / 100,
      ...(salePrice != null
        ? { salePrice: Math.round(salePrice * 100) / 100 }
        : {}),
      currency: "EUR",
      shortDescription,
      detailedDescription,
      specifications: specs,
      features,
      dimensions,
      targetGroup: [], // not derivable cleanly from CSV; left empty
      ...(compatibleWith && compatibleWith.length
        ? { compatibleWith }
        : {}),
      shopifyUrl: `${SHOP_DOMAIN}/products/${handle}`,
      // The Shopify CSV export does not include the numeric variant id, and a
      // SKU-based cart URL 404s with "Cannot find variant". We therefore omit
      // shopifyCartUrl from the bundled fallback catalog so the widget degrades
      // gracefully; the live Shopify sync (src/lib/catalog-mapping.ts) populates
      // it from the variant's numeric id.
      images,
      inStock: true, // active+published; finer-grained stock not in export
      deliveryTime,
      ...(series ? { series } : {}),
      tags,
      // Persona-relevant fields default to "unknown" — hand-curate hot products later.
      medicalCertification: {
        ceClass: "unknown",
        suitableForRehab: "unknown",
      },
      noiseLevelDb: "unknown",
      ...(footprintM2 != null ? { footprintM2 } : {}),
    };

    products.push(product);
    stats.kept++;
  }

  // Sort by name for stable diffs across runs
  products.sort((a, b) => a.name.localeCompare(b.name, "de"));

  await fs.writeFile(OUTPUT, JSON.stringify(products, null, 2));

  const sizeKb = ((await fs.stat(OUTPUT)).size / 1024).toFixed(1);
  console.log(`[convert-catalog] wrote ${products.length} products → ${path.relative(ROOT, OUTPUT)} (${sizeKb} KB)`);
  console.log(`[convert-catalog] filter stats:`, stats);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
