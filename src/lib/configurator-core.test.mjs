import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIGURATOR_FIELDS,
  CONFIGURATOR_LIMITS,
  DEFAULT_CONFIGURATOR_SETTINGS,
  answerDistribution,
  chatStartedEventData,
  configuratorFunnel,
  configuratorGreetingTrigger,
  configuratorLabel,
  configuratorRetrievalQuery,
  configuratorToolCopy,
  hasConfiguratorTag,
  mergeConfiguratorProfile,
  normalizePlanItems,
  normalizeTag,
  parseConfiguratorContext,
  parseConfiguratorSettings,
  parseProductIdList,
  planShownEventData,
  renderConfiguratorSection,
  selectAssortment,
  unknownExtraIds,
  validateConfiguratorSettingsInput,
} from "./configurator-core.mjs";
import { buildSystemPrompt } from "./system-prompt-core.mjs";
import { SERVER_ONLY_EVENTS } from "./kpi-widget-events.mjs";

const ctx = (configurator) => ({ type: "configurator", source: "configurator", configurator });

const fullAnswers = {
  v: 1,
  persona: "busy",
  location: "apartment",
  space: "xs",
  training: ["cardio", "free_weights", "nope"],
  level: "rookie",
  goal: "muscle",
  partner: "MH",
  plan: [{ id: "atx-rack~123", qty: 2 }, { id: "bank", qty: 99 }, { id: "bank", qty: 1 }, { id: "bad id" }],
};

test("vocabulary: unique snake_case ids and both labels on every option", () => {
  const keys = new Set();
  for (const field of CONFIGURATOR_FIELDS) {
    assert.ok(!keys.has(field.key), field.key);
    keys.add(field.key);
    assert.ok(field.de && field.en, field.key);
    const ids = new Set();
    for (const o of field.options) {
      assert.match(o.id, /^[a-z0-9_]+$/, `${field.key}.${o.id}`);
      assert.ok(!ids.has(o.id), `${field.key}.${o.id} duplicated`);
      ids.add(o.id);
      assert.ok(o.de.trim() && o.en.trim(), `${field.key}.${o.id} labels`);
      assert.equal(Boolean(o.hintDe), Boolean(o.hintEn), `${field.key}.${o.id} hints in both locales`);
    }
  }
  assert.equal(configuratorLabel("space", "xs"), "bis 6 m²");
  assert.equal(configuratorLabel("space", "xs", "en"), "up to 6 m²");
  assert.equal(configuratorLabel("space", "nope"), "");
});

test("parseConfiguratorContext: known values only, vocabulary order, plan bounded", () => {
  const a = parseConfiguratorContext(ctx(fullAnswers));
  assert.ok(a);
  assert.equal(a.persona, "busy");
  assert.equal(a.location, "apartment");
  assert.deepEqual(a.training, ["free_weights", "cardio"]);
  assert.equal(a.partner, "mh");
  assert.equal(a.budget, null);
  assert.deepEqual(a.wishes, []);
  assert.deepEqual(a.plan, [
    { id: "atx-rack~123", qty: 2 },
    { id: "bank", qty: CONFIGURATOR_LIMITS.planQuantityMax },
  ]);
  // comma text for multi answers, case-insensitive ids
  const b = parseConfiguratorContext(ctx({ goal: " Health ", training: "cardio,functional", wishes: ["quiet", "x"] }));
  assert.deepEqual(b.training, ["cardio", "functional"]);
  assert.equal(b.goal, "health");
  assert.deepEqual(b.wishes, ["quiet"]);
});

test("parseConfiguratorContext: not a configurator context or nothing known → null", () => {
  assert.equal(parseConfiguratorContext(null), null);
  assert.equal(parseConfiguratorContext({ type: "product", productId: "x" }), null);
  assert.equal(parseConfiguratorContext({ type: "configurator" }), null);
  assert.equal(parseConfiguratorContext(ctx({ persona: "x", budget: "b2" })), null);
  assert.equal(parseConfiguratorContext(ctx([])), null);
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, qty: 1 }));
  assert.equal(parseConfiguratorContext(ctx({ goal: "muscle", plan: many })).plan.length, CONFIGURATOR_LIMITS.planItems);
});

const emptyProfile = () => ({
  segment: "unknown",
  experienceLevel: "unknown",
  trainingFocus: "unknown",
  spaceM2: "unknown",
  budgetEUR: "unknown",
  trainingFrequency: "unknown",
  housing: "unknown",
  noiseSensitive: "unknown",
  procurementNeeds: [],
  confidence: 0,
});

