// Pure helpers for the admin conversation inspector ("Gespräche"). No I/O, no DB,
// no model — imported by the data layer (admin-conversations.ts), the AI passes
// (conversation-analysis.ts / conversation-insights.ts) AND the node:test suite,
// so it stays a plain .mjs (like ai-pricing.mjs / kpi-range.mjs).
//
// It owns: the tier classifier, the readable-turn predicate (the SAME rule the
// session/account transcript views use — tool-bookkeeping rows dropped), the
// defensive parser for the model's JSON analysis, the regenerate-or-cache
// decision, the bulk cost estimate, and the rollup-prompt builder (which proves
// the insights pass is fed CACHED SUMMARIES, never raw transcripts).

import { usdCostForUsage } from "./ai-pricing.mjs";

// ── Tier ────────────────────────────────────────────────────────────────────
// The three identity tiers, derived WITHOUT exposing who the person is — the
// inspector only ever shows the label, never an email/identity (guardrail).

/** German display labels for the tier badge. */
export const TIER_LABELS = {
  anonymous: "Anonym",
  "email-only": "E-Mail",
  "signed-in": "Angemeldet",
};

/**
 * Classify a conversation's tier from two booleans the DB derives:
 *   - signedIn:   a Shopify-linked customer (shopify_customer_id present)
 *   - identified: a customer row is attached (email captured or signed-in)
 * Signed-in wins over email; neither ⇒ anonymous. No identity value is involved.
 */
export function classifyTier({ signedIn, identified }) {
  if (signedIn) return "signed-in";
  if (identified) return "email-only";
  return "anonymous";
}

/** The valid tier filter values (plus null = no filter). */
export const TIERS = ["anonymous", "email-only", "signed-in"];

// ── Readable turns ────────────────────────────────────────────────────────────
// EXACTLY the filter used by the session/account transcript views (see
// lib/summary-email.readableTurns + the SQL form in lib/account-export /
// migration 0026): keep human/bot text turns, drop tool-bookkeeping rows
// (tool_name set), system/tool rows, and empty content.

/** True for a human-readable turn (drop tool/bookkeeping/empty rows). */
export function isReadableTurn(m) {
  return (
    m != null &&
    (m.toolName === null || m.toolName === undefined) &&
    (m.role === "user" || m.role === "assistant") &&
    typeof m.content === "string" &&
    m.content.trim().length > 0
  );
}

// ── Categories & quality ──────────────────────────────────────────────────────
// Bounded vocabularies so the back-office UI can render stable badges and the
// rollup can tally a distribution. The model is asked to pick from these; the
// parser coerces anything off-list to the safe fallback.

/** Allowed primary categories (the model picks one). */
export const ANALYSIS_CATEGORIES = [
  "product-advice",
  "refund/return",
  "sizing",
  "price/discount",
  "technical-question",
  "complaint",
  "off-topic",
  "other",
];

/** German display labels for categories. */
export const CATEGORY_LABELS = {
  "product-advice": "Produktberatung",
  "refund/return": "Rückgabe/Erstattung",
  sizing: "Größe & Maße",
  "price/discount": "Preis/Rabatt",
  "technical-question": "Technische Frage",
  complaint: "Beschwerde",
  "off-topic": "Off-Topic",
  other: "Sonstiges",
};

/** Allowed quality signals (the model picks one). */
export const ANALYSIS_QUALITIES = [
  "handled_well",
  "satisfied",
  "unmet_need",
  "dropped_off",
  "unclear",
];

/** German display labels for the quality signal. */
export const QUALITY_LABELS = {
  handled_well: "Gut gelöst",
  satisfied: "Zufrieden",
  unmet_need: "Offener Bedarf",
  dropped_off: "Abgesprungen",
  unclear: "Unklar",
};

/** Which quality labels indicate a problem (for the UI tone). */
export const QUALITY_IS_NEGATIVE = {
  handled_well: false,
  satisfied: false,
  unmet_need: true,
  dropped_off: true,
  unclear: false,
};

function coerceCategory(v) {
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (ANALYSIS_CATEGORIES.includes(t)) return t;
  }
  return "other";
}

function coerceQuality(v) {
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (ANALYSIS_QUALITIES.includes(t)) return t;
  }
  return "unclear";
}

