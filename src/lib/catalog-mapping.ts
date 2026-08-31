// Map a Shopify Admin GraphQL product into the chatbot's Product type.
//
// Mirrors the filter + mapping rules in scripts/convert-catalog.mjs so the
// runtime catalog stays consistent regardless of whether it came from the
// committed CSV-derived JSON or from a live Shopify sync.

import type { Product, ProductVariant } from "./types";
import { getMetafield, type ShopifyProduct, type ShopifyProductVariant } from "./shopify";
import { richTextToPlainText } from "./shopify-richtext.mjs";
import { buildShopifyCartUrl, parseNumericVariantId } from "./shopify-cart-url.mjs";
import { QA_METAFIELD_KEY, QA_METAFIELD_NAMESPACE, parseQaMetafield } from "./qa-core.mjs";
import { parseKurztextSpecs, extractKurztextDimensions } from "./kurztext.mjs";
// The embedded-doc builder lives in its own module (one source of truth shared
// with the cron sync and scripts/build-embeddings.mjs). Re-exported here so the
// long-standing `import { buildEmbeddingDoc } from "@/lib/catalog-mapping"`
// callers keep working unchanged.
export { buildEmbeddingDoc, EMBEDDING_DOC_VERSION, embeddingDocHash } from "./embedding-doc.mjs";

const SHOP_DOMAIN = "https://motionsports.de";

function stripHtml(html: string): string {
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

function extractFeatures(html: string): string[] {
  if (!html) return [];
  const features: string[] = [];
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = liRe.exec(html)) !== null) {
    const text = stripHtml(m[1]);
    if (text && text.length > 3 && text.length < 250) features.push(text);
  }
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const f of features) {
    if (!seen.has(f)) {
      seen.add(f);
      unique.push(f);
    }
    if (unique.length >= 12) break;
  }
  return unique;
}

