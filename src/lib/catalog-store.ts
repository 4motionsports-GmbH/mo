// Catalog + embeddings storage layer.
//
// At runtime, try to load from Vercel Blob (live, refreshed by
// /api/cron/sync-catalog). If Blob is not configured OR the keys don't
// exist yet, fall back to the JSON committed in src/data/. Results are
// cached in module memory for the lifetime of the warm Lambda.
//
// The store is configured as PRIVATE, so these blobs are written with
// access:"private" and read back server-side through the SDK with the
// BLOB_READ_WRITE_TOKEN (get), NOT via an unauthenticated public URL. They are
// only ever read by the backend (into memory for retrieval) — the browser gets
// products via /api/products — so they never need public access.

import { get, put } from "@vercel/blob";
import { reconcileEmbeddingItems } from "./catalog-pair.mjs";
import type { Product } from "./types";

export const CATALOG_BLOB_KEY = "catalog/product-catalog.json";
export const EMBEDDINGS_BLOB_KEY = "catalog/product-embeddings.json";

export interface EmbeddingItem {
  id: string;
  vector: number[];
  // Short hash of the embedded doc text (embeddingDocHash). Lets the webhook
  // single-product update re-embed ONLY when the text actually changed, and lets
  // the sync's carry-forward refuse a vector whose doc has since changed. Optional
  // for back-compat with vectors written before this field existed.
  docHash?: string;
}

export interface EmbeddingsFile {
  model: string;
  dim: number;
  // The EMBEDDING_DOC_VERSION the vectors were built with. Absent on legacy
  // blobs (treated as "older than current" ⇒ not carried forward). See
  // embedding-doc.mjs / embed-resilience.mjs.
  docVersion?: number;
  items: EmbeddingItem[];
}

// How long (ms) a warm Lambda may serve its in-memory snapshot before
// re-reading the blob. Keeps a re-sync visible within ~a minute without a
// redeploy, while still avoiding a blob round-trip on every request.
const CACHE_TTL_MS = 60_000;

let cachedCatalog: Product[] | null = null;
let cachedCatalogAt = 0;
let cachedEmbeddings: EmbeddingsFile | null = null;
let cachedEmbeddingsAt = 0;

function isFresh(loadedAt: number): boolean {
  return loadedAt > 0 && Date.now() - loadedAt < CACHE_TTL_MS;
}

