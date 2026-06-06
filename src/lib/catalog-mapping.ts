// Map a Shopify Admin GraphQL product into the chatbot's Product type.
//
// Mirrors the filter + mapping rules in scripts/convert-catalog.mjs so the
// runtime catalog stays consistent regardless of whether it came from the
// committed CSV-derived JSON or from a live Shopify sync.

import type { Product } from "./types";
import { getMetafield, type ShopifyProduct } from "./shopify";
import { buildShopifyCartUrl, parseNumericVariantId } from "./shopify-cart-url.mjs";

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
    const detailedDescription = stripHtml(bodyHtml);
    const features = extractFeatures(bodyHtml);
    const specs: Record<string, string | number> = { ...extractSpecsFromTable(bodyHtml) };

    const material = getMetafield(p, "shopify", "material");
    if (material) specs["Material"] = material;
    const color = getMetafield(p, "shopify", "color-pattern");
    if (color) specs["Farbe"] = color;
    const certification = getMetafield(p, "custom", "zertifizierung");
    if (certification) specs["Zertifizierung"] = certification;
    const serieMeta = getMetafield(p, "custom", "serie");
    if (serieMeta) specs["Serie"] = serieMeta;

    const heightCm = parseNumber(getMetafield(p, "custom", "hoehe"));
    const lengthCm = parseNumber(getMetafield(p, "custom", "laenge"));
    const weightKgMeta = parseNumber(getMetafield(p, "custom", "gewicht"));
    const weightKg = weightKgMeta ?? 0;
    const dimensions = {
      width: 0,
      height: heightCm ?? 0,
      depth: lengthCm ?? 0,
      weight: weightKg,
    };
    const footprintM2 =
      heightCm && lengthCm
        ? Math.round(((heightCm * lengthCm) / 10000) * 10) / 10
        : undefined;

    const tags = Array.isArray(p.tags) ? p.tags : [];
    const shortDescription = trimToWords(detailedDescription, 240);
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

  products.sort((a, b) => a.name.localeCompare(b.name, "de"));
  return { products, stats };
}

// Compact representation embedded by the embeddings model. Must match the doc
// shape used in scripts/build-embeddings.mjs so vector quality stays comparable.
export function buildEmbeddingDoc(p: Product): string {
  const lines = [
    `Name: ${p.name}`,
    `Kategorie: ${p.category}`,
    `Marke: ${p.brand}`,
    `Preis: ${p.price} EUR`,
    `Beschreibung: ${p.shortDescription}`,
    `Features: ${(p.features || []).join("; ")}`,
    `Zielgruppe: ${(p.targetGroup || []).join(", ")}`,
    `Tags: ${(p.tags || []).join(", ")}`,
    `Serie: ${p.series || ""}`,
  ];
  if (p.medicalCertification?.suitableForRehab === true) lines.push("Reha-geeignet: ja");
  if (typeof p.noiseLevelDb === "number") lines.push(`Lautstärke: ${p.noiseLevelDb} dB`);
  if (typeof p.footprintM2 === "number" && p.footprintM2 > 0) {
    lines.push(`Stellfläche: ca. ${p.footprintM2} m²`);
  }
  return lines.join("\n");
}
