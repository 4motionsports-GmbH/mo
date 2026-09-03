// Pure model→price lookup + USD→EUR conversion for the AI-cost KPI.
//
// No I/O, no DB — imported by the usage store (lib/ai-usage-store.ts) AND by its
// unit tests. Kept as a plain .mjs (like email-offer-trigger.mjs) so the
// node:test runner can import it directly.
//
// Prices are USD per MILLION tokens. The DEFAULTS below cover the models we
// actually call (checked against Anthropic + OpenAI list pricing, 2026-06).
// Prices change, so config beats code: override any/all of them at runtime via
// the MODEL_PRICES_JSON env var — a JSON object keyed by model id, e.g.
//   MODEL_PRICES_JSON={"claude-sonnet-4-5-20250929":{"input":3,"output":15}}
// (USD per million tokens). EUR conversion uses USD_EUR_RATE (default 0.92).

/** Default USD→EUR rate when USD_EUR_RATE is unset/invalid. */
export const DEFAULT_USD_EUR_RATE = 0.92;

/**
 * USD per MILLION tokens for the models the backend actually calls. Anthropic
 * (chat / summaries / drafts / profiles) + OpenAI (embeddings). Override via
 * MODEL_PRICES_JSON — see the header.
 */
export const DEFAULT_MODEL_PRICES = {
  // Anthropic — chat, transactional summary, marketing drafts, top-questions.
  "claude-sonnet-4-5-20250929": { input: 3, output: 15 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  // Anthropic — Opus tier (customer-profile regeneration).
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  // Anthropic — Haiku tier (back-office conversation analysis + insights rollup):
  // cheap categorisation + short summaries, not the consultation model.
  "claude-haiku-4-5": { input: 1, output: 5 },
  // OpenAI — query embedding model. Embeddings have no output tokens.
  "text-embedding-3-small": { input: 0.02, output: 0 },
  // OpenAI — hero image generation (lib/email-hero.ts). UNIT NOTE: `input` is
  // the TEXT-input token price, `output` the IMAGE-output token price — the
  // usage store records exactly those two counts from the images API. A
  // 1536×1024 image at quality "high" is ~6.2k output tokens (gpt-image-2:
  // ≈ $0.19; gpt-image-1.5: ≈ $0.20; gpt-image-1: ≈ $0.25), the hero's native
  // 1536×720 proportionally less. List pricing 2026-09; override via
  // MODEL_PRICES_JSON when it moves.
  "gpt-image-2": { input: 5, output: 30 },
  "gpt-image-1.5": { input: 5, output: 32 },
  "gpt-image-1": { input: 5, output: 40 },
  // OpenAI — text-to-speech (voice mode, /api/tts). UNIT NOTE: TTS is billed
  // per CHARACTER of input, so for these models `input` is USD per million
  // CHARACTERS and the usage store records characters synthesized in the
  // input_tokens column (output is 0). Figures are list pricing as of
  // 2026-06 (gpt-4o-mini-tts ≈ $15.9/1M chars; tts-1 $15; tts-1-hd $30) —
  // override via MODEL_PRICES_JSON when they move.
  "gpt-4o-mini-tts": { input: 15.9, output: 0 },
  "tts-1": { input: 15, output: 0 },
  "tts-1-hd": { input: 30, output: 0 },
};

/** Is `v` a finite, non-negative number? */
function isNonNegNumber(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

/**
 * Merge a MODEL_PRICES_JSON string onto a base price table. Malformed JSON or
 * malformed entries are ignored (the base price for that model stands), so a
 * bad override can never zero out a price or throw. Returns a NEW object.
 */
export function parseModelPrices(rawJson, base = DEFAULT_MODEL_PRICES) {
  const merged = { ...base };
  if (!rawJson || typeof rawJson !== "string") return merged;
  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return merged;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return merged;
  for (const [model, price] of Object.entries(parsed)) {
    if (!price || typeof price !== "object") continue;
    const baseEntry = merged[model];
    // A field that is PRESENT but invalid (e.g. negative) rejects the whole
    // entry — that's a config mistake, not an intent to drop the price. A field
    // that is ABSENT inherits the base price (so you can override just `input`).
    let nextInput = baseEntry?.input;
    if (price.input !== undefined) {
      if (!isNonNegNumber(price.input)) continue;
      nextInput = price.input;
    }
    let nextOutput = baseEntry?.output;
    if (price.output !== undefined) {
      if (!isNonNegNumber(price.output)) continue;
      nextOutput = price.output;
    }
    // Both sides must resolve (a brand-new model must supply both).
    if (!isNonNegNumber(nextInput) || !isNonNegNumber(nextOutput)) continue;
    merged[model] = { input: nextInput, output: nextOutput };
  }
  return merged;
}

/** Load the effective price table, applying the MODEL_PRICES_JSON override. */
export function loadModelPrices(env = process.env) {
  return parseModelPrices(env.MODEL_PRICES_JSON, DEFAULT_MODEL_PRICES);
}

/** The configured USD→EUR rate (USD_EUR_RATE), or the default when unset/invalid. */
export function usdEurRate(env = process.env) {
  const raw = env.USD_EUR_RATE;
  const n = raw != null ? Number.parseFloat(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_USD_EUR_RATE;
}

/** The {input, output} USD/MTok price for a model, or null when unknown. */
export function priceForModel(model, prices = DEFAULT_MODEL_PRICES) {
  return prices[model] ?? null;
}

// Anthropic prompt-caching multipliers on the INPUT price (provider-wide, not
// per-model): a cached-prefix READ bills at 0.1× input, a cache WRITE (prefix
// creation, 5-minute TTL) at 1.25× input. Chat requests set cache_control
// breakpoints (see api/chat/route.ts), and the usage store records the
// read/write splits so the cost KPI prices them at their real rates.
export const CACHE_READ_INPUT_MULTIPLIER = 0.1;
export const CACHE_WRITE_INPUT_MULTIPLIER = 1.25;

/**
 * USD cost of one usage record. Returns 0 for an unknown model (no guessing —
 * an untracked model contributes 0 rather than a fabricated number). Negative /
 * non-finite token counts are floored to 0.
 *
 * `inputTokens` is the TOTAL input count (the ai@6 convention — it already
 * includes cached tokens). `cacheReadTokens` / `cacheWriteTokens` are the
 * subsets served from / written to the prompt cache; the uncached remainder
 * bills at the full input price. Records without the cache fields (all rows
 * written before caching existed, and non-caching call sites) price exactly as
 * before.
 */
export function usdCostForUsage(
  { model, inputTokens, outputTokens, cacheReadTokens = 0, cacheWriteTokens = 0 },
  prices = DEFAULT_MODEL_PRICES
) {
  const p = priceForModel(model, prices);
  if (!p) return 0;
  const inTok = isNonNegNumber(inputTokens) ? inputTokens : 0;
  const outTok = isNonNegNumber(outputTokens) ? outputTokens : 0;
  const readTok = isNonNegNumber(cacheReadTokens) ? cacheReadTokens : 0;
  const writeTok = isNonNegNumber(cacheWriteTokens) ? cacheWriteTokens : 0;
  // Guard against inconsistent records (splits exceeding the total): never let
  // the uncached remainder go negative.
  const uncachedTok = Math.max(0, inTok - readTok - writeTok);
  const inputUsd =
    (uncachedTok +
      readTok * CACHE_READ_INPUT_MULTIPLIER +
      writeTok * CACHE_WRITE_INPUT_MULTIPLIER) *
    p.input;
  return (inputUsd + outTok * p.output) / 1_000_000;
}

/**
 * NET USD saved by prompt caching for one usage record, versus the same call
 * with no cache: every cache-read token would have billed at the full input
 * price (saving 1 − 0.1 = 0.9× each), while every cache-write token cost a
 * 1.25 − 1 = 0.25× premium. Can be NEGATIVE for a pathological write-heavy /
 * read-light pattern — that is the honest answer, not an error. Returns 0 for
 * an unknown model or a record without cache fields.
 */
export function usdCacheSavingsForUsage(
  { model, cacheReadTokens = 0, cacheWriteTokens = 0 },
  prices = DEFAULT_MODEL_PRICES
) {
  const p = priceForModel(model, prices);
  if (!p) return 0;
  const readTok = isNonNegNumber(cacheReadTokens) ? cacheReadTokens : 0;
  const writeTok = isNonNegNumber(cacheWriteTokens) ? cacheWriteTokens : 0;
  const savedUsd =
    (readTok * (1 - CACHE_READ_INPUT_MULTIPLIER) -
      writeTok * (CACHE_WRITE_INPUT_MULTIPLIER - 1)) *
    p.input;
  return savedUsd / 1_000_000;
}

/** Convert USD to EUR at the given rate (default 0.92). */
export function usdToEur(usd, rate = DEFAULT_USD_EUR_RATE) {
  return usd * rate;
}

/** Convenience: EUR cost of one usage record, in one call. */
export function eurCostForUsage(usage, prices = DEFAULT_MODEL_PRICES, rate = DEFAULT_USD_EUR_RATE) {
  return usdToEur(usdCostForUsage(usage, prices), rate);
}
