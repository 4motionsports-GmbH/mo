// Targeted single-product catalog mutation — the engine behind the Shopify stock
// webhook (Part E). Reuses the SAME authoritative Shopify fetch + mapping as the
// daily sync, so a webhook-updated record is computed identically to a synced one
// (availableForSale-backed inStock, prices, etc.). It updates just ONE product in
// the catalog blob (never a full resync) and re-embeds it ONLY when the embedded
// text actually changed; an inventory-only change skips OpenAI entirely.
//
// CONCURRENCY / BURSTS: the catalog is one blob, so a webhook burst would race
// read-modify-write. We serialize mutations behind a best-effort Redis lock
// (degrades to no-lock when KV is absent — the daily sync remains the backstop),
// and every mutation is IDEMPOTENT: an unchanged product writes nothing (so
// Shopify's frequent duplicate deliveries are free no-ops). The two blobs are
// always written together as a consistent pair (writeCatalogPair).

import {
  EMBEDDING_DOC_VERSION,
  buildEmbeddingDoc,
  embeddingDocHash,
} from "./embedding-doc.mjs";
import {
  removeEmbeddingItem,
  removeProductFromCatalog,
  shouldReembed,
  upsertEmbeddingItem,
  upsertProductInCatalog,
} from "./catalog-merge.mjs";
import {
  invalidateCache,
  readCatalogForMutation,
  readEmbeddingsBlobDirect,
  writeCatalogPair,
  type EmbeddingsFile,
} from "./catalog-store";
import { mapShopifyProducts } from "./catalog-mapping";
import {
  fetchProductsByIds,
  resolveProductIdForInventoryItem,
} from "./shopify";
import { tryGetRedis } from "./redis";
import { reportError } from "./observability";
import type { Product } from "./types";
import OpenAI from "openai";

const EMBEDDING_MODEL = "text-embedding-3-small";
const LOCK_KEY = "catalog-mutate:lock";
const LOCK_TTL_MS = 30_000;
const LOCK_WAIT_MS = 8_000;
const LOCK_POLL_MS = 250;

export type MutateResult =
  | { ok: true; action: "upserted" | "removed" | "noop"; productId: string | null; reembedded: boolean }
  | { ok: false; reason: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Acquire a best-effort distributed lock so concurrent webhooks don't race the
 * shared catalog blob. Returns a release() fn (a no-op when Redis is absent or
 * the lock couldn't be taken — we proceed anyway; idempotency + the daily sync
 * keep us correct, and dropping the update would be worse than a rare race).
 */
async function acquireLock(): Promise<() => Promise<void>> {
  const redis = tryGetRedis();
  if (!redis) return async () => {};
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const res = await redis.set(LOCK_KEY, token, { nx: true, px: LOCK_TTL_MS });
      if (res === "OK") {
        return async () => {
          try {
            // Only release if we still own it (avoid clearing a successor's lock).
            const cur = await redis.get<string>(LOCK_KEY);
            if (cur === token) await redis.del(LOCK_KEY);
          } catch {
            /* lock will expire via TTL */
          }
        };
      }
    } catch {
      // Redis hiccup — proceed without the lock rather than drop the update.
      return async () => {};
    }
    if (Date.now() >= deadline) return async () => {};
    await sleep(LOCK_POLL_MS);
  }
}

/** Embed a single document; returns the vector or null on any failure (the
 *  product is simply left without a vector → keyword-search fallback). */
async function embedOne(text: string): Promise<number[] | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const client = new OpenAI({ maxRetries: 3 });
    const res = await client.embeddings.create({ model: EMBEDDING_MODEL, input: text });
    return res.data[0]?.embedding ?? null;
  } catch (err) {
    reportError(err, { route: "lib/catalog-mutate", phase: "embedOne" });
    return null;
  }
}

/**
 * Refresh ONE product in the catalog from Shopify (by GID) and persist if it
 * changed. Maps to 0 products ⇒ the product is no longer catalog-eligible
 * (unpublished / archived / no price / no image) ⇒ remove it. Idempotent.
 */
