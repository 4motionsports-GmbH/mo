import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIGURATOR_FIELDS,
  CONFIGURATOR_LIMITS,
  CONFIGURATOR_PLAN_TOOLS,
  CONFIGURATOR_TOOLS,
  DEFAULT_CONFIGURATOR_SETTINGS,
  ACCESSORY_LIMITS,
  OPTION_STEPS,
  OPTION_STEP_ROLE,
  PLAN_MAX_ITEMS,
  PLAN_ROLES,
  configuratorHasOptions,
  normalizeOfferOptions,
  offerOptionsResult,
  optionStepRows,
  optionsShownEvents,
  planAccessories,
  planAccessoryBases,
  planAccessoryIds,
  searchCatalogCards,
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
  assert.match(out, /- Typ \/ Trainingsfokus: Kraft und Muskeln aufbauen \(Stärke gezielt und progressiv weiterentwickeln\.\)/);
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
  // a strength machine that says "Plate Load" is a base unit, not a weight plate;
  // cardio machines stay cardio; plates stay weights
  assert.equal(planRoleForProduct({ category: "Uncategorized", name: "Hip Thruster Machine Plate Load - Vision Fitness" }), "base");
  assert.equal(planRoleForProduct({ category: "", name: "Latzugmaschine Physio - Zugapparat Vertikal" }), "base");
  assert.equal(planRoleForProduct({ category: "Cardio Machines", name: "Concept2 SkiErg Skitrainer" }), "cardio");
  assert.equal(planRoleForProduct({ category: "", name: "ATX® Gym Bumper Plate Hantelscheiben - 5 bis 25 kg" }), "weights");
  assert.equal(planRoleForProduct({ category: "Weight Plates", name: "Olympic Plates" }), "weights");

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
    steps: false,
    locale: "de",
  });
  assert.equal(chatStartedEventData(parseConfiguratorContext(ctx({ ...fullAnswers, features: ["options"] })), "de").steps, true);
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


// ---------------------------------------------------------------------------
// Step-by-step choice (offer_plan_options, 2026-10-23)
// ---------------------------------------------------------------------------

test("features: only known values, the step flow needs the widget's \"options\"", () => {
  assert.deepEqual(parseConfiguratorContext(ctx({ persona: "weight_loss", features: ["Options", "x", 3] })).features, ["options"]);
  assert.deepEqual(parseConfiguratorContext(ctx({ persona: "weight_loss" })).features, []);
  assert.deepEqual(parseConfiguratorContext(ctx({ persona: "weight_loss", features: "options" })).features, []);
  assert.equal(configuratorHasOptions(parseConfiguratorContext(ctx({ persona: "weight_loss", features: ["options"] }))), true);
  assert.equal(configuratorHasOptions(parseConfiguratorContext(ctx({ persona: "weight_loss" }))), false);
  assert.equal(configuratorHasOptions(null), false);
  assert.ok(CONFIGURATOR_TOOLS.includes("offer_plan_options"));
  assert.deepEqual([...CONFIGURATOR_PLAN_TOOLS], ["show_gym_plan", "offer_plan_options"]);
  for (const step of OPTION_STEPS) assert.ok(PLAN_ROLES.includes(OPTION_STEP_ROLE[step]), step);
  assert.equal(OPTION_STEP_ROLE.bench, "accessory");
});

test("normalizeOfferOptions: known step, bounded options and items, merged duplicates, trimmed points", () => {
  const n = normalizeOfferOptions({
    step: "weights",
    multiSelect: true,
    options: [
      { items: [{ productId: "plates~1", quantity: 2 }, { productId: "plates~1", quantity: 2 }, { productId: "bad id" }, { productId: "plates~2", quantity: 99 }], label: "  Einsteiger-Set  ", badge: "Mos Empfehlung", pros: ["a", " ", "b", "c", "d"], cons: ["x".repeat(200), "y", "z"] },
      { items: [] },
      { items: [{ productId: "bar" }] },
      { items: [{ productId: "p3" }] },
      { items: [{ productId: "p4" }] },
      { items: [{ productId: "p5" }] },
    ],
  });
  assert.equal(n.step, "weights");
  assert.equal(n.multiSelect, true);
  assert.equal(n.options.length, 4);
  assert.deepEqual(n.options[0].items, [{ productId: "plates~1", quantity: 4 }, { productId: "plates~2", quantity: CONFIGURATOR_LIMITS.planQuantityMax }]);
  assert.equal(n.options[0].label, "Einsteiger-Set");
  assert.deepEqual(n.options[0].pros, ["a", "b", "c"]);
  assert.equal(n.options[0].cons.length, 2);
  assert.ok(n.options[0].cons[0].length <= 91);
  assert.deepEqual(n.options[1], { items: [{ productId: "bar", quantity: 1 }], label: null, badge: null, pros: [], cons: [] });
  assert.equal(normalizeOfferOptions({ step: "nope", options: [] }).step, "extra");
  assert.deepEqual(normalizeOfferOptions(null), { step: "extra", multiSelect: false, options: [] });
});

