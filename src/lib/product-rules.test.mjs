import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RULES,
  MO_RULE_METAFIELDS,
  PRODUCT_RULES,
  RULE_LIMITS,
  areaFromDescription,
  areaFromText,
  coverageFromDimensions,
  lineCapOf,
  normalizeAreaM2,
  normalizeQuantity,
  packCountFromText,
  parseMoRuleMetafields,
  publicRules,
  resolveProductRules,
  ruleBadges,
  ruleFacts,
  ruleHint,
  ruleRegistryOverview,
  salesUnitOf,
  validateLines,
  validateOptions,
} from "./product-rules.mjs";
import { CONFIGURATOR_LIMITS } from "./configurator-core.mjs";

const product = (over = {}) => ({
  id: "p",
  name: "Produkt",
  category: "Sonstiges",
  price: 10,
  inStock: true,
  tags: [],
  shortDescription: "",
  detailedDescription: "",
  specifications: {},
  ...over,
});
const plate = (over = {}) =>
  product({
    id: "plates",
    name: "Hantelscheiben Guss 50 mm - 1,25 bis 25 kg",
    category: "Weight Plates",
    detailedDescription: "Alle genannten Preise gelten pro Stück!",
    variants: [
      { id: "11", title: "5 kg", price: 15, available: true, isDefault: true },
      { id: "12", title: "10 kg", price: 30, available: true, isDefault: false },
    ],
    ...over,
  });
const dumbbell = (over = {}) => product({ id: "db", name: "Urethan Dumbbells ATX® Kurzhanteln - 2,5 kg bis 60 kg", category: "Dumbbells", ...over });
const tile = (over = {}) => product({ id: "mat", name: "Bodenschutzmatte Standard 1000 x 1000 x 15 / 20 mm", category: "Floor Protection Mats", ...over });
const ids = (r) => r.ruleIds;

test("registry: unique ids, both labels, a description and an effect per rule", () => {
  const seen = new Set();
  for (const r of PRODUCT_RULES) {
    assert.match(r.id, /^[a-z]+(?:-[a-z]+)*$/);
    assert.equal(seen.has(r.id), false, r.id);
    seen.add(r.id);
    assert.ok(r.label.de && r.label.en && r.label.de !== r.label.en, r.id);
    assert.ok(r.description.length > 20 && r.effect.length > 3, r.id);
    assert.ok(r.when && r.effects, r.id);
  }
  assert.deepEqual([...seen], ["plates-pairs", "dumbbells-pairs", "flooring-room"]);
  // a plan line holds 20, a floor line 200 — the configurator's parsers clamp at the floor line's cap
  assert.equal(RULE_LIMITS.lineMax, 20);
  assert.equal(RULE_LIMITS.floorLineMax, 200);
  assert.equal(RULE_LIMITS.floorLineMax, CONFIGURATOR_LIMITS.planQuantityMax);
  assert.deepEqual(resolveProductRules(product()), { ...DEFAULT_RULES, ruleIds: [] });
  assert.deepEqual(resolveProductRules(null), { ...DEFAULT_RULES, ruleIds: [] });
});

test("salesUnitOf: the merchant's Liefereinheit (Stück / Paar / Set), unknown without", () => {
  assert.equal(salesUnitOf(product({ specifications: { Liefereinheit: "Stück" } })), "piece");
  assert.equal(salesUnitOf(product({ specifications: { Liefereinheit: "Sück" } })), "piece"); // the shop's typo
  assert.equal(salesUnitOf(product({ specifications: { Liefereinheit: "Paar" } })), "pair");
  assert.equal(salesUnitOf(product({ specifications: { Liefereinheit: "Set" } })), "set");
  assert.equal(salesUnitOf(product()), "unknown");
  assert.equal(salesUnitOf(null), "unknown");
});

test("plates: single plates per piece in pairs — sets, packs, pairs and vest plates never", () => {
  const r = resolveProductRules(plate());
  assert.equal(r.step, 2);
  assert.equal(r.min, 2);
  assert.deepEqual(ids(r), ["plates-pairs"]);
  assert.equal(resolveProductRules(plate({ specifications: { Liefereinheit: "Stück" } })).step, 2);
  // bumper plates / technique plates by name, also outside the plates category
  assert.equal(resolveProductRules(product({ name: "ATX® Hantelscheibe -Technikscheibe - Abwurftraining 2,5 + 5 kg", category: "Weight Plates" })).step, 2);
  assert.equal(resolveProductRules(product({ name: "Hantelscheiben Gummi Gripper 50 mm 0,5 bis 25 kg", category: "Uncategorized" })).step, 2);
  for (const name of [
    "ATX® Bumper Plate Barbell Club - 150 kg Set",
    "150 kg ATX® Gym Bumper Plates - Vorteilspaket",
    "ATX® HQ Bumper Plates Hantelscheiben Set – 140 kg",
    "Vorteilspaket Polyurethan 4-Grip Hantelscheiben 30 mm – 125 kg",
    "ATX® Add-On Flex Plate - Paar",
  ]) {
    assert.equal(resolveProductRules(plate({ name })).step, 1, name);
  }
  assert.equal(resolveProductRules(product({ name: "ATX® Tactical Weight Vest Plates - Gewichtsplatten", category: "Weighted Vests" })).step, 1);
  // the sales unit decides when the shop maintains it …
  assert.equal(resolveProductRules(plate({ specifications: { Liefereinheit: "Paar" } })).step, 1);
  assert.equal(resolveProductRules(plate({ specifications: { Liefereinheit: "Set" } })).step, 1);
  // … and the description's pricing unit when it does not
  assert.equal(resolveProductRules(plate({ detailedDescription: "Bestelleinheit / Preisstellung: Paarweise" })).step, 1);
  // not a weight at all: a plate-loaded machine, a dropping plate, a plate tree
  assert.equal(resolveProductRules(product({ name: "Hip Thruster Machine Plate Load", category: "Weight Lifting Machines & Racks" })).step, 1);
  assert.equal(resolveProductRules(product({ name: "ATX® Shock Absorption Dropping Plate - 40 mm", category: "Free Weight Accessories" })).step, 1);
  assert.equal(resolveProductRules(product({ name: "ATX® Weight Plate Tree Ø 50 mm Hantelscheibenständer", category: "Free Weight Storage Racks" })).step, 1);
});

