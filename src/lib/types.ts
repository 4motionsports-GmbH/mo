// One sellable variant of a product ("16 kg", "Stärke 5", "Eiche"). Present on
// every Product after the variant-aware sync (length >= 1 — single-variant
// products carry one entry with an empty title). Consumers must tolerate its
// absence (old blob / CSV fallback) — src/lib/product-ref.mjs synthesizes the
// default variant from the flat Product fields in that case.
export interface ProductVariant {
  // Numeric Shopify variant id (cart-url + ?variant= deep-link source).
  // Null when unresolvable (CSV fallback has no variant ids).
  id: string | null;
  // Human variant label from the Shopify options ("16 kg"). Empty string for
  // single-variant products (Shopify's placeholder "Default Title" is mapped
  // away at ingestion).
  title: string;
  options: Array<{ name: string; value: string }>;
  sku?: string;
  barcode?: string;
  price: number;
  salePrice?: number;
  // ProductVariant.availableForSale — whether THIS variant can be sold now.
  available: boolean;
  inventoryQuantity?: number;
  // Storefront cart permalink for this variant; omitted when id is null.
  cartUrl?: string;
  // True for the variant in Shopify position 1 — the one the flat Product
  // fields (price, sku, shopifyVariantId, …) project.
  isDefault: boolean;
}

export interface MedicalCertification {
  ceClass?: "I" | "IIa" | "IIb" | "III" | "none" | "unknown";
  suitableForRehab: boolean | "unknown";
  notes?: string;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  category: string;
  brand: string;
  price: number;
  salePrice?: number;
  currency: "EUR";
  shortDescription: string;
  detailedDescription: string;
  specifications: Record<string, string | number>;
  features: string[];
  dimensions: {
    width: number;
    height: number;
    depth: number;
    weight: number;
  };
  targetGroup: string[];
  compatibleWith?: string[];
  shopifyUrl: string;
  // Numeric Shopify variant id (the cart-url source of truth). Resolved from
  // the variant GID at ingestion time and cached alongside other fields.
  shopifyVariantId?: string;
  // Storefront cart permalink (`/cart/<numericVariantId>:1`). Omitted when no
  // numeric variant id is resolvable, so the widget can degrade gracefully
  // rather than link to a broken (SKU-based) cart.
  shopifyCartUrl?: string;
  images: string[];
  // Stock status, refreshed by the daily catalog sync (NOT a live per-request
  // check — see docs/CATALOG_SYNC.md). `inStock` is the headline flag Mo and
  // the UI use: true when the product can currently be sold.
  inStock: boolean;
  // Optional richer stock signals captured from Shopify when available.
  //   inventoryQuantity   — units in stock across variants/locations
  //                         (Shopify `Product.totalInventory`). Omitted when
  //                         inventory isn't tracked.
  //   anyVariantAvailable — whether ANY variant is `availableForSale` (already
  //                         accounts for oversell policy). Omitted when no
  //                         availability data was present (e.g. fallback bundle).
  inventoryQuantity?: number;
  anyVariantAvailable?: boolean;
  deliveryTime: string;
  series?: string;
  tags: string[];
  // Merchant article identifiers (first variant) — lets Mo answer "which
  // article number is that?" and disambiguate B-Ware/variants precisely.
  sku?: string;
  barcode?: string;
  // Customer review signals from the shop's review app (reviews.rating /
  // reviews.rating_count metafields). Omitted when the product has no reviews.
  rating?: number;
  ratingCount?: number;
  // "Zugehörige Produkte" from Shopify Search & Discovery (product handles).
  // compatibleWith (above) carries the "Ergänzende Produkte" (accessories).
  relatedProducts?: string[];
  // custom.hide_from_search ("Von Suche ausschließen") — the merchant excluded
  // this product from storefront search. Mo's retrieval mirrors that: the
  // product stays resolvable by id but is never recommended proactively.
  hideFromSearch?: boolean;
  // Published customer Q&A pairs from the `custom.qa` metafield (the "Wissen"
  // feature, docs/QA_KNOWLEDGE.md) — shown in the PDP Q&A tab and given to Mo
  // so an already-answered question never stumps him again. German (question/
  // answer) is the source of truth; the English pair is present when the
  // publish-time auto-translation ran (consumers fall back to German).
  // answerHtml/answerEnHtml are present when the answer contains a link
  // (markdown `[Text](URL)` → pre-rendered anchors, qa-links.mjs) — render
  // the HTML variant when present, else the plain text.
  qa?: Array<{
    question: string;
    answer: string;
    answerHtml?: string;
    questionEn?: string;
    answerEn?: string;
    answerEnHtml?: string;
  }>;
  // Persona-relevant fields (added for persona-aware recommendations)
  medicalCertification?: MedicalCertification;
  noiseLevelDb?: number | "unknown";
  // Rough footprint requirement for the trainee in m². Distinct from raw dimensions
  // because some equipment needs clearance around it (e.g. rack with bench, treadmill run-out).
  footprintM2?: number;
  // All sellable variants (length >= 1 when present). The flat fields above
  // stay the default-variant projection for back-compat; variant-granular
  // consumers resolve through src/lib/product-ref.mjs instead of reading
  // price/sku/shopifyVariantId directly. Optional: old blobs and the CSV
  // fallback predate this field.
  variants?: ProductVariant[];
  // Effective (sale-aware) price range across variants — "ab 3,60 €"
  // rendering and price filters. Equal to price for single-variant products.
  priceMin?: number;
  priceMax?: number;
}