export async function refreshProductInCatalog(productGid: string): Promise<MutateResult> {
  const release = await acquireLock();
  try {
    const fetched = await fetchProductsByIds([productGid]);
    const { products: mapped } = mapShopifyProducts(fetched);
    // The fetched product's catalog id is its handle; if it was filtered out, we
    // still need that id to remove the stale record. Fall back to the raw handle.
    const handle = fetched[0]?.handle ?? null;
    const product: Product | undefined = mapped[0];

    const catalog = await readCatalogForMutation();
    const embFile = await readEmbeddingsBlobDirect();
    const items = embFile?.items ?? [];

    // CASE 1 — product no longer eligible (or gone): remove it + its vector.
    if (!product) {
      if (!handle) return { ok: true, action: "noop", productId: null, reembedded: false };
      const removed = removeProductFromCatalog(catalog, handle);
      if (!removed.changed) return { ok: true, action: "noop", productId: handle, reembedded: false };
      const nextItems = removeEmbeddingItem(items, handle) as EmbeddingsFile["items"];
      await persist(removed.catalog as Product[], embFile, nextItems);
      return { ok: true, action: "removed", productId: handle, reembedded: false };
    }

    // CASE 2 — upsert. No-op when the mapped product is byte-identical (burst).
    const up = upsertProductInCatalog(catalog, product);
    if (!up.changed) return { ok: true, action: "noop", productId: product.id, reembedded: false };

    // Re-embed ONLY when the embedded text changed (stock-only change reuses the
    // stored vector → no OpenAI call).
    const doc = buildEmbeddingDoc(product);
    const docHash = embeddingDocHash(doc);
    const existingItem = items.find((it) => it.id === product.id);
    let reembedded = false;
    let nextItems: EmbeddingsFile["items"] = items;
    if (
      shouldReembed({
        fileDocVersion: embFile?.docVersion,
        currentDocVersion: EMBEDDING_DOC_VERSION,
        existingItem,
        newDocHash: docHash,
      })
    ) {
      const vector = await embedOne(doc);
      if (vector) {
        nextItems = upsertEmbeddingItem(items, { id: product.id, vector, docHash }) as EmbeddingsFile["items"];
        reembedded = true;
      } else if (!existingItem) {
        // Couldn't embed a brand-new product — leave it without a vector
        // (keyword fallback). Existing products keep their old vector.
        nextItems = items;
      }
    }

    await persist(up.catalog as Product[], embFile, nextItems);
    return { ok: true, action: "upserted", productId: product.id, reembedded };
  } catch (err) {
    reportError(err, { route: "lib/catalog-mutate", phase: "refreshProduct" });
    return { ok: false, reason: (err as Error).message };
  } finally {
    await release();
  }
}

/** Resolve an inventory item to its product, then refresh that one product. */
export async function refreshInventoryItemInCatalog(
  inventoryItemGid: string
): Promise<MutateResult> {
  try {
    const productGid = await resolveProductIdForInventoryItem(inventoryItemGid);
    if (!productGid) return { ok: true, action: "noop", productId: null, reembedded: false };
    return await refreshProductInCatalog(productGid);
  } catch (err) {
    reportError(err, { route: "lib/catalog-mutate", phase: "refreshInventoryItem" });
    return { ok: false, reason: (err as Error).message };
  }
}

/** Persist the mutated catalog + embeddings as a consistent pair. */
async function persist(
  catalog: Product[],
  embFile: EmbeddingsFile | null,
  items: EmbeddingsFile["items"]
): Promise<void> {
  const dim = items[0]?.vector.length ?? embFile?.dim ?? 0;
  const nextEmb: EmbeddingsFile = {
    model: embFile?.model ?? EMBEDDING_MODEL,
    dim,
    docVersion: embFile?.docVersion ?? EMBEDDING_DOC_VERSION,
    items,
  };
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    await writeCatalogPair(catalog, nextEmb);
  } else {
    invalidateCache();
  }
}