test("dumbbells: single dumbbells per piece in pairs — sets, pairs, adjustables and kettlebells never", () => {
  for (const name of [
    "Urethan Dumbbells ATX® Kurzhanteln - 2,5 kg bis 60 kg",
    "Hex Hanteln Gummi - 1 bis 50 kg",
    "Trainingshanteln Chrom - 1 bis 10 kg",
    "Vinyl Hanteln 0,5 kg bis 5 kg",
    "Kompakthanteln Gummi - mit ATX/ Barbell Club Logo - 2,5 – 60 kg / 2,5 kg Steigerung",
    "Kurzhantelstange Gewinde 30 mm",
  ]) {
    const r = resolveProductRules(dumbbell({ name }));
    assert.equal(r.step, 2, name);
    assert.deepEqual(ids(r), ["dumbbells-pairs"], name);
  }
  // „Trainingshanteln … mit Hantelpaaren“ in the text is no pair pricing
  assert.equal(resolveProductRules(dumbbell({ name: "Trainingshanteln Chrom - 1 bis 10 kg", detailedDescription: "auch als Hantelsatz mit Hantelpaaren. Preis per Stück." })).step, 2);
  for (const name of [
    "Hantelset Hex 5 bis 20/ 30/ 40 kg + Ablage",
    "Kurzhantel-Set 30 kg Guss",
    "Hex Hantelsatz Gummi - 1 bis 25 kg",
    "CHD-Kompletthantelsätze - Gummi - 2,5 kg Steigung - 5 bis 70 kg",
    "Vorteilspaket! Hex Hantelsatz Gummi - 1 bis 10 kg + Hantelablage",
    "CHD Kompakthanteln Guss - 2,5 kg-Steigung - Paarweise - glatt",
    "NOHrD Swing Hantel Paar 1 bis 8 kg",
    "ATX® Octa-Dumbbells 2 x 24 kg - Verstellbare Hanteln inkl. Ablageständer",
    "ATX® Nüobell Kompakthantel 2 - 32 kg",
    "Original Nüobell® 5 bis 80 lb (ca. 2,3 - 36 kg)",
  ]) {
    assert.equal(resolveProductRules(dumbbell({ name })).step, 1, name);
  }
  // CHD „bis 72 kg“: the name says nothing, the pricing unit says pairs
  assert.equal(resolveProductRules(dumbbell({ name: "CHD Guss-Kompakthanteln - bis 72 kg in 2 kg-Steigung", detailedDescription: "Preisstellung paarweise" })).step, 1);
  assert.equal(resolveProductRules(dumbbell({ name: "CHD Guss-Kompakthanteln - bis 72 kg in 2 kg-Steigung", specifications: { Liefereinheit: "Paar" } })).step, 1);
  // kettlebells: no pair rule
  for (const name of ["ATX® Kettlebell - Guss - von 8 bis 48 kg", "Competition Kettlebell - PB Strong 8 bis 48 kg"]) {
    assert.equal(resolveProductRules(product({ name, category: "Kettlebells" })).step, 1, name);
  }
});

test("areaFromText / packCountFromText: the size of one piece and the pieces of a pack", () => {
  assert.equal(areaFromText("Bodenschutzmatte Standard 1000 x 1000 x 15 / 20 mm"), 1);
  assert.equal(areaFromText("Gymfloor® - Granulat Schutzplatten 500 x 500 x 30 mm"), 0.25);
  assert.equal(areaFromText("Puzzleplatte Excellence 980 x 980 x 10 mm"), 0.9604);
  assert.equal(areaFromText("Kampfsportmatte Double Competition Profi 100x100x2,0cm"), 1);
  assert.equal(areaFromText("Weight Lifting Platform 3 x 3 m"), 9);
  assert.equal(areaFromText("Set 10 Stück - Bodenschutzmatte Excellence 1000 x 1000"), 1); // no unit: ≥ 300 → mm
  assert.equal(areaFromText("Unterlegmatte 70 x 140 cm"), 0.98);
  assert.equal(areaFromText("Matte 60 x 60"), 0.36); // no unit: 30–299 → cm
  assert.equal(areaFromText("Hantelscheibe 5 kg"), null);
  assert.equal(areaFromText(null), null);
  assert.equal(packCountFromText("Set 10 Stück - Bodenschutzmatte Excellence 1000 x 1000"), 10);
  assert.equal(packCountFromText("Bodenschutzmatten 10er-Set"), 10);
  assert.equal(packCountFromText("Profi Gymnastikmatte schwarz Set - 5 Stück"), 5);
  assert.equal(packCountFromText("Bodenschutzmatte 1000 x 1000"), null);
  assert.equal(packCountFromText("1 Stück"), null);
});