test("mergeConfiguratorProfile fills only what the conversation has not set", () => {
  const a = parseConfiguratorContext(ctx({ ...fullAnswers, budget: "b2" }));
  const merged = mergeConfiguratorProfile(emptyProfile(), a);
  assert.equal(merged.segment, "private");
  assert.equal(merged.housing, "apartment");
  assert.equal(merged.noiseSensitive, true);
  assert.equal(merged.spaceM2, 6);
  assert.equal(merged.experienceLevel, "beginner");
  assert.equal(merged.trainingFocus, "mixed");
  assert.deepEqual(merged.budgetEUR, { min: 1000, max: 2500 });
  const own = { ...emptyProfile(), spaceM2: 12, budgetEUR: { min: null, max: 800 }, segment: "studio" };
  const kept = mergeConfiguratorProfile(own, a);
  assert.equal(kept.spaceM2, 12);
  assert.deepEqual(kept.budgetEUR, { min: null, max: 800 });
  assert.equal(kept.segment, "studio");
  assert.equal(mergeConfiguratorProfile(own, null), own);
  // house → house_basement_garage; endurance goal → cardio focus
  const h = mergeConfiguratorProfile(emptyProfile(), parseConfiguratorContext(ctx({ location: "garage", goal: "endurance" })));
  assert.equal(h.housing, "house_basement_garage");
  assert.equal(h.trainingFocus, "cardio");
  assert.equal(h.noiseSensitive, "unknown");
});

test("settings: fail-soft parse and strict validation", () => {
  assert.deepEqual(parseConfiguratorSettings(null), { ...DEFAULT_CONFIGURATOR_SETTINGS, extraProductIds: [] });
  assert.deepEqual(parseConfiguratorSettings("{broken"), { ...DEFAULT_CONFIGURATOR_SETTINGS, extraProductIds: [] });
  const s = parseConfiguratorSettings({ enabled: false, tag: "  Home  Gym ", extraProductIds: "a, b\nc a", focus: "only", notes: " x " });
  assert.deepEqual(s, { enabled: false, tag: "Home Gym", extraProductIds: ["a", "b", "c"], focus: "only", notes: "x" });
  assert.equal(parseConfiguratorSettings({ tag: "a,b", focus: "x" }).tag, DEFAULT_CONFIGURATOR_SETTINGS.tag);
  assert.equal(parseConfiguratorSettings({ focus: "x" }).focus, "prefer");

  const ok = validateConfiguratorSettingsInput({ enabled: true, tag: "konfig", extraProductIds: ["x"], focus: "prefer", notes: "" });
  assert.equal(ok.ok, true);
  assert.equal(validateConfiguratorSettingsInput({ enabled: true, tag: "", focus: "prefer" }).ok, false);
  assert.equal(validateConfiguratorSettingsInput({ enabled: "yes", tag: "x", focus: "prefer" }).ok, false);
  assert.equal(validateConfiguratorSettingsInput({ enabled: true, tag: "x", focus: "all" }).ok, false);
  const long = validateConfiguratorSettingsInput({ enabled: true, tag: "x", focus: "only", notes: "a".repeat(CONFIGURATOR_LIMITS.notesMax + 1) });
  assert.equal(long.ok, false);
  assert.match(long.message, /höchstens/);
  assert.equal(normalizeTag("a<b"), "");
  assert.deepEqual(parseProductIdList(["a", "", "a", 3, "b~1"]), ["a", "b~1"]);
});

const catalog = [
  { id: "rack", name: "Rack", category: "Racks", price: 900, inStock: true, tags: ["Home-Gym-Konfigurator", "Kraft"] },
  { id: "bank", name: "Bank", category: "Bänke", price: 300, inStock: true, tags: ["home-gym-konfigurator"] },
  { id: "ball", name: "Ball", category: "Zubehör", price: 20, inStock: true, tags: [] },
  { id: "plates", name: "Scheiben", category: "Bänke", price: 100, priceMin: 50, priceMax: 400, inStock: false, tags: [] },
];

test("assortment: tag (case-insensitive) plus extra list, sorted by category then price", () => {
  assert.equal(hasConfiguratorTag(catalog[0], "home-gym-konfigurator"), true);
  assert.equal(hasConfiguratorTag(catalog[2], "home-gym-konfigurator"), false);
  const sel = selectAssortment(catalog, { tag: "home-gym-konfigurator", extraProductIds: ["plates~9", "ghost"] });
  assert.deepEqual(sel.map((s) => s.product.id), ["plates", "bank", "rack"]);
  assert.deepEqual(sel.map((s) => [s.viaTag, s.viaList]), [[false, true], [true, false], [true, false]]);
  assert.deepEqual(unknownExtraIds(catalog, ["plates~9", "ghost"]), ["ghost"]);
});

