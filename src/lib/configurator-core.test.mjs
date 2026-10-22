import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIGURATOR_FIELDS,
  CONFIGURATOR_LIMITS,
  DEFAULT_CONFIGURATOR_SETTINGS,
  PLAN_MAX_ITEMS,
  answerDistribution,
  assortmentCards,
  chatStartedEventData,
  configuratorArchetype,
  configuratorFunnel,
  configuratorGreetingTrigger,
  configuratorLabel,
  configuratorRangeParam,
  configuratorRetrievalQuery,
  configuratorToolCopy,
  countShownGymPlans,
  hasConfiguratorTag,
  isConfiguratorThread,
  mergeConfiguratorProfile,
  normalizePlanItems,
  normalizeTag,
  parseConfiguratorContext,
  parseConfiguratorSettings,
  parseProductIdList,
  parseStoredGymPlan,
  personaAnswer,
  planRoleForProduct,
  planShownEventData,
  planShownEvents,
  renderConfiguratorSection,
  selectAssortment,
  unknownExtraIds,
  validateConfiguratorSettingsInput,
} from "./configurator-core.mjs";
import { buildSystemPrompt } from "./system-prompt-core.mjs";
import { SERVER_ONLY_EVENTS } from "./kpi-widget-events.mjs";
import { PROFILE_PERSONAS } from "./customer-profile-core.mjs";

const ctx = (configurator) => ({ type: "configurator", source: "configurator", configurator });

const fullAnswers = {
  v: 1,
  persona: "strength_focused",
  location: "apartment",
  space: "xs",
  training: ["cardio", "free_weights", "nope"],
  level: "rookie",
  partner: "MH",
  plan: [
    { id: "atx-rack~123", qty: 2 },
    { id: "bank", qty: 99 },
    { id: "bank", qty: 1 },
    { id: "bad id" },
    { id: "plates~7", qty: 2, added: true },
    { id: "ball", added: "yes" },
  ],
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

test("personas: the configurator's „Trainingsfokus“ is Mo's persona set", () => {
  const persona = CONFIGURATOR_FIELDS.find((f) => f.key === "persona");
  assert.deepEqual(
    persona.options.map((o) => o.id),
    ["pragmatic_beginner", "ambitious_home_athlete", "strength_focused", "cardio_focused", "design_lifestyle", "weight_loss"]
  );
  // every option is a persona the AI customer profile knows (customer-profile-core)
  for (const o of persona.options) assert.ok(PROFILE_PERSONAS.includes(o.id), o.id);
  for (const o of persona.options) assert.ok(o.subDe && o.subEn, `${o.id} subtitle`);
  assert.equal(configuratorLabel("persona", "design_lifestyle"), "Design und Lifestyle leben");
  assert.ok(!CONFIGURATOR_FIELDS.some((f) => f.key === "goal"), "the goal card is gone");
  assert.equal(configuratorArchetype(parseConfiguratorContext(ctx({ persona: "weight_loss" }))), "weight_loss");
  assert.equal(configuratorArchetype(parseConfiguratorContext(ctx({ space: "m" }))), null);
  assert.equal(configuratorArchetype(null), null);
});

test("personas: answers of the first version map onto today's personas", () => {
  assert.equal(personaAnswer("busy"), "pragmatic_beginner");
  assert.equal(personaAnswer(" Ambitious "), "ambitious_home_athlete");
  assert.equal(personaAnswer("best_ager"), "cardio_focused");
  assert.equal(personaAnswer("", "muscle"), "strength_focused");
  assert.equal(personaAnswer(undefined, "fitness"), "weight_loss");
  assert.equal(personaAnswer("family", "muscle"), "pragmatic_beginner", "the persona wins over the goal");
  assert.equal(personaAnswer("weight_loss", "muscle"), "weight_loss");
  assert.equal(personaAnswer("x", "y"), null);
  // own keys only — prototype names never resolve
  for (const k of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    assert.equal(personaAnswer(k), null, `persona ${k}`);
    assert.equal(personaAnswer(undefined, k), null, `goal ${k}`);
  }
  assert.equal(parseConfiguratorContext(ctx({ persona: "constructor" })), null);
  assert.equal(parseConfiguratorContext(ctx({ goal: "__proto__" })), null);
  assert.equal(parseConfiguratorContext(ctx({ goal: "endurance" })).persona, "cardio_focused");
});

test("parseConfiguratorContext: known values only, vocabulary order, plan bounded", () => {
  const a = parseConfiguratorContext(ctx(fullAnswers));
  assert.ok(a);
  assert.equal(a.persona, "strength_focused");
  assert.equal(a.location, "apartment");
  assert.deepEqual(a.training, ["free_weights", "cardio"]);
  assert.equal(a.partner, "mh");
  assert.equal(a.budget, null);
  assert.deepEqual(a.wishes, []);
  assert.deepEqual(a.plan, [
    { id: "atx-rack~123", qty: 2 },
    { id: "bank", qty: CONFIGURATOR_LIMITS.planQuantityMax },
    { id: "plates~7", qty: 2, added: true },
    { id: "ball", qty: 1 },
  ]);
  assert.equal("goal" in a, false);
  // comma text for multi answers, case-insensitive ids
  const b = parseConfiguratorContext(ctx({ persona: " Cardio_Focused ", training: "cardio,functional", wishes: ["quiet", "x"] }));
  assert.deepEqual(b.training, ["cardio", "functional"]);
  assert.equal(b.persona, "cardio_focused");
  assert.deepEqual(b.wishes, ["quiet"]);
});

test("parseConfiguratorContext: not a configurator context or nothing known → null", () => {
  assert.equal(parseConfiguratorContext(null), null);
  assert.equal(parseConfiguratorContext({ type: "product", productId: "x" }), null);
  assert.equal(parseConfiguratorContext({ type: "configurator" }), null);
  assert.equal(parseConfiguratorContext(ctx({ persona: "x", budget: "b2" })), null);
  assert.equal(parseConfiguratorContext(ctx([])), null);
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, qty: 1 }));
  assert.equal(parseConfiguratorContext(ctx({ persona: "weight_loss", plan: many })).plan.length, CONFIGURATOR_LIMITS.planItems);
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
  // house → house_basement_garage; weight-loss persona → cardio focus
  const h = mergeConfiguratorProfile(emptyProfile(), parseConfiguratorContext(ctx({ location: "garage", persona: "weight_loss" })));
  assert.equal(h.housing, "house_basement_garage");
  assert.equal(h.trainingFocus, "cardio");
  assert.equal(h.noiseSensitive, "unknown");
  // the persona fills level and focus when the page left them open
  const beginner = mergeConfiguratorProfile(emptyProfile(), parseConfiguratorContext(ctx({ persona: "pragmatic_beginner" })));
  assert.equal(beginner.experienceLevel, "beginner");
  assert.equal(beginner.trainingFocus, "unknown");
  const strong = mergeConfiguratorProfile(emptyProfile(), parseConfiguratorContext(ctx({ persona: "strength_focused", level: "pro" })));
  assert.equal(strong.experienceLevel, "advanced");
  assert.equal(strong.trainingFocus, "strength");
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

