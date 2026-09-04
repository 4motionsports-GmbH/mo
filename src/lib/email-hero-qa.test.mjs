import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  clampReview,
  HERO_QA_MIN_SCORE,
  heroQaSchema,
  heroQaEnabled,
  heroQaPrompt,
  heroQaVerdict,
  pickBestRender,
  reviewHeroImage,
} from "./email-hero-qa.mjs";

const good = { leftCalm: true, productsRight: true, strayText: false, cutoutLook: false, productFidelity: 5, overall: 9, issues: [] };

test("a clean review passes; each hard fail is named", () => {
  assert.deepEqual(heroQaVerdict(good), { pass: true, score: 9, reasons: [] });
  assert.deepEqual(heroQaVerdict({ ...good, leftCalm: false }).reasons, ["linke Bildhälfte nicht ruhig"]);
  assert.deepEqual(heroQaVerdict({ ...good, strayText: true }).reasons, ["Fremdtext im Bild"]);
  assert.deepEqual(heroQaVerdict({ ...good, cutoutLook: true }).reasons, ["Produkte wirken eingeklebt"]);
  assert.deepEqual(heroQaVerdict({ ...good, productsRight: false }).reasons, ["Geräte nicht rechts"]);
  const low = heroQaVerdict({ ...good, overall: HERO_QA_MIN_SCORE - 1 });
  assert.equal(low.pass, false);
  assert.match(low.reasons[0], /Gesamtwertung 5\/10/);
});

test("pickBestRender prefers a pass, then the higher score, then the first", () => {
  const a = { id: "a", verdict: { pass: false, score: 8 } };
  const b = { id: "b", verdict: { pass: true, score: 6 } };
  const c = { id: "c", verdict: { pass: true, score: 6 } };
  assert.equal(pickBestRender([a, b]).id, "b");
  assert.equal(pickBestRender([b, c]).id, "b", "stable: the first render wins a tie");
  assert.equal(pickBestRender([{ id: "x", verdict: { pass: false, score: 3 } }, a]).id, "a");
  assert.equal(pickBestRender([{ id: "only" }]).id, "only", "an unreviewed render still returns");
});

test("the schema carries no numeric bounds (Anthropic structured output rejects them) and answers are clamped", () => {
  const json = JSON.stringify(z.toJSONSchema(heroQaSchema));
  assert.doesNotMatch(json, /"minimum"|"maximum"|"maxItems"/);
  const r = clampReview({ ...good, productFidelity: 9, overall: 12.4, issues: ["a", "b", "c", "d", "e", "f"] });
  assert.equal(r.productFidelity, 5);
  assert.equal(r.overall, 10);
  assert.equal(r.issues.length, 5);
  assert.equal(clampReview({ ...good, overall: -3 }).overall, 1);
});

test("the check is on with a key and off via EMAIL_HERO_QA=off", () => {
  assert.equal(heroQaEnabled({ ANTHROPIC_API_KEY: "k" }), true);
  assert.equal(heroQaEnabled({ ANTHROPIC_API_KEY: "k", EMAIL_HERO_QA: "off" }), false);
  assert.equal(heroQaEnabled({}), false);
});

test("reviewHeroImage sends the picture + product names and returns verdict and usage", async () => {
  let seen = null;
  const generate = async (args) => {
    seen = args;
    return { object: { ...good, overall: 7.4 }, usage: { inputTokens: 1200, outputTokens: 80 } };
  };
  const out = await reviewHeroImage(Buffer.from("jpg"), {
    productNames: ["ATX® Power Rack 620"],
    generate,
    modelFactory: (m) => ({ id: m }),
  });
  assert.equal(seen.model.id, "claude-sonnet-4-6");
  assert.equal(seen.messages[0].content[0].type, "image");
  assert.match(seen.messages[0].content[1].text, /ATX® Power Rack 620/);
  assert.equal(out.verdict.pass, true);
  assert.equal(out.verdict.score, 7);
  assert.deepEqual(out.usage, { inputTokens: 1200, outputTokens: 80 });
  assert.match(heroQaPrompt([]), /calm, bright, empty wall/);
});
