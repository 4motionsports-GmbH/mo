// Scheduled catalog refresh.
//
// Triggered by Vercel Cron (see vercel.json). Pulls the live product catalog
// from the Shopify Admin API, regenerates embeddings with OpenAI, and writes
// both files to Vercel Blob under stable keys so /api/chat can pick up the
// new data on the next warm invocation without a redeploy.
//
// Protected by CRON_SECRET — Vercel Cron sends Authorization: Bearer <secret>.
// Manual invocation: curl -H "Authorization: Bearer $CRON_SECRET" $URL

import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  CATALOG_BLOB_KEY,
  EMBEDDINGS_BLOB_KEY,
  invalidateCache,
  writeCatalogToBlob,
  writeEmbeddingsToBlob,
  type EmbeddingsFile,
} from "@/lib/catalog-store";
import { buildEmbeddingDoc, mapShopifyProducts } from "@/lib/catalog-mapping";
import { fetchAllProducts } from "@/lib/shopify";
import { reportError } from "@/lib/observability";
import { requireCronAuth } from "@/lib/cron-auth";
import type { Product } from "@/lib/types";

// Vercel hobby plan caps cron functions at 60s; pro at 300s. Bumping to 300
// because the embedding step is the bottleneck (~10 chunks * ~1s each).
export const maxDuration = 300;

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_CHUNK = 100;

async function embedAll(products: Product[]): Promise<EmbeddingsFile> {
  const client = new OpenAI();
  const items: EmbeddingsFile["items"] = [];
  for (let i = 0; i < products.length; i += EMBEDDING_CHUNK) {
    const slice = products.slice(i, i + EMBEDDING_CHUNK);
    const inputs = slice.map((p) => buildEmbeddingDoc(p));
    const res = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: inputs,
    });
    res.data.forEach((d, idx) => {
      items.push({ id: slice[idx].id, vector: d.embedding });
    });
  }
  const dim = items[0]?.vector.length ?? 0;
  return { model: EMBEDDING_MODEL, dim, items };
}

async function fallbackFromBundle(): Promise<Product[]> {
  // If Shopify auth is blocked, ship the committed CSV-derived JSON so the
  // build keeps working. We still regenerate embeddings into Blob.
  const mod = await import("@/data/product-catalog.json");
  return (mod.default as unknown) as Product[];
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  // Vercel Cron uses GET by default — accept both.
  return handle(req);
}

async function handle(req: Request): Promise<Response> {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  try {
    const startedAt = Date.now();
    const log: Record<string, unknown> = {};

    let products: Product[];
    let mode: "shopify" | "fallback-bundle" = "shopify";

    try {
      const raw = await fetchAllProducts();
      const { products: mapped, stats } = mapShopifyProducts(raw);
      log.shopifyRawCount = raw.length;
      log.filterStats = stats;
      if (mapped.length === 0) {
        throw new Error("Shopify returned no products after filtering");
      }
      products = mapped;
    } catch (err) {
      mode = "fallback-bundle";
      log.shopifyError = (err as Error).message;
      console.error("[cron/sync-catalog] Shopify fetch failed, falling back to bundled JSON", err);
      products = await fallbackFromBundle();
    }

    const catalogUrl = process.env.BLOB_READ_WRITE_TOKEN
      ? await writeCatalogToBlob(products)
      : null;

    let embeddingsUrl: string | null = null;
    let embeddingsCount = 0;
    if (process.env.OPENAI_API_KEY) {
      const file = await embedAll(products);
      embeddingsCount = file.items.length;
      if (process.env.BLOB_READ_WRITE_TOKEN) {
        embeddingsUrl = await writeEmbeddingsToBlob(file);
      }
    } else {
      log.embeddingsSkipped = "OPENAI_API_KEY not set";
    }

    invalidateCache();

    const elapsedMs = Date.now() - startedAt;
    const payload = {
      ok: true,
      mode,
      productCount: products.length,
      embeddingsCount,
      catalogBlobKey: CATALOG_BLOB_KEY,
      catalogBlobUrl: catalogUrl,
      embeddingsBlobKey: EMBEDDINGS_BLOB_KEY,
      embeddingsBlobUrl: embeddingsUrl,
      elapsedMs,
      ...log,
    };
    console.log("[cron/sync-catalog] done", payload);
    return NextResponse.json(payload);
  } catch (err) {
    // Match the other three crons: a real failure (e.g. the OpenAI embeddings
    // call or a Blob write throwing) is reported to Sentry and surfaced as a
    // 503 envelope, rather than escaping as an unhandled 500 with no capture.
    // The Shopify-fetch fallback above still degrades to the bundled catalog.
    reportError(err, { route: "api/cron/sync-catalog" });
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 503 });
  }
}
