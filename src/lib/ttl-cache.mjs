// Tiny in-memory TTL cache — the core behind the KPI Shopify cache (decision
// D-4). Pure and clock-injectable so node:test can drive it; the TypeScript
// wrapper (lib/kpi-cache.ts) supplies the loaders and the real clock.
//
// Semantics:
//   · get(key, now)            → the entry when it exists and has not expired
//   · isFresh(entry, now, min) → additionally requires fetchedAt >= minFetchedAt
//                                (the "Aktualisieren" floor: a caller may demand
//                                data newer than a given moment without wiping
//                                the cache for everyone else)
//   · set(key, value, now)     → stores { value, fetchedAt: now }
//   · prune(now)               → drops expired entries (bounded memory)
//
// This is a per-process cache: on serverless hosting every warm instance has
// its own copy, which is why callers pass a freshness floor via the URL rather
// than relying on an invalidation reaching the right instance.

/**
 * @template T
 * @typedef {{ value: T, fetchedAt: number }} CacheEntry
 */

export class TtlCache {
  /**
   * @param {number} ttlMs time-to-live per entry in milliseconds
   */
  constructor(ttlMs) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new TypeError("ttlMs must be > 0");
    this.ttlMs = ttlMs;
    /** @type {Map<string, CacheEntry<any>>} */
    this.entries = new Map();
  }

  /**
   * Whether an entry is usable at `now`: not expired and (optionally) fetched at
   * or after `minFetchedAt`.
   * @param {CacheEntry<unknown> | undefined} entry
   * @param {number} now
   * @param {number} [minFetchedAt]
   */
  isFresh(entry, now, minFetchedAt = 0) {
    if (!entry) return false;
    if (now - entry.fetchedAt >= this.ttlMs) return false;
    return entry.fetchedAt >= minFetchedAt;
  }

  /**
   * @param {string} key
   * @param {number} now
   * @param {number} [minFetchedAt]
   * @returns {CacheEntry<any> | null}
   */
  get(key, now, minFetchedAt = 0) {
    const entry = this.entries.get(key);
    if (!this.isFresh(entry, now, minFetchedAt)) return null;
    return entry ?? null;
  }

  /**
   * @param {string} key
   * @param {unknown} value
   * @param {number} now
   */
  set(key, value, now) {
    this.entries.set(key, { value, fetchedAt: now });
    return this.entries.get(key);
  }

  /** @param {string} key */
  delete(key) {
    return this.entries.delete(key);
  }

  /** Drop expired entries. @param {number} now */
  prune(now) {
    for (const [key, entry] of this.entries) {
      if (now - entry.fetchedAt >= this.ttlMs) this.entries.delete(key);
    }
  }

  get size() {
    return this.entries.size;
  }
}

/**
 * Parse the `?kpiFresh=` freshness floor: unix seconds (as written by the
 * "Aktualisieren" button). Anything non-numeric, negative or in the future
 * (beyond a small skew) yields 0 = no floor, so a forged or stale param can
 * never disable caching permanently.
 * @param {unknown} raw
 * @param {number} nowMs
 * @returns {number} floor in ms
 */
export function parseFreshnessFloor(raw, nowMs) {
  if (typeof raw !== "string" || !/^\d{1,12}$/.test(raw)) return 0;
  const ms = Number(raw) * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  if (ms > nowMs + 60_000) return 0;
  return ms;
}

/**
 * Whether `fetchedAt` is older than `now` by at least `staleAfterMs` — used to
 * show a "Stand" badge in a warning tone once the data is getting old.
 * @param {number} fetchedAt
 * @param {number} now
 * @param {number} staleAfterMs
 */
export function isStale(fetchedAt, now, staleAfterMs) {
  return now - fetchedAt >= staleAfterMs;
}