test("renderConfiguratorSection (de): answers, open fields, cues, assortment, focus, notes, plan", () => {
  const answers = parseConfiguratorContext(ctx(fullAnswers));
  const assortment = selectAssortment(catalog, { tag: "home-gym-konfigurator", extraProductIds: ["plates"] }).map((s) => s.product);
  const out = renderConfiguratorSection({
    answers,
    assortment,
    settings: { focus: "prefer", notes: "Aktion: 10 % auf Racks." },
    plan: [{ id: "rack", qty: 1, name: "Rack" }],
  });
  assert.match(out, /^## Home-Gym-Konfigurator/);
  assert.match(out, /- Ich bin: Berufstätig & wenig Zeit/);
  assert.match(out, /- Trainingsort: Wohnung \(Mietobjekt\) — Platz: bis 6 m²/);
  assert.match(out, /- Trainingsart: Freie Gewichte, Cardio — Niveau: Einsteiger:in/);
  assert.match(out, /- Budget: noch offen — erfragen/);
  assert.match(out, /- Individuelle Wünsche: noch offen — erfragen/);
  assert.match(out, /Beratungsimpulse zu diesen Angaben:\n- Berufstätig & wenig Zeit: zeiteffizientes/);
  assert.match(out, /- `plates` Scheiben — Bänke · 50–400 € · AUSVERKAUFT/);
  assert.match(out, /- `rack` Rack — Racks · 900 €/);
  assert.match(out, /Bewege dich primär im Konfigurator-Sortiment/);
  assert.match(out, /### Hinweise des motion sports Teams zum Konfigurator \(befolge sie\)\nAktion: 10 % auf Racks\./);
  assert.match(out, /- 1× Rack \(`rack`\)/);
  assert.match(out, /`suggest_replies`/);
  assert.match(out, /`show_gym_plan`/);
  assert.doesNotMatch(out, /undefined|null/);

  const strict = renderConfiguratorSection({ answers, assortment: [], settings: { focus: "only", notes: "" } });
  assert.match(strict, /Empfiehl AUSSCHLIESSLICH Produkte aus dem Konfigurator-Sortiment/);
  assert.match(strict, /Noch kein Konfigurator-Sortiment markiert/);
  assert.doesNotMatch(strict, /Hinweise des motion sports Teams/);
  assert.doesNotMatch(strict, /Der Plan, wie er jetzt auf der Seite steht/);
});

test("renderConfiguratorSection caps the listed assortment and points to search_products", () => {
  const many = Array.from({ length: CONFIGURATOR_LIMITS.promptProducts + 5 }, (_, i) => ({
    id: `p${i}`, name: `P${i}`, category: "X", price: i, inStock: true,
  }));
  const out = renderConfiguratorSection({
    answers: parseConfiguratorContext(ctx({ goal: "muscle" })),
    assortment: many,
    settings: { focus: "prefer", notes: "" },
  });
  assert.equal((out.match(/^- `p\d+`/gm) ?? []).length, CONFIGURATOR_LIMITS.promptProducts);
  assert.match(out, /\+5 weitere — über search_products finden/);
});

test("renderConfiguratorSection (en) is English", () => {
  const out = renderConfiguratorSection({
    answers: parseConfiguratorContext(ctx(fullAnswers)),
    assortment: catalog,
    settings: { focus: "only", notes: "" },
    locale: "en",
  });
  assert.match(out, /^## Home-gym configurator/);
  assert.match(out, /- I am: Busy, with little time/);
  assert.match(out, /Recommend ONLY products from the configurator assortment/);
  assert.doesNotMatch(out, /Beratungsimpulse|noch offen|Leitfaden/);
  assert.match(configuratorGreetingTrigger("en"), /^\[System: /);
  assert.match(configuratorGreetingTrigger("de"), /Home-Gym-Konfigurator/);
});

test("system prompt: the configurator block sits after the opening sentence; absent = unchanged", () => {
  const base = {
    profile: emptyProfile(),
    archetype: "unknown",
    retrievedProducts: [],
  };
  const plain = buildSystemPrompt(base);
  assert.equal(buildSystemPrompt({ ...base, configuratorBlock: "" }), plain);
  const block = "## Home-Gym-Konfigurator (Test)";
  const withBlock = buildSystemPrompt({ ...base, configuratorBlock: block });
  assert.ok(withBlock.startsWith("Du bist Mo, der KI-Fitnessberater"));
  assert.ok(withBlock.includes(`Equipment.\n\n${block}\n\n## Deine Persönlichkeit`));
  assert.ok(buildSystemPrompt({ ...base, configuratorBlock: block, locale: "en" }).includes(`equipment and gear.\n\n${block}`));
});

test("retrieval query and tool copy", () => {
  const q = configuratorRetrievalQuery(parseConfiguratorContext(ctx(fullAnswers)));
  assert.match(q, /^Home Gym Freie Gewichte Cardio Muskeln & Kraft aufbauen platzsparend kompakt Wohnung leise$/);
  const de = configuratorToolCopy("de");
  const en = configuratorToolCopy("en");
  assert.deepEqual(Object.keys(de), Object.keys(en));
  for (const key of Object.keys(de)) assert.notEqual(de[key], en[key], key);
});

test("normalizePlanItems: roles, quantities, duplicates merged, capped", () => {
  const items = normalizePlanItems({
    items: [
      { productId: "rack", role: "base" },
      { productId: "rack", quantity: 2, role: "base" },
      { productId: "bank", quantity: 0, role: "mystery" },
      { productId: "bad id", role: "base" },
      { role: "base" },
    ],
  });
  assert.deepEqual(items, [
    { productId: "rack", quantity: 3, role: "base" },
    { productId: "bank", quantity: 1, role: "extra" },
  ]);
  assert.deepEqual(normalizePlanItems(null), []);
  const many = { items: Array.from({ length: 30 }, (_, i) => ({ productId: `p${i}`, role: "extra" })) };
  assert.equal(normalizePlanItems(many).length, 12);
});

test("KPI payloads carry ids, enums and counts only; server names are server-only", () => {
  const a = parseConfiguratorContext(ctx({ ...fullAnswers, wishes: ["quiet", "assembly"] }));
  assert.deepEqual(chatStartedEventData(a, "de"), {
    persona: "busy",
    location: "apartment",
    space: "xs",
    training: "free_weights,cardio",
    level: "rookie",
    goal: "muscle",
    budget: "",
    wishes: "assembly,quiet",
    partner: "mh",
    locale: "de",
  });
  assert.deepEqual(planShownEventData({ items: [{ productId: "rack~5", quantity: 2, role: "base" }, { productId: "bank", role: "accessory" }] }, 2), {
    planNumber: 2,
    items: 2,
    units: 3,
    productIds: ["rack", "bank"],
  });
  assert.ok(SERVER_ONLY_EVENTS.includes("configurator_chat_started"));
  assert.ok(SERVER_ONLY_EVENTS.includes("configurator_plan_shown"));
});

test("answerDistribution: every option in vocabulary order, multi fields count each choice", () => {
  assert.deepEqual(
    answerDistribution("level", [{ value: "pro", n: 2 }, { value: "rookie", n: 5 }, { value: "", n: 1 }, { value: "x", n: 1 }]),
    [
      { key: "rookie", label: "Einsteiger:in", count: 5 },
      { key: "intermediate", label: "Fortgeschritten", count: 0 },
      { key: "pro", label: "Profi", count: 2 },
      { key: "", label: "ohne Angabe", count: 2 },
    ]
  );
  const training = answerDistribution("training", [{ value: "cardio,free_weights", n: 3 }, { value: "cardio", n: 1 }]);
  assert.deepEqual(training.map((r) => r.count), [3, 0, 4, 0]);
  assert.deepEqual(answerDistribution("nope", []), []);
});

test("configuratorFunnel: stage order and rates (null without a base)", () => {
  const f = configuratorFunnel({ viewed: 100, started: 40, handover: 20, chats: 18, plans: 9, carts: 3, orders: 1 });
  assert.deepEqual(f.stages.map((s) => s.key), ["started", "handover", "chats", "plans", "carts", "orders"]);
  assert.equal(f.handoverRate, 0.5);
  assert.equal(f.planRate, 0.5);
  assert.equal(f.cartRate, 1 / 3);
  assert.equal(f.orderRate, 1 / 18);
  assert.equal(configuratorFunnel({ viewed: 0, started: 0, handover: 0, chats: 0, plans: 0, carts: 0, orders: 0 }).planRate, null);
});
