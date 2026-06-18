// Scheduled catalog refresh.
//
// Triggered by Vercel Cron (see vercel.json). Pulls the live product catalog
// from the Shopify Admin API, regenerates embeddings with OpenAI, and writes
// both files to Vercel Blob under stable keys so /api/chat can pick up the
// new data on the next warm invocation without a redeploy.
//
// RELIABILITY (see docs/CATALOG_SYNC_DIAGNOSIS.md). Two structural fixes here:
//   A) RESILIENT embeddings — embedDocsResilient wraps every chunk, retries a
//      failed chunk as smaller sub-batches / per item, and carries forward an
//      item's previous vector (or skips it) instead of throwing. One bad item or
//      chunk can no longer 503 the whole run. The route returns 200 with a
//      synced/carriedForward/skipped summary on PARTIAL success; a 5xx is now
//      reserved for TOTAL failure (e.g. insufficient_quota / billing — flagged
//      distinctly so it's recognised as a billing fix, not a code bug).
//   B) ATOMIC write — embeddings are generated IN FULL before EITHER blob is
//      written; then both are written together (writeCatalogPair, embeddings
//      first). A mid-run failure can no longer leave a fresh catalog paired with
//      stale embeddings.
//
// Protected by CRON_SECRET — Vercel Cron sends Authorization: Bearer <secret>.
// Manual invocation: curl -H "Authorization: Bearer $CRON_SECRET" $URL

import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  CATALOG_BLOB_KEY,
  EMBEDDINGS_BLOB_KEY,
  invalidateCache,
  readEmbeddingsBlobDirect,
  writeCatalogPair,
  writeCatalogToBlob,
  type EmbeddingsFile,
} from "@/lib/catalog-store";
import { mapShopifyProducts } from "@/lib/catalog-mapping";
import { buildEmbeddingDoc, embeddingDocHash, EMBEDDING_DOC_VERSION } from "@/lib/embedding-doc.mjs";
import { embedDocsResilient } from "@/lib/embed-resilience.mjs";
import { classifyOpenAiError } from "@/lib/openai-error.mjs";
import { fetchAllProducts } from "@/lib/shopify";
import { reportError } from "@/lib/observability";
import { requireCronAuth } from "@/lib/cron-auth";
import type { Product } from "@/lib/types";

// Vercel hobby plan caps cron functions at 60s; pro at 300s. Bumping to 300
// because the embedding step is the bottleneck (~10 chunks * ~1s each).
export const maxDuration = 300;

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_CHUNK = 100;
// Hardening (Part A): an explicit SDK retry budget (429/5xx back-off) plus a
// small delay between chunks so we stay polite to the TPM/RPM limits.
const OPENAI_MAX_RETRIES = 4;
const INTER_CHUNK_DELAY_MS = 250;

interface EmbedSummary {
  synced: number;
  carriedForward: number;
  skipped: number;
  failedIds: string[];
  chunkErrors: number;
  fatal: boolean;
  quota: boolean;
  errorClass?: string;
}

async function embedAll(
  products: Product[]
): Promise<{ file: EmbeddingsFile; summary: EmbedSummary }> {
  // Explicit retry budget: the SDK retries 429/5xx with back-off before it ever
  // throws into our resilient loop.
  const client = new OpenAI({ maxRetries: OPENAI_MAX_RETRIES });

  const docs = products.map((p) => {
    const text = buildEmbeddingDoc(p);
    return { id: p.id, text, docHash: embeddingDocHash(text) };
  });

  // Previous vectors for the carry-forward fallback. Read directly (authoritative
  // current blob), indexed by id. A docVersion mismatch (e.g. after this doc
  // change) means none are carried forward — everything is re-embedded (Part D).
  const prevFile = await readEmbeddingsBlobDirect();
  const previous = prevFile
    ? {
        docVersion: prevFile.docVersion,
        byId: new Map(prevFile.items.map((it) => [it.id, { vector: it.vector, docHash: it.docHash }])),
      }
    : null;

  let quota = false;
  let errorClass: string | undefined;

  const embed = async (texts: string[]): Promise<number[][]> => {
    const res = await client.embeddings.create({ model: EMBEDDING_MODEL, input: texts });
    return res.data.map((d) => d.embedding);
  };

  const noteError = (err: unknown, where: "fatal" | "chunk-error", size?: number) => {
    const c = classifyOpenAiError(err);
    errorClass = c.label;
    if (c.quota) {
      quota = true;
      // DISTINCT, unmistakable log: this is a BILLING fix on the OpenAI account
      // (likely a freshly-created account with no credits), NOT a code bug.
      console.error(
        `[cron/sync-catalog] OpenAI embeddings BILLING/QUOTA error (${c.label}) — ` +
          `the OpenAI account is out of credits or billing is unconfigured. ` +
          `This is a BILLING fix, not a code bug. Check platform.openai.com billing.`,
        c.message
      );
    } else {
      console.warn(
        `[cron/sync-catalog] embeddings ${where} (size=${size ?? "?"}, class=${c.label})`,
        c.message
      );
    }
  };

  const result = await embedDocsResilient({
    docs,
    embed,
    docVersion: EMBEDDING_DOC_VERSION,
    previous,
    chunkSize: EMBEDDING_CHUNK,
    interChunkDelayMs: INTER_CHUNK_DELAY_MS,
    isFatal: (err) => classifyOpenAiError(err).fatal,
    onEvent: (e) => {
      if (e.type === "fatal") noteError(e.error, "fatal", e.size as number);
      else if (e.type === "chunk-error") noteError(e.error, "chunk-error", e.size as number);
    },
  });

  const dim = result.items[0]?.vector.length ?? prevFile?.dim ?? 0;
  const file: EmbeddingsFile = {
    model: EMBEDDING_MODEL,
    dim,
    docVersion: EMBEDDING_DOC_VERSION,
    items: result.items,
  };
  return {
    file,
    summary: {
      synced: result.synced,
      carriedForward: result.carriedForward,
      skipped: result.skipped,
      failedIds: result.failedIds,
      chunkErrors: result.chunkErrors,
      fatal: result.fatal,
      quota,
      errorClass,
    },
  };
}