test("flooring: tiles with dimensions cover the room; gym mats, mats under one machine, accessories never", () => {
  const r = resolveProductRules(tile());
  assert.equal(r.coverageM2, 1);
  assert.equal(r.fillsRoom, true);
  assert.equal(r.step, 1);
  assert.deepEqual(ids(r), ["flooring-room"]);
  assert.equal(resolveProductRules(tile({ name: "Set 10 Stück - Bodenschutzmatte Excellence 1000 x 1000" })).coverageM2, 10);
  assert.equal(resolveProductRules(tile({ name: "Gymfloor® - Granulat Schutzplatten 500 x 500 x 30 mm" })).coverageM2, 0.25);
  assert.equal(resolveProductRules(tile({ name: "Puzzleplatte Excellence 980 x 980 x 10 mm" })).coverageM2, 0.96);
  assert.equal(resolveProductRules(tile({ name: "Fallschutzplatte Antishock 1000 x 1000 x 40 mm" })).coverageM2, 1);
  // a floor tile outside the flooring category (role extra) — by name
  assert.equal(resolveProductRules(product({ name: "Fallschutzplatte / Gewichthebermatte 1000 x 1000 x 40 mm", category: "Weight Lifting" })).fillsRoom, true);
  // without dimensions: from the catalog's width × depth, else no rule at all
  assert.equal(resolveProductRules(tile({ name: "Fallschutzplatte / Gewichthebermatte 40 mm", dimensions: { width: 101, height: 4, depth: 101, weight: 35 } })).coverageM2, 1.02);
  assert.equal(resolveProductRules(tile({ name: "Fallschutzplatte / Gewichthebermatte 40 mm", footprintM2: 1 })).coverageM2, 1);
  const bare = resolveProductRules(tile({ name: "Fallschutzplatte / Gewichthebermatte 40 mm" }));
  assert.equal(bare.coverageM2, null);
  assert.equal(bare.fillsRoom, false);
  assert.deepEqual(ids(bare), []);
  // … else from the description's „Länge … Breite …“ (the last source): the real 40 mm plate, 101 × 101 cm
  const described = resolveProductRules(
    product({
      name: "Fallschutzplatte / Gewichthebermatte 40 mm",
      category: "Weight Lifting",
      dimensions: { width: 0, height: 0, depth: 0, weight: 35 },
      detailedDescription: "Produktdetails\n\nLänge: 101 cm +/- 1 %\n\nBreite: 101 cm +/- 1 %\n\nStärke: 40 mm +/- 1 mm",
    })
  );
  assert.deepEqual([described.coverageM2, described.fillsRoom, ids(described)], [1.02, true, ["flooring-room"]]);
  // the name and the catalog dimensions come first
  assert.equal(resolveProductRules(tile({ detailedDescription: "Länge: 50 cm\nBreite: 50 cm" })).coverageM2, 1);
  // only for floor tiles by name — a bench or a gym mat with „Länge/Breite“ gets no coverage
  for (const [name, category] of [
    ["Flachbank Hantelbank", "Exercise Benches"],
    ["AIREX® Gymnastikmatte Fitline", "Gym Mats"],
    ["Bodenschutzmatte Yoga", "Yoga & Pilates Mats"],
  ]) {
    const x = resolveProductRules(product({ name, category, detailedDescription: "Länge: 100 cm\nBreite: 100 cm" }));
    assert.equal(x.coverageM2, null, name);
  }
  // implausible sizes
  assert.equal(resolveProductRules(tile({ name: "Bodenschutzplatte 10 x 10 mm" })).coverageM2, null);
  assert.equal(resolveProductRules(tile({ name: "Bodenschutzmatte 5 x 4 m" })).coverageM2, null);
  for (const [name, category] of [
    ["AIREX® Sportmatte Corona 200 x 100 cm", "Floor Protection Mats"],
    ["AIREX® Gymnastikmatte Fitline 180 x 60 cm", "Gym Mats"],
    ["Yogamatte Kork 180 x 60 x 0,4 cm", "Yoga & Pilates Mats"],
    ["Unterlegmatte Johnson Fitness 100 x 200 cm", "Floor Protection Mats"],
    ["Concept2 RowErg Unterlegmatte", "Floor Protection Mats"],
    ["Kampfsportmatte 100 x 100 x 2 cm", "Boxing & Martial Arts Training Equipment"],
    ["Komplette Bodenschutzfläche - für Power Racks", "Floor Protection Mats"],
    ["PU Reiniger - Bodenreiniger - Konzentrat im 5 Liter Kanister", "Floor Protection Mats"],
    ["Grip Tape - doppelseitiges Klebeband - Rolle 25 m x 50 mm", "Floor Protection Mats"],
    ["Vollgummirampe, Aufgang 20/30/40 mm", "Floor Protection Mats"],
    ["ATX® Weight Lifting Platform 3 x 3 m - Customize", "Weight Lifting"],
  ]) {
    const x = resolveProductRules(product({ name, category }));
    assert.equal(x.fillsRoom, false, name);
    assert.equal(x.coverageM2, null, name);
  }
});