const scheiben = {
  id: "atx-scheiben",
  name: "ATX Hantelscheiben Guss 30 mm",
  category: "Weight Plates",
  price: 4,
  priceMin: 4,
  priceMax: 90,
  inStock: true,
  images: ["https://cdn/a.jpg", "https://cdn/b.jpg"],
  shopifyUrl: "https://motionsports.de/products/atx-scheiben",
  tags: ["home-gym-konfigurator"],
  shortDescription: "Gusseiserne Hantelscheiben",
  variants: [
    { id: "gid://shopify/ProductVariant/11", title: "0.5", price: 4, available: true, isDefault: true, options: [] },
    { id: "12", title: "5 kg", price: 20, available: true, isDefault: false, options: [] },
    { id: "13", title: "10 kg", price: 38, salePrice: 34, available: false, isDefault: false, options: [] },
    { id: "14", title: "20 kg", price: 90, available: true, isDefault: false, options: [] },
  ],
};

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
    plan: [{ id: "rack", qty: 1, name: "Rack" }, { id: "ball", qty: 1, name: "Ball", added: true }],
  });
  assert.match(out, /^## Home-Gym-Konfigurator/);
  assert.match(out, /- Typ \/ Trainingsfokus: Kraft und Muskeln aufbauen \(Gezielt und progressiv stärker werden\.\)/);
  assert.match(out, /- Trainingsort: Wohnung \(Mietobjekt\) — Platz: bis 6 m²/);
  assert.match(out, /- Trainingsart: Freie Gewichte, Cardio — Niveau: Einsteiger:in/);
  assert.match(out, /- Budget: noch offen — erfragen/);
  assert.match(out, /- Individuelle Wünsche: noch offen — erfragen/);
  assert.match(out, /Beratungsimpulse zu diesen Angaben:\n- Wohnung \(Mietobjekt\): leise Geräte/);
  assert.doesNotMatch(out, /Ziel|Ich will/);
  assert.match(out, /- `plates` Scheiben — Bänke · 50–400 € · AUSVERKAUFT/);
  assert.match(out, /- `rack` Rack — Racks · 900 €/);
  assert.match(out, /Bewege dich primär im Konfigurator-Sortiment/);
  assert.match(out, /### Hinweise des motion sports Teams zum Konfigurator \(befolge sie\)\nAktion: 10 % auf Racks\./);
  assert.match(out, /- 1× Rack \(`rack`\)\n- 1× Ball \(`ball`\) — vom Kunden ergänzt/);
  assert.match(out, /übernimm die vom Kunden ergänzten Positionen in jeden neuen Plan/);
  assert.match(out, /\*\*Gewichte mit mehreren Gewichtsstufen\*\* \(Hantelscheiben, Hanteln, Kettlebells, deren Zeile „Varianten“ nennt/);
  assert.match(out, /Gewichte ohne Varianten \(verstellbare Hanteln, Sets, einzelne Kettlebells\) nimmst du mit ihrer Produkt-ID/);
  assert.match(out, /nie eine erfundene VariantenID \(search_products liefert keine\)/);
  assert.match(out, /Produktgrenzen pro Antwort \(„Maximal 2-3 Produkte pro Antwort“ und die des Beratungsmodus/);
  assert.match(out, /Ein Plan hat höchstens 20 Positionen, die des Kunden eingeschlossen/);
  assert.match(out, /„\+ Gewichtsstufe“ weitere Gewichtsstufen und mit „\+ Produkt hinzufügen“/);
  assert.match(out, /bis zu 20 Positionen, die des Kunden eingeschlossen/);
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
    answers: parseConfiguratorContext(ctx({ persona: "strength_focused" })),
    assortment: many,
    settings: { focus: "prefer", notes: "" },
  });
  assert.equal((out.match(/^- `p\d+`/gm) ?? []).length, CONFIGURATOR_LIMITS.promptProducts);
  assert.match(out, /\+5 weitere — über search_products finden/);
});

