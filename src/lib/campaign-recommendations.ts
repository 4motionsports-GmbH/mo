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
import { buildAccessoryMap, pickComplementIds } from "./campaign-complement.mjs";
import { anchorValueEur, mergePurchaseOccasions } from "./repurchase-analysis.mjs";
import {
  RECOMMENDATION_STRATEGIES,
  resolveCampaignSegment,
} from "./campaign-segments.mjs";
import type { CampaignPurchaseSummary } from "./campaign-store";
import type { Product } from "./types";

/** Which kind of products to pick — see campaign-segments.mjs. */
export type RecommendationStrategy = "complement" | "similarity" | "winback";

/** The resolved lifecycle segment (campaign-segments.mjs, typed for the TS side). */
export interface CampaignSegment {
  key: string;
  label: string;
  sendable: boolean;
  reason: string;
  strategy: string | null;
  contentTier: "klein" | "gross" | null;
  days: number | null;
}

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
  /** The strategy that actually produced these picks. Differs from the one
   *  requested when a fallback kicked in (e.g. complement asked for, but the
   *  owned products carry no curated accessories) — the review card shows this,
   *  not the request. */
  strategy: RecommendationStrategy;
}

/**
 * The lifecycle inputs derived from a contact's order history: when they last
 * bought and how big that purchase was. Feeds resolveCampaignSegment.
 *
 * The anchor is the largest single item of the most recent PURCHASE OCCASION
 * (orders inside 7 days merged), so a €30 mat bought two days after a €2.500
 * machine cannot demote the contact to the small-ticket tier.
 *
 * NOTE ON PRICES: Shopify's order-history read carries no per-line-item price,
 * so the anchor uses the CURRENT CATALOG price of the purchased products. That
 * is a proxy for what was actually paid — good enough for a 150 € tier
 * boundary, and it degrades to null (unknown tier → today's behaviour) for
 * items that are no longer in the catalogue.
 */
export interface CampaignLifecycleFacts {
  lastOrderAt: string | null;
  anchorEur: number | null;
}

/**
 * Derive the lifecycle facts from an order history, pricing purchased items
 * from the catalog. Returns nulls when nothing is derivable — callers then get
 * the "unknown" segment and today's unchanged behaviour.
 */
export function lifecycleFactsFromHistory(
  history: OrderHistory | null,
  catalog: Product[]
): CampaignLifecycleFacts {
  if (!history || history.orders.length === 0) return { lastOrderAt: null, anchorEur: null };
  const priceById = new Map(catalog.map((p) => [p.id, p.price]));
  const orders = history.orders.map((o, i) => ({
    id: o.name || String(i),
    createdAt: o.createdAt,
    lineItems: o.items.map((it) => ({
      handle: it.handle,
      quantity: it.quantity,
      unitPriceEur: it.handle ? (priceById.get(it.handle) ?? null) : null,
    })),
  }));
  const occasions = mergePurchaseOccasions(orders);
  const last = occasions[occasions.length - 1];
  if (!last) return { lastOrderAt: null, anchorEur: null };
  return { lastOrderAt: last.createdAt, anchorEur: anchorValueEur(last) };
}

/** Compact the full Shopify order history into the review-card snapshot.
 * `catalogIds` marks which purchased handles map to a CURRENT catalog product
 * (item.productId) — those items are selectable as the recommendation basis in
 * the review card; unmatched items stay informational. */