test("optionsShownEvents: one per rendered call; options with an unknown or sold-out item left out", () => {
  const calls = [
    { toolCallId: "a", toolName: "offer_plan_options", input: { step: "base", options: [{ items: [{ productId: "rack" }] }, { items: [{ productId: "ghost" }] }] } },
    { toolCallId: "b", toolName: "offer_plan_options", input: { step: "bench", options: [{ items: [{ productId: "ghost" }] }] } },
    { toolCallId: "c", toolName: "offer_plan_options", invalid: true, input: { step: "base", options: [{ items: [{ productId: "rack" }] }] } },
    { toolCallId: "d", toolName: "show_gym_plan", input: { items: [{ productId: "rack" }] } },
    // a mixed option (one good, one unknown item), a sold-out option, a sold-out bundle line, one clean bundle
    {
      toolCallId: "e",
      toolName: "offer_plan_options",
      input: {
        step: "weights",
        options: [
          { items: [{ productId: "plates~5", quantity: 2 }, { productId: "plates~999" }] },
          { items: [{ productId: "soldout" }] },
          { items: [{ productId: "bar" }, { productId: "plates~10", quantity: 2 }, { productId: "plates~5", quantity: 2 }] },
          { items: [{ productId: "plates~20", quantity: 2 }, { productId: "soldout" }] },
        ],
      },
    },
  ];
  const results = new Map([
    ["a", { ok: true, shownOptions: 1, unknownIds: ["ghost"], soldOutIds: [] }],
    ["b", { ok: true, shownOptions: 0, unknownIds: ["ghost"], soldOutIds: [] }],
    ["c", { ok: true, shownOptions: 1 }],
    ["d", { ok: true, shownItems: 1 }],
    ["e", { ok: true, shownOptions: 1, unknownIds: ["plates~999"], soldOutIds: ["soldout", 7] }],
  ]);
  assert.deepEqual(optionsShownEvents(calls, results), [
    { step: "base", options: 1, items: 1, multi: false, productIds: ["rack"] },
    { step: "weights", options: 1, items: 3, multi: false, productIds: ["bar", "plates"] },
  ]);
  // a result that says shown but whose every option has a bad id → no event
  assert.deepEqual(
    optionsShownEvents([calls[4]], new Map([["e", { ok: true, shownOptions: 1, unknownIds: ["plates~999", "bar"], soldOutIds: ["soldout"] }]])),
    []
  );
  assert.deepEqual(optionsShownEvents(null, new Map()), []);
});

test("offerOptionsResult: shown = every item known and available; a vanished variant is unknown", () => {
  const options = normalizeOfferOptions({
    step: "weights",
    options: [
      { items: [{ productId: "plates~5" }, { productId: "plates~999" }] },
      { items: [{ productId: "bench" }] },
      { items: [{ productId: "rack" }, { productId: "ghost" }] },
      { items: [{ productId: "rack" }, { productId: "bar" }] },
    ],
  }).options;
  const resolved = [
    { ref: "plates~5", available: true, missingVariant: false },
    { ref: "plates~999", available: false, missingVariant: true },
    { ref: "bench", available: false, missingVariant: false },
    { ref: "rack", available: true, missingVariant: false },
    { ref: "bar", available: true, missingVariant: false },
  ];
  assert.deepEqual(offerOptionsResult(options, resolved), {
    ok: true,
    shownOptions: 1,
    unknownIds: ["plates~999", "ghost"],
    soldOutIds: ["bench"],
  });
  assert.deepEqual(offerOptionsResult(options.slice(3), resolved), { ok: true, shownOptions: 1 });
  assert.deepEqual(offerOptionsResult([], []), { ok: true, shownOptions: 0 });
});

