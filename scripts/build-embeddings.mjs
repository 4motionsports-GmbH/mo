#!/usr/bin/env node
// Build product embeddings using OpenAI text-embedding-3-small.
// Run: OPENAI_API_KEY=... node scripts/build-embeddings.mjs
//
// Output: src/data/product-embeddings.json
//   { model: string, dim: number, items: [{ id, vector: number[] }] }
//
// Re-run whenever product-catalog.json changes. Safe to run repeatedly:
// it overwrites the existing file. For 1000 products this costs ~$0.001
// total against text-embedding-3-small.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
// One source of truth for the embedded text — shared with the runtime mapper and
// the cron sync, so the offline-built bundle and a live sync embed identical docs.
import {
  buildEmbeddingDoc,
  embeddingDocHash,
  EMBEDDING_DOC_VERSION,
} from "../src/lib/embedding-doc.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CATALOG = path.join(ROOT, "src/data/product-catalog.json");
const OUT = path.join(ROOT, "src/data/product-embeddings.json");
const MODEL = "text-embedding-3-small";

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY not set");
    process.exit(1);
  }

  const catalog = JSON.parse(await fs.readFile(CATALOG, "utf8"));
  console.log(`Embedding ${catalog.length} products with ${MODEL} (doc v${EMBEDDING_DOC_VERSION})…`);

  const client = new OpenAI();
  const docs = catalog.map((p) => buildEmbeddingDoc(p));

  // Batch in chunks of 100 — OpenAI handles up to 2048 inputs per request,
  // 100 keeps memory/error blast radius small.
  const items = [];
  const CHUNK = 100;
  for (let i = 0; i < catalog.length; i += CHUNK) {
    const slice = docs.slice(i, i + CHUNK);
    const ids = catalog.slice(i, i + CHUNK).map((p) => p.id);
    const res = await client.embeddings.create({ model: MODEL, input: slice });
    res.data.forEach((d, idx) => {
      // docHash + docVersion let the runtime tell whether a stored vector still
      // matches the current embedded text (see embed-resilience.mjs).
      items.push({ id: ids[idx], vector: d.embedding, docHash: embeddingDocHash(slice[idx]) });
    });
    console.log(`  ${Math.min(i + CHUNK, catalog.length)}/${catalog.length}`);
  }

  const dim = items[0].vector.length;
  const out = { model: MODEL, dim, docVersion: EMBEDDING_DOC_VERSION, items };
  await fs.writeFile(OUT, JSON.stringify(out));
  console.log(`Wrote ${items.length} vectors (dim=${dim}) → ${path.relative(ROOT, OUT)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