export function compactPurchaseSummary(
  history: OrderHistory,
  catalogIds?: Set<string>
): CampaignPurchaseSummary {
  return {
    orders: history.orders.slice(0, SUMMARY_MAX_ORDERS).map((o) => ({
      name: o.name,
      createdAt: o.createdAt ?? null,
      totalAmount: o.totalAmount,
      currencyCode: o.currencyCode,
      items: o.items.slice(0, SUMMARY_MAX_ITEMS_PER_ORDER).map((i) => ({
        title: i.title,
        quantity: i.quantity,
        productId: i.handle && catalogIds?.has(i.handle) ? i.handle : null,
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
 *
 * `strategy` selects WHAT KIND of product to recommend and comes from the
 * contact's lifecycle segment (campaign-segments.mjs):
 *
 *   complement — accessories to what they own (Product.compatibleWith). The
 *                measured winner right after a purchase: 3,0–4,6× the chance
 *                rate, and up to 38,6 % in the 7–30 day window.
 *   similarity — the classic embedding pick. Correct once accessory relevance
 *                has decayed (below 150 € after ~3 months).
 *   winback    — broad representative picks, not tied to an old purchase.
 *
 * Every strategy DEGRADES rather than fails: complement with no curated
 * accessories falls back to similarity, similarity with no embedding signal
 * falls back to representative picks. The returned `strategy` says what
 * actually produced the picks.
 *
 * `selectedProductIds` narrows the basis to those owned products (review-card
 * purchase selection); null/undefined = all owned products. The exclusion of
 * already-owned products from the candidates always covers the FULL owned set —
 * deselecting a purchase never makes it recommendable.
 */
export async function pickCampaignRecommendations(
  history: OrderHistory | null,
  selectedProductIds?: string[] | null,
  strategy: RecommendationStrategy = RECOMMENDATION_STRATEGIES.SIMILARITY as RecommendationStrategy
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
    return { products: [], ownedProductIds, lowConfidence: true, strategy };
  }
  const availableIds = new Set(candidates.map((p) => p.id));

  // The similarity basis: the operator's narrowed selection when given (only
  // ids that are actually owned count), else every owned product.
  const basisIds = selectedProductIds
    ? ownedProductIds.filter((id) => selectedProductIds.includes(id))
    : ownedProductIds;

  // ── winback ────────────────────────────────────────────────────────────────
  // Deliberately NOT anchored on an old purchase: after a year or more the
  // point is to show what the shop has now, not to continue a stale thought.
  if (strategy === RECOMMENDATION_STRATEGIES.WINBACK) {
    return {
      products: representativePicks(candidates),
      ownedProductIds,
      lowConfidence: false,
      strategy: "winback",
    };
  }

  // ── complement ─────────────────────────────────────────────────────────────
  if (strategy === RECOMMENDATION_STRATEGIES.COMPLEMENT && basisIds.length > 0) {
    // Accessories of the most recent purchase lead the ranking — that is the
    // product the mail's prose is about.
    const recentOrder = [...(history?.orders ?? [])]
      .filter((o) => !Number.isNaN(new Date(o.createdAt).getTime()))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    const recentOwnedIds = (recentOrder?.items ?? [])
      .map((i) => i.handle)
      .filter((h): h is string => Boolean(h && owned.has(h)));

    const ids = pickComplementIds({
      ownedIds: basisIds,
      recentOwnedIds,
      accessoryMap: buildAccessoryMap(catalog),
      isAvailable: (id: string) => availableIds.has(id),
      max: MAX_RECOMMENDATIONS,
    });
    const products = ids.map((id) => byId.get(id)).filter((p): p is Product => Boolean(p));
    if (products.length > 0) {
      return { products, ownedProductIds, lowConfidence: false, strategy: "complement" };
    }
    // No curated accessories for anything they own — fall through to similarity
    // rather than sending a mail with nothing in it.
  }

  // ── similarity (the classic pick, and every strategy's floor) ──────────────
  const vectorIndex = new Map(embeddings.items.map((it) => [it.id, it.vector]));
  const ownedVectors = basisIds
    .map((id) => vectorIndex.get(id))
    .filter((v): v is number[] => Array.isArray(v) && v.length > 0);

  // No catalog-matched purchase or no embedding signal → representative picks,
  // flagged low-confidence.
  if (ownedVectors.length === 0) {
    return {
      products: representativePicks(candidates),
      ownedProductIds,
      lowConfidence: true,
      strategy: "similarity",
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
      strategy: "similarity",
    };
  }
  return {
    products: withSignal.map((s) => s.product),
    ownedProductIds,
    lowConfidence: false,
    strategy: "similarity",
  };
}

/**
 * The full draft-time read for one contact: order history (Shopify, at draft
 * time) + recommendations + the compact review-card snapshot. `history` is
 * null when Shopify is unconfigured or the read failed — the caller decides
 * whether that blocks the draft (it doesn't; the summary is then empty and the
 * picks are low-confidence fallbacks).
 */
export async function loadCampaignPersonalization(
  email: string,
  selectedProductIds?: string[] | null,
  strategyOverride?: RecommendationStrategy | null
): Promise<{
  history: OrderHistory | null;
  purchaseSummary: CampaignPurchaseSummary | null;
  recommendations: CampaignRecommendations;
  lifecycle: CampaignLifecycleFacts;
  segment: CampaignSegment;
}> {
  const history = await fetchOrderHistoryByEmail(email);
  // The segment falls out of the SAME history read — resolving it here keeps
  // the Shopify call at exactly one per draft.
  const catalog = await loadProductCatalog();
  const lifecycle = lifecycleFactsFromHistory(history, catalog);
  const segment = resolveCampaignSegment(lifecycle) as CampaignSegment;
  const recommendations = await pickCampaignRecommendations(
    history,
    selectedProductIds,
    strategyOverride ??
      (segment.strategy as RecommendationStrategy | null) ??
      (RECOMMENDATION_STRATEGIES.SIMILARITY as RecommendationStrategy)
  );
  // Catalog-matched purchases (= the selectable basis) are exactly the owned
  // ids the picker resolved — the summary marks them for the review card.
  return {
    history,
    purchaseSummary: history
      ? compactPurchaseSummary(history, new Set(recommendations.ownedProductIds))
      : null,
    recommendations,
    lifecycle,
    segment,
  };
}
