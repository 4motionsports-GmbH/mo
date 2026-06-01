// Catalog + embeddings storage layer.
//
// At runtime, try to load from Vercel Blob (live, refreshed by
// /api/cron/sync-catalog). If Blob is not configured OR the keys don't
// exist yet, fall back to the JSON committed in src/data/. Results are
// cached in module memory for the lifetime of the warm Lambda.

import { list, put } from "@vercel/blob";
import type { Product } from "./types";

export const CATALOG_BLOB_KEY = "catalog/product-catalog.json";
export const EMBEDDINGS_BLOB_KEY = "catalog/product-embeddings.json";

export interface EmbeddingsFile {
  model: string;
  dim: number;
  items: Array<{ id: string; vector: number[] }>;
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

async function findBlobUrl(pathname: string): Promise<string | null> {
  try {
    const res = await list({
      prefix: pathname,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    const exact = res.blobs.find((b) => b.pathname === pathname);
    return exact?.url ?? null;
  } catch (err) {
    console.warn(`[catalog-store] blob list failed for ${pathname}`, err);
    return null;
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`blob fetch ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
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
      const url = await findBlobUrl(CATALOG_BLOB_KEY);
      if (url) {
        const data = await fetchJson<Product[]>(url);
        if (Array.isArray(data) && data.length) {
          cachedCatalog = data;
          cachedCatalogAt = Date.now();
          return data;
        }
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
      const url = await findBlobUrl(EMBEDDINGS_BLOB_KEY);
      if (url) {
        const data = await fetchJson<EmbeddingsFile>(url);
        if (data?.items?.length) {
          cachedEmbeddings = data;
          cachedEmbeddingsAt = Date.now();
          return data;
        }
      }
    } catch (err) {
      console.warn("[catalog-store] embeddings blob load failed, falling back to bundled JSON", err);
    }
  }
  cachedEmbeddings = await loadEmbeddingsFromBundle();
  cachedEmbeddingsAt = Date.now();
  return cachedEmbeddings;
}

export async function writeCatalogToBlob(products: Product[]): Promise<string> {
  const res = await put(CATALOG_BLOB_KEY, JSON.stringify(products), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    // Overwrite the stable URL on every sync. Without this, Vercel Blob's
    // default (one month) caches the old copy at the CDN/browser, so a
    // re-sync wouldn't be visible. Keep it short so updates propagate fast.
    cacheControlMaxAge: 60,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  return res.url;
}

export async function writeEmbeddingsToBlob(file: EmbeddingsFile): Promise<string> {
  const res = await put(EMBEDDINGS_BLOB_KEY, JSON.stringify(file), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
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
