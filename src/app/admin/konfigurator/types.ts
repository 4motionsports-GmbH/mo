// Plain props of the Konfigurator screen (server → client).

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
}
