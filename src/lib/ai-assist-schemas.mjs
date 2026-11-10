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

import { z } from "zod";
import { MAIL_BLOCK_TYPES } from "./mail-template-doc.mjs";

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

// ── „Mit KI gestalten“ (mail-template-assist.ts) ─────────────────────────────

const str = z.string();
/** A yes/no setting of a block: "" = not set (the block's default). */
const flag = z.enum(["", "true", "false"]);
const FLAG_FIELDS = Object.freeze(["fullWidth", "showHeadline", "showHeading", "showSocial"]);
const NUMBER_FIELDS = Object.freeze(["width", "height"]);

/**
 * Every field of every block type, all required and plain (no unions):
 * a field a block does not have is "" (or [] / "" flag).
 */
export const TEMPLATE_ASSIST_SCHEMA = z.object({
  style: z.object({
    accentColor: str,
    buttonTextColor: str,
    textColor: str,
    headingColor: str,
    outerBackground: str,
    fontFamily: str,
    buttonShape: str,
  }),
  blocks: z.array(
    z.object({
      id: str,
      type: z.enum(/** @type {[string, ...string[]]} */ ([...MAIL_BLOCK_TYPES])),
      text: str,
      size: str,
      align: str,
      color: str,
      background: str,
      src: str,
      alt: str,
      href: str,
      width: str,
      label: str,
      textColor: str,
      fullWidth: flag,
      title: str,
      refs: z.array(str),
      layout: str,
      code: str,
      headline: str,
      terms: str,
      until: str,
      heading: str,
      height: str,
      html: str,
      fallback: str,
      showHeadline: flag,
      showHeading: flag,
      showSocial: flag,
    })
  ),
  notes: str,
});

/**
 * One block (or the style) as the model returned it → the raw shape the
 * document normaliser reads: "" fields dropped (unset), the yes/no fields as
 * booleans, a numeric width / height as a number. Everything else stays as
 * it is — normalizeMailTemplateDoc validates it like any other input.
 * @param {Record<string, unknown>} raw
 * @returns {Record<string, unknown>}
 */
export function fromAssistFields(raw) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (value == null || value === "") continue;
    if (FLAG_FIELDS.includes(key)) {
      if (value === "true" || value === true) out[key] = true;
      else if (value === "false" || value === false) out[key] = false;
      continue;
    }
    if (NUMBER_FIELDS.includes(key) && typeof value === "string" && /^\d{1,4}$/.test(value.trim())) {
      out[key] = Number(value.trim());
      continue;
    }
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

// ── „Filter setzen“ in the campaign editor (campaign-assist.ts) ──────────────

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
