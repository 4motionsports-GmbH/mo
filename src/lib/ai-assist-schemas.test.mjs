import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import * as schemas from "./ai-assist-schemas.mjs";
import { AUDIENCE_ASSIST_SCHEMA, STRUCTURED_OUTPUT_LIMITS, fitsStructuredOutput, structuredOutputCounts } from "./ai-assist-schemas.mjs";
import { normalizeAudienceSpec } from "./audience-spec.mjs";

test("the counter sees what Anthropic counts: nullable = a union, optional = not required, nested and in arrays", () => {
  const s = z.object({
    a: z.string().nullable(),
    b: z.array(z.object({ c: z.number().nullable(), d: z.string().optional() })),
    e: z.object({ f: z.union([z.string(), z.number()]) }).nullable(),
    g: z.enum(["", "x"]),
  });
  assert.deepEqual(structuredOutputCounts(s), { unionParams: 4, optionalParams: 1 });
});

test("the old schemas broke the limit — which is why every call failed", () => {
  const nstr = z.string().nullable();
  const oldBlock = z.object(
    Object.fromEntries(
      ["id", "text", "size", "align", "color", "background", "src", "alt", "href", "label", "textColor", "title", "layout", "code", "headline", "terms", "until", "heading", "html", "fallback"].map((k) => [k, nstr])
    )
  ).extend({ type: z.enum(["text"]), width: z.union([z.string(), z.number()]).nullable(), fullWidth: z.boolean().nullable(), refs: z.array(z.string()).nullable(), height: z.number().nullable(), showHeadline: z.boolean().nullable(), showHeading: z.boolean().nullable(), showSocial: z.boolean().nullable() });
  assert.equal(fitsStructuredOutput(z.object({ blocks: z.array(oldBlock) })), false);
});

test("the audience schema fits Anthropic's structured-output limits — with no unions at all", () => {
  const c = structuredOutputCounts(AUDIENCE_ASSIST_SCHEMA);
  assert.ok(c.unionParams <= STRUCTURED_OUTPUT_LIMITS.unionParams, `${c.unionParams} union params`);
  assert.ok(c.optionalParams <= STRUCTURED_OUTPUT_LIMITS.optionalParams, `${c.optionalParams} optional params`);
  assert.equal(c.unionParams, 0);
  assert.equal(fitsStructuredOutput(AUDIENCE_ASSIST_SCHEMA), true);
});

test("the flat template schema is gone — the KI-Gestalter hands its document in as non-strict tool input", () => {
  assert.equal("TEMPLATE_ASSIST_SCHEMA" in schemas, false);
  assert.equal("fromAssistFields" in schemas, false);
});

test("an audience answer in the new shape normalises: [] / -1 / 0 / '' are 'not set'", () => {
  const spec = normalizeAudienceSpec({
    optInLevels: [],
    lifecycle: ["ausbauen"],
    valueTier: [],
    churn: [],
    lastOrderDays: { min: -1, max: 90 },
    ordersCount: { min: -1, max: -1 },
    totalSpentEur: { min: 500, max: -1 },
    boughtAny: [],
    boughtNone: [],
    categories: [],
    persona: [],
    moContact: "",
    language: [],
    country: [],
    clickedWithinDays: 0,
    excludeMailedWithinDays: 14,
  });
  assert.deepEqual(spec.lifecycle, ["ausbauen"]);
  assert.deepEqual(spec.lastOrderDays, { max: 90 });
  assert.equal(spec.ordersCount, undefined);
  assert.deepEqual(spec.totalSpentEur, { min: 500 });
  assert.equal(spec.moContact, undefined);
  assert.equal(spec.clickedWithinDays, undefined);
  assert.equal(spec.excludeMailedWithinDays, 14);
  assert.equal(spec.optInLevels, undefined);
});