test("searchCatalogCards: every word matches, umlauts and plurals folded, hidden left out, in stock first", () => {
  const cat = [
    { id: "bench-a", name: "ATX® Multi Bench Hantelbank MBX-520", brand: "ATX", category: "Exercise Benches", price: 349, inStock: true },
    { id: "bench-b", name: "Hantelbänke Set Pro", brand: "Other", category: "Benches", price: 99, inStock: false },
    { id: "rack", name: "Power Rack PRX-780", brand: "ATX", category: "Power Racks", price: 900, inStock: true, hideFromSearch: true },
    { id: "mat", name: "Bodenschutzmatte Standard", brand: "Gymfloor", category: "Floor Protection Mats", price: 40, inStock: true, sku: "GF-100" },
  ];
  assert.deepEqual(searchCatalogCards(cat, "Hantelbank").map((c) => c.id), ["bench-a", "bench-b"]);
  assert.deepEqual(searchCatalogCards(cat, "hantelbänke").map((c) => c.id), ["bench-a", "bench-b"]);
  assert.deepEqual(searchCatalogCards(cat, "atx hantelbank").map((c) => c.id), ["bench-a"]);
  assert.deepEqual(searchCatalogCards(cat, "rack"), []);
  assert.deepEqual(searchCatalogCards(cat, "matten").map((c) => c.id), ["mat"]);
  assert.deepEqual(searchCatalogCards(cat, "gf-100").map((c) => c.id), ["mat"]);
  assert.deepEqual(searchCatalogCards(cat, "x"), []);
  assert.deepEqual(searchCatalogCards(cat, ""), []);
  assert.equal(searchCatalogCards(cat, "a", 1).length, 0);
  assert.equal(searchCatalogCards(cat, "hantelbank", 1).length, 1);
  const card = searchCatalogCards(cat, "bodenschutz")[0];
  assert.deepEqual(Object.keys(card).sort(), ["category", "id", "images", "inStock", "name", "price", "role", "shopifyUrl"]);
  assert.equal(card.role, "flooring");
});

test("searchCatalogCards: a whole name word before a prefix; -er plurals, short plurals, ae/oe/ue and variant SKUs", () => {
  const cat = [
    { id: "ablage", name: "ATX® Kurzhantelablage doppelstufig", category: "Free Weight Storage Racks", price: 300, inStock: true },
    { id: "dumbbells", name: "Urethan Dumbbells ATX® Kurzhanteln – 2,5 bis 60 kg", category: "Dumbbells", price: 20, inStock: true },
    { id: "treadmill", name: "Horizon Fitness Paragon X Laufband", category: "Treadmills", price: 2000, inStock: true },
    { id: "flat", name: "ATX® Flachbank mit Optionsaufnahme", category: "Exercise Benches", price: 199, inStock: true },
    { id: "rower", name: "Concept2 RowErg Rudergerät", category: "Rowing Machines", price: 1100, inStock: true },
    {
      id: "plates",
      name: "ATX® 2-Grip Hantelscheiben Guss - 30 mm",
      category: "Weight Plates",
      price: 4,
      inStock: true,
      sku: "MS-30-GXA-0050",
      variants: [
        { id: "1", title: "0,5 kg", price: 4, sku: "MS-30-GXA-0050", isDefault: true, available: true },
        { id: "2", title: "1,25 kg", price: 8, sku: "MS-30-GXA-0125", available: true },
        { id: "3", title: "2,5 kg", price: 12, available: true },
      ],
    },
    { id: "bt", name: "Bluetooth Herzfrequenz-Gurt", category: "Accessories", price: 49, inStock: true },
  ];
  // the exact word („Kurzhanteln“) and its singular before the storage rack's prefix match
  assert.deepEqual(searchCatalogCards(cat, "Kurzhanteln").map((c) => c.id), ["dumbbells", "ablage"]);
  assert.deepEqual(searchCatalogCards(cat, "kurzhantel").map((c) => c.id), ["dumbbells", "ablage"]);
  assert.deepEqual(searchCatalogCards(cat, "Laufbänder").map((c) => c.id), ["treadmill"]);
  assert.deepEqual(searchCatalogCards(cat, "Bänke").map((c) => c.id), ["flat"]);
  assert.deepEqual(searchCatalogCards(cat, "rudergeraet").map((c) => c.id), ["rower"]);
  assert.deepEqual(searchCatalogCards(cat, "hantelscheibe").map((c) => c.id), ["plates"]);
  assert.deepEqual(searchCatalogCards(cat, "MS-30-GXA-0125").map((c) => c.id), ["plates"]);
  assert.deepEqual(searchCatalogCards(cat, "bluetooth").map((c) => c.id), ["bt"]);
  // repeated queries reuse the folded fields and give the same answer
  assert.deepEqual(searchCatalogCards(cat, "Kurzhanteln").map((c) => c.id), ["dumbbells", "ablage"]);
});

