// The one place that decides which Claude model — and how much thinking — each
// AI call site uses. Pure (no I/O) so node:test covers it; every Anthropic call
// in src/lib and src/app/api takes its model id and provider options from here,
// so a model change is a one-line edit and the cost KPI (lib/ai-pricing.mjs)
// prices against the same ids.
//
// Tiers (2026-09 evaluation, docs/AI_MODELS.md):
//   chat    — the storefront chat (latency-sensitive, agentic tool loop):
//             Sonnet 5.5 with `between_tools` — no up-front thinking, so the
//             first token is as fast as before; effort `high` (the highest
//             `between_tools` accepts) for more thorough tool use and answers.
//   writer  — operator-reviewed text: marketing / campaign drafts, hero prompt,
//             bundle suggestion, summary e-mail, Q&A answer drafts. Sonnet 5.5,
//             adaptive thinking at `low` (thinks only when the task needs it).
//   analyst — judgement over a lot of material: Wissens-Pässe,
//             insights, persona questions, customer synthesis, the hero image
//             check (vision). Sonnet 5.5, adaptive thinking at `medium`.
//   deep    — the per-customer "current understanding" (identity-level, few
//             calls, highest stakes). Opus 5.5 (always thinks) at `medium`.
//   strategist — the operator's business decisions: the Komplettanalyse
//             synthesis and the Verbesserung suggestions (rare, operator-run,
//             a lot of material, decisions with money attached). Opus 5.5 at
//             effort `high` (owner, 2026-10-06: "the best suitable model").
//   bulk    — high-volume, per-item analysis and translation: Haiku 4.5
//             without thinking — the cheapest model that does these well.
//
// Every tier on a 5.x model opts into Anthropic's server-side refusal fallback
// (`fallbacks: "default"`): a false-positive safety decline is re-run on the
// fallback model inside the same call instead of failing the turn.

export const SONNET_MODEL = "claude-sonnet-5-5";
export const OPUS_MODEL = "claude-opus-5-5";
export const HAIKU_MODEL = "claude-haiku-4-5";

/** @typedef {"chat" | "writer" | "analyst" | "deep" | "strategist" | "bulk"} AiTier */

/**
 * @type {Record<AiTier, { model: string, thinking?: "adaptive" | "between_tools", effort?: "low" | "medium" | "high", thinkingHeadroom: number }>}
 */
export const AI_TIERS = {
  chat: { model: SONNET_MODEL, thinking: "between_tools", effort: "high", thinkingHeadroom: 0 },
  writer: { model: SONNET_MODEL, thinking: "adaptive", effort: "low", thinkingHeadroom: 4000 },
  analyst: { model: SONNET_MODEL, thinking: "adaptive", effort: "medium", thinkingHeadroom: 8000 },
  deep: { model: OPUS_MODEL, thinking: "adaptive", effort: "medium", thinkingHeadroom: 8000 },
  strategist: { model: OPUS_MODEL, thinking: "adaptive", effort: "high", thinkingHeadroom: 16000 },
  bulk: { model: HAIKU_MODEL, thinkingHeadroom: 0 },
};

/** The model id of a tier. @param {AiTier} tier */
export function modelFor(tier) {
  return AI_TIERS[tier].model;
}

/**
 * The `providerOptions` for a generateText / generateObject / streamText call
 * of a tier: thinking mode, effort and the refusal fallback. `{}` for tiers
 * that run the model with its defaults (Haiku, no thinking).
 * @param {AiTier} tier
 * @returns {Record<string, Record<string, any>>} (JSON-serialisable, as providerOptions requires)
 */
export function anthropicOptionsFor(tier) {
  const t = AI_TIERS[tier];
  /** @type {Record<string, any>} */
  const anthropic = {};
  if (t.thinking) anthropic.thinking = { type: t.thinking };
  if (t.effort) anthropic.effort = t.effort;
  if (t.thinking) anthropic.fallbacks = "default";
  return Object.keys(anthropic).length > 0 ? { anthropic } : {};
}

/**
 * The output-token cap for a call: the answer's own budget plus room for the
 * tier's thinking. Thinking counts toward max_tokens, so a cap sized for the
 * answer alone would truncate it on a thinking model.
 * @param {AiTier} tier
 * @param {number} answerTokens
 */
export function maxOutputTokensFor(tier, answerTokens) {
  return answerTokens + AI_TIERS[tier].thinkingHeadroom;
}