test("flooring variants: connectors, tape and edge pieces cover nothing; a variant's own size wins", () => {
  const gym = tile({ name: "Gymfloor® - Granulat Schutzplatten 500 x 500 x 30 mm" });
  assert.equal(resolveProductRules(gym, { variant: { id: "1", title: "Basisplatte" } }).coverageM2, 0.25);
  assert.equal(resolveProductRules(gym, { variant: { id: "2", title: "Randplatte" } }).coverageM2, 0.25);
  const frog = resolveProductRules(gym, { variant: { id: "3", title: "Verbinder-Frog" } });
  assert.equal(frog.coverageM2, null);
  assert.equal(frog.fillsRoom, false);
  const puzzle = tile({ name: "Puzzleplatte Excellence 980 x 980 x 10 mm" });
  assert.equal(resolveProductRules(puzzle, { variant: { id: "4", title: "Base" } }).coverageM2, 0.96);
  for (const title of ["Rechts", "Links", "Gerade"]) {
    assert.equal(resolveProductRules(puzzle, { variant: { id: "5", title } }).coverageM2, null, title);
  }
  assert.equal(coverageFromDimensions(tile({ name: "Bodenschutzplatte" }), { id: "6", title: "500 x 1000 mm" }), 0.5);
  assert.equal(coverageFromDimensions(tile({ name: "Bodenschutzplatte 1000 x 1000 mm" }), { id: "7", title: "4 Stück" }), 4);
});

test("parseMoRuleMetafields: Shopify values and text, invalid ones ignored, null when none", () => {
  const get = (o) => (k) => o[k];
  assert.equal(parseMoRuleMetafields(get({})), null);
  assert.deepEqual(MO_RULE_METAFIELDS, ["sold_in_pairs", "quantity_step", "min_quantity", "max_quantity", "coverage_m2"]);
  assert.deepEqual(
    parseMoRuleMetafields(get({ sold_in_pairs: "true", quantity_step: "2", min_quantity: "4", max_quantity: "60", coverage_m2: "1.0" })),
    { soldInPairs: true, quantityStep: 2, minQuantity: 4, maxQuantity: 60, coverageM2: 1 }
  );
  assert.deepEqual(parseMoRuleMetafields(get({ sold_in_pairs: "Nein", coverage_m2: "0,25" })), { soldInPairs: false, coverageM2: 0.25 });
  assert.deepEqual(parseMoRuleMetafields(get({ coverage_m2: "0" })), { coverageM2: 0 });
  assert.equal(
    parseMoRuleMetafields(get({ sold_in_pairs: "vielleicht", quantity_step: "0", min_quantity: "-1", max_quantity: "abc", coverage_m2: "-3" })),
    null
  );
  assert.equal(parseMoRuleMetafields(get({ quantity_step: "21" })), null); // above the plan line's cap
});

test("metafields beat the registry", () => {
  // not in pairs after all
  const single = resolveProductRules(plate({ moRules: { soldInPairs: false } }));
  assert.equal(single.step, 1);
  assert.equal(single.min, 1);
  assert.deepEqual(ids(single), ["mo.sold_in_pairs"]);
  // pairs where the registry has none (a kettlebell)
  const kb = resolveProductRules(product({ name: "Kettlebell 16 kg", category: "Kettlebells", moRules: { soldInPairs: true } }));
  assert.equal(kb.step, 2);
  assert.equal(kb.min, 2);
  assert.deepEqual(ids(kb), ["mo.sold_in_pairs"]);
  // a step of 3: the minimum follows the step
  const three = resolveProductRules(plate({ moRules: { quantityStep: 3 } }));
  assert.equal(three.step, 3);
  assert.equal(three.min, 3);
  // a minimum is rounded up to the step
  assert.equal(resolveProductRules(plate({ moRules: { minQuantity: 3 } })).min, 4);
  // a max below the pair step: one at most
  const one = resolveProductRules(plate({ moRules: { maxQuantity: 1 } }));
  assert.deepEqual([one.step, one.min, one.max], [1, 1, 1]);
  // coverage from the metafield; 0 switches a derived coverage off
  const cov = resolveProductRules(product({ name: "Gummimatte Rolle", category: "Floor Protection Mats", moRules: { coverageM2: 2.5 } }));
  assert.equal(cov.coverageM2, 2.5);
  assert.equal(cov.fillsRoom, true);
  assert.deepEqual(ids(cov), ["mo.coverage_m2"]);
  const off = resolveProductRules(tile({ moRules: { coverageM2: 0 } }));
  assert.equal(off.coverageM2, null);
  assert.equal(off.fillsRoom, false);
  // any positive coverage means the whole room (L1) — also a product whose plan role is not flooring
  const heavy = resolveProductRules(product({ name: "Fallschutzplatte / Gewichthebermatte 40 mm", category: "Weight Lifting", moRules: { coverageM2: 1.02 } }));
  assert.deepEqual([heavy.coverageM2, heavy.fillsRoom, ids(heavy)], [1.02, true, ["mo.coverage_m2"]]);
  const other = resolveProductRules(product({ name: "Rack-Unterlage", category: "Power Racks", moRules: { coverageM2: 1 } }));
  assert.equal(other.fillsRoom, true);
  assert.deepEqual(publicRules(other), { coverageM2: 1 });
  // 0 switches coverage AND the whole room off, also for a product the registry derived none for
  const zero = resolveProductRules(product({ name: "Yogamatte XL", category: "Yoga & Pilates Mats", moRules: { coverageM2: 0 } }));
  assert.deepEqual([zero.coverageM2, zero.fillsRoom, publicRules(zero)], [null, false, undefined]);
  // an edge-piece / connector variant covers nothing, also with the metafield (L6, like the widget's cfgRulesOf)
  const gym = product({ name: "Gymfloor® Schutzplatten", category: "Floor Protection Mats", moRules: { coverageM2: 0.25 }, variants: [{ id: "71", title: "Basisplatte" }, { id: "72", title: "Verbinder-Frog" }, { id: "73", title: "Rechts" }] });
  assert.equal(resolveProductRules(gym, { variant: gym.variants[0] }).coverageM2, 0.25);
  for (const variant of gym.variants.slice(1)) {
    const edge = resolveProductRules(gym, { variant });
    assert.deepEqual([edge.coverageM2, edge.fillsRoom, publicRules(edge), ids(edge)], [null, false, undefined, []], variant.title);
  }
  const byGym = new Map([[gym.id, gym]]);
  const sized = validateLines([{ productId: `${gym.id}~71`, quantity: 4 }, { productId: `${gym.id}~72`, quantity: 10 }], byGym, { areaM2: 5 });
  assert.deepEqual(sized.lines.map((l) => l.quantity), [20, 10]);
  assert.deepEqual(sized.coverage.lines.map((l) => l.productId), [`${gym.id}~71`]);
});