test("searchCatalogCards: an „-er“ stem finds only the exact word („Ständer“, „Halter“, „Hocker“ are no plurals)", () => {
  const cat = [
    { id: "free-stands", name: "ATX® Free Stands 510", category: "Squat Racks", price: 399, inStock: true },
    { id: "plate-stand", name: "ATX® Hantelscheibenständer", category: "Free Weight Storage Racks", price: 149, inStock: true },
    { id: "kb-stand", name: "Kettlebell-Ständer mit 2 Ablagen", category: "Free Weight Storage Racks", price: 99, inStock: true },
    { id: "shock", name: "ATX® Shock Absorption Dropping Plate", category: "Floor Protection", price: 99, inStock: true },
    { id: "posture", name: "Haltungstrainer Motion Pro", category: "Strength Machines", price: 999, inStock: true },
    { id: "wall", name: "Wandhalter Hantelscheiben 30 mm", category: "Free Weight Storage Racks", price: 59, inStock: true },
    { id: "loop", name: "ATX® Loop Band", category: "Resistance Bands", price: 19, inStock: true },
    { id: "minis", name: "ATX® Mini Loop Bänder", category: "Resistance Bands", price: 29, inStock: true },
  ];
  // the whole word, then the compound — never the stem „stand“ of „Stands“
  assert.deepEqual(searchCatalogCards(cat, "Ständer").map((c) => c.id), ["kb-stand", "plate-stand"]);
  // never the prefix „halt“ („Haltungstrainer“) or the substring „hock“ („Shock“)
  assert.deepEqual(searchCatalogCards(cat, "Halter").map((c) => c.id), ["wall"]);
  assert.deepEqual(searchCatalogCards(cat, "Hocker"), []);
  // a real „-er“ plural still finds the singular word, and the other way round (the exact word first)
  assert.deepEqual(searchCatalogCards(cat, "Bänder").map((c) => c.id), ["minis", "loop"]);
  assert.deepEqual(searchCatalogCards(cat, "Band").map((c) => c.id), ["loop", "minis"]);
});

test("searchCatalogCards: the plan role the query names first, then the exact word, the shorter name, the name", () => {
  // Small copies of the real catalog: before, equal scores sorted by name, so
  // „Hanteln“ showed the dumbbell racks, „Rudergerät“ the strength machines
  // and „Bank“ the „Curl Bank“ machine first.
  const cat = [
    { id: "aerobic-rack", name: "Aerobic Hantel Rack - für bis zu 60 Trainingshanteln", category: "Uncategorized", price: 499, inStock: true },
    { id: "half-rack", name: "ATX® Half Rack - Hantel Rack - Kniebeugen-Rack - H 210 cm", category: "Power Racks", price: 899, inStock: true },
    { id: "pyramid", name: "Hantelpyramide - für 10 Paar Hanteln - schwarz", category: "Free Weight Storage Racks", price: 129, inStock: true },
    { id: "hexagon", name: "Hexagon Hanteln – Hantelsätze Gummi 5 bis 50 kg", category: "Dumbbells", price: 30, inStock: true },
    { id: "hex", name: "Hex Hanteln Gummi - 1 bis 50 kg", category: "Dumbbells", price: 10, inStock: true },
    { id: "swing", name: "NOHrD Swing Hantel Paar", category: "Dumbbells", price: 300, inStock: true },
    { id: "lateral-row", name: "ATX® Lateral Row Machine - Rudergerät", category: "Weight Lifting Machines & Racks", price: 1999, inStock: true },
    { id: "t-bar", name: "ATX® T-Bar Row Rudergerät", category: "Weight Lifting Machines & Racks", price: 899, inStock: true },
    { id: "concept2", name: "Concept2 RowErg Rudergerät", category: "Rowing Machines", price: 1100, inStock: true },
    { id: "waterrower", name: "Rudergerät WaterRower A1", category: "Rowing Machines", price: 999, inStock: true },
    { id: "waterrower-club", name: "Rudergerät WaterRower Club", category: "Rowing Machines", price: 1499, inStock: false },
    { id: "curl-bank", name: "ATX® Bizeps Maschine - Curl Bank", category: "Weight Lifting Machines & Racks", price: 799, inStock: true },
    { id: "flat", name: "ATX® Flachbank mit Optionsaufnahme", category: "Weight Benches", price: 199, inStock: true },
    { id: "foldable", name: "ATX® Hantelbank - klappbar - schwarz", category: "Weight Benches", price: 149, inStock: true },
    { id: "gun-rack", name: "Langhantelablage / Gun Rack - zur Wandbefestigung", category: "Free Weight Storage Racks", price: 89, inStock: true },
  ];
  const ids = (/** @type {string} */ q) => searchCatalogCards(cat, q, 12).map((c) => c.id);
  // „Hanteln“ names weights: the dumbbells first — the exact word before its
  // singular („Hantel“), even with a shorter name —, then the racks, then prefixes and substrings
  assert.deepEqual(ids("Hanteln"), ["hex", "hexagon", "swing", "pyramid", "aerobic-rack", "half-rack", "foldable", "gun-rack"]);
  // „Rudergerät“ names cardio: the rowers before the strength line's rowing machines; sold-out last
  assert.deepEqual(ids("Rudergerät"), ["waterrower", "concept2", "t-bar", "lateral-row", "waterrower-club"]);
  assert.deepEqual(ids("rudergeraet"), ["waterrower", "concept2", "t-bar", "lateral-row", "waterrower-club"]);
  // „Bank“ / „Bänke“ name accessories: the benches before the „Curl Bank“ machine with the exact word
  assert.deepEqual(ids("Bank"), ["flat", "foldable", "curl-bank"]);
  assert.deepEqual(ids("Bänke"), ["flat", "foldable", "curl-bank"]);
  // the role counts for name matches only: a base unit that says „Rack“ only in
  // its category stays behind the storage rack with the word in its name
  assert.deepEqual(ids("Rack"), ["aerobic-rack", "half-rack", "gun-rack", "t-bar", "curl-bank", "lateral-row", "pyramid"]);
  // a query naming no role: exact word, then the shorter name
  assert.deepEqual(ids("Paar"), ["swing", "pyramid"]);
});

