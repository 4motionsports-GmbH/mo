// The structured-output schemas of the operator's AI assistants and the one
// rule they must keep: Anthropic's limits for structured outputs. Pure (zod
// only) so node:test checks the limits (ai-assist-schemas.test.mjs).
//
// @ai-sdk/anthropic sends a generateObject schema as native structured output
// (`output_config.format`, constrained decoding). Anthropic compiles that
// schema into a grammar and REJECTS the request (HTTP 400) when it exceeds
// (docs: build-with-claude/structured-outputs, „Explicit complexity limits“):
//   * 16 parameters with union types — every `anyOf` or type array, and every
//     zod `.nullable()` is one (`anyOf: [T, null]`);
//   * 24 optional parameters (not listed in `required`).
// A schema over a limit fails EVERY call, before the model runs. So these
// schemas use no nullable fields: an unset value is "" (strings), [] (lists),
// 0 or -1 (numbers) or "" in an enum — the normalisers downstream already read
// those as „not set“.
//
// The template assistant's flat schema (TEMPLATE_ASSIST_SCHEMA, 10.11.2026)
// is gone: the „KI-Gestalter“ (mail-template-designer.mjs, 11.11.2026) hands
// its document in as the input of a NON-strict tool (submit_design) — tool
// input is not compiled into a grammar, so these limits do not apply there
// and nested sections / columns need no flattening.

import { z } from "zod";

/** Anthropic's documented per-request limits for structured outputs. */
export const STRUCTURED_OUTPUT_LIMITS = Object.freeze({ unionParams: 16, optionalParams: 24 });

/**
 * Count what the limits count: properties whose schema is a union (anyOf /
 * oneOf / type array) and properties that are not required — over the whole
 * schema, nested objects and array items included.
 * @param {import("zod").ZodType} schema
 * @returns {{ unionParams: number, optionalParams: number }}
 */
export function structuredOutputCounts(schema) {
  const json = z.toJSONSchema(schema);
  let unionParams = 0;
  let optionalParams = 0;
  /** @param {any} node */
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.properties && typeof node.properties === "object") {
      const required = new Set(Array.isArray(node.required) ? node.required : []);
      for (const [key, prop] of Object.entries(node.properties)) {
        const p = /** @type {any} */ (prop);
        if (!required.has(key)) optionalParams++;
        if (Array.isArray(p?.anyOf) || Array.isArray(p?.oneOf) || Array.isArray(p?.type)) unionParams++;
        walk(p);
      }
    }
    for (const key of ["anyOf", "oneOf", "allOf"]) if (Array.isArray(node[key])) node[key].forEach(walk);
    if (node.items) (Array.isArray(node.items) ? node.items : [node.items]).forEach(walk);
  };
  walk(json);
  return { unionParams, optionalParams };
}

/** @param {import("zod").ZodType} schema */
export function fitsStructuredOutput(schema) {
  const c = structuredOutputCounts(schema);
  return c.unionParams <= STRUCTURED_OUTPUT_LIMITS.unionParams && c.optionalParams <= STRUCTURED_OUTPUT_LIMITS.optionalParams;
}

// ── „Filter setzen“ in the campaign editor (campaign-assist.ts) ──────────────

const str = z.string();
/** A range filter: -1 = open end (audience-spec cleanRange drops negatives). */
const range = z.object({ min: z.number(), max: z.number() });

/**
 * The audience filters, all required and plain: [] = not set, -1 = open
 * range end, 0 days = not set, "" = no Mo filter — exactly what
 * normalizeAudienceSpec (audience-spec.mjs) reads as „not set“.
 */
export const AUDIENCE_ASSIST_SCHEMA = z.object({
  optInLevels: z.array(str),
  lifecycle: z.array(str),
  valueTier: z.array(str),
  churn: z.array(str),
  lastOrderDays: range,
  ordersCount: range,
  totalSpentEur: range,
  boughtAny: z.array(str),
  boughtNone: z.array(str),
  categories: z.array(str),
  persona: z.array(str),
  moContact: z.enum(["", "yes", "no"]),
  language: z.array(str),
  country: z.array(str),
  clickedWithinDays: z.number(),
  excludeMailedWithinDays: z.number(),
  explanation: str,
});