test("showroom: the flag from the showroom ids (Set, array or none)", () => {
  assert.equal(resolveProductRules(product({ id: "rack" }), { showroomIds: new Set(["rack"]) }).showroom, true);
  assert.equal(resolveProductRules(product({ id: "rack" }), { showroomIds: ["bank", "rack"] }).showroom, true);
  assert.equal(resolveProductRules(product({ id: "rack" }), { showroomIds: ["bank"] }).showroom, false);
  assert.equal(resolveProductRules(product({ id: "rack" }), { showroomIds: null }).showroom, false);
  assert.equal(resolveProductRules(product({ id: "rack" })).showroom, false);
});

test("normalizeQuantity: at least min, rounded up to the step, never above the cap", () => {
  const pairs = { step: 2, min: 2, max: null };
  assert.deepEqual([1, 2, 3, 4, 5, 19, 20, 21].map((q) => normalizeQuantity(q, pairs)), [2, 2, 4, 4, 6, 20, 20, 20]);
  assert.equal(normalizeQuantity(0, pairs), 2);
  assert.equal(normalizeQuantity("x", pairs), 2);
  assert.equal(normalizeQuantity(25, { step: 3, min: 3, max: null }), 18);
  assert.equal(normalizeQuantity(5, { step: 1, min: 1, max: 4 }), 4);
  assert.equal(normalizeQuantity(1, { step: 1, min: 3, max: null }), 3);
  assert.equal(normalizeQuantity(7, null), 7);
  assert.equal(normalizeQuantity(99, undefined), RULE_LIMITS.lineMax);
  assert.equal(normalizeQuantity(-2, DEFAULT_RULES), 1);
  // a floor line (a coverage) holds up to 200; a lower floor cap for a widget without rules
  const floor = { step: 1, min: 1, max: null, coverageM2: 1 };
  assert.equal(normalizeQuantity(150, floor), 150);
  assert.equal(normalizeQuantity(250, floor), RULE_LIMITS.floorLineMax);
  assert.equal(normalizeQuantity(150, floor, { floorLineMax: 20 }), 20);
  assert.equal(normalizeQuantity(150, { ...floor, max: 120 }), 120);
  assert.deepEqual([lineCapOf(floor), lineCapOf(floor, { floorLineMax: 20 }), lineCapOf(DEFAULT_RULES), lineCapOf(null)], [200, 20, 20, 20]);
  // the floor cap never rises above 200 and never applies without a coverage
  assert.equal(lineCapOf(floor, { floorLineMax: 999 }), 200);
  assert.equal(normalizeQuantity(150, { step: 1, min: 1, max: null, coverageM2: null }), 20);
});

test("areaFromDescription: „Länge … Breite …“ or a labelled „Maße“ line, units required", () => {
  assert.equal(areaFromDescription("Produktdetails\n\nLänge: 101 cm +/- 1 %\n\nBreite: 101 cm +/- 1 %\n\nStärke: 40 mm"), 1.0201);
  assert.equal(areaFromDescription("Breite: 500 mm, Laenge: 1000 mm"), 0.5);
  assert.equal(areaFromDescription("Maße: 1000 x 1000 mm"), 1);
  assert.equal(areaFromDescription("Abmessungen (L x B x H): 100 x 50 x 4 cm"), 0.5);
  // no unit, an overall length, values far apart, nothing → no area
  assert.equal(areaFromDescription("Maße: 100 x 100"), null);
  assert.equal(areaFromDescription("Gesamtlänge: 200 cm, Breite: 100 cm"), null);
  assert.equal(areaFromDescription(`Länge: 100 cm ${"x".repeat(400)} Breite: 100 cm`), null);
  assert.equal(areaFromDescription("Stärke: 40 mm"), null);
  assert.equal(areaFromDescription(null), null);
  // coverageFromDimensions reads the description only when asked (the flooring-room rule)
  const p = product({ name: "Gewichthebermatte 40 mm", detailedDescription: "Länge: 101 cm\nBreite: 101 cm" });
  assert.equal(coverageFromDimensions(p), null);
  assert.equal(coverageFromDimensions(p, null, { description: true }), 1.02);
  assert.equal(coverageFromDimensions(p, { id: "1", title: "Verbinder" }, { description: true }), null);
});