function extractSpecsFromTable(html: string): Record<string, string> {
  const specs: Record<string, string> = {};
  if (!html) return specs;
  const tableRe = /<table[\s\S]*?<\/table>/gi;
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let tm: RegExpExecArray | null;
  while ((tm = tableRe.exec(html)) !== null) {
    const table = tm[0];
    let trm: RegExpExecArray | null;
    while ((trm = trRe.exec(table)) !== null) {
      const tdMatches: string[] = [];
      let tdm: RegExpExecArray | null;
      const tdReLocal = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
      while ((tdm = tdReLocal.exec(trm[1])) !== null) {
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

function parseNumber(s: string | null | undefined): number | null {
  if (s == null) return null;
  const cleaned = String(s).replace(/\s/g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function trimToWords(s: string, max: number): string {
  if (!s) return "";
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim() + "…";
}

function deriveCategory(fullName: string | null | undefined, productType: string): string {
  const t = (productType || "").trim();
  if (fullName) {
    const segs = fullName.split(">").map((s) => s.trim()).filter(Boolean);
    if (segs.length) {
      const last = segs[segs.length - 1];
      if (last && !/^Sporting Goods$/i.test(last)) return last;
    }
  }
  return t || "Sonstiges";
}

// German display labels for the Shopify standard-taxonomy ("category")
// metafields, mirroring the labels the admin shows (taken from the product
// CSV export's column headers). Any `shopify.*` metafield the sync returns
// lands in `specifications` — known keys get their proper German label,
// unknown/new taxonomy keys fall back to a humanized key so new categories
// keep working without a code change.
const TAXONOMY_SPEC_LABELS: Record<string, string> = {
  "accessory-size": "Zubehörgröße",
  "age-group": "Altersgruppe",
  "animal-type": "Tierart",
  "ball-material": "Kugelmaterial",
  "bar-mounting-type": "Stangenmontagetyp",
  "collar-lock-type": "Ringschlosstyp",
  "color-pattern": "Farbe",
  "compatible-bench-positions": "Kompatible Bankpositionen",
  "compatible-exercises": "Kompatible Übungen",
  "compatible-weight-lifting-accessory": "Kompatibles Gewichthebezubehör",
  "detailed-ingredients": "Detaillierte Inhaltsstoffe",
  "dietary-preferences": "Ernährungsgewohnheiten",
  "exercise-equipment-included": "Trainingsgeräte inklusive",
  "exercise-equipment-material": "Trainingsgeräte-Material",
  "exercise-machine-features": "Eigenschaften des Trainingsgeräts",
  "exercise-mat-material": "Material der Trainingsmatte",
  fabric: "Stoff",
  "fastener-finish": "Oberflächenbehandlung des Befestigungselements",
  flavor: "Geschmack",
  "handwear-material": "Handschuhmaterial",
  "hardware-material": "Hardwarematerial",
  "ingredient-category": "Bestandteilkategorie",
  "j-cup-type": "J-Cup-Typ",
  "jump-rope-design": "Springseil-Design",
  "leash-design": "Leinendesign",
  "massage-technique": "Massagetechnik",
  material: "Material",
  "material-hardness": "Materialhärte",
  "power-source": "Energiequelle",
  "pull-up-bar": "Klimmzugstange",
  "resistance-level": "Widerstandsgrad",
  "resistance-system": "Widerstandssystem",
  "target-gender": "Zielgeschlecht",
  "weight-bar-activity": "Hantelstangenaktivität",
  "weight-bar-type": "Hantelstangentyp",
};

function taxonomySpecLabel(key: string): string {
  return (
    TAXONOMY_SPEC_LABELS[key] ??
    key
      .split("-")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

function isTruthyFlag(s: string | null | undefined): boolean {
  if (s == null) return false;
  const v = String(s).trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "ja";
}

// Handles resolved from a product-reference metafield come back ", "-joined
// (see shopify.ts resolveMetafieldNode); handles never contain commas.
function splitHandleList(s: string | null): string[] {
  if (!s) return [];
  return s
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
}

// reviews.rating is a JSON payload like {"scale_min":"1.0","scale_max":"5.0",
// "value":"4.7"} (Shopify review-app convention); tolerate a bare number too.
function parseRating(s: string | null): number | null {
  if (!s) return null;
  const direct = parseNumber(s);
  if (direct != null) return direct;
  try {
    const obj = JSON.parse(s) as { value?: unknown };
    const v = parseNumber(typeof obj?.value === "string" ? obj.value : String(obj?.value ?? ""));
    return v;
  } catch {
    return null;
  }
}

function deliveryTimeLabel(minDays: number | null): string {
  if (minDays == null) return "Nach Verfügbarkeit";
  if (minDays <= 1) return "1-3 Werktage";
  if (minDays <= 3) return "3-5 Werktage";
  if (minDays <= 5) return "5-7 Werktage";
  if (minDays <= 10) return "7-14 Werktage";
  return `${minDays}+ Werktage`;
}

export interface MapStats {
  notPublished: number;
  noPrice: number;
  noImage: number;
  notActive: number;
  kept: number;
}

// Shopify's placeholder for the sole variant of an option-less product.
const DEFAULT_VARIANT_TITLE = "Default Title";

/**
 * Map ONE Shopify variant to the catalog's ProductVariant. Pricing mirrors the
 * flat-field rule: compareAtPrice > price means "on sale" (compare = regular,
 * price = sale). The placeholder "Default Title" becomes an empty title so
 * single-variant products don't render a meaningless label.
 */
function mapVariant(v: ShopifyProductVariant, isDefault: boolean): ProductVariant | null {
  const variantPrice = parseNumber(v.price);
  if (!variantPrice || variantPrice <= 0) return null;
  const comparePrice = parseNumber(v.compareAtPrice);
  let price = variantPrice;
  let salePrice: number | undefined;
  if (comparePrice && comparePrice > variantPrice) {
    price = comparePrice;
    salePrice = variantPrice;
  }
  const rawTitle = (v.title || "").trim();
  const title = rawTitle === DEFAULT_VARIANT_TITLE ? "" : rawTitle;
  const options = (v.selectedOptions ?? [])
    .filter((o) => o && o.name && o.name !== "Title" && o.value && o.value !== DEFAULT_VARIANT_TITLE)
    .map((o) => ({ name: o.name.trim(), value: o.value.trim() }));
  const numericId = parseNumericVariantId(v.id);
  const cartUrl = buildShopifyCartUrl(v.id) ?? undefined;
  const sku = (v.sku || "").trim();
  const barcode = (v.barcode || "").trim();
  return {
    id: numericId,
    title,
    options,
    ...(sku ? { sku } : {}),
    ...(barcode ? { barcode } : {}),
    price: Math.round(price * 100) / 100,
    ...(salePrice != null ? { salePrice: Math.round(salePrice * 100) / 100 } : {}),
    // availableForSale already factors in the inventory policy; treat missing
    // data permissively (mirrors the product-level inStock fallback).
    available: v.availableForSale !== false,
    ...(typeof v.inventoryQuantity === "number" ? { inventoryQuantity: v.inventoryQuantity } : {}),
    ...(cartUrl ? { cartUrl } : {}),
    isDefault,
  };
}

/**
 * Apply the Path A filters and map to the runtime Product type.
 * Filter rules mirror scripts/convert-catalog.mjs:
 *   - Published=TRUE  (publishedAt non-null)
 *   - Variant Price > 0
 *   - Has at least one image
 *   - Status=active
 */
export function mapShopifyProducts(
  source: ShopifyProduct[]
): { products: Product[]; stats: MapStats } {
  const stats: MapStats = {
    notPublished: 0,
    noPrice: 0,
    noImage: 0,
    notActive: 0,
    kept: 0,
  };
  const products: Product[] = [];

  for (const p of source) {
    if (p.status !== "ACTIVE") {
      stats.notActive++;
      continue;
    }
    if (!p.publishedAt) {
      stats.notPublished++;
      continue;
    }
    const variant = p.variants[0];
    const variantPrice = variant ? parseNumber(variant.price) : null;
    if (!variantPrice || variantPrice <= 0) {
      stats.noPrice++;
      continue;
    }
    const imageUrls = (
      p.images.length ? p.images : p.featuredImage ? [p.featuredImage] : []
    )
      .map((i) => i.url)
      .filter((u): u is string => !!u);
    const uniqueImages = Array.from(new Set(imageUrls));
    if (uniqueImages.length === 0) {
      stats.noImage++;
      continue;
    }

    const comparePrice = parseNumber(variant?.compareAtPrice);
    let price = variantPrice;
    let salePrice: number | undefined;
    if (comparePrice && comparePrice > variantPrice) {
      price = comparePrice;
      salePrice = variantPrice;
    }

    const bodyHtml = p.descriptionHtml || "";
    let detailedDescription = stripHtml(bodyHtml);
    const features = extractFeatures(bodyHtml);
    const specs: Record<string, string | number> = { ...extractSpecsFromTable(bodyHtml) };

    // custom.kurztext is the merchant's condensed spec sheet AND the source of
    // the storefront PDP's "Technische Daten" details tab — the spec values the
    // customer actually sees (dimensions there are in mm, e.g. "Höhe: 2300").
    // Parse it into structured spec entries so every value on the details tab
    // reaches Mo and the embeddings, no matter how long the description is.
    // Kurztext values overwrite body-table rows on key collision: the details
    // tab is the authoritative sheet.
    const kurztext = getMetafield(p, "custom", "kurztext");
    const kurztextPairs = parseKurztextSpecs(kurztext);
    for (const [k, v] of kurztextPairs) specs[k] = v;

    // Every Shopify standard-taxonomy ("category") metafield becomes a spec —
    // Farbe, Material, Klimmzugstange, Widerstandssystem, … — labelled like
    // the admin shows them.
    for (const mf of p.metafields) {
      if (mf.namespace !== "shopify") continue;
      if (!mf.value || mf.value === "—") continue;
      specs[taxonomySpecLabel(mf.key)] = mf.value;
    }

    const certification = getMetafield(p, "custom", "zertifizierung");
    if (certification) specs["Zertifizierung"] = certification;
    const serieMeta = getMetafield(p, "custom", "serie");
    if (serieMeta) specs["Serie"] = serieMeta;

    // Logistics facts the merchant maintains as custom metafields — relevant
    // consultation signals (Speditionslieferung, Vorlauf, Verkaufseinheit).
    const versandtyp = getMetafield(p, "custom", "versandtyp");
    if (versandtyp) specs["Versandart"] = versandtyp;
    if (isTruthyFlag(getMetafield(p, "custom", "sperrgut"))) {
      specs["Sperrgut"] = "Ja";
    }
    const vorlaufzeit = getMetafield(p, "custom", "vorlaufzeit");
    if (vorlaufzeit) specs["Vorlaufzeit"] = vorlaufzeit;
    const liefereinheit = getMetafield(p, "custom", "liefereinheit");
    if (liefereinheit) specs["Liefereinheit"] = liefereinheit;

    // Any remaining custom.* metafield the merchant adds in the admin becomes
    // a spec automatically (humanized label), so new fields reach Mo without a
    // code change. Keys that feed dedicated Product fields above/below are
    // excluded — they'd only duplicate or leak internals.
    const HANDLED_CUSTOM_KEYS = new Set([
      "kurzinfo",
      "kurztext",
      "hoehe",
      "laenge",
      "gewicht",
      "lieferzeit_min",
      "zertifizierung",
      "serie",
      "versandtyp",
      "sperrgut",
      "vorlaufzeit",
      "liefereinheit",
      "hide_from_search",
      QA_METAFIELD_KEY,
    ]);
    for (const mf of p.metafields) {
      if (mf.namespace !== "custom" || HANDLED_CUSTOM_KEYS.has(mf.key)) continue;
      if (!mf.value || mf.value === "—" || mf.value.length > 300) continue;
      const label = mf.key
        .split(/[_-]/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      if (!(label in specs)) specs[label] = mf.value;
    }

    // The kurztext also travels verbatim on the description (prose context for
    // Mo and the embeddings even when the HTML body is thin).
    if (kurztext && !detailedDescription.includes(kurztext)) {
      detailedDescription = detailedDescription
        ? `${detailedDescription}\n\nTechnische Daten: ${kurztext}`
        : `Technische Daten: ${kurztext}`;
    }

    // Dimensions: the kurztext (= PDP details tab, mm) is authoritative;
    // the legacy custom.hoehe/laenge/gewicht metafields (cm/kg) are the
    // fallback — they are not always kept in sync with the details tab.
    const ktDims = extractKurztextDimensions(kurztextPairs);
    const widthCm = ktDims.widthCm;
    const heightCm = ktDims.heightCm ?? parseNumber(getMetafield(p, "custom", "hoehe"));
    const lengthCm = ktDims.depthCm ?? parseNumber(getMetafield(p, "custom", "laenge"));
    const weightKgMeta = parseNumber(getMetafield(p, "custom", "gewicht"));
    const weightKg = ktDims.weightKg ?? weightKgMeta ?? 0;
    const dimensions = {
      width: widthCm ?? 0,
      height: heightCm ?? 0,
      depth: lengthCm ?? 0,
      weight: weightKg,
    };
    // Floor space: width × depth when both are known (the physically correct
    // footprint, now possible since the kurztext carries Breite). The legacy
    // height × length estimate stays as fallback for older data shapes.
    const footprintM2 =
      widthCm && lengthCm
        ? Math.round(((widthCm * lengthCm) / 10000) * 10) / 10
        : heightCm && lengthCm && !ktDims.heightCm
          ? Math.round(((heightCm * lengthCm) / 10000) * 10) / 10
          : undefined;

    const tags = Array.isArray(p.tags) ? p.tags : [];
    // Short description preference: the merchant-curated Kurzinfo metafield,
    // then the SEO description (mirrors convert-catalog.mjs), then a trim of
    // the long description.
    const kurzinfo = getMetafield(p, "custom", "kurzinfo");
    const seoDescription = (p.seo?.description || "").trim();
    // The kurzinfo metafield is a Shopify RICH-TEXT field: its raw value is a
    // JSON document, not text (shopify-richtext.mjs). Convert before it becomes
    // the product's short description — otherwise the JSON ships into emails,
    // Mo's prompt, the embeddings and /api/products.
    const shortDescription =
      richTextToPlainText((kurzinfo || "").trim()).trim() ||
      seoDescription ||
      trimToWords(detailedDescription, 240);
    const category = deriveCategory(p.category?.fullName, p.productType);
    const brand = (p.vendor || "").trim() || "Motion Sports";
    const deliveryMinDays = parseNumber(getMetafield(p, "custom", "lieferzeit_min"));
    const deliveryTime = deliveryTimeLabel(deliveryMinDays);
    const series = serieMeta || undefined;

    // Stock status (sync-fresh; refreshed by the daily catalog cron, not a live
    // check — see docs/CATALOG_SYNC.md). Prefer Shopify's per-variant
    // `availableForSale`, which already factors in the inventory policy (a
    // "continue selling when out of stock" variant stays available). A product
    // counts as in stock when ANY of its variants can be sold. We fall back
    // through totalInventory → first-variant inventoryQuantity → permissive
    // default so older payloads and the committed fallback bundle (which carry
    // no availability data) keep their previous behaviour and never falsely show
    // as sold out.
    const variantsWithAvail = p.variants.filter(
      (v) => typeof v.availableForSale === "boolean"
    );
    const anyVariantAvailable =
      variantsWithAvail.length > 0
        ? variantsWithAvail.some((v) => v.availableForSale === true)
        : undefined;
    const totalInventory =
      typeof p.totalInventory === "number" ? p.totalInventory : undefined;
    const inStock =
      anyVariantAvailable != null
        ? anyVariantAvailable
        : totalInventory != null
          ? totalInventory > 0
          : variant?.inventoryQuantity == null
            ? true
            : variant.inventoryQuantity > 0;

    // Resolve the *numeric* Shopify variant id (Admin/Storefront GraphQL
    // returns a GID like "gid://shopify/ProductVariant/40123456789"). The cart
    // permalink must use this numeric id — a SKU 404s with "Cannot find
    // variant". When it can't be resolved we omit shopifyCartUrl so the widget
    // degrades gracefully rather than linking to a broken cart.
    const shopifyVariantId = parseNumericVariantId(variant?.id) ?? undefined;
    const shopifyCartUrl = buildShopifyCartUrl(variant?.id) ?? undefined;

    // Review signals (the shop's review app writes reviews.rating /
    // reviews.rating_count) + the Search & Discovery recommendations that
    // power the PDP's "Ergänzende/Zugehörige Produkte" (accessory) sections.
    const rating = parseRating(getMetafield(p, "reviews", "rating"));
    const ratingCount = parseNumber(getMetafield(p, "reviews", "rating_count"));
    const compatibleWith = splitHandleList(
      getMetafield(p, "shopify--discovery--product_recommendation", "complementary_products")
    );
    const relatedProducts = splitHandleList(
      getMetafield(p, "shopify--discovery--product_recommendation", "related_products")
    );
    const hideFromSearch = isTruthyFlag(getMetafield(p, "custom", "hide_from_search"));
    // Published Q&A pairs (the "Wissen" feature) — the metafield carries the
    // canonical {q,a} JSON list; parse defensively (junk → []).
    const qa = parseQaMetafield(getMetafield(p, QA_METAFIELD_NAMESPACE, QA_METAFIELD_KEY));
    const sku = (variant?.sku || "").trim();
    const barcode = (variant?.barcode || "").trim();

    // All sellable variants (position 1 = default — the flat-field projection
    // above). Unpriceable variants are dropped; the product itself already
    // passed the "default variant has a price" filter, so length >= 1.
    const variants = p.variants
      .map((v, i) => mapVariant(v, i === 0))
      .filter((v): v is ProductVariant => v !== null);
    const variantPrices = variants
      .map((v) =>
        typeof v.salePrice === "number" && v.salePrice > 0 ? v.salePrice : v.price
      )
      .filter((n) => n > 0);
    const priceMin = variantPrices.length ? Math.min(...variantPrices) : undefined;
    const priceMax = variantPrices.length ? Math.max(...variantPrices) : undefined;

    const product: Product = {
      id: p.handle,
      name: (p.title || "").trim(),
      slug: p.handle,
      category,
      brand,
      price: Math.round(price * 100) / 100,
      ...(salePrice != null ? { salePrice: Math.round(salePrice * 100) / 100 } : {}),
      currency: "EUR",
      shortDescription,
      detailedDescription,
      specifications: specs,
      features,
      dimensions,
      targetGroup: [],
      ...(compatibleWith.length ? { compatibleWith } : {}),
      ...(relatedProducts.length ? { relatedProducts } : {}),
      shopifyUrl: p.onlineStoreUrl || `${SHOP_DOMAIN}/products/${p.handle}`,
      ...(shopifyVariantId ? { shopifyVariantId } : {}),
      ...(shopifyCartUrl ? { shopifyCartUrl } : {}),
      images: uniqueImages,
      inStock,
      ...(totalInventory != null ? { inventoryQuantity: totalInventory } : {}),
      ...(anyVariantAvailable != null ? { anyVariantAvailable } : {}),
      deliveryTime,
      ...(series ? { series } : {}),
      tags,
      ...(sku ? { sku } : {}),
      ...(barcode ? { barcode } : {}),
      ...(rating != null ? { rating: Math.round(rating * 10) / 10 } : {}),
      ...(ratingCount != null && ratingCount > 0
        ? { ratingCount: Math.round(ratingCount) }
        : {}),
      ...(hideFromSearch ? { hideFromSearch: true } : {}),
      ...(qa.length ? { qa } : {}),
      medicalCertification: {
        ceClass: "unknown",
        suitableForRehab: "unknown",
      },
      noiseLevelDb: "unknown",
      ...(footprintM2 != null ? { footprintM2 } : {}),
      ...(variants.length ? { variants } : {}),
      ...(priceMin != null ? { priceMin } : {}),
      ...(priceMax != null ? { priceMax } : {}),
    };
    products.push(product);
    stats.kept++;
  }

  products.sort((a, b) => a.name.localeCompare(b.name, "de"));
  return { products, stats };
}

// buildEmbeddingDoc is re-exported from ./embedding-doc.mjs (see the top of this
// file) — the embedded-text composition is documented in docs/CATALOG_SYNC.md.
