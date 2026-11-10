import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  AUDIENCE_ASSIST_SCHEMA,
  STRUCTURED_OUTPUT_LIMITS,
  TEMPLATE_ASSIST_SCHEMA,
  fitsStructuredOutput,
  fromAssistFields,
  structuredOutputCounts,
} from "./ai-assist-schemas.mjs";
import { MAIL_BLOCK_TYPES, normalizeMailTemplateDoc } from "./mail-template-doc.mjs";
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

test("both assistant schemas fit Anthropic's structured-output limits", () => {
  for (const [name, schema] of [
    ["template", TEMPLATE_ASSIST_SCHEMA],
    ["audience", AUDIENCE_ASSIST_SCHEMA],
  ]) {
    const c = structuredOutputCounts(schema);
    assert.ok(c.unionParams <= STRUCTURED_OUTPUT_LIMITS.unionParams, `${name}: ${c.unionParams} union params`);
    assert.ok(c.optionalParams <= STRUCTURED_OUTPUT_LIMITS.optionalParams, `${name}: ${c.optionalParams} optional params`);
    assert.equal(c.unionParams, 0, `${name} needs no unions at all`);
  }
});

test("the template schema knows every block type", () => {
  const json = z.toJSONSchema(TEMPLATE_ASSIST_SCHEMA);
  assert.deepEqual(json.properties.blocks.items.properties.type.enum, [...MAIL_BLOCK_TYPES]);
});

test("fromAssistFields: empty = unset, flags become booleans, numeric width/height become numbers", () => {
  assert.deepEqual(
    fromAssistFields({ id: "", type: "logo", width: "144", align: "center", text: "", refs: [], showSocial: "" }),
    { type: "logo", width: 144, align: "center" }
  );
  assert.deepEqual(fromAssistFields({ type: "image", width: "full", src: "https://x.de/a.jpg" }), { type: "image", width: "full", src: "https://x.de/a.jpg" });
  assert.deepEqual(fromAssistFields({ type: "footer", showSocial: "false" }), { type: "footer", showSocial: false });
  assert.deepEqual(fromAssistFields({ type: "button", fullWidth: "true", label: "Jetzt sparen" }), { type: "button", fullWidth: true, label: "Jetzt sparen" });
  // a text that happens to say "true" stays text
  assert.deepEqual(fromAssistFields({ type: "text", text: "true" }), { type: "text", text: "true" });
  assert.deepEqual(fromAssistFields({ type: "spacer", height: "24" }), { type: "spacer", height: 24 });
});

test("a model answer in the new shape normalises into a valid document", () => {
  const empty = Object.fromEntries(Object.keys(z.toJSONSchema(TEMPLATE_ASSIST_SCHEMA).properties.blocks.items.properties).map((k) => [k, k === "refs" ? [] : ""]));
  const answer = {
    style: { accentColor: "#ffcc00", buttonTextColor: "", textColor: "", headingColor: "", outerBackground: "#111111", fontFamily: "", buttonShape: "" },
    blocks: [
      { ...empty, type: "logo", width: "144", align: "center" },
      { ...empty, type: "heading", text: "Black Week", size: "xl" },
      { ...empty, type: "products", title: "Deals", refs: ["atx®-hantelbank-klappbar-schwarz-silber"], layout: "grid" },
      { ...empty, type: "footer", showSocial: "true" },
    ],
    notes: "Banner fehlt.",
  };
  const doc = normalizeMailTemplateDoc({ style: fromAssistFields(answer.style), blocks: answer.blocks.map(fromAssistFields) });
  assert.deepEqual(doc.blocks.map((b) => b.type), ["logo", "heading", "products", "footer"]);
  assert.equal(doc.style.accentColor, "#ffcc00");
  assert.deepEqual(doc.blocks[2].refs, ["atx®-hantelbank-klappbar-schwarz-silber"]);
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
