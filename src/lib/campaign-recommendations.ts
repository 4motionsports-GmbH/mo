// Purchase-aware product recommendations for campaign drafts (Task B).
//
// Per contact, the order history is read from Shopify AT DRAFT TIME (existing
// shopify-orders infrastructure — nothing is bulk-stored beyond the compact
// purchase_summary snapshot on the draft), the purchased line items are mapped
// to catalog products (catalog product ids ARE Shopify handles — see
// catalog-mapping), and 2–3 recommendations are picked via the EXISTING
// in-memory embedding similarity over the product catalog (catalog-store
// embeddings + retrieval's cosine — deliberately NO vector DB):
//   * similar/complementary to what they bought (max cosine against any owned
//     product's vector),
//   * excluding products they already own,
//   * filtered through the existing availability check (filterAvailable).
//
// When no purchased item matches any catalog product (old/removed items) — or
// no embedding signal exists — the pick falls back to representative products
// (one per major category, deterministic) and the draft is flagged
// `low_confidence` so the reviewer knows to look closer.

import { loadProductCatalog, loadEmbeddings } from "./catalog-store";
import { cosine } from "./retrieval";
import { filterAvailable } from "./availability.mjs";
import { fetchOrderHistoryByEmail, type OrderHistory } from "./shopify-orders";
import type { CampaignPurchaseSummary } from "./campaign-store";
import type { Product } from "./types";

const MAX_RECOMMENDATIONS = 3;

// Compact review-card snapshot bounds — the card needs a glanceable history,
// not the full order log.
const SUMMARY_MAX_ORDERS = 5;
const SUMMARY_MAX_ITEMS_PER_ORDER = 6;

export interface CampaignRecommendations {
  /** 2–3 recommendable products (available, not owned). May be empty when the
   *  catalog itself is empty. */
  products: Product[];
  /** Catalog ids the contact already owns (matched purchase handles). */
  ownedProductIds: string[];
  /** True when the picks are fallback/representative (no catalog match for any
   *  purchase, or no embedding signal) — surfaces as the draft's flag. */
  lowConfidence: boolean;
}

/** Compact the full Shopify order history into the review-card snapshot. */
export function compactPurchaseSummary(history: OrderHistory): CampaignPurchaseSummary {
  return {
    orders: history.orders.slice(0, SUMMARY_MAX_ORDERS).map((o) => ({
      name: o.name,
      createdAt: o.createdAt ?? null,
      totalAmount: o.totalAmount,
      currencyCode: o.currencyCode,
      items: o.items.slice(0, SUMMARY_MAX_ITEMS_PER_ORDER).map((i) => ({
        title: i.title,
        quantity: i.quantity,
      })),
    })),
    truncated:
      history.truncated ||
      history.orders.length > SUMMARY_MAX_ORDERS ||
      history.orders.some((o) => o.items.length > SUMMARY_MAX_ITEMS_PER_ORDER),
  };
}

/**
 * Representative fallback picks: one available product from each of the
 * largest categories (deterministic — category size desc, then catalog order),
 * so a contact with unmatchable history still gets a sensible, varied set.
 */
function representativePicks(candidates: Product[]): Product[] {
  const byCategory = new Map<string, Product[]>();
  for (const p of candidates) {
    const key = p.category || "—";
    const list = byCategory.get(key);
    if (list) list.push(p);
    else byCategory.set(key, [p]);
  }
  const categories = [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length);
  const picks: Product[] = [];
  for (const [, list] of categories) {
    picks.push(list[0]);
    if (picks.length >= MAX_RECOMMENDATIONS) break;
  }
  // Fewer categories than picks — top up from the largest category.
  for (const [, list] of categories) {
    for (const p of list) {
      if (picks.length >= MAX_RECOMMENDATIONS) return picks;
      if (!picks.includes(p)) picks.push(p);
    }
  }
  return picks;
}

/**
 * Pick recommendations for a contact from their (already-fetched) order
 * history. Pure over its inputs apart from the catalog/embeddings loads —
 * callers pass the history so the Shopify read happens exactly once per draft.
 */
export async function pickCampaignRecommendations(
  history: OrderHistory | null
): Promise<CampaignRecommendations> {
  const [catalog, embeddings] = await Promise.all([loadProductCatalog(), loadEmbeddings()]);
  const byId = new Map(catalog.map((p) => [p.id, p]));

  // Map purchased handles → catalog products (id IS the handle).
  const ownedProductIds: string[] = [];
  for (const order of history?.orders ?? []) {
    for (const item of order.items) {
      if (item.handle && byId.has(item.handle) && !ownedProductIds.includes(item.handle)) {
        ownedProductIds.push(item.handle);
      }
    }
  }

  const owned = new Set(ownedProductIds);
  const candidates = filterAvailable(catalog).filter((p) => !owned.has(p.id));
  if (candidates.length === 0) {
    return { products: [], ownedProductIds, lowConfidence: true };
  }

  const vectorIndex = new Map(embeddings.items.map((it) => [it.id, it.vector]));
  const ownedVectors = ownedProductIds
    .map((id) => vectorIndex.get(id))
    .filter((v): v is number[] => Array.isArray(v) && v.length > 0);

  // No catalog-matched purchase or no embedding signal → representative picks,
  // flagged low-confidence.
  if (ownedVectors.length === 0) {
    return {
      products: representativePicks(candidates),
      ownedProductIds,
      lowConfidence: true,
    };
  }

  const scored = candidates
    .map((product) => {
      const v = vectorIndex.get(product.id);
      const score = v ? Math.max(...ownedVectors.map((ov) => cosine(ov, v))) : 0;
      return { product, score };
    })
    .sort((a, b) => b.score - a.score);

  const withSignal = scored.filter((s) => s.score > 0).slice(0, MAX_RECOMMENDATIONS);
  if (withSignal.length === 0) {
    return {
      products: representativePicks(candidates),
      ownedProductIds,
      lowConfidence: true,
    };
  }
  return {
    products: withSignal.map((s) => s.product),
    ownedProductIds,
    lowConfidence: false,
  };
}

/**
 * The full draft-time read for one contact: order history (Shopify, at draft
 * time) + recommendations + the compact review-card snapshot. `history` is
 * null when Shopify is unconfigured or the read failed — the caller decides
 * whether that blocks the draft (it doesn't; the summary is then empty and the
 * picks are low-confidence fallbacks).
 */
export async function loadCampaignPersonalization(email: string): Promise<{
  history: OrderHistory | null;
  purchaseSummary: CampaignPurchaseSummary | null;
  recommendations: CampaignRecommendations;
}> {
  const history = await fetchOrderHistoryByEmail(email);
  const recommendations = await pickCampaignRecommendations(history);
  return {
    history,
    purchaseSummary: history ? compactPurchaseSummary(history) : null,
    recommendations,
  };
}