test("optionStepRows: guide order, only types with counts, German labels", () => {
  assert.deepEqual(
    optionStepRows([
      { step: "weights", shown: 2, picked: 1, skipped: 0, more: 1 },
      { step: "base", shown: 3, picked: 2, skipped: 0, more: 0 },
      { step: "nope", shown: 1, picked: 0, skipped: 0, more: 0 },
      { step: "bench", shown: 0, picked: 0, skipped: 0, more: 0 },
    ]),
    [
      { step: "base", label: "Basisgerät", shown: 3, picked: 2, skipped: 0, more: 0 },
      { step: "weights", label: "Gewichte", shown: 2, picked: 1, skipped: 0, more: 1 },
      { step: "extra", label: "Extra", shown: 1, picked: 0, skipped: 0, more: 0 },
    ]
  );
  assert.deepEqual(optionStepRows([]), []);
});

test("renderConfiguratorSection: the step guide only with the widget's options, plan prices and subtotal, accessories", () => {
  const withOptions = parseConfiguratorContext(ctx({ ...fullAnswers, features: ["options"] }));
  const plan = [
    { id: "rack", qty: 1, name: "Power Rack", price: 899.9, added: true },
    { id: "plates~5", qty: 2, name: "Hantelscheibe – 5 kg", price: 15 },
  ];
  const accessories = [
    { baseId: "rack", baseName: "Power Rack", items: [{ id: "dip", name: "Dip Bar", price: 229 }, { id: "lat", name: "Latzug-Option", price: 399 }], inPlan: [] },
    { baseId: "station", baseName: "Kraftstation", items: [] },
  ];
  const de = renderConfiguratorSection({ answers: withOptions, assortment: catalog, settings: { focus: "prefer", notes: "" }, plan, accessories });
  assert.match(de, /3\. \*\*Schritt für Schritt statt eines fertigen Sets:\*\*/);
  assert.match(de, /Pro Schritt rufst du `offer_plan_options` auf: 2–3 Optionen \(höchstens 4\)/);
  assert.match(de, /„Diesen Schritt überspringe ich“\*\* → direkt zum nächsten Schritt/);
  assert.match(de, /- `offer_plan_options`: ein Aufruf pro Antwort \(plus der Ersatz für nicht gezeigte Optionen\) und kein `suggest_replies` dazu/);
  // swaps (a pick replaces the step's earlier pick; accessories / extras add), the retry for options not shown, the barbell
  assert.match(de, /\*\*Tausch\*\* \(„Ich nehme stattdessen: …“\): Eine Wahl in einer Einzelauswahl ersetzt die frühere Wahl DESSELBEN Schritts/);
  assert.match(de, /In den Schritten "accessory" und "extra" und bei multiSelect kommt eine Wahl aus einer späteren Gruppe dazu/);
  assert.match(de, /Nach einem Tausch des Basisgeräts prüf, ob das schon gewählte Zubehör noch zum neuen Basisgerät passt/);
  assert.match(de, /\*\*Nicht gezeigte Optionen:\*\* Meldet das Ergebnis von `offer_plan_options` weniger shownOptions als angebotene Optionen/);
  assert.match(de, /Braucht das Basisgerät eine Langhantel .* und ist keine im Plan, gehört sie in jede Option dieses Schritts/);
  assert.match(de, /Bänke, Hantelscheiben und Matten gehören in ihre eigenen Schritte/);
  assert.match(de, /zeig sofort die ersten Optionen \(Basisgerät\)/);
  assert.doesNotMatch(de, /3\. \*\*Der Plan:\*\*/);
  assert.match(de, /- 1× Power Rack \(`rack`\) — 899\.9 € je Stück — vom Kunden ergänzt\n- 2× Hantelscheibe – 5 kg \(`plates~5`\) — 15 € je Stück\nZwischensumme: 929\.9 €/);
  assert.match(de, /### Zubehör zu den Basisgeräten im Plan \(für den Schritt „Zubehör“\)\n- Zu Power Rack \(`rack`\): `dip` Dip Bar — 229 € · `lat` Latzug-Option — 399 €\n- Zu Kraftstation \(`station`\): keins hinterlegt/);
  assert.match(de, /passt \(was passt, steht unten in „Zubehör zu den Basisgeräten im Plan“ unter „schon im Plan“\)/);
  // accessories already in the plan: named per base, „keins hinterlegt“ only when the base lists nothing
  const swapped = [
    { baseId: "fold", baseName: "Fold Back Rack", items: [{ id: "dip", name: "Dip Bar", price: 229 }], inPlan: ["Landmine", "J-Hooks"] },
    { baseId: "station", baseName: "Kraftstation", items: [], inPlan: ["Latzug-Option"] },
  ];
  const deSwap = renderConfiguratorSection({ answers: withOptions, assortment: [], settings: { focus: "prefer", notes: "" }, plan, accessories: swapped });
  assert.match(deSwap, /- Zu Fold Back Rack \(`fold`\): `dip` Dip Bar — 229 €; schon im Plan: Landmine, J-Hooks\n- Zu Kraftstation \(`station`\): schon im Plan: Latzug-Option — weiteres Zubehör mit search_products suchen/);
  assert.doesNotMatch(deSwap, /keins hinterlegt/);
  const enSwap = renderConfiguratorSection({ answers: withOptions, assortment: [], settings: { focus: "prefer", notes: "" }, plan, accessories: swapped, locale: "en" });
  assert.match(enSwap, /- For Fold Back Rack \(`fold`\): `dip` Dip Bar — 229 €; already in the plan: Landmine, J-Hooks\n- For Kraftstation \(`station`\): already in the plan: Latzug-Option — find further accessories with search_products/);
  assert.match(enSwap, /\(the fitting ones are named under "already in the plan" in "Accessories for the base units in the plan" below\)/);
  assert.match(de, /\*\*Gewichte mit mehreren Gewichtsstufen\*\*/);

  const en = renderConfiguratorSection({ answers: withOptions, assortment: catalog, settings: { focus: "prefer", notes: "" }, plan, accessories, locale: "en" });
  assert.match(en, /3\. \*\*Step by step instead of a finished set:\*\*/);
  assert.match(en, /Subtotal: 929\.9 €/);
  assert.match(en, /### Accessories for the base units in the plan/);
  assert.doesNotMatch(en, /Schritt für Schritt|Zwischensumme/);
  // the English page's button labels, never the German ones
  assert.match(en, /point to "Add everything to cart" in the plan/);
  assert.match(en, /add weight steps with "\+ Weight step" and further products with "\+ Add a product"/);
  assert.doesNotMatch(en, /Alles in den Warenkorb|Gewichtsstufe|Produkt hinzufügen/);
  assert.match(en, /\*\*Swap\*\* \("Instead I'll take: …"\)/);
  assert.match(en, /\*\*Options not shown:\*\* if the result of `offer_plan_options` reports fewer shownOptions/);
  assert.match(en, /If the base unit needs a barbell/);

  // an old widget (no "options"): the one-plan guide, no accessories block, no options rule
  const old = renderConfiguratorSection({ answers: parseConfiguratorContext(ctx(fullAnswers)), assortment: catalog, settings: { focus: "prefer", notes: "" }, plan, accessories });
  assert.match(old, /3\. \*\*Der Plan:\*\* Stell mit `show_gym_plan` EIN stimmiges Set zusammen/);
  assert.doesNotMatch(old, /offer_plan_options|Zubehör zu den Basisgeräten/);
  assert.match(old, /Zwischensumme: 929\.9 €/);
  // … in English with the English page's buttons too
  const oldEn = renderConfiguratorSection({ answers: parseConfiguratorContext(ctx(fullAnswers)), assortment: catalog, settings: { focus: "prefer", notes: "" }, plan, accessories, locale: "en" });
  assert.match(oldEn, /3\. \*\*The plan:\*\* put together ONE coherent set with `show_gym_plan`/);
  assert.match(oldEn, /add further weight steps with "\+ Weight step" and further products with "\+ Add a product"/);
  assert.doesNotMatch(oldEn, /Gewichtsstufe|Produkt hinzufügen/);
  // a line without a price: no subtotal
  const partial = renderConfiguratorSection({ answers: withOptions, assortment: [], settings: { focus: "prefer", notes: "" }, plan: [{ id: "rack", qty: 1, name: "Rack" }] });
  assert.doesNotMatch(partial, /Zwischensumme: /);
  assert.match(partial, /- 1× Rack \(`rack`\)$/m);
});

test("planAccessoryBases: the most expensive strength base first, add-ons related to a kept base left out, else the cardio machine", () => {
  const rack = { id: "rack", name: "Power Rack 520", category: "Power Racks", price: 1500, compatibleWith: ["mat", "jhooks", "lat~5", "bench"] };
  const jhooks = { id: "jhooks", name: "J-Hooks Type 5", category: "Power Racks", price: 120, compatibleWith: ["smith"] };
  const lat = { id: "lat", name: "Latzug-Option LTO-II", category: "Power Racks", price: 600, compatibleWith: ["rack"] };
  const station = { id: "station", name: "Kraftstation", category: "Kraftstation", price: 2000, compatibleWith: ["rack"] };
  const rower = { id: "rower", name: "Concept2 RowErg Rudergerät", category: "Rowing Machines", price: 1000, compatibleWith: ["c2-mat", "slides", "skierg"] };
  const plates = { id: "plates", name: "Hantelscheiben", category: "Weight Plates", price: 50 };
  // J-Hooks / Latzug-Option picked as accessories are no bases of their own
  assert.deepEqual(planAccessoryBases([rack, jhooks, plates, lat]).map((p) => p.id), ["rack"]);
  // related bases: the more expensive one stays, in either plan order and either direction
  assert.deepEqual(planAccessoryBases([station, rack]).map((p) => p.id), ["station"]);
  assert.deepEqual(planAccessoryBases([rack, station]).map((p) => p.id), ["station"]);
  const mutual = { ...rack, compatibleWith: [...rack.compatibleWith, "station"] };
  assert.deepEqual(planAccessoryBases([mutual, station]).map((p) => p.id), ["station"]);
  // an add-on that lists the rack one-way (Jammer Arms) never pushes the rack out
  const prx780 = { id: "prx780", name: "Power Rack PRX-780", category: "Power Racks", price: 1299, compatibleWith: ["dip", "landmine"] };
  const jammer = { id: "jammer", name: "3D Jammer Arms RRL-700", category: "Power Racks", price: 459, compatibleWith: ["prx780", "prx-other", "half-rack"] };
  assert.deepEqual(planAccessoryBases([prx780, jammer]).map((p) => p.id), ["prx780"]);
  assert.deepEqual(planAccessoryBases([jammer, prx780]).map((p) => p.id), ["prx780"]);
  // a swap of the base unit: the widget appends the new rack AFTER the add-ons picked for
  // the old one — the Landmine the new rack lists is no base of its own (the J-Hooks 500 fit
  // no base in the plan and stay one: the plan context carries no pick step)
  const pr520 = { id: "pr520", name: "Power Rack 520 mit Latzug", category: "Power Racks", price: 1800, compatibleWith: ["jhooks5", "dip500", "landmine"] };
  const jhooks5 = { id: "jhooks5", name: "J-Hooks Type 5 / Serie 500", category: "Power Racks", price: 150, compatibleWith: ["storage", "smith", "prx520"] };
  const landmine = { id: "landmine", name: "Core Trainer Landmine", category: "Power Racks", price: 100, compatibleWith: ["bar", "row-grip"] };
  const fold = { id: "fold", name: "Fold Back Rack 750", category: "Power Racks", price: 1300, compatibleWith: ["dip700", "landmine~3", "jammer"] };
  assert.deepEqual(planAccessoryBases([pr520, jhooks5, landmine]).map((p) => p.id), ["pr520"]);
  assert.deepEqual(planAccessoryBases([jhooks5, landmine, fold]).map((p) => p.id), ["fold", "jhooks5"]);
  // the new rack lists every add-on picked before: it is the only base
  assert.deepEqual(planAccessoryBases([jhooks5, landmine, { ...fold, compatibleWith: [...fold.compatibleWith, "jhooks5"] }]).map((p) => p.id), ["fold"]);
  // an add-on dearer than its rack (Latzug-Option with its weight stack, 3D Jammer Arms) still
  // ranks behind it — mutual and one-way, in either plan order; „Rack mit Latzug-Option“ is a rack
  const lto = { id: "lto780", name: "ATX® Latzug Option LTO-780 - 125 kg", category: "Power Racks", price: 1199, compatibleWith: ["prx780", "handles"] };
  assert.deepEqual(planAccessoryBases([prx780, lto]).map((p) => p.id), ["prx780"]);
  assert.deepEqual(planAccessoryBases([lto, prx780]).map((p) => p.id), ["prx780"]);
  const ltoMutual = { ...prx780, compatibleWith: [...prx780.compatibleWith, "lto780"] };
  assert.deepEqual(planAccessoryBases([lto, ltoMutual]).map((p) => p.id), ["prx780"]);
  assert.deepEqual(planAccessoryBases([{ ...jammer, price: 1999 }, prx780]).map((p) => p.id), ["prx780"]);
  const rackWithLat = { id: "pr520lat", name: "ATX® Power Rack 520 mit Latzug-Option", category: "Power Racks", price: 1499, compatibleWith: ["jhooks5"] };
  assert.deepEqual(planAccessoryBases([jhooks5, rackWithLat]).map((p) => p.id), ["pr520lat"]);
  // sale price counts
  assert.deepEqual(planAccessoryBases([{ ...rack, id: "dear", compatibleWith: ["cheap"], price: 2000, salePrice: 400 }, { ...rack, id: "cheap", compatibleWith: [], price: 900 }]).map((p) => p.id), ["cheap"]);
  // equal prices: the root (no other base lists it) before the one it lists, then plan order
  const ra = { id: "ra", name: "Rack A", category: "Power Racks", price: 500 };
  const rb = { id: "rb", name: "Rack B", category: "Power Racks", price: 500, compatibleWith: ["ra"] };
  assert.deepEqual(planAccessoryBases([ra, rb]).map((p) => p.id), ["rb"]);
  assert.deepEqual(planAccessoryBases([rb, ra]).map((p) => p.id), ["rb"]);
  // the cardio machine is the base only without a strength base
  assert.deepEqual(planAccessoryBases([rower, plates]).map((p) => p.id), ["rower"]);
  assert.deepEqual(planAccessoryBases([rower, rack]).map((p) => p.id), ["rack"]);
  assert.deepEqual(planAccessoryBases([plates]), []);
  assert.deepEqual(planAccessoryBases([]), []);
  const many = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, name: `Rack ${i}`, category: "Power Racks" }));
  assert.equal(planAccessoryBases(many).length, ACCESSORY_LIMITS.bases);
  assert.deepEqual(planAccessoryBases(many).map((p) => p.id), ["r0", "r1", "r2"]);
  // the ids to load: the first ACCESSORY_LIMITS.scan of each base, variant refs folded, once
  const long = { id: "big", name: "Big Rack", category: "Power Racks", compatibleWith: Array.from({ length: 30 }, (_, i) => `a${i}~1`) };
  assert.equal(planAccessoryIds([long]).length, ACCESSORY_LIMITS.scan);
  assert.deepEqual(planAccessoryIds([rack, { compatibleWith: ["mat", "dip"] }]), ["mat", "jhooks", "lat", "bench", "dip"]);
});

