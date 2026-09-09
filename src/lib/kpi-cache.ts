// KPI Shopify cache (decision D-4). The four KPI getters that fan out to the
// Shopify Admin API (up to ~330 order lookups per page view) are served from a
// per-process TTL cache keyed by the KPI range, so a range change or a reload
// within ten minutes costs one DB round trip instead of seconds of Shopify
// calls. Pure-DB sections stay live and are not cached.
//
// Freshness: "Aktualisieren" in the KPI toolbar navigates with
// ?kpiFresh=<unix seconds>; entries fetched before that moment are treated as
// misses. That works across serverless instances (each has its own cache) and
// never disables caching permanently — a later reload with the same URL is
// served from cache again once the entries are newer than the floor.
//
// Concurrency: simultaneous misses for the same key share one in-flight
// promise, so two operators opening the KPIs at once trigger one Shopify pass.

import { TtlCache, parseFreshnessFloor } from "./ttl-cache.mjs";
import type { KpiRange } from "./kpi-range";
import { getMoRevenue, type MoRevenue } from "./kpi-revenue-store";
import { getCampaignKpis, type CampaignKpis } from "./campaign-store";
import {
  getRecommendationLoop,
  type RecommendationLoopResult,
} from "./kpi-recommendation-loop";
import { getMarketingFunnel, type MarketingFunnel } from "./marketing-store";

const KPI_SHOPIFY_CACHE_TTL_MS = 10 * 60 * 1000;

/** A cached value with the moment it was actually computed. */
export interface Cached<T> {
  value: T;
  /** ISO timestamp of the underlying fetch (not of this request). */
  fetchedAt: string;
  fromCache: boolean;
}

/** The Shopify-dependent KPI block, loaded together for one range. */
export interface KpiShopifyBlock {
  revenue: Cached<MoRevenue | null>;
  campaign: Cached<CampaignKpis | null>;
  loop: Cached<RecommendationLoopResult | null>;
  funnel: Cached<MarketingFunnel | null>;
  /** The oldest of the four fetch times — the "Stand" shown in the toolbar. */
  fetchedAt: string;
  /** True when at least one part was served from the cache. */
  fromCache: boolean;
}

interface Store {
  cache: TtlCache;
  inflight: Map<string, Promise<unknown>>;
}

// One store per process; kept on globalThis so dev HMR doesn't reset it on
// every edit of a module that imports this file.
const STORE_KEY = "__moKpiShopifyCache";
function store(): Store {
  const g = globalThis as unknown as Record<string, Store | undefined>;
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = { cache: new TtlCache(KPI_SHOPIFY_CACHE_TTL_MS), inflight: new Map() };
  }
  return g[STORE_KEY];
}

/**
 * Serve `loader()` for `key` from the cache when a fresh entry exists (fetched
 * within the TTL and at/after `minFetchedAt`), otherwise run it once — sharing
 * the promise with concurrent callers — and cache a non-null result.
 */
async function cachedKpi<T>(
  key: string,
  loader: () => Promise<T>,
  { minFetchedAt = 0, now = Date.now() }: { minFetchedAt?: number; now?: number } = {}
): Promise<Cached<T>> {
  const s = store();
  const hit = s.cache.get(key, now, minFetchedAt);
  if (hit) {
    return { value: hit.value as T, fetchedAt: new Date(hit.fetchedAt).toISOString(), fromCache: true };
  }
  let pending = s.inflight.get(key) as Promise<Cached<T>> | undefined;
  if (!pending) {
    pending = (async () => {
      try {
        const value = await loader();
        const fetchedAt = Date.now();
        // A null result means "no database" — nothing worth remembering.
        if (value !== null && value !== undefined) s.cache.set(key, value, fetchedAt);
        s.cache.prune(fetchedAt);
        return { value, fetchedAt: new Date(fetchedAt).toISOString(), fromCache: false };
      } finally {
        s.inflight.delete(key);
      }
    })();
    s.inflight.set(key, pending);
  }
  return pending;
}

/** Cache key for a range-bound getter. */
function rangeKey(prefix: string, range: KpiRange): string {
  return `${prefix}:${range.from}:${range.to}`;
}

/**
 * Load the four Shopify-dependent KPI results for `range`. `freshParam` is the
 * raw `?kpiFresh=` value (unix seconds) written by the "Aktualisieren" button.
 */
export async function loadKpiShopifyBlock(
  range: KpiRange,
  freshParam?: string | null
): Promise<KpiShopifyBlock> {
  const now = Date.now();
  const minFetchedAt = parseFreshnessFloor(freshParam ?? undefined, now);
  const opts = { minFetchedAt, now };
  const [revenue, campaign, loop, funnel] = await Promise.all([
    cachedKpi(rangeKey("revenue", range), () => getMoRevenue(range), opts),
    cachedKpi(rangeKey("campaign", range), () => getCampaignKpis(range), opts),
    cachedKpi("loop:all", () => getRecommendationLoop(), opts),
    cachedKpi("funnel:all", () => getMarketingFunnel(), opts),
  ]);
  const parts = [revenue, campaign, loop, funnel];
  const oldest = parts.reduce(
    (min, p) => (Date.parse(p.fetchedAt) < Date.parse(min) ? p.fetchedAt : min),
    parts[0].fetchedAt
  );
  return {
    revenue,
    campaign,
    loop,
    funnel,
    fetchedAt: oldest,
    fromCache: parts.some((p) => p.fromCache),
  };
}