function coerceTags(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const raw of v) {
    if (typeof raw !== "string") continue;
    const t = raw.trim().slice(0, 40);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= 6) break;
  }
  return out;
}

/**
 * Defensively parse the model's analysis JSON. Tolerates ```json fences and
 * leading/trailing prose by extracting the first {...} block. Returns the
 * coerced shape, or null when no JSON object can be recovered (the caller treats
 * that as a model error rather than caching garbage).
 */
export function parseAnalysisResponse(text) {
  if (typeof text !== "string") return null;
  let body = text.trim();
  // Strip a leading ```json / ``` fence and trailing ``` if present.
  body = body.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  let obj;
  try {
    obj = JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const summary =
    typeof obj.summary === "string" ? obj.summary.trim().slice(0, 1200) : "";
  return {
    summary,
    category: coerceCategory(obj.category),
    tags: coerceTags(obj.tags),
    quality: coerceQuality(obj.quality),
  };
}

// ── Cache decision ────────────────────────────────────────────────────────────

/**
 * Whether the analysis pass should (re)run. Re-opening a conversation that is
 * already analysed costs ZERO tokens (returns the cache); regenerating is the
 * deliberate "force" path (the "Neu analysieren" button).
 */
export function shouldRegenerate({ hasCached, force }) {
  return force === true || !hasCached;
}

// ── Cost estimate (bulk) ──────────────────────────────────────────────────────
// A typical analysis is a short readable transcript in + a short JSON out. These
// rough per-conversation token figures power the bulk-action "ca. €X" estimate
// shown BEFORE the operator confirms (the real cost is recorded per run).

export const PER_ANALYSIS_INPUT_TOKENS_EST = 3000;
export const PER_ANALYSIS_OUTPUT_TOKENS_EST = 250;

/** Estimated USD cost of analysing `count` conversations with `model`. */
export function estimateAnalysisCostUsd(count, prices, model = "claude-haiku-4-5") {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  if (n === 0) return 0;
  return usdCostForUsage(
    {
      model,
      inputTokens: n * PER_ANALYSIS_INPUT_TOKENS_EST,
      outputTokens: n * PER_ANALYSIS_OUTPUT_TOKENS_EST,
    },
    prices
  );
}

// ── Rollup (insights) ─────────────────────────────────────────────────────────
// The aggregate insights pass summarises SUMMARIES, not transcripts. These
// helpers operate purely on the cached per-conversation analysis fields, which is
// exactly why the rollup is cheap and scales.

/** Tally a category distribution from cached analyses, most common first. */
export function tallyCategories(analyses) {
  const counts = new Map();
  for (const a of analyses ?? []) {
    const c = coerceCategory(a?.category);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({
      category,
      label: CATEGORY_LABELS[category] ?? category,
      count,
    }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}

/** Tally a quality distribution from cached analyses, most common first. */
export function tallyQualities(analyses) {
  const counts = new Map();
  for (const a of analyses ?? []) {
    const q = coerceQuality(a?.quality);
    counts.set(q, (counts.get(q) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([quality, count]) => ({
      quality,
      label: QUALITY_LABELS[quality] ?? quality,
      count,
    }))
    .sort((a, b) => b.count - a.count || a.quality.localeCompare(b.quality));
}

/**
 * Build the rollup prompt body from CACHED per-conversation analyses. Reads only
 * summary/category/quality/tags — never a transcript — so the insights pass is
 * cheap and bounded by the number of conversations, not their length.
 */
export function buildRollupPrompt(analyses) {
  const rows = (analyses ?? []).filter(
    (a) => a && typeof a.summary === "string" && a.summary.trim()
  );
  const lines = rows.map((a, i) => {
    const cat = CATEGORY_LABELS[coerceCategory(a.category)] ?? a.category;
    const qual = QUALITY_LABELS[coerceQuality(a.quality)] ?? a.quality;
    const tags = coerceTags(a.tags);
    const tagStr = tags.length ? ` · Tags: ${tags.join(", ")}` : "";
    return `${i + 1}. [${cat} · ${qual}${tagStr}] ${a.summary.trim()}`;
  });
  return lines.join("\n");
}