test("planAccessories: in stock, without weights, floor protection and cardio, capped; what is already in the plan named, not offered", () => {
  const byId = new Map(
    [
      { id: "mat", name: "Bodenschutzmatte Excellence", category: "Floor Protection Mats", price: 49, inStock: true },
      { id: "dip", name: "Dip Bar", category: "Power Rack Accessories", price: 229, salePrice: 199, inStock: true },
      { id: "plates", name: "Hantelscheiben Guss", category: "Weight Plates", price: 4, inStock: true },
      { id: "lat", name: "Latzug-Option", category: "Power Racks", price: 399, inStock: true },
      { id: "gone", name: "Landmine", category: "Power Rack Accessories", price: 99, inStock: false },
      { id: "bench", name: "Flachbank", category: "Exercise Benches", price: 199, inStock: true },
      { id: "skierg", name: "Concept2 SkiErg", category: "Cardio Machines", price: 1200, inStock: true },
      { id: "slides", name: "Concept2 Slide - Paar", category: "Rowing Machine Accessories & Parts", price: 300, inStock: true },
    ].map((p) => [p.id, p])
  );
  const rack = { id: "rack", name: "Power Rack", compatibleWith: ["mat", "dip~7", "plates", "lat", "gone", "bench", "ghost", "dip"] };
  const rower = { id: "rower", name: "RowErg", compatibleWith: ["mat", "skierg", "slides"] };
  assert.deepEqual(planAccessories([rack, rower], byId, ["rack", "lat~3", "gone", "mat", "skierg"]), [
    {
      baseId: "rack",
      baseName: "Power Rack",
      items: [
        { id: "dip", name: "Dip Bar", price: 199 },
        { id: "bench", name: "Flachbank", price: 199 },
      ],
      // in the plan (a sold-out one too): named, not offered; weights / floor / cardio never
      inPlan: ["Latzug-Option", "Landmine"],
    },
    { baseId: "rower", baseName: "RowErg", items: [{ id: "slides", name: "Concept2 Slide - Paar", price: 300 }], inPlan: [] },
  ]);
  const many = new Map(Array.from({ length: 15 }, (_, i) => [`d${i}`, { id: `d${i}`, name: `Dip ${i}`, category: "Accessories", price: 10, inStock: true }]));
  assert.equal(planAccessories([{ id: "x", name: "X", compatibleWith: [...many.keys()] }], many, []).at(0)?.items.length, ACCESSORY_LIMITS.items);
  // the cap counts offers only: a plan product after it is still named
  const capped = planAccessories([{ id: "x", name: "X", compatibleWith: [...many.keys()] }], many, ["d14"]).at(0);
  assert.equal(capped?.items.length, ACCESSORY_LIMITS.items);
  assert.deepEqual(capped?.inPlan, ["Dip 14"]);
  assert.deepEqual(planAccessories([], byId, []), []);
});

test("tool copy of offer_plan_options exists in both locales", () => {
  for (const locale of ["de", "en"]) {
    const c = configuratorToolCopy(locale);
    for (const key of ["offerOptionsDesc", "fieldOptionsStep", "fieldOptionsTitle", "fieldOptionsIntro", "fieldOptionsMulti", "fieldOptionsList"]) {
      assert.ok(typeof c[key] === "string" && c[key].length > 20, `${locale}.${key}`);
    }
  }
});
