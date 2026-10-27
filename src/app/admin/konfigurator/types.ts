// Plain props of the Konfigurator screen (server → client).

export type { ProductRulesOverview } from "@/lib/configurator-store";
export type { ShowroomCardData } from "@/lib/showroom-store";

export interface AssortmentRow {
  id: string;
  name: string;
  category: string;
  price: number;
  priceMin: number | null;
  priceMax: number | null;
  inStock: boolean;
  image: string | null;
  url: string | null;
  /** In the assortment through the Shopify tag. */
  viaTag: boolean;
  /** In the assortment through the hand-picked list. */
  viaList: boolean;
  /** Short labels of the product rules (product-rules.mjs ruleBadges, without the showroom). */
  rules: string[];
  /** A `mo.*` metafield sets or lifts a rule of this product. */
  ruleMetafield: boolean;
  /** On display in the showroom (theme list ∪ manual list). */
  showroom: boolean;
}
