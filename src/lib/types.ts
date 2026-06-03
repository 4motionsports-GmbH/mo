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
  inStock: boolean;
  deliveryTime: string;
  series?: string;
  tags: string[];
  // Persona-relevant fields (added for persona-aware recommendations)
  medicalCertification?: MedicalCertification;
  noiseLevelDb?: number | "unknown";
  // Rough footprint requirement for the trainee in m². Distinct from raw dimensions
  // because some equipment needs clearance around it (e.g. rack with bench, treadmill run-out).
  footprintM2?: number;
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