test("renderConfiguratorSection lists the orderable weight steps with their variant ids", () => {
  const out = renderConfiguratorSection({
    answers: parseConfiguratorContext(ctx(fullAnswers)),
    assortment: [scheiben, catalog[0]],
    settings: { focus: "prefer", notes: "" },
  });
  // sold-out step (10 kg) left out; GID normalised to the number
  assert.match(out, /- `atx-scheiben` ATX Hantelscheiben Guss 30 mm — Weight Plates · 4–90 € — Gusseiserne Hantelscheiben \| Varianten: 0\.5 `~11`, 5 kg `~12`, 20 kg `~14`$/m);
  // a single-variant product lists none
  assert.match(out, /- `rack` Rack — Racks · 900 €$/m);
  // a long series: an even spread that keeps the lightest and the heaviest step
  const steps = Array.from({ length: 20 }, (_, i) => ({ id: String(100 + i), title: `${i + 1} kg`, price: i + 1, available: true }));
  const capped = renderConfiguratorSection({
    answers: parseConfiguratorContext(ctx(fullAnswers)),
    assortment: [{ ...scheiben, variants: steps }],
    settings: { focus: "prefer", notes: "" },
    locale: "en",
  });
  const listed = capped.match(/\| Variants: (.*)$/m)[1];
  assert.equal((listed.match(/`~\d+`/g) ?? []).length, CONFIGURATOR_LIMITS.promptVariants);
  assert.match(listed, /^1 kg `~100`, 2 kg `~101`, /);
  assert.match(listed, /, 20 kg `~119` \(\+4 steps in between\)$/);
  const de = renderConfiguratorSection({
    answers: parseConfiguratorContext(ctx(fullAnswers)),
    assortment: [{ ...scheiben, variants: steps }],
    settings: { focus: "prefer", notes: "" },
  });
  assert.match(de, /20 kg `~119` \(\+4 Stufen dazwischen\)$/m);
});