function blobConfigured(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/**
 * Read a PRIVATE blob's JSON by pathname through the SDK, authenticated with the
 * read-write token (get resolves the store from the token). Returns null when the
 * key doesn't exist; throws on a real read/auth error so callers' try/catch can
 * fall back. `useCache:false` bypasses the CDN cache so a freshly-synced copy is
 * read immediately (the private-store equivalent of the old `cache:"no-store"`).
 */
async function readPrivateJson<T>(pathname: string): Promise<T | null> {
  const res = await get(pathname, {
    access: "private",
    token: process.env.BLOB_READ_WRITE_TOKEN,
    useCache: false,
  });
  if (!res || res.statusCode !== 200) return null;
  return (await new Response(res.stream).json()) as T;
}

async function loadCatalogFromBundle(): Promise<Product[]> {
  const mod = await import("@/data/product-catalog.json");
  return (mod.default as unknown) as Product[];
}

async function loadEmbeddingsFromBundle(): Promise<EmbeddingsFile> {
  const mod = await import("@/data/product-embeddings.json");
  return mod.default as unknown as EmbeddingsFile;
}

export async function loadProductCatalog(): Promise<Product[]> {
  if (cachedCatalog && isFresh(cachedCatalogAt)) return cachedCatalog;
  if (blobConfigured()) {
    try {
      const data = await readPrivateJson<Product[]>(CATALOG_BLOB_KEY);
      if (Array.isArray(data) && data.length) {
        cachedCatalog = data;
        cachedCatalogAt = Date.now();
        return data;
      }
    } catch (err) {
      console.warn("[catalog-store] catalog blob load failed, falling back to bundled JSON", err);
    }
  }
  cachedCatalog = await loadCatalogFromBundle();
  cachedCatalogAt = Date.now();
  return cachedCatalog;
}

export async function loadEmbeddings(): Promise<EmbeddingsFile> {
  if (cachedEmbeddings && isFresh(cachedEmbeddingsAt)) return cachedEmbeddings;
  if (blobConfigured()) {
    try {
      const data = await readPrivateJson<EmbeddingsFile>(EMBEDDINGS_BLOB_KEY);
      if (data?.items?.length) {
        cachedEmbeddings = data;
        cachedEmbeddingsAt = Date.now();
        return data;
      }
    } catch (err) {
      console.warn("[catalog-store] embeddings blob load failed, falling back to bundled JSON", err);
    }
  }
  cachedEmbeddings = await loadEmbeddingsFromBundle();
  cachedEmbeddingsAt = Date.now();
  return cachedEmbeddings;
}

/**
 * Read the catalog blob DIRECTLY (no module cache, no bundled-JSON fallback).
 * Returns null when the key doesn't exist or can't be read. Used by the sync
 * (carry-forward base) and the webhook single-product update, which must operate
 * on the authoritative current blob, not a possibly-stale warm-Lambda snapshot.
 */
export async function readCatalogBlobDirect(): Promise<Product[] | null> {
  if (!blobConfigured()) return null;
  try {
    const data = await readPrivateJson<Product[]>(CATALOG_BLOB_KEY);
    return Array.isArray(data) ? data : null;
  } catch (err) {
    console.warn("[catalog-store] direct catalog blob read failed", err);
    return null;
  }
}

/** Direct (uncached, no-fallback) read of the embeddings blob, or null. */
export async function readEmbeddingsBlobDirect(): Promise<EmbeddingsFile | null> {
  if (!blobConfigured()) return null;
  try {
    const data = await readPrivateJson<EmbeddingsFile>(EMBEDDINGS_BLOB_KEY);
    return data?.items ? data : null;
  } catch (err) {
    console.warn("[catalog-store] direct embeddings blob read failed", err);
    return null;
  }
}

/**
 * The base catalog a webhook update mutates: the live blob when present, else the
 * committed bundle (so a targeted update still works before the very first sync).
 */
export async function readCatalogForMutation(): Promise<Product[]> {
  return (await readCatalogBlobDirect()) ?? (await loadCatalogFromBundle());
}

/**
 * Write BOTH blobs as a consistent pair (Part B). Callers generate the fresh
 * catalog AND fresh embeddings IN FULL before calling this, so a failure earlier
 * in the pipeline never leaves one blob fresh and the other stale.
 *
 * Ordering is deliberate: embeddings FIRST, then catalog. If the second write
 * fails, the worst residual state is "catalog no newer than embeddings" (the new
 * embeddings may contain a few vectors for products not yet in the old catalog —
 * harmless, they're simply not retrievable). The reverse order could leave a
 * fresh catalog with stale embeddings — exactly the regression we're fixing.
 *
 * Orphan vectors (ids not in the catalog) are reconciled away first so the pair
 * is internally consistent.
 */
export async function writeCatalogPair(
  products: Product[],
  embeddings: EmbeddingsFile
): Promise<{ catalogUrl: string; embeddingsUrl: string }> {
  const reconciled: EmbeddingsFile = {
    ...embeddings,
    items: reconcileEmbeddingItems(
      products.map((p) => p.id),
      embeddings.items
    ) as EmbeddingItem[],
  };
  const embeddingsUrl = await writeEmbeddingsToBlob(reconciled);
  const catalogUrl = await writeCatalogToBlob(products);
  invalidateCache();
  return { catalogUrl, embeddingsUrl };
}

export async function writeCatalogToBlob(products: Product[]): Promise<string> {
  const res = await put(CATALOG_BLOB_KEY, JSON.stringify(products), {
    // PRIVATE store: the catalog is read back server-side via get() + token, never
    // fetched by the browser, so it must not request public access (the private
    // store rejects access:"public"). Reads use useCache:false for freshness, so
    // no CDN cache-control is needed on write.
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  return res.url;
}

export async function writeEmbeddingsToBlob(file: EmbeddingsFile): Promise<string> {
  const res = await put(EMBEDDINGS_BLOB_KEY, JSON.stringify(file), {
    // PRIVATE store — see writeCatalogToBlob. Read back server-side via get().
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  return res.url;
}

export function invalidateCache(): void {
  cachedCatalog = null;
  cachedCatalogAt = 0;
  cachedEmbeddings = null;
  cachedEmbeddingsAt = 0;
}