async function fallbackFromBundle(): Promise<Product[]> {
  // If Shopify auth is blocked, ship the committed CSV-derived JSON so the
  // build keeps working. We still regenerate embeddings into Blob.
  const mod = await import("@/data/product-catalog.json");
  return mod.default as unknown as Product[];
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

  const startedAt = Date.now();
  const log: Record<string, unknown> = {};

  try {
    // 1. Source the products (Shopify → fallback bundle). Self-heals to the
    //    bundled JSON on any Shopify error (mode:"fallback-bundle", HTTP 200).
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

    const blobConfigured = !!process.env.BLOB_READ_WRITE_TOKEN;
    const openaiConfigured = !!process.env.OPENAI_API_KEY;

    // 2. No OpenAI key ⇒ can't embed. Update only the catalog blob (a deliberate
    //    config state, not a failure; production always has a key). The existing
    //    embeddings/keyword fallback keeps retrieval working.
    if (!openaiConfigured) {
      log.embeddingsSkipped = "OPENAI_API_KEY not set";
      let catalogUrl: string | null = null;
      if (blobConfigured) {
        catalogUrl = await writeCatalogToBlob(products);
        invalidateCache();
      }
      return summaryResponse({ ok: true, mode, products, catalogUrl, embeddingsUrl: null, file: null, startedAt, log });
    }

    // 3. Generate embeddings IN FULL before writing ANY blob (atomicity, Part B).
    const { file, summary } = await embedAll(products);
    log.embeddings = summary;

    // 4. TOTAL failure: no fresh vectors AND nothing carried forward (e.g.
    //    insufficient_quota). Do NOT overwrite the last-good pair with an empty
    //    one — preserve it and return 5xx so the (likely billing) cause is fixed.
    if (summary.synced === 0 && summary.carriedForward === 0) {
      const msg = summary.quota
        ? "OpenAI embeddings failed: insufficient_quota / billing — the OpenAI account is out of credits. This is a BILLING fix, not a code bug."
        : `OpenAI embeddings failed entirely (class=${summary.errorClass ?? "unknown"}).`;
      reportError(new Error(msg), {
        route: "api/cron/sync-catalog",
        phase: "embedAll",
        quota: summary.quota,
        errorClass: summary.errorClass,
      });
      return NextResponse.json(
        { ok: false, mode, error: msg, embeddings: summary, elapsedMs: Date.now() - startedAt, ...log },
        { status: 503 }
      );
    }

    // 5. Write BOTH blobs as a consistent pair (embeddings first, then catalog).
    //    A put() throwing escapes to the outer catch → 503 (and, crucially,
    //    leaves the OTHER blob untouched since embeddings is written first).
    let catalogUrl: string | null = null;
    let embeddingsUrl: string | null = null;
    if (blobConfigured) {
      const written = await writeCatalogPair(products, file);
      catalogUrl = written.catalogUrl;
      embeddingsUrl = written.embeddingsUrl;
    } else {
      log.blobSkipped = "BLOB_READ_WRITE_TOKEN not set";
    }

    return summaryResponse({ ok: true, mode, products, catalogUrl, embeddingsUrl, file, startedAt, log });
  } catch (err) {
    // A real failure (a Blob write throwing, an unexpected error) is reported to
    // Sentry and surfaced as a 503 envelope. With the atomic write above, a
    // failure here cannot have left a fresh catalog with stale embeddings.
    reportError(err, { route: "api/cron/sync-catalog" });
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 503 });
  }
}

function summaryResponse(args: {
  ok: true;
  mode: "shopify" | "fallback-bundle";
  products: Product[];
  catalogUrl: string | null;
  embeddingsUrl: string | null;
  file: EmbeddingsFile | null;
  startedAt: number;
  log: Record<string, unknown>;
}): Response {
  const { mode, products, catalogUrl, embeddingsUrl, file, startedAt, log } = args;
  const summary = (log.embeddings as EmbedSummary | undefined) ?? null;
  const payload = {
    ok: true,
    // partial when some products were skipped (no vector) but the run still
    // produced a usable, consistent pair.
    partial: (summary?.skipped ?? 0) > 0,
    mode,
    productCount: products.length,
    embeddingsCount: file?.items.length ?? 0,
    synced: summary?.synced ?? 0,
    carriedForward: summary?.carriedForward ?? 0,
    skipped: summary?.skipped ?? 0,
    docVersion: file?.docVersion ?? EMBEDDING_DOC_VERSION,
    catalogBlobKey: CATALOG_BLOB_KEY,
    catalogBlobUrl: catalogUrl,
    embeddingsBlobKey: EMBEDDINGS_BLOB_KEY,
    embeddingsBlobUrl: embeddingsUrl,
    elapsedMs: Date.now() - startedAt,
    ...log,
  };
  console.log("[cron/sync-catalog] done", payload);
  return NextResponse.json(payload);
}