test("assortment cards: role per category/name, public fields, variants, sorted by role then name", () => {
  assert.equal(planRoleForProduct({ category: "Free Weight Storage Racks", name: "Scheibenständer" }), "accessory");
  assert.equal(planRoleForProduct({ category: "Weight Bar Collars" }), "accessory");
  assert.equal(planRoleForProduct({ category: "Power Racks" }), "base");
  assert.equal(planRoleForProduct({ category: "Smith Machines" }), "base");
  assert.equal(planRoleForProduct({ category: "Kettlebells" }), "weights");
  assert.equal(planRoleForProduct({ category: "Rowing Machines" }), "cardio");
  assert.equal(planRoleForProduct({ category: "Floor Protection Mats" }), "flooring");
  assert.equal(planRoleForProduct({ category: "", name: "Laufband TX 2" }), "cardio");
  assert.equal(planRoleForProduct({ category: "Yoga Mats" }), "extra");
  assert.equal(planRoleForProduct({}), "extra");

  const cards = assortmentCards([
    { id: "mat", name: "Bodenschutzmatte", category: "Floor Protection Mats", price: 49, inStock: true, images: [], shopifyUrl: "u" },
    scheiben,
    { id: "rack", name: "Power Rack", category: "Power Racks", price: 900, salePrice: 799, inStock: false, shopifyUrl: "r", shopifyVariantId: "55", description: "lang", sku: "X" },
    { id: "", name: "kaputt" },
  ]);
  assert.deepEqual(cards.map((c) => [c.id, c.role]), [["rack", "base"], ["atx-scheiben", "weights"], ["mat", "flooring"]]);
  assert.deepEqual(cards[0], {
    id: "rack",
    name: "Power Rack",
    category: "Power Racks",
    role: "base",
    price: 900,
    salePrice: 799,
    images: [],
    shopifyUrl: "r",
    inStock: false,
    variants: [{ id: "55", title: "", price: 900, salePrice: 799, available: false, isDefault: true }],
  });
  assert.deepEqual(cards[1].images, ["https://cdn/a.jpg"]);
  assert.equal(cards[1].priceMin, 4);
  assert.deepEqual(cards[1].variants.map((v) => [v.id, v.title, v.available]), [
    ["11", "0.5", true],
    ["12", "5 kg", true],
    ["13", "10 kg", false],
    ["14", "20 kg", true],
  ]);
  assert.equal(cards[1].variants[2].salePrice, 34);
  assert.equal(cards[2].variants, undefined, "no variant id, no variants");
});