// ---------------- Customer profile / persona ----------------

export type CustomerSegment =
  | "private"
  | "studio"
  | "physio"
  | "public_sector"
  | "unknown";

export type ExperienceLevel =
  | "beginner"
  | "intermediate"
  | "advanced"
  | "unknown";

export type TrainingFocus =
  | "strength"
  | "cardio"
  | "mixed"
  | "rehab"
  | "unknown";

export type Housing =
  | "apartment"
  | "house_basement_garage"
  | "facility"
  | "unknown";

export type ProcurementNeed =
  | "invoice"
  | "tender"
  | "warranty_docs"
  | "ce_certs"
  | "leasing"
  | "bulk_discount"
  | "maintenance_contract";

export interface CustomerProfile {
  segment: CustomerSegment;
  experienceLevel: ExperienceLevel;
  trainingFocus: TrainingFocus;
  spaceM2: number | "unknown";
  budgetEUR: { min: number | null; max: number | null } | "unknown";
  trainingFrequency: "1-2x" | "3-5x" | "daily" | "unknown";
  housing: Housing;
  noiseSensitive: boolean | "unknown";
  procurementNeeds: ProcurementNeed[];
  // 0..1 — how confident the model is that the profile is correct.
  confidence: number;
}

export const EMPTY_PROFILE: CustomerProfile = {
  segment: "unknown",
  experienceLevel: "unknown",
  trainingFocus: "unknown",
  spaceM2: "unknown",
  budgetEUR: "unknown",
  trainingFrequency: "unknown",
  housing: "unknown",
  noiseSensitive: "unknown",
  procurementNeeds: [],
  confidence: 0,
};

export type PersonaArchetype =
  | "pragmatic_beginner" // 1
  | "ambitious_home_athlete" // 2
  | "strength_focused" // 3a
  | "cardio_focused" // 3b
  | "studio_operator" // 4
  | "physio" // 5
  | "public_sector" // 6
  | "unknown";

export interface ArchetypeMeta {
  id: PersonaArchetype;
  label: string;
  shortLabel: string;
}

// ---------------- Tool I/O ----------------

export interface ShowProductArgs {
  productId: string;
  reason?: string;
}

export interface CompareProductsArgs {
  productIds: string[];
  comparisonContext?: string;
}

export interface AddToCartArgs {
  productId: string;
  message: string;
}

export interface SuggestShowroomArgs {
  productIds: string[];
}

export interface UpdateCustomerProfileArgs {
  segment?: CustomerSegment;
  experienceLevel?: ExperienceLevel;
  trainingFocus?: TrainingFocus;
  spaceM2?: number | "unknown";
  budgetEUR?: { min: number | null; max: number | null } | "unknown";
  trainingFrequency?: "1-2x" | "3-5x" | "daily" | "unknown";
  housing?: Housing;
  noiseSensitive?: boolean | "unknown";
  procurementNeeds?: ProcurementNeed[];
  confidence?: number;
  rationale?: string;
}

export interface SearchProductsArgs {
  query: string;
  filters?: {
    category?: string;
    maxPriceEUR?: number;
    minPriceEUR?: number;
    maxFootprintM2?: number;
    requiresMedical?: boolean;
    requiresQuiet?: boolean;
  };
  limit?: number;
}

export interface SearchProductsResult {
  products: Array<{
    id: string;
    name: string;
    category: string;
    price: number;
    /** Effective price range + variant count — present only for products with
     * a genuine multi-variant price spread. */
    priceFrom?: number;
    priceTo?: number;
    variantCount?: number;
    shortDescription: string;
    score: number;
  }>;
  totalMatched: number;
}

export type ContactReason =
  | "studio_consultation"
  | "public_sector_quote"
  | "physio_consultation"
  | "bulk_discount"
  | "leasing"
  | "maintenance"
  | "order_support"
  | "general";

export interface ShowContactFormArgs {
  reason: ContactReason;
  message: string;
  productIds?: string[];
}

export interface OfferEmailSummaryArgs {
  message: string;
  productIds?: string[];
}