test("ruleHint, ruleBadges, publicRules: compact, both locales, nothing for no rule", () => {
  const pairs = resolveProductRules(plate(), { showroomIds: ["plates"] });
  assert.equal(ruleHint(pairs, "de"), "nur paarweise · im Showroom ausgestellt");
  assert.equal(ruleHint(pairs, "en"), "pairs only · on display in the showroom");
  assert.deepEqual(ruleBadges(pairs), ["paarweise", "Showroom"]);
  assert.deepEqual(publicRules(pairs), { step: 2, min: 2 });
  const floor = resolveProductRules(tile({ name: "Gymfloor® - Granulat Schutzplatten 500 x 500 x 30 mm" }));
  assert.equal(ruleHint(floor, "de"), "deckt ca. 0,25 m² je Stück · für die ganze Raumfläche planen");
  assert.equal(ruleHint(floor, "en"), "covers approx. 0.25 m² per unit · plan for the whole room");
  assert.deepEqual(ruleBadges(floor), ["0,25 m²/Stk"]);
  assert.deepEqual(publicRules(floor), { coverageM2: 0.25 });
  const custom = resolveProductRules(plate({ moRules: { quantityStep: 3, minQuantity: 6, maxQuantity: 12 } }));
  assert.equal(ruleHint(custom, "de"), "nur in Schritten von 3 · mindestens 6 Stück · höchstens 12 Stück");
  assert.deepEqual(ruleBadges(custom), ["3er-Schritte", "ab 6 Stk", "max. 12 Stk"]);
  assert.deepEqual(publicRules(custom), { step: 3, min: 6, max: 12 });
  for (const none of [resolveProductRules(product()), null, undefined]) {
    assert.equal(ruleHint(none, "de"), "");
    assert.deepEqual(ruleBadges(none), []);
    assert.equal(publicRules(none), undefined);
  }
  // a published coverage always means „sized to the room“: never without fillsRoom
  assert.equal(publicRules({ step: 1, min: 1, max: null, coverageM2: 2, fillsRoom: false }), undefined);
  assert.deepEqual(publicRules({ step: 1, min: 1, max: null, coverageM2: 2, fillsRoom: true }), { coverageM2: 2 });
});

const catalogMap = (...products) => new Map(products.map((p) => [p.id, p]));

test("validateLines: pairs adjusted with a readable rule, unknown lines and vanished variants untouched", () => {
  const byId = catalogMap(plate(), dumbbell(), product({ id: "rack", name: "Power Rack", category: "Power Racks" }));
  const v = validateLines(
    [
      { productId: "plates~11", quantity: 1 },
      { productId: "plates~12", quantity: 2 },
      { productId: "db", quantity: 3 },
      { productId: "rack", quantity: 1 },
      { productId: "ghost", quantity: 1 },
      { productId: "plates~999", quantity: 1 },
    ],
    byId
  );
  assert.deepEqual(v.adjusted, [
    { productId: "plates~11", from: 1, to: 2, rule: "paarweise" },
    { productId: "db", from: 3, to: 4, rule: "paarweise" },
  ]);
  assert.deepEqual(v.lines.map((l) => [l.productId, l.quantity]), [
    ["plates~11", 2],
    ["plates~12", 2],
    ["db", 4],
    ["rack", 1],
    ["ghost", 1],
    ["plates~999", 1],
  ]);
  assert.equal(v.lines[4].rules, null);
  assert.equal(v.lines[5].rules, null);
  assert.equal(v.coverage, null);
  assert.deepEqual(v.inShowroom, []);
  assert.equal(validateLines([{ productId: "plates", quantity: 1 }], byId, { locale: "en" }).adjusted[0].rule, "pairs");
  // custom rules: minimum / maximum / the plan line's cap (named)
  const custom = catalogMap(product({ id: "a", moRules: { minQuantity: 3 } }), product({ id: "b", moRules: { maxQuantity: 2 } }), product({ id: "c" }));
  assert.deepEqual(
    validateLines([{ productId: "a", quantity: 1 }, { productId: "b", quantity: 5 }, { productId: "c", quantity: 25 }], custom).adjusted.map((a) => a.rule),
    ["Mindestmenge", "Höchstmenge", "höchstens 20 je Position"]
  );
  // a non-floor line given 30 (the tool schemas accept up to 200) → 20, named
  assert.deepEqual(validateLines([{ productId: "c", quantity: 30 }], custom).adjusted, [{ productId: "c", from: 30, to: 20, rule: "höchstens 20 je Position" }]);
  assert.deepEqual(validateLines([{ productId: "c", quantity: 30 }], custom, { locale: "en" }).adjusted[0].rule, "at most 20 per line");
  assert.deepEqual(validateLines(null, byId), { lines: [], adjusted: [], coverage: null, inShowroom: [] });
});