test("renderConfiguratorSection (en) is English", () => {
  const out = renderConfiguratorSection({
    answers: parseConfiguratorContext(ctx(fullAnswers)),
    assortment: catalog,
    settings: { focus: "only", notes: "" },
    locale: "en",
  });
  assert.match(out, /^## Home-gym configurator/);
  assert.match(out, /- Type \/ training focus: Build strength and muscle \(/);
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
  assert.match(q, /^Home Gym Freie Gewichte Cardio Krafttraining Muskelaufbau Rack Hanteln platzsparend kompakt Wohnung leise$/);
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
  assert.equal(normalizePlanItems(many).length, PLAN_MAX_ITEMS);
  // the page plan's limit, so Mo can keep every line the customer added
  assert.equal(PLAN_MAX_ITEMS, CONFIGURATOR_LIMITS.planItems);
});

test("KPI payloads carry ids, enums and counts only; server names are server-only", () => {
  const a = parseConfiguratorContext(ctx({ ...fullAnswers, wishes: ["quiet", "assembly"] }));
  assert.deepEqual(chatStartedEventData(a, "de"), {
    persona: "strength_focused",
    location: "apartment",
    space: "xs",
    training: "free_weights,cardio",
    level: "rookie",
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
  // consultations of the first version count under today's persona
  const persona = answerDistribution("persona", [{ value: "busy", n: 2 }, { value: "family", n: 1 }, { value: "weight_loss", n: 4 }]);
  assert.deepEqual(persona.map((r) => [r.key, r.count]), [
    ["pragmatic_beginner", 3],
    ["ambitious_home_athlete", 0],
    ["strength_focused", 0],
    ["cardio_focused", 0],
    ["design_lifestyle", 0],
    ["weight_loss", 4],
  ]);
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

test("planShownEvents: only rendered plans count, numbered on, unknown lines left out", () => {
  const plan = (id, items) => ({ toolCallId: id, toolName: "show_gym_plan", input: { title: "Set", items } });
  const calls = [
    plan("a", [{ productId: "rack", role: "base" }, { productId: "kb~2", quantity: 2, role: "weights" }]),
    { ...plan("b", [{ productId: "rack", role: "base" }]), invalid: true }, // failed the schema
    plan("c", [{ productId: "ghost", role: "extra" }]), // all lines unknown
    plan("d", [{ productId: "bank", role: "accessory" }, { productId: "ghost2", role: "extra" }]),
    { toolCallId: "e", toolName: "show_product", input: { productId: "x" } },
    plan("f", [{ productId: "rack", role: "base" }]), // no tool result (tool error)
  ];
  const results = new Map([
    ["a", { ok: true, shownItems: 2 }],
    ["b", { ok: true, shownItems: 1 }],
    ["c", { ok: true, shownItems: 0, unknownIds: ["ghost"], soldOutIds: [] }],
    ["d", { ok: true, shownItems: 1, unknownIds: ["ghost2"], soldOutIds: [] }],
  ]);
  assert.deepEqual(planShownEvents(calls, results, 1), [
    { planNumber: 2, items: 2, units: 3, productIds: ["rack", "kb"] },
    { planNumber: 3, items: 1, units: 1, productIds: ["bank"] },
  ]);
  assert.deepEqual(planShownEvents(undefined, new Map(), 0), []);
});

test("parseStoredGymPlan: the stored tool input with notes and German roles; junk → null", () => {
  const stored = JSON.stringify({
    title: "Dein Kraft-Set",
    summary: "Kompakt für 6 m².",
    tips: ["Matte zuerst auslegen", 7],
    items: [
      { productId: "rack", quantity: 1, role: "base", note: "Herzstück" },
      { productId: "kb~2", quantity: 2, role: "weights" },
      { productId: "matte", role: "unknown-role" },
    ],
  });
  assert.deepEqual(parseStoredGymPlan(stored), {
    title: "Dein Kraft-Set",
    summary: "Kompakt für 6 m².",
    tips: ["Matte zuerst auslegen"],
    items: [
      { productId: "rack", quantity: 1, role: "base", roleLabel: "Basisgerät", note: "Herzstück" },
      { productId: "kb~2", quantity: 2, role: "weights", roleLabel: "Gewichte", note: null },
      { productId: "matte", quantity: 1, role: "extra", roleLabel: "Extra", note: null },
    ],
  });
  assert.equal(parseStoredGymPlan('{"title":"cut off at 8000 chars'), null);
  assert.equal(parseStoredGymPlan(JSON.stringify({ title: "leer", items: [] })), null);
  assert.equal(parseStoredGymPlan(null), null);
});

test("isConfiguratorThread and configuratorRangeParam", () => {
  assert.equal(isConfiguratorThread(["show_product", "suggest_replies"]), true);
  assert.equal(isConfiguratorThread(["show_gym_plan"]), true);
  assert.equal(isConfiguratorThread(["show_product", "add_to_cart"]), false);
  assert.equal(isConfiguratorThread(null), false);
  assert.equal(configuratorRangeParam("7d"), "7d");
  assert.equal(configuratorRangeParam("90d"), "90d");
  assert.equal(configuratorRangeParam("30d"), "30d");
  assert.equal(configuratorRangeParam("custom"), "30d");
  assert.equal(configuratorRangeParam(undefined), "30d");
});

test("countShownGymPlans: rendered plans of the history; an all-unknown plan does not count", () => {
  const msgs = [
    { role: "user", parts: [{ type: "text" }] },
    { role: "assistant", parts: [{ type: "tool-show_gym_plan", output: { ok: true, shownItems: 0, unknownIds: ["ghost"] } }] },
    { role: "assistant", parts: [{ type: "text" }, { type: "tool-show_gym_plan", output: { ok: true, shownItems: 3 } }] },
    { role: "assistant", parts: [{ type: "tool-show_gym_plan" }] }, // no stored result (older history)
    { role: "assistant", parts: [{ type: "tool-show_product", output: { ok: true } }] },
  ];
  assert.equal(countShownGymPlans(msgs), 2);
  assert.equal(countShownGymPlans(undefined), 0);
});
