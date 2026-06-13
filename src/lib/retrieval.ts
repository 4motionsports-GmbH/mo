import OpenAI from "openai";
import { loadEmbeddings, loadProductCatalog, type EmbeddingsFile } from "./catalog-store";
import { recordAiUsage } from "./ai-usage-store";
import type { CustomerProfile, Product, SearchProductsArgs } from "./types";

let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openaiClient) openaiClient = new OpenAI();
  return openaiClient;
}

interface IndexedEmbeddings {
  index: Map<string, number[]>;
  model: string;
  hasVectors: boolean;
}

let indexedCache: IndexedEmbeddings | null = null;
async function getIndexedEmbeddings(): Promise<IndexedEmbeddings> {
  if (indexedCache) return indexedCache;
  const file: EmbeddingsFile = await loadEmbeddings();
  const index = new Map(file.items.map((it) => [it.id, it.vector]));
  indexedCache = {
    index,
    model: file.model || "text-embedding-3-small",
    hasVectors: index.size > 0,
  };
  return indexedCache;
}

// How much to nudge sold-out products down the ranking. Multiplicative and
// deliberately mild (~15%): a strongly-matching sold-out item can still rank
// above a weak in-stock one, but in-stock wins whenever the fit is comparable.
// This is a ranking nudge, not a hard filter.
const SOLD_OUT_RANK_PENALTY = 0.85;

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function applyHardFilters(
  products: Product[],
  profile: CustomerProfile,
  filters: SearchProductsArgs["filters"]
): Product[] {
  return products.filter((p) => {
    if (filters?.category && p.category !== filters.category) return false;
    if (filters?.maxPriceEUR != null && (p.salePrice ?? p.price) > filters.maxPriceEUR) return false;
    if (filters?.minPriceEUR != null && (p.salePrice ?? p.price) < filters.minPriceEUR) return false;
    if (filters?.maxFootprintM2 != null && typeof p.footprintM2 === "number" && p.footprintM2 > filters.maxFootprintM2) return false;
    if (filters?.requiresMedical && p.medicalCertification?.suitableForRehab !== true) return false;
    if (filters?.requiresQuiet && typeof p.noiseLevelDb === "number" && p.noiseLevelDb > 65) return false;

    if (typeof profile.budgetEUR === "object" && profile.budgetEUR) {
      const price = p.salePrice ?? p.price;
      if (profile.budgetEUR.max != null && price > profile.budgetEUR.max * 1.15) return false;
    }
    if (typeof profile.spaceM2 === "number" && typeof p.footprintM2 === "number" && p.footprintM2 > 0) {
      if (p.footprintM2 > profile.spaceM2 * 1.1) return false;
    }
    if (profile.segment === "physio" && p.medicalCertification?.suitableForRehab === false) {
      return false;
    }
    return true;
  });
}

function keywordScore(product: Product, query: string): number {
  if (!query.trim()) return 0;
  const haystack = [
    product.name,
    product.category,
    product.brand,
    product.shortDescription,
    (product.features || []).join(" "),
    (product.tags || []).join(" "),
    (product.targetGroup || []).join(" "),
  ]
    .join(" ")
    .toLowerCase();
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);
  let score = 0;
  for (const t of terms) {
    if (haystack.includes(t)) score += 1;
  }
  return score / Math.max(terms.length, 1);
}

export async function embedQuery(text: string): Promise<number[] | null> {
  const emb = await getIndexedEmbeddings();
  if (!emb.hasVectors) return null;
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const res = await getOpenAI().embeddings.create({
      model: emb.model,
      input: text,
    });
    // Cost KPI (chat-serving side). OpenAI returns prompt_tokens on the usage
    // field, so this is provider-reported, not estimated. Fire-and-forget: this
    // runs on the chat hot path (before streaming), so we never await the write.
    void recordAiUsage({
      callSite: "embeddings",
      model: emb.model,
      inputTokens: res.usage?.prompt_tokens ?? 0,
      outputTokens: 0,
    });
    return res.data[0].embedding;
  } catch (err) {
    console.error("embedQuery failed", err);
    return null;
  }
}

export interface RetrievalHit {
  product: Product;
  score: number;
}

export async function retrieve(opts: {
  query: string;
  profile: CustomerProfile;
  filters?: SearchProductsArgs["filters"];
  limit?: number;
  queryVector?: number[] | null;
}): Promise<RetrievalHit[]> {
  const limit = opts.limit ?? 8;
  const [catalog, emb] = await Promise.all([loadProductCatalog(), getIndexedEmbeddings()]);
  const candidates = applyHardFilters(catalog, opts.profile, opts.filters);

  let queryVector = opts.queryVector ?? null;
  if (queryVector === undefined) queryVector = null;
  if (emb.hasVectors && queryVector === null && opts.query) {
    queryVector = await embedQuery(opts.query);
  }

  const scored: RetrievalHit[] = candidates.map((product) => {
    let score = 0;
    if (queryVector) {
      const v = emb.index.get(product.id);
      if (v) score = cosine(queryVector, v);
    }
    if (!queryVector || score === 0) {
      score = keywordScore(product, opts.query);
    }
    // Gentle de-prioritisation of sold-out items. We deliberately do NOT filter
    // them out — Mo may still surface a genuinely best-fit item that's
    // currently unavailable — but in-stock options should rank first when
    // comparably suitable. A small multiplicative penalty keeps a clearly
    // superior sold-out match ahead of a much weaker in-stock one, while
    // letting in-stock win ties and near-ties. (Stock is sync-fresh; see
    // docs/CATALOG_SYNC.md.)
    if (product.inStock === false) score *= SOLD_OUT_RANK_PENALTY;
    return { product, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export async function retrieveForTurn(opts: {
  latestUserMessage: string;
  profile: CustomerProfile;
  limit?: number;
}): Promise<RetrievalHit[]> {
  const profileSignals: string[] = [];
  if (opts.profile.trainingFocus !== "unknown") profileSignals.push(opts.profile.trainingFocus);
  if (opts.profile.experienceLevel !== "unknown") profileSignals.push(opts.profile.experienceLevel);
  if (opts.profile.segment === "physio") profileSignals.push("Reha medizinisch");
  if (opts.profile.segment === "studio") profileSignals.push("Studio gewerblich");
  if (opts.profile.noiseSensitive === true) profileSignals.push("leise");
  const query = [opts.latestUserMessage, ...profileSignals].filter(Boolean).join(" ");

  return retrieve({
    query,
    profile: opts.profile,
    limit: opts.limit ?? 8,
  });
}