test("validateLines: with a room area the one floor line is sized to it („Raumfläche“), up to 200", () => {
  const byId = catalogMap(
    tile(),
    tile({ id: "small", name: "Gymfloor® - Granulat Schutzplatten 500 x 500 x 30 mm", variants: [{ id: "71", title: "Basisplatte" }, { id: "72", title: "Verbinder-Frog" }] }),
    tile({ id: "set10", name: "Set 10 Stück - Bodenschutzmatte Excellence 1000 x 1000" }),
    tile({ id: "pairtile", name: "Puzzleplatte Excellence 980 x 980 x 10 mm", moRules: { quantityStep: 2 } }),
    tile({ id: "drop", name: "Fallschutzplatte Antishock 1000 x 1000 x 40 mm" })
  );
  // 12 m² with 1 m² tiles → 12
  const a = validateLines([{ productId: "mat", quantity: 4 }], byId, { areaM2: 12 });
  assert.deepEqual(a.adjusted, [{ productId: "mat", from: 4, to: 12, rule: "Raumfläche" }]);
  assert.deepEqual(a.coverage, { areaM2: 12, coveredM2: 12, lines: [{ productId: "mat", quantity: 12, coverageM2: 1, coveredM2: 12 }] });
  // 12,5 m² → 13 tiles (rounded up); the step of a tile is kept (0,96 m², steps of 2: 13,02 → 14)
  assert.equal(validateLines([{ productId: "mat", quantity: 1 }], byId, { areaM2: "12,5" }).lines[0].quantity, 13);
  assert.equal(validateLines([{ productId: "pairtile", quantity: 2 }], byId, { areaM2: 12.5 }).lines[0].quantity, 14);
  // sets of 10 m²: 25 m² → 3 sets
  assert.equal(validateLines([{ productId: "set10", quantity: 1 }], byId, { areaM2: 25 }).lines[0].quantity, 3);
  // a 30 m² room in 1 m² mats → 30, nothing missing (a floor line holds up to 200)
  const thirty = validateLines([{ productId: "mat", quantity: 4 }], byId, { areaM2: 30 });
  assert.deepEqual(thirty.adjusted, [{ productId: "mat", from: 4, to: 30, rule: "Raumfläche" }]);
  assert.deepEqual(thirty.coverage, { areaM2: 30, coveredM2: 30, lines: [{ productId: "mat", quantity: 30, coverageM2: 1, coveredM2: 30 }] });
  // Gymfloor 0,25 m² at 20 m² → 80
  const gym = validateLines([{ productId: "small", quantity: 4 }], byId, { areaM2: 20 });
  assert.equal(gym.lines[0].quantity, 80);
  assert.deepEqual(gym.coverage, { areaM2: 20, coveredM2: 20, lines: [{ productId: "small", quantity: 80, coverageM2: 0.25, coveredM2: 20 }] });
  // an area too big for 200 tiles: the cap, what is missing and the uncapped count
  const big = validateLines([{ productId: "small", quantity: 4 }], byId, { areaM2: 60 });
  assert.equal(big.lines[0].quantity, 200);
  assert.deepEqual(big.adjusted, [{ productId: "small", from: 4, to: 200, rule: "Raumfläche" }]);
  assert.deepEqual(big.coverage, {
    areaM2: 60,
    coveredM2: 50,
    lines: [{ productId: "small", quantity: 200, coverageM2: 0.25, coveredM2: 50 }],
    missingM2: 10,
    neededQuantity: 240,
  });
  // a floor line above 200 without an area → 200, the label names the floor cap
  assert.deepEqual(validateLines([{ productId: "mat", quantity: 250 }], byId).adjusted, [{ productId: "mat", from: 250, to: 200, rule: "höchstens 200 je Position" }]);
  // a widget without rules (old): floor lines capped at its 20 — the rest is reported missing
  const old = validateLines([{ productId: "mat", quantity: 4 }], byId, { areaM2: 30, floorLineMax: 20 });
  assert.equal(old.lines[0].quantity, 20);
  assert.deepEqual([old.coverage.missingM2, old.coverage.neededQuantity], [10, 30]);
  assert.deepEqual(validateLines([{ productId: "mat", quantity: 25 }], byId, { floorLineMax: 20 }).adjusted[0].rule, "höchstens 20 je Position");
  // TWO floor lines (a drop zone plus mats for the rest): nothing is resized — coverage and what is missing only
  const two = validateLines([{ productId: "drop", quantity: 4 }, { productId: "mat", quantity: 1 }], byId, { areaM2: 20 });
  assert.deepEqual(two.lines.map((l) => [l.productId, l.quantity]), [["drop", 4], ["mat", 1]]);
  assert.deepEqual(two.adjusted, []);
  assert.deepEqual(two.coverage, {
    areaM2: 20,
    coveredM2: 5,
    lines: [
      { productId: "drop", quantity: 4, coverageM2: 1, coveredM2: 4 },
      { productId: "mat", quantity: 1, coverageM2: 1, coveredM2: 1 },
    ],
    missingM2: 15,
  });
  // counts Mo worked out himself: covered, nothing missing, still nothing resized
  const done = validateLines([{ productId: "drop", quantity: 4 }, { productId: "mat", quantity: 16 }], byId, { areaM2: 20 });
  assert.deepEqual([done.adjusted, done.coverage.coveredM2, "missingM2" in done.coverage], [[], 20, false]);
  // two lines of one product (two variants) count as two floor lines as well
  assert.deepEqual(validateLines([{ productId: "small~71", quantity: 4 }, { productId: "small", quantity: 4 }], byId, { areaM2: 20 }).adjusted, []);
  // an edge-piece / connector variant has no coverage and does not count — the one tile line is sized
  const edge = validateLines([{ productId: "small~71", quantity: 4 }, { productId: "small~72", quantity: 10 }], byId, { areaM2: 5 });
  assert.deepEqual(edge.lines.map((l) => [l.productId, l.quantity]), [["small~71", 20], ["small~72", 10]]);
  assert.deepEqual(edge.coverage.lines.map((l) => l.productId), ["small~71"]);
  // without an area: the coverage is reported, nothing is sized
  const noArea = validateLines([{ productId: "mat", quantity: 4 }], byId);
  assert.deepEqual(noArea.adjusted, []);
  assert.deepEqual(noArea.coverage, { areaM2: null, coveredM2: 4, lines: [{ productId: "mat", quantity: 4, coverageM2: 1, coveredM2: 4 }] });
  // an implausible area is no area
  assert.equal(validateLines([{ productId: "mat", quantity: 4 }], byId, { areaM2: 9999 }).coverage.areaM2, null);
  assert.equal(normalizeAreaM2("0"), null);
  assert.equal(normalizeAreaM2(12.345), 12.35);
  assert.equal(normalizeAreaM2(null), null);
  // the area already covered: nothing adjusted
  assert.deepEqual(validateLines([{ productId: "mat", quantity: 12 }], byId, { areaM2: 12 }).adjusted, []);
});

test("validateLines / validateOptions: the showroom products, per option numbers", () => {
  const byId = catalogMap(product({ id: "rack", name: "Power Rack", category: "Power Racks" }), plate(), tile());
  const showroomIds = new Set(["rack"]);
  const v = validateLines([{ productId: "rack", quantity: 1 }, { productId: "plates~11", quantity: 1 }], byId, { showroomIds });
  assert.deepEqual(v.inShowroom, ["rack"]);
  const o = validateOptions(
    [
      { items: [{ productId: "mat", quantity: 2 }] },
      { items: [{ productId: "plates~11", quantity: 1 }, { productId: "rack", quantity: 1 }] },
      { option: 4, items: [{ productId: "mat", quantity: 30 }] },
    ],
    byId,
    { showroomIds, areaM2: 6 }
  );
  assert.deepEqual(o.adjusted, [
    { option: 1, productId: "mat", from: 2, to: 6, rule: "Raumfläche" },
    { option: 2, productId: "plates~11", from: 1, to: 2, rule: "paarweise" },
    { option: 4, productId: "mat", from: 30, to: 6, rule: "Raumfläche" },
  ]);
  assert.deepEqual(o.coverage.map((c) => [c.option, c.coveredM2]), [[1, 6], [4, 6]]);
  assert.deepEqual(o.inShowroom, ["rack"]);
});

test("ruleFacts: only what is there; the showroom only while the list is known", () => {
  assert.deepEqual(ruleFacts({ adjusted: [], coverage: null, inShowroom: [] }), {});
  assert.deepEqual(ruleFacts({ adjusted: [], coverage: [], inShowroom: ["rack"] }), {});
  assert.deepEqual(ruleFacts({ adjusted: [], coverage: [], inShowroom: ["rack"] }, { showroomKnown: true }), { inShowroom: ["rack"] });
  const adjusted = [{ productId: "a", from: 1, to: 2, rule: "paarweise" }];
  const coverage = { areaM2: null, coveredM2: 1, lines: [] };
  assert.deepEqual(ruleFacts({ adjusted, coverage, inShowroom: [] }), { adjusted, coverage });
});

test("ruleRegistryOverview: matching products per rule, metafields and showroom", () => {
  const catalog = [plate(), dumbbell(), tile(), plate({ id: "single", moRules: { soldInPairs: false } }), product({ id: "rack", moRules: { maxQuantity: 1 } })];
  const o = ruleRegistryOverview(catalog, { showroomIds: ["rack", "mat"] });
  assert.deepEqual(o.rules.map((r) => [r.id, r.count]), [["plates-pairs", 1], ["dumbbells-pairs", 1], ["flooring-room", 1]]);
  assert.equal(o.metafields, 2);
  assert.equal(o.showroom, 2);
  assert.ok(o.rules.every((r) => r.label && r.description && r.effect));
  // the matched products by name (the admin's „Betroffene Produkte“), sorted, capped
  assert.deepEqual(o.rules[0].products, [{ id: "plates", name: "Hantelscheiben Guss 50 mm - 1,25 bis 25 kg" }]);
  assert.deepEqual(o.metafieldProducts.map((p) => p.id).sort(), ["rack", "single"]);
  const capped = ruleRegistryOverview([plate({ id: "b", name: "B" }), plate({ id: "a", name: "A" }), plate({ id: "c", name: "C" })], { listMax: 2 });
  assert.equal(capped.rules[0].count, 3);
  assert.deepEqual(capped.rules[0].products.map((p) => p.id), ["a", "b"]);
});
