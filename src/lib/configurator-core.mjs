// Home-Gym-Konfigurator (Men's Health / Women's Health cooperation) — pure,
// no I/O. The storefront page lets a visitor pick a few basic answers (the
// „Trainingsfokus“ — one of Mo's personas — space, training, level) and hands
// the conversation to Mo, which then leads the
// rest of the consultation (budget, wishes) and builds a home-gym plan.
//
// This file owns everything both sides must agree on and everything testable:
//   - the answer vocabulary (ids + German/English labels) — the theme section
//     sends exactly these ids (docs/frontend/API_CONTRACT.md §2 „Optional
//     `context`“, type "configurator");
//   - parsing of the request context (public boundary: unknown values are
//     dropped, never an error) and of the operator settings (admin_settings
//     key 'configurator', migration 0078 — no new migration);
//   - the curated assortment („Konfigurator-Sortiment“: products carrying the
//     Shopify tag of the settings, plus extra handles);
//   - the prompt section Mo reads in a configurator conversation, the greeting
//     trigger and the profile defaults derived from the answers;
//   - the model-facing copy of the two configurator tools (suggest_replies,
//     show_gym_plan) — kept here, not in tool-descriptions.mjs, so the copy of
//     every other conversation (and Mo's self-snapshot) stays byte-identical;
//   - the KPI payloads (ids and enums only) and the funnel arithmetic of the
//     admin screen „Konfigurator“.
//
// docs/CONFIGURATOR.md is the owner document.

import { isVariantAvailable, normalizeVariantId, productVariants } from "./product-ref.mjs";

/** The admin_settings key (migration 0078). */
export const CONFIGURATOR_SETTINGS_KEY = "configurator";

/** Version of the context shape the widget sends (`configurator.v`). */
export const CONFIGURATOR_CONTEXT_VERSION = 1;

/** The Shopify tag that marks the curated assortment unless the operator changes it. */
export const DEFAULT_CONFIGURATOR_TAG = "home-gym-konfigurator";

/** How strictly Mo stays inside the curated assortment. */
export const CONFIGURATOR_FOCUS_MODES = /** @type {const} */ (["prefer", "only"]);

/**
 * @typedef {{
 *   enabled: boolean,
 *   tag: string,
 *   extraProductIds: string[],
 *   focus: "prefer" | "only",
 *   notes: string,
 * }} ConfiguratorSettings
 */

/** @type {Readonly<ConfiguratorSettings>} */
export const DEFAULT_CONFIGURATOR_SETTINGS = Object.freeze({
  enabled: true,
  tag: DEFAULT_CONFIGURATOR_TAG,
  extraProductIds: Object.freeze([]),
  focus: "prefer",
  notes: "",
});

export const CONFIGURATOR_LIMITS = Object.freeze({
  tagMax: 60,
  extraProductIdsMax: 60,
  productIdMax: 255,
  notesMax: 1500,
  /** Products of the assortment listed in the prompt (the rest: search_products). */
  promptProducts: 60,
  /** Plan lines the widget may echo back in the context (Mo's lines plus the
   * customer's own, „+ Produkt hinzufügen“ / „+ Gewichtsstufe“). */
  planItems: 20,
  planQuantityMax: 20,
  /** Variants (weight steps) listed per multi-variant product in the prompt —
   * a longer series is listed as a spread from the lightest to the heaviest. */
  promptVariants: 16,
});

// ---------------------------------------------------------------------------
// Answer vocabulary (shared with the theme section)
// ---------------------------------------------------------------------------

/**
 * @typedef {{ id: string, de: string, en: string, subDe?: string, subEn?: string, hintDe?: string, hintEn?: string }} ConfiguratorOption
 * @typedef {{ key: string, multi: boolean, required: boolean, de: string, en: string, options: ConfiguratorOption[] }} ConfiguratorField
 */

/** @type {ReadonlyArray<ConfiguratorField>} */
export const CONFIGURATOR_FIELDS = Object.freeze([
  {
    // Mo's own customer personas (persona.ts / PersonaArchetype), in the
    // wording of the Men's Health / Women's Health „Trainingsfokus“ set: the
    // visitor picks one, so Mo's consulting mode is set without asking
    // (configuratorArchetype). The consulting cues live in Mo's persona
    // addendum (system-prompt-core getPersonaAddendum), not here.
    key: "persona",
    multi: false,
    required: true,
    de: "Typ / Trainingsfokus",
    en: "Type / training focus",
    options: [
      {
        id: "pragmatic_beginner",
        de: "Pragmatisch starten",
        en: "Start pragmatically",
        subDe: "Platzsparende Fitnesslösungen für den optimalen Einstieg.",
        subEn: "Space-saving fitness solutions for the ideal start.",
      },
      {
        id: "ambitious_home_athlete",
        de: "Ambitioniert trainieren",
        en: "Train ambitiously",
        subDe: "Vielseitige Fitnessgeräte in erstklassiger Qualität.",
        subEn: "Versatile fitness equipment in first-class quality.",
      },
      {
        id: "strength_focused",
        de: "Kraft und Muskeln aufbauen",
        en: "Build strength and muscle",
        subDe: "Stärke gezielt und progressiv weiterentwickeln.",
        subEn: "Develop your strength in a targeted, progressive way.",
      },
      {
        id: "cardio_focused",
        de: "Gesundheit und Ausdauer fördern",
        en: "Boost health and endurance",
        subDe: "Langfristig fit, gesund und aktiv bleiben.",
        subEn: "Stay fit, healthy and active for the long term.",
      },
      {
        id: "design_lifestyle",
        de: "Design und Lifestyle leben",
        en: "Live design and lifestyle",
        subDe: "Stilvolle Fitnessgeräte Zuhause integrieren.",
        subEn: "Integrate stylish fitness equipment at home.",
      },
      {
        id: "weight_loss",
        de: "Abnehmen und fit bleiben",
        en: "Lose weight and stay fit",
        subDe: "Mit Cardiotraining das Wohlbefinden steigern.",
        subEn: "Boost your well-being with cardio.",
      },
    ],
  },
  {
    key: "location",
    multi: false,
    required: true,
    de: "Trainingsort",
    en: "Where",
    options: [
      {
        id: "house",
        de: "Haus / Keller",
        en: "House / basement",
        hintDe: "Wand- oder Bodenmontage meist möglich; Deckenhöhe für Racks und Klimmzüge klären",
        hintEn: "wall or floor mounting usually possible; check the ceiling height for racks and pull-ups",
      },
      {
        id: "apartment",
        de: "Wohnung (Mietobjekt)",
        en: "Flat (rented)",
        hintDe: "leise Geräte, Trittschall- und Bodenschutz, Bohren nur mit Zustimmung des Vermieters → freistehende Lösungen bevorzugen, Traglast und Deckenhöhe beachten",
        hintEn: "quiet equipment, impact and floor protection, drilling only with the landlord's consent → prefer freestanding solutions, mind floor load and ceiling height",
      },
      {
        id: "garage",
        de: "Garage / Outdoor",
        en: "Garage / outdoor",
        hintDe: "Feuchtigkeit und Temperatur: robuste, pulverbeschichtete Geräte, Bodenschutz, Elektronik geschützt aufstellen",
        hintEn: "humidity and temperature: rugged, powder-coated equipment, floor protection, keep electronics protected",
      },
    ],
  },
  {
    key: "space",
    multi: false,
    required: true,
    de: "Platz",
    en: "Space",
    options: [
      {
        id: "xs",
        de: "bis 6 m²",
        en: "up to 6 m²",
        hintDe: "sehr platzsparend: Wandzugstationen, Fold-Back-Racks, klappbare Bänke, verstellbare Hanteln",
        hintEn: "very space-saving: wall cable stations, fold-back racks, folding benches, adjustable dumbbells",
      },
      {
        id: "s",
        de: "6–10 m²",
        en: "6–10 m²",
        hintDe: "kompaktes Set: ein Basisgerät plus Bank und Gewichte, Laufwege einplanen",
        hintEn: "compact set: one base unit plus bench and weights, plan walking space",
      },
      {
        id: "m",
        de: "10–20 m²",
        en: "10–20 m²",
        hintDe: "Rack oder Kraftstation plus Bank, Gewichte und ein Cardio-Gerät möglich",
        hintEn: "rack or multi-gym plus bench, weights and one cardio machine possible",
      },
      {
        id: "l",
        de: "über 20 m²",
        en: "more than 20 m²",
        hintDe: "vollwertiges Home Gym: mehrere Stationen, Cardio und freie Gewichte kombinierbar",
        hintEn: "full home gym: several stations, cardio and free weights can be combined",
      },
    ],
  },
  {
    key: "training",
    multi: true,
    required: false,
    de: "Trainingsart",
    en: "Training style",
    options: [
      { id: "free_weights", de: "Freie Gewichte", en: "Free weights" },
      { id: "machines", de: "Kabelzug & Maschinen", en: "Cables & machines" },
      { id: "cardio", de: "Cardio", en: "Cardio" },
      { id: "functional", de: "Functional & Bodyweight", en: "Functional & bodyweight" },
    ],
  },
  {
    key: "level",
    multi: false,
    required: true,
    de: "Niveau",
    en: "Level",
    options: [
      {
        id: "rookie",
        de: "Einsteiger:in",
        en: "Beginner",
        hintDe: "einfache, sichere Geräte, kurze Erklärungen, keine Profi-Ausstattung aufschwatzen",
        hintEn: "simple, safe equipment, short explanations, never push pro gear",
      },
      { id: "intermediate", de: "Fortgeschritten", en: "Intermediate" },
      {
        id: "pro",
        de: "Profi",
        en: "Advanced",
        hintDe: "hohe Belastbarkeit, Studioqualität, Erweiterbarkeit",
        hintEn: "high load capacity, commercial quality, expandability",
      },
    ],
  },
  {
    key: "budget",
    multi: false,
    required: false,
    de: "Budget",
    en: "Budget",
    options: [
      { id: "b1", de: "bis 1.000 €", en: "up to €1,000" },
      { id: "b2", de: "1.000–2.500 €", en: "€1,000–2,500" },
      { id: "b3", de: "2.500–5.000 €", en: "€2,500–5,000" },
      { id: "b4", de: "5.000–10.000 €", en: "€5,000–10,000" },
      { id: "b5", de: "über 10.000 €", en: "more than €10,000" },
    ],
  },
  {
    key: "wishes",
    multi: true,
    required: false,
    de: "Individuelle Wünsche",
    en: "Individual wishes",
    options: [
      { id: "assembly", de: "Aufbau-/Montageservice", en: "Assembly service" },
      { id: "fast_delivery", de: "Schnelle Lieferung", en: "Fast delivery" },
      { id: "quiet", de: "Leise (Nachbarn)", en: "Quiet (neighbours)" },
      { id: "no_drilling", de: "Ohne Bohren", en: "No drilling" },
      { id: "foldable", de: "Klappbar / verstaubar", en: "Foldable / stowable" },
      { id: "floor_protection", de: "Bodenschutz", en: "Floor protection" },
      { id: "showroom", de: "Vorher im Showroom testen", en: "Test in the showroom first" },
    ],
  },
]);

/** Where the visitor came from (seal / landing page variant). */
export const CONFIGURATOR_PARTNERS = /** @type {const} */ (["mh", "wh"]);

/** Budget bucket → the profile's budgetEUR (the retrieval's price gate). */
const BUDGET_RANGES = Object.freeze({
  b1: { min: null, max: 1000 },
  b2: { min: 1000, max: 2500 },
  b3: { min: 2500, max: 5000 },
  b4: { min: 5000, max: 10000 },
  b5: { min: 10000, max: null },
});

/** Space bucket → the profile's spaceM2 (the upper end; the retrieval's footprint gate). */
const SPACE_M2 = Object.freeze({ xs: 6, s: 10, m: 20, l: 40 });

/** @param {string} key */
export function configuratorField(key) {
  return CONFIGURATOR_FIELDS.find((f) => f.key === key) ?? null;
}

/**
 * @param {string} key
 * @param {string} id
 * @returns {ConfiguratorOption | null}
 */
export function configuratorOption(key, id) {
  const field = configuratorField(key);
  return field?.options.find((o) => o.id === id) ?? null;
}

/**
 * The label of an answer id in a locale ("" for an unknown id).
 * @param {string} key @param {string} id @param {"de" | "en"} [locale]
 */
export function configuratorLabel(key, id, locale = "de") {
  const o = configuratorOption(key, id);
  if (!o) return "";
  return locale === "en" ? o.en : o.de;
}

// ---------------------------------------------------------------------------
// Request context (public boundary)
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   persona: string | null,
 *   location: string | null,
 *   space: string | null,
 *   training: string[],
 *   level: string | null,
 *   budget: string | null,
 *   wishes: string[],
 *   partner: "mh" | "wh" | null,
 *   plan: Array<{ id: string, qty: number, added?: boolean }>,
 *   features: string[],
 * }} ConfiguratorAnswers
 */

/**
 * What the widget can render beyond the first version (`configurator.features`,
 * sent with every request): "options" = the step-by-step product choice
 * (offer_plan_options, 2026-10-23). Unknown values are dropped; an old widget
 * sends none and keeps the one-plan guide.
 */
export const CONFIGURATOR_FEATURES = /** @type {const} */ (["options"]);

/** @param {unknown} raw @returns {string[]} */
function parseFeatures(raw) {
  if (!Array.isArray(raw)) return [];
  const known = /** @type {readonly string[]} */ (CONFIGURATOR_FEATURES);
  return known.filter((f) => raw.some((x) => typeof x === "string" && x.trim().toLowerCase() === f));
}

/** Does the widget of this thread render offer_plan_options? */
export function configuratorHasOptions(/** @type {ConfiguratorAnswers | null | undefined} */ answers) {
  return Boolean(answers?.features?.includes("options"));
}

/** @param {unknown} v */
function asRecord(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : null;
}

/** @param {string} key @param {unknown} raw */
function singleAnswer(key, raw) {
  if (typeof raw !== "string") return null;
  const id = raw.trim().toLowerCase();
  return configuratorOption(key, id) ? id : null;
}

/** @param {string} key @param {unknown} raw */
function multiAnswer(key, raw) {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const field = configuratorField(key);
  if (!field) return [];
  /** @type {string[]} */
  const out = [];
  for (const item of list.slice(0, 20)) {
    if (typeof item !== "string") continue;
    const id = item.trim().toLowerCase();
    if (field.options.some((o) => o.id === id) && !out.includes(id)) out.push(id);
  }
  // Vocabulary order, so the same choice always renders (and counts) the same.
  return field.options.map((o) => o.id).filter((id) => out.includes(id));
}

const PRODUCT_REF_RE = /^[^\s,]{1,255}$/;

/** @param {unknown} raw @returns {Array<{ id: string, qty: number, added?: boolean }>} */
function parsePlan(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {Array<{ id: string, qty: number, added?: boolean }>} */
  const out = [];
  for (const entry of raw.slice(0, 40)) {
    const e = asRecord(entry);
    if (!e || typeof e.id !== "string") continue;
    const id = e.id.trim();
    if (!PRODUCT_REF_RE.test(id) || out.some((x) => x.id === id)) continue;
    const q = Number(e.qty);
    const qty = Number.isInteger(q) && q >= 1 ? Math.min(q, CONFIGURATOR_LIMITS.planQuantityMax) : 1;
    // added: a line the customer put into the plan himself („+ Produkt hinzufügen“).
    out.push(e.added === true ? { id, qty, added: true } : { id, qty });
    if (out.length >= CONFIGURATOR_LIMITS.planItems) break;
  }
  return out;
}

/**
 * Answers of the first configurator version (before 2026-10-22) → today's
 * persona: the page's own types and the removed „Ich will …“ goal. Lets a
 * page still cached in a browser, or an old link, keep working.
 */
const LEGACY_PERSONA = Object.freeze({
  busy: "pragmatic_beginner",
  ambitious: "ambitious_home_athlete",
  health: "cardio_focused",
  family: "pragmatic_beginner",
  best_ager: "cardio_focused",
});
const LEGACY_GOAL_PERSONA = Object.freeze({
  muscle: "strength_focused",
  fitness: "weight_loss",
  health: "cardio_focused",
  endurance: "cardio_focused",
  athletic: "ambitious_home_athlete",
});

/**
 * The persona id of a context or a recorded configurator_chat_started event:
 * today's id, else the mapped id of the first version's persona or goal.
 * @param {unknown} rawPersona @param {unknown} [rawGoal]
 * @returns {string | null}
 */
export function personaAnswer(rawPersona, rawGoal) {
  const current = singleAnswer("persona", rawPersona);
  if (current) return current;
  const key = (/** @type {unknown} */ v) => (typeof v === "string" ? v.trim().toLowerCase() : "");
  // Own keys only — "constructor" / "__proto__" must not resolve.
  const own = (/** @type {Record<string, string>} */ map, /** @type {string} */ k) =>
    Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null;
  return own(LEGACY_PERSONA, key(rawPersona)) ?? own(LEGACY_GOAL_PERSONA, key(rawGoal));
}

/**
 * The `context` of a /api/chat request → the configurator answers, or null
 * when it is no configurator context or carries no known answer at all.
 * Unknown values are dropped silently (an older/newer page never breaks the
 * chat). The plan ids are validated against the catalog by the caller.
 * @param {unknown} context
 * @returns {ConfiguratorAnswers | null}
 */
export function parseConfiguratorContext(context) {
  const ctx = asRecord(context);
  if (!ctx || ctx.type !== "configurator") return null;
  const c = asRecord(ctx.configurator);
  if (!c) return null;
  /** @type {ConfiguratorAnswers} */
  const answers = {
    persona: personaAnswer(c.persona, c.goal),
    location: singleAnswer("location", c.location),
    space: singleAnswer("space", c.space),
    training: multiAnswer("training", c.training),
    level: singleAnswer("level", c.level),
    budget: singleAnswer("budget", c.budget),
    wishes: multiAnswer("wishes", c.wishes),
    partner:
      typeof c.partner === "string" && /** @type {readonly string[]} */ (CONFIGURATOR_PARTNERS).includes(c.partner.trim().toLowerCase())
        ? /** @type {"mh" | "wh"} */ (c.partner.trim().toLowerCase())
        : null,
    plan: parsePlan(c.plan),
    features: parseFeatures(c.features),
  };
  const known =
    answers.persona || answers.location || answers.space || answers.training.length || answers.level;
  return known ? answers : null;
}

/**
 * Profile defaults from the answers: fill only what the conversation has not
 * set yet (an `update_customer_profile` of the conversation always wins), so
 * the retrieval's space/budget gates and the persona logic see the page's
 * answers from the first turn on.
 * @template {Record<string, any>} P
 * @param {P} profile
 * @param {ConfiguratorAnswers | null} answers
 * @returns {P}
 */
export function mergeConfiguratorProfile(profile, answers) {
  if (!answers) return profile;
  /** @type {Record<string, any>} */
  const next = { ...profile };
  const unknown = (/** @type {unknown} */ v) => v === undefined || v === null || v === "unknown";
  if (unknown(next.segment)) next.segment = "private";
  if (unknown(next.housing) && answers.location) {
    next.housing = answers.location === "apartment" ? "apartment" : "house_basement_garage";
  }
  if (unknown(next.noiseSensitive) && (answers.location === "apartment" || answers.wishes.includes("quiet"))) {
    next.noiseSensitive = true;
  }
  if (unknown(next.spaceM2) && answers.space) {
    next.spaceM2 = SPACE_M2[/** @type {keyof typeof SPACE_M2} */ (answers.space)];
  }
  if (unknown(next.experienceLevel) && answers.level) {
    next.experienceLevel =
      answers.level === "rookie" ? "beginner" : answers.level === "pro" ? "advanced" : "intermediate";
  } else if (unknown(next.experienceLevel) && answers.persona === "pragmatic_beginner") {
    next.experienceLevel = "beginner";
  }
  if (unknown(next.trainingFocus)) {
    const t = answers.training;
    const p = answers.persona;
    const strength = t.includes("free_weights") || t.includes("machines") || p === "strength_focused";
    const cardio = t.includes("cardio") || p === "cardio_focused" || p === "weight_loss";
    if (strength && cardio) next.trainingFocus = "mixed";
    else if (cardio) next.trainingFocus = "cardio";
    else if (strength || t.includes("functional")) next.trainingFocus = "strength";
  }
  if (unknown(next.budgetEUR) && answers.budget) {
    next.budgetEUR = { ...BUDGET_RANGES[/** @type {keyof typeof BUDGET_RANGES} */ (answers.budget)] };
  }
  return /** @type {P} */ (next);
}

/** The search words of each persona for the greeting's retrieval. */
const PERSONA_QUERY = Object.freeze({
  pragmatic_beginner: "Einsteiger kompakt platzsparend",
  ambitious_home_athlete: "Studioqualität Rack Komplettsystem",
  strength_focused: "Krafttraining Muskelaufbau Rack Hanteln",
  cardio_focused: "Ausdauer Gesundheit Cardio gelenkschonend",
  design_lifestyle: "Design hochwertig Holz wohnraumtauglich",
  weight_loss: "Cardio Abnehmen Laufband Crosstrainer Ergometer",
});

/**
 * Mo's persona for a configurator thread: the visitor chose it on the page,
 * so it replaces the derived archetype (persona.ts deriveArchetype) — Mo does
 * not have to find out who he is talking to. Null without a choice.
 * @param {ConfiguratorAnswers | null | undefined} answers
 * @returns {string | null}
 */
export function configuratorArchetype(answers) {
  const id = answers?.persona;
  return id && configuratorOption("persona", id) ? id : null;
}

/**
 * The retrieval query of a configurator turn without user text (the greeting):
 * the answers in words, so the first prompt already carries matching products.
 * @param {ConfiguratorAnswers} answers
 */
export function configuratorRetrievalQuery(answers) {
  const parts = ["Home Gym"];
  for (const id of answers.training) parts.push(configuratorLabel("training", id));
  if (answers.persona) parts.push(PERSONA_QUERY[/** @type {keyof typeof PERSONA_QUERY} */ (answers.persona)] ?? "");
  if (answers.space === "xs" || answers.space === "s") parts.push("platzsparend kompakt");
  if (answers.location === "apartment") parts.push("Wohnung leise");
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Settings (admin_settings 'configurator')
// ---------------------------------------------------------------------------

/** @param {unknown} value */
function asObject(value) {
  let v = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  return asRecord(v);
}

/** A Shopify tag as stored: trimmed, inner whitespace collapsed; "" when unusable. @param {unknown} raw */
export function normalizeTag(raw) {
  if (typeof raw !== "string") return "";
  const t = raw.replace(/\s+/g, " ").trim();
  return t.length > 0 && t.length <= CONFIGURATOR_LIMITS.tagMax && !/[,<>]/.test(t) ? t : "";
}

/** Handles / variant refs from an array or a comma/newline separated text. @param {unknown} raw */
export function parseProductIdList(raw) {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\s,;]+/) : [];
  /** @type {string[]} */
  const out = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || id.length > CONFIGURATOR_LIMITS.productIdMax || !PRODUCT_REF_RE.test(id)) continue;
    if (!out.includes(id)) out.push(id);
    if (out.length >= CONFIGURATOR_LIMITS.extraProductIdsMax) break;
  }
  return out;
}

/**
 * The stored setting → settings. Fail-soft per field: a missing or broken
 * field takes its default, so a damaged row never switches the feature off
 * by accident.
 * @param {unknown} value
 * @returns {ConfiguratorSettings}
 */
export function parseConfiguratorSettings(value) {
  const obj = asObject(value) ?? {};
  const d = DEFAULT_CONFIGURATOR_SETTINGS;
  const tag = normalizeTag(obj.tag);
  return {
    enabled: typeof obj.enabled === "boolean" ? obj.enabled : d.enabled,
    tag: tag || d.tag,
    extraProductIds: parseProductIdList(obj.extraProductIds),
    focus: obj.focus === "only" || obj.focus === "prefer" ? obj.focus : d.focus,
    notes: typeof obj.notes === "string" ? obj.notes.trim().slice(0, CONFIGURATOR_LIMITS.notesMax) : d.notes,
  };
}

/**
 * Strict check of a NEW value (the admin route body). German messages.
 * @param {unknown} value
 * @returns {{ ok: true, settings: ConfiguratorSettings } | { ok: false, message: string }}
 */
export function validateConfiguratorSettingsInput(value) {
  const obj = asObject(value);
  if (!obj) return { ok: false, message: "Ungültige Einstellungen." };
  if (typeof obj.enabled !== "boolean") return { ok: false, message: "„Aktiv“ fehlt." };
  const tag = normalizeTag(obj.tag);
  if (!tag) {
    return {
      ok: false,
      message: `Der Shopify-Tag darf nicht leer sein, höchstens ${CONFIGURATOR_LIMITS.tagMax} Zeichen haben und kein Komma enthalten.`,
    };
  }
  if (obj.focus !== "prefer" && obj.focus !== "only") {
    return { ok: false, message: "Unbekannter Sortiments-Fokus." };
  }
  const notes = typeof obj.notes === "string" ? obj.notes.trim() : "";
  if (notes.length > CONFIGURATOR_LIMITS.notesMax) {
    return { ok: false, message: `Die Hinweise für Mo dürfen höchstens ${CONFIGURATOR_LIMITS.notesMax} Zeichen haben.` };
  }
  const rawIds = Array.isArray(obj.extraProductIds)
    ? obj.extraProductIds
    : typeof obj.extraProductIds === "string"
      ? obj.extraProductIds.split(/[\s,;]+/).filter(Boolean)
      : [];
  if (rawIds.length > CONFIGURATOR_LIMITS.extraProductIdsMax) {
    return { ok: false, message: `Höchstens ${CONFIGURATOR_LIMITS.extraProductIdsMax} zusätzliche Produkte.` };
  }
  return {
    ok: true,
    settings: {
      enabled: obj.enabled,
      tag,
      extraProductIds: parseProductIdList(rawIds),
      focus: obj.focus,
      notes,
    },
  };
}

// ---------------------------------------------------------------------------
// Curated assortment
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   id: string, name: string, category: string, price: number, salePrice?: number,
 *   priceMin?: number, priceMax?: number, shortDescription?: string, tags?: string[],
 *   footprintM2?: number, inStock: boolean, compatibleWith?: string[], variants?: unknown[],
 * }} AssortmentProduct
 */

/** @param {string} id */
function baseId(id) {
  const i = id.indexOf("~");
  return i >= 0 ? id.slice(0, i) : id;
}

/**
 * Does the product carry the configurator tag? (case-insensitive, trimmed —
 * Shopify tags are case-insensitive in the admin as well.)
 * @param {{ tags?: string[] }} product @param {string} tag
 */
export function hasConfiguratorTag(product, tag) {
  const want = normalizeTag(tag).toLowerCase();
  if (!want) return false;
  return (product.tags ?? []).some((t) => typeof t === "string" && normalizeTag(t).toLowerCase() === want);
}

/**
 * The curated assortment: tagged products plus the extra handles, in a stable
 * order (by category, then price). Each entry says why it is in.
 * @template {AssortmentProduct} T
 * @param {T[]} catalog
 * @param {Pick<ConfiguratorSettings, "tag" | "extraProductIds">} settings
 * @returns {Array<{ product: T, viaTag: boolean, viaList: boolean }>}
 */
export function selectAssortment(catalog, settings) {
  const extra = new Set((settings.extraProductIds ?? []).map(baseId));
  /** @type {Array<{ product: T, viaTag: boolean, viaList: boolean }>} */
  const out = [];
  for (const product of catalog) {
    const viaTag = hasConfiguratorTag(product, settings.tag);
    const viaList = extra.has(product.id);
    if (viaTag || viaList) out.push({ product, viaTag, viaList });
  }
  out.sort((a, b) => {
    const c = String(a.product.category ?? "").localeCompare(String(b.product.category ?? ""), "de");
    if (c !== 0) return c;
    return effectivePrice(a.product) - effectivePrice(b.product);
  });
  return out;
}

// The plan role of an assortment product, for „+ Produkt hinzufügen“ on the
// page (GET /api/configurator/assortment). First match wins: storage racks and
// bar collars are accessories although they say "Rack"/"Weight"; cardio
// machines ("Rowing Machines") stay cardio, and a strength machine is a base
// unit although it says "Plate Load" (Hip Thruster Machine Plate Load — not a
// weight plate, so the picker does not add it in pairs).
const ROLE_RULES = /** @type {ReadonlyArray<readonly [string, RegExp]>} */ ([
  ["flooring", /floor protection|gym mats?|bodenschutz|bodenmatte|puzzlematte|schutzmatte|unterlegmatte/i],
  ["accessory", /storage|ablage|st[äa]nder|collar|verschl[üu]ss|bench|hantelbank|\bbank\b|barbell|weightlifting bars?|langhantel|stange|handles?|griff|accessor|zubeh[öo]r|klimmzug|pull.?up bar|belt|g[üu]rtel|resistance bands?|widerstandsb[äa]nder?|\bbands?\b/i],
  ["cardio", /treadmill|laufband|bikes?|ergometer|rowing|rudergerät|rower|elliptical|crosstrainer|cross.?trainer|stepper|stair|spinning|indoor.?cycl|cardio|walking.?pad/i],
  ["base", /\bmachines?\b|maschine|plate.?load/i],
  ["weights", /weight plates?|hantelscheibe|dumbbells?|kurzhantel|kettlebell|gewichtsscheibe|\bplates?\b|scheiben/i],
  ["base", /power racks?|half racks?|squat racks?|weight lifting (machines|racks)|smith|multipresse|power towers?|kraftstation|equipment sets|multi.?gym|cable|kabelzug|functional trainer|\brack\b|machines?/i],
]);

/**
 * Plan role (PLAN_ROLES) of a catalog product, from its category, else its
 * name; "extra" when nothing matches.
 * @param {{ category?: unknown, name?: unknown }} p
 * @returns {"base" | "accessory" | "weights" | "cardio" | "flooring" | "extra"}
 */
export function planRoleForProduct(p) {
  for (const text of [String(p?.category ?? ""), String(p?.name ?? "")]) {
    if (!text.trim()) continue;
    for (const [role, re] of ROLE_RULES) {
      if (re.test(text)) return /** @type {any} */ (role);
    }
  }
  return "extra";
}

/**
 * @typedef {{
 *   id: string, name: string, category: string,
 *   role: "base" | "accessory" | "weights" | "cardio" | "flooring" | "extra",
 *   price: number, salePrice?: number, priceMin?: number, priceMax?: number,
 *   images: string[], shopifyUrl: string, inStock: boolean,
 *   variants?: Array<{ id: string, title: string, price: number, salePrice?: number, available: boolean, isDefault: boolean }>,
 * }} AssortmentCard
 */

/**
 * The public cards of the curated assortment — what the page's „+ Produkt
 * hinzufügen“ picker lists (public storefront fields only, first image, the
 * variants with an id). Sorted by plan role (PLAN_ROLES order), then name.
 * @param {ReadonlyArray<AssortmentProduct & { images?: string[], shopifyUrl?: string }>} products
 * @returns {AssortmentCard[]}
 */
export function assortmentCards(products) {
  /** @type {AssortmentCard[]} */
  const out = [];
  for (const p of products ?? []) {
    const card = assortmentCard(p);
    if (card) out.push(card);
  }
  const order = /** @type {readonly string[]} */ (PLAN_ROLES);
  out.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || a.name.localeCompare(b.name, "de"));
  return out;
}

/**
 * One public card (assortmentCards, searchCatalogCards); null without an id.
 * @param {(AssortmentProduct & { images?: string[], shopifyUrl?: string }) | null | undefined} p
 * @returns {AssortmentCard | null}
 */
function assortmentCard(p) {
  if (!p || typeof p.id !== "string" || !p.id) return null;
  const variants = /** @type {Array<{ id?: unknown, title?: unknown, price?: unknown, salePrice?: unknown, isDefault?: unknown }>} */ (
    productVariants(p)
  )
    .filter((v) => normalizeVariantId(v.id))
    .map((v) => ({
      id: /** @type {string} */ (normalizeVariantId(v.id)),
      title: String(v.title ?? "").trim(),
      price: Number(v.price) || 0,
      ...(typeof v.salePrice === "number" && v.salePrice > 0 ? { salePrice: v.salePrice } : {}),
      available: isVariantAvailable(p, v),
      isDefault: v.isDefault === true,
    }));
  return {
    id: p.id,
    name: String(p.name ?? ""),
    category: String(p.category ?? ""),
    role: planRoleForProduct(p),
    price: Number(p.price) || 0,
    ...(typeof p.salePrice === "number" && p.salePrice > 0 ? { salePrice: p.salePrice } : {}),
    ...(typeof p.priceMin === "number" ? { priceMin: p.priceMin } : {}),
    ...(typeof p.priceMax === "number" ? { priceMax: p.priceMax } : {}),
    images: Array.isArray(p.images) ? p.images.filter((u) => typeof u === "string" && u).slice(0, 1) : [],
    shopifyUrl: String(p.shopifyUrl ?? ""),
    inStock: p.inStock !== false,
    ...(variants.length ? { variants } : {}),
  };
}

/**
 * Lower-case, umlauts and accents folded („Hantelbänke“ → „hantelbanke“, ß →
 * ss), and the ae / oe / ue spellings of umlauts too („hantelbaenke“,
 * „rudergeraet“) — on both sides of the search, so a word that really holds
 * „ue“ („Bluetooth“) still finds itself.
 * @param {unknown} s
 */
function foldText(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[®™©]/g, "")
    .replace(/ae/g, "a")
    .replace(/oe/g, "o")
    .replace(/ue/g, "u");
}

/**
 * A word's search forms: the word and, for words of 5+ characters, its stem
 * without a German / English plural ending („banke“ → „bank“, „matten“ →
 * „matt“, „racks“ → „rack“) in `forms`. An „-er“ ending is kept apart (`er`:
 * „laufbander“ → „laufband“): most German words on „-er“ are no plural
 * („Ständer“, „Halter“, „Hocker“), so that stem only finds the exact word on
 * the other side — never a prefix, a substring or the other side's stem.
 * @param {string} w
 * @returns {{ word: string, forms: string[], er: string }}
 */
function wordForms(w) {
  const m = w.length > 4 ? /^(.{4,}?)(en|er|e|n|s)$/.exec(w) : null;
  if (!m) return { word: w, forms: [w], er: "" };
  return m[2] === "er" ? { word: w, forms: [w], er: m[1] } : { word: w, forms: [w, m[1]], er: "" };
}

/**
 * Two words are the same word: equal, singular / plural of each other (their
 * forms meet), or one is the other's „-er“ plural („laufband“ / „laufbander“).
 * @param {{ word: string, forms: string[], er: string }} a
 * @param {{ word: string, forms: string[], er: string }} b
 */
function sameWord(a, b) {
  return a.forms.some((c) => b.forms.includes(c)) || (a.er !== "" && a.er === b.word) || (b.er !== "" && b.er === a.word);
}

/** Search limits of GET /api/configurator/search. */
export const SEARCH_LIMITS = Object.freeze({ queryMin: 2, queryMax: 80, results: 12, defaultResults: 8 });

/**
 * The folded search fields of a catalog product, built once per product object
 * (the catalog is cached per instance, so every later query reuses them).
 * @type {WeakMap<object, { name: string, nameWords: Array<{ word: string, forms: string[], er: string }>, other: Array<readonly [string, number]> }>}
 */
const SEARCH_INDEX = new WeakMap();

/** @param {any} p */
function searchEntry(p) {
  let e = SEARCH_INDEX.get(p);
  if (e) return e;
  const name = foldText(p.name);
  const variantSkus = Array.isArray(p.variants) ? p.variants.map((/** @type {any} */ v) => v?.sku).filter((x) => typeof x === "string" && x) : [];
  e = {
    name,
    nameWords: name.split(/[^a-z0-9]+/).filter(Boolean).map(wordForms),
    other: [
      [foldText(p.brand), 1.5],
      [foldText(p.category), 1.5],
      [foldText((Array.isArray(p.tags) ? p.tags : []).join(" ")), 1],
      // The flat SKU is the default variant's; every variant's SKU counts.
      [foldText([p.sku, ...variantSkus].filter(Boolean).join(" ")), 2],
      [foldText(p.id), 1],
    ],
  };
  SEARCH_INDEX.set(p, e);
  return e;
}

/**
 * The whole-shop search of the plan's „+ Produkt hinzufügen“ (GET
 * /api/configurator/search): a keyword match over name, brand, category,
 * tags and SKUs (the variants' too) — every query word must match somewhere
 * (folded: umlauts, ae/oe/ue, plurals). A whole name word counts most
 * („Kurzhanteln“ before „Kurzhantelablage“), then a name word's prefix, then
 * anywhere in the name; hidden products left out, in-stock before sold-out,
 * then by score and name. Pure and free (no embeddings).
 * @param {ReadonlyArray<AssortmentProduct & { images?: string[], shopifyUrl?: string, brand?: string, sku?: string, hideFromSearch?: boolean }>} catalog
 * @param {unknown} query
 * @param {number} [limit]
 * @returns {AssortmentCard[]}
 */
export function searchCatalogCards(catalog, query, limit = SEARCH_LIMITS.defaultResults) {
  const words = foldText(String(query ?? "").slice(0, SEARCH_LIMITS.queryMax))
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2);
  if (!words.length) return [];
  const forms = words.map(wordForms);
  const max = Math.max(1, Math.min(SEARCH_LIMITS.results, Number.isInteger(limit) ? limit : SEARCH_LIMITS.defaultResults));
  /** @type {Array<{ p: any, score: number }>} */
  const hits = [];
  for (const p of catalog ?? []) {
    if (!p || typeof p.id !== "string" || p.hideFromSearch === true) continue;
    const { name, nameWords, other } = searchEntry(p);
    let score = 0;
    let all = true;
    for (const wf of forms) {
      let best = 0;
      // A German plural („Hantelbänke“, „Matten“, „Laufbänder“) also finds
      // the singular, and the other way round (word forms on both sides).
      if (nameWords.some((nw) => sameWord(wf, nw))) best = 4;
      else {
        for (const c of wf.forms) {
          if (best < 3 && nameWords.some((nw) => nw.word.startsWith(c))) best = 3;
          else if (best < 2 && name.includes(c)) best = 2;
          for (const [text, weight] of other) {
            if (best < weight && text.includes(c)) best = weight;
          }
        }
      }
      if (!best) {
        all = false;
        break;
      }
      score += best;
    }
    if (all) hits.push({ p, score });
  }
  hits.sort(
    (a, b) =>
      Number(b.p.inStock !== false) - Number(a.p.inStock !== false) ||
      b.score - a.score ||
      String(a.p.name ?? "").localeCompare(String(b.p.name ?? ""), "de")
  );
  return /** @type {AssortmentCard[]} */ (hits.slice(0, max).map((h) => assortmentCard(h.p)).filter(Boolean));
}

/** Extra handles that match no catalog product (shown as a warning in the admin). */
export function unknownExtraIds(/** @type {Array<{ id: string }>} */ catalog, /** @type {string[]} */ extraIds) {
  const ids = new Set(catalog.map((p) => p.id));
  return extraIds.filter((id) => !ids.has(baseId(id)));
}

/** @param {AssortmentProduct} p */
function effectivePrice(p) {
  const v = p.priceMin ?? p.salePrice ?? p.price;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** @param {unknown} s @param {number} max */
function clip(s, max) {
  const str = String(s ?? "").replace(/\s+/g, " ").trim();
  if (str.length <= max) return str;
  const cut = str.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim() + "…";
}

/** @param {AssortmentProduct} p @param {"de" | "en"} locale */
function assortmentLine(p, locale) {
  const en = locale === "en";
  const ranged = p.priceMin != null && p.priceMax != null && p.priceMax > p.priceMin;
  const price = ranged
    ? en
      ? `€${p.priceMin}–${p.priceMax}`
      : `${p.priceMin}–${p.priceMax} €`
    : en
      ? `€${p.salePrice ?? p.price}`
      : `${p.salePrice ?? p.price} €`;
  const bits = [`- \`${p.id}\` ${p.name} — ${p.category} · ${price}`];
  if (typeof p.footprintM2 === "number" && p.footprintM2 > 0) {
    bits.push(en ? `approx. ${p.footprintM2} m²` : `ca. ${p.footprintM2} m²`);
  }
  if (!p.inStock) bits.push(en ? "SOLD OUT" : "AUSVERKAUFT");
  let line = bits.join(" · ");
  // Short on purpose: ~60 lines ride on every turn; details come from the
  // retrieved-products block or search_products.
  const desc = clip(p.shortDescription, 90);
  if (desc) line += ` — ${desc}`;
  const acc = (p.compatibleWith ?? []).slice(0, 3);
  if (acc.length) line += en ? ` | Accessories: ${acc.join(", ")}` : ` | Zubehör: ${acc.join(", ")}`;
  const steps = variantSteps(p, locale);
  if (steps) line += en ? ` | Variants: ${steps}` : ` | Varianten: ${steps}`;
  return line;
}

/**
 * The orderable variants of a multi-variant product as „title `~id`“ — Mo
 * needs the ids to plan concrete weight steps (the plan otherwise falls back
 * to the default variant, often the smallest plate). A series longer than the
 * cap is listed as an even spread that keeps the lightest and the heaviest
 * step; null for a single-variant product.
 * @param {AssortmentProduct} p @param {"de" | "en"} locale
 */
function variantSteps(p, locale) {
  const variants = /** @type {Array<{ id?: unknown, title?: unknown, available?: unknown }>} */ (
    productVariants(p)
  );
  if (variants.length < 2) return null;
  const usable = variants.filter(
    (v) => isVariantAvailable(p, v) && normalizeVariantId(v.id) && String(v.title ?? "").trim()
  );
  if (!usable.length) return null;
  const cap = CONFIGURATOR_LIMITS.promptVariants;
  const picked =
    usable.length <= cap
      ? usable
      : [...new Set(Array.from({ length: cap }, (_, k) => Math.round((k * (usable.length - 1)) / (cap - 1))))].map(
          (i) => usable[i]
        );
  const shown = picked.map((v) => `${clip(v.title, 24)} \`~${normalizeVariantId(v.id)}\``);
  const more = usable.length - shown.length;
  if (more <= 0) return shown.join(", ");
  return `${shown.join(", ")} (${locale === "en" ? `+${more} steps in between` : `+${more} Stufen dazwischen`})`;
}

// ---------------------------------------------------------------------------
// Prompt section
// ---------------------------------------------------------------------------

/** @param {ConfiguratorAnswers} a @param {"de" | "en"} locale */
function renderAnswers(a, locale) {
  const en = locale === "en";
  const open = en ? "still open — ask" : "noch offen — erfragen";
  const label = (/** @type {string} */ key, /** @type {string | null} */ id) =>
    id ? configuratorLabel(key, id, locale) : open;
  const list = (/** @type {string} */ key, /** @type {string[]} */ ids) =>
    ids.length ? ids.map((id) => configuratorLabel(key, id, locale)).join(", ") : open;
  const persona = a.persona ? configuratorOption("persona", a.persona) : null;
  const focus = persona
    ? `${en ? persona.en : persona.de} (${en ? persona.subEn : persona.subDe})`
    : open;
  if (en) {
    return [
      `- Type / training focus: ${focus}`,
      `- Training location: ${label("location", a.location)} — space: ${label("space", a.space)}`,
      `- Training style: ${list("training", a.training)} — level: ${label("level", a.level)}`,
      `- Budget: ${label("budget", a.budget)}`,
      `- Individual wishes: ${list("wishes", a.wishes)}`,
    ].join("\n");
  }
  return [
    `- Typ / Trainingsfokus: ${focus}`,
    `- Trainingsort: ${label("location", a.location)} — Platz: ${label("space", a.space)}`,
    `- Trainingsart: ${list("training", a.training)} — Niveau: ${label("level", a.level)}`,
    `- Budget: ${label("budget", a.budget)}`,
    `- Individuelle Wünsche: ${list("wishes", a.wishes)}`,
  ].join("\n");
}

/** The consulting cues of the chosen answers (only answers that carry one). @param {ConfiguratorAnswers} a @param {"de" | "en"} locale */
function renderHints(a, locale) {
  /** @type {string[]} */
  const out = [];
  for (const key of ["persona", "location", "space", "level"]) {
    const id = /** @type {string | null} */ (/** @type {Record<string, unknown>} */ (a)[key]);
    if (!id) continue;
    const o = configuratorOption(key, id);
    const hint = locale === "en" ? o?.hintEn : o?.hintDe;
    if (o && hint) out.push(`- ${locale === "en" ? o.en : o.de}: ${hint}`);
  }
  return out.join("\n");
}

/**
 * @param {Array<{ id: string, qty: number, name?: string, added?: boolean }>} plan
 * @param {"de" | "en"} locale
 */
function renderPlan(plan, locale) {
  if (!plan.length) return "";
  const en = locale === "en";
  const mark = en ? " — added by the customer" : " — vom Kunden ergänzt";
  const each = en ? "each" : "je Stück";
  const priced = (/** @type {{ price?: number }} */ p) => typeof p.price === "number" && Number.isFinite(p.price) && p.price > 0;
  const lines = plan
    .map(
      (p) =>
        `- ${p.qty}× ${p.name ? `${p.name} ` : ""}(\`${p.id}\`)${priced(p) ? ` — ${roundEur(/** @type {number} */ (p.price))} € ${each}` : ""}${p.added ? mark : ""}`
    )
    .join("\n");
  const sum = plan.every(priced) ? roundEur(plan.reduce((n, p) => n + /** @type {number} */ (p.price) * p.qty, 0)) : null;
  const subtotal = sum == null ? "" : en ? `\nSubtotal: ${sum} €` : `\nZwischensumme: ${sum} €`;
  return en
    ? `\n\n### The plan as it stands on the page now (the customer may have changed quantities, variants, removed items or added products)\n${lines}${subtotal}\nBuild on this state — never silently re-add what the customer removed, and keep the items the customer added in every new plan unless they want them gone. A plan has at most ${PLAN_MAX_ITEMS} lines including the customer's own; if it would get longer, ask what can go.`
    : `\n\n### Der Plan, wie er jetzt auf der Seite steht (der Kunde kann Mengen, Varianten geändert, Positionen entfernt oder Produkte ergänzt haben)\n${lines}${subtotal}\nBaue auf diesem Stand auf — füge nie stillschweigend wieder hinzu, was der Kunde entfernt hat, und übernimm die vom Kunden ergänzten Positionen in jeden neuen Plan, solange er sie nicht loswerden will. Ein Plan hat höchstens ${PLAN_MAX_ITEMS} Positionen, die des Kunden eingeschlossen; würde er länger, frag, was wegfallen kann.`;
}

// The step-by-step guide (offer_plan_options, 2026-10-23 — the client's wish:
// base unit, its accessories, bench, weights and floor protection one by one,
// three options each with pros and cons, the customer picks into the plan).
const STEP_GUIDE_EN = `3. **Step by step instead of a finished set:** announce the steps once in one sentence (e.g. "1. base unit, 2. accessories, 3. bench, 4. weights, 5. floor protection" — adapt them to the training focus: for "Boost health and endurance" and "Lose weight and stay fit" the base unit is a cardio machine; leave out what does not fit space or wishes), then go through them ONE at a time. For each step call \`offer_plan_options\`: 2–3 options (at most 4) that fit space, level, training focus and the remaining budget, your recommendation first with the badge "Mo's pick"; pros and cons short and factual, ONLY from the product data (dimensions, footprint, load capacity, features, price, delivery time) — never invented. Write at most 1–2 sentences next to the cards, then WAIT for the customer's choice — no second \`offer_plan_options\` in the same answer (except the replacement below).
   - **The customer chooses** ("I'll take: …"): the product is already in their plan (a line "added by the customer") — confirm in one sentence and go on. After the base unit come its accessories: offer the products of "Accessories for the base units in the plan" below (step "accessory", multiSelect true, up to 4 — e.g. lat pull-down option, dip bars, hip thrust attachment); benches, plates and mats belong in their own steps. Then bench, weights, floor protection, a cardio machine if it fits.
   - **Swap** ("Instead I'll take: …"): a choice in a single-select group replaces the earlier choice of the SAME step — from this card group or an earlier one of that step; the widget takes the old lines out of the plan. In the steps "accessory" and "extra" and with multiSelect, a choice from a later group is added (only a new choice in the same group replaces that group's earlier one). After a swap of the base unit, check whether the accessories already chosen still fit the new base unit (the fitting ones are named under "already in the plan" in "Accessories for the base units in the plan" below) and say which ones the customer should remove in the plan ("Remove").
   - **"I'll skip this step"** → straight on to the next step. **"Other suggestions"** → new options for the same step (other products, not the same ones again). If the customer writes freely (other wishes, questions), answer, search with search_products if needed and then offer fitting options.
   - **Weights:** an option is a set of concrete weight steps (items = one variant ref per step, plates in pairs) with a label such as "Starter set 30 kg" — see the weights rule below. If the base unit needs a barbell (rack, half rack, free stands, squat stands) and there is none in the plan, it belongs in every option of this step — a line of its own, the plates matching its diameter (30/50 mm).
   - **Options not shown:** if the result of \`offer_plan_options\` reports fewer shownOptions than the options you offered (unknownIds / soldOutIds), call it again in the same answer for the same step — only with replacements for the options with those ids (other products that are available) — and never talk about an option that is not shown.
   - Keep the plan's subtotal (below) in view against the budget and say openly when it gets tight.
   - After the last step: sum the plan up in 2–3 sentences and point to "Add everything to cart" in the plan. Do NOT call \`show_gym_plan\` to repeat the choices — the plan is already on the page. Use \`show_gym_plan\` only when the customer explicitly wants a complete set at once — then with every line already chosen.`;
const STEP_AFTER_EN = `4. **Afterwards:** answer questions and offer swaps (again with \`offer_plan_options\` for the step concerned — see "Swap"; for accessories and extras name the old line the customer should remove). Mention once that the customer can change quantities and variants in the plan, add weight steps with "+ Weight step" and further products with "+ Add a product" (a search over the whole shop), and put everything into the cart with one click.`;
const STEP_GUIDE_DE = `3. **Schritt für Schritt statt eines fertigen Sets:** Kündige die Schritte einmal in einem Satz an (z. B. „1. Basisgerät, 2. Zubehör, 3. Hantelbank, 4. Gewichte, 5. Bodenschutz“ — passe sie an den Trainingsfokus an: bei „Gesundheit und Ausdauer fördern“ und „Abnehmen und fit bleiben“ ist das Basisgerät ein Cardio-Gerät; lass weg, was nicht zu Platz oder Wünschen passt) und geh sie dann EINZELN durch. Pro Schritt rufst du \`offer_plan_options\` auf: 2–3 Optionen (höchstens 4), die zu Platz, Niveau, Trainingsfokus und dem restlichen Budget passen, deine Empfehlung zuerst mit dem badge „Mos Empfehlung“; pros und cons kurz und sachlich, NUR aus den Produktdaten (Maße, Stellfläche, Belastbarkeit, Ausstattung, Preis, Lieferzeit) — nie erfunden. Schreib höchstens 1–2 Sätze zu den Karten und WARTE dann auf die Wahl des Kunden — kein zweites \`offer_plan_options\` in derselben Antwort (außer dem Ersatz unten).
   - **Der Kunde wählt** („Ich nehme: …“): Das Produkt steht schon in seinem Plan (Position „vom Kunden ergänzt“) — bestätige in einem Satz und mach weiter. Nach dem Basisgerät kommt sein Zubehör: biete die Produkte aus „Zubehör zu den Basisgeräten im Plan“ unten an (step "accessory", multiSelect true, bis zu 4 — z. B. Latzug-Option, Dip-Barren, Hip-Thrust-Aufsatz); Bänke, Hantelscheiben und Matten gehören in ihre eigenen Schritte. Dann Hantelbank, Gewichte, Bodenschutz, ein Cardio-Gerät, wenn es passt.
   - **Tausch** („Ich nehme stattdessen: …“): Eine Wahl in einer Einzelauswahl ersetzt die frühere Wahl DESSELBEN Schritts — aus dieser Kartengruppe oder einer früheren dieses Schritts; das Widget nimmt die alten Positionen aus dem Plan. In den Schritten "accessory" und "extra" und bei multiSelect kommt eine Wahl aus einer späteren Gruppe dazu (nur eine neue Wahl in derselben Gruppe ersetzt deren frühere). Nach einem Tausch des Basisgeräts prüf, ob das schon gewählte Zubehör noch zum neuen Basisgerät passt (was passt, steht unten in „Zubehör zu den Basisgeräten im Plan“ unter „schon im Plan“), und sag, welches der Kunde im Plan entfernen sollte („Entfernen“).
   - **„Diesen Schritt überspringe ich“** → direkt zum nächsten Schritt. **„Andere Vorschläge“** → neue Optionen für denselben Schritt (andere Produkte, nicht dieselben noch einmal). Schreibt der Kunde frei (andere Wünsche, Fragen), geh darauf ein, such bei Bedarf mit search_products und biete dann passende Optionen an.
   - **Gewichte:** Eine Option ist ein Set konkreter Gewichtsstufen (items = je Stufe eine Varianten-Ref, Hantelscheiben paarweise) mit einem label wie „Einsteiger-Set 30 kg“ — siehe die Gewichte-Regel unten. Braucht das Basisgerät eine Langhantel (Rack, Half Rack, Free Stands, Kniebeugenständer) und ist keine im Plan, gehört sie in jede Option dieses Schritts — als eigene Position, die Hantelscheiben passend zu ihrem Durchmesser (30/50 mm).
   - **Nicht gezeigte Optionen:** Meldet das Ergebnis von \`offer_plan_options\` weniger shownOptions als angebotene Optionen (unknownIds / soldOutIds), ruf es in derselben Antwort noch einmal für denselben Schritt auf — nur mit Ersatz für die Optionen mit diesen IDs (andere, verfügbare Produkte) — und sprich nie von einer Option, die nicht gezeigt wird.
   - Halte die Zwischensumme des Plans (unten) gegen das Budget im Blick und sag offen, wenn es eng wird.
   - Nach dem letzten Schritt: Fasse den Plan in 2–3 Sätzen zusammen und weise auf „Alles in den Warenkorb“ im Plan hin. Ruf \`show_gym_plan\` NICHT auf, um die Auswahl zu wiederholen — der Plan steht schon auf der Seite. \`show_gym_plan\` nur, wenn der Kunde ausdrücklich ein komplettes Set auf einmal möchte — dann mit allen schon gewählten Positionen.`;
const STEP_AFTER_DE = `4. **Danach:** Beantworte Fragen und biete Tausch an (wieder mit \`offer_plan_options\` für den betroffenen Schritt — siehe „Tausch“; bei Zubehör und Extras nenn die alte Position, die der Kunde entfernen sollte). Erwähne einmal, dass der Kunde im Plan Mengen und Varianten ändern, mit „+ Gewichtsstufe“ weitere Gewichtsstufen und mit „+ Produkt hinzufügen“ (Suche im ganzen Shop) weitere Produkte ergänzen und alles mit einem Klick in den Warenkorb legen kann.`;

/** @param {number} n */
function roundEur(n) {
  return Math.round(n * 100) / 100;
}

/**
 * The accessories of the base units in the plan (their „Ergänzende Produkte“,
 * in stock) — what Mo offers in the step „Zubehör“ of the step-by-step flow —
 * and, per base, the ones already in the plan („schon im Plan“: after a swap
 * of the base unit Mo tells the fitting ones from the leftovers).
 * @param {Array<{ baseId: string, baseName: string, items: Array<{ id: string, name: string, price: number }>, inPlan?: string[] }>} accessories
 * @param {"de" | "en"} locale
 */
function renderAccessories(accessories, locale) {
  if (!accessories.length) return "";
  const en = locale === "en";
  const blocks = accessories.map((a) => {
    const planned = a.inPlan?.length ? `${en ? "already in the plan" : "schon im Plan"}: ${a.inPlan.join(", ")}` : "";
    const items = a.items.length
      ? `${a.items.map((it) => `\`${it.id}\` ${it.name} — ${roundEur(it.price)} €`).join(" · ")}${planned ? `; ${planned}` : ""}`
      : planned
        ? `${planned} — ${en ? "find further accessories with search_products" : "weiteres Zubehör mit search_products suchen"}`
        : en
          ? "none on record — find matching accessories with search_products"
          : "keins hinterlegt — such passendes Zubehör mit search_products";
    return `- ${en ? "For" : "Zu"} ${a.baseName} (\`${a.baseId}\`): ${items}`;
  });
  return en
    ? `\n\n### Accessories for the base units in the plan (for the step "accessory")\n${blocks.join("\n")}`
    : `\n\n### Zubehör zu den Basisgeräten im Plan (für den Schritt „Zubehör“)\n${blocks.join("\n")}`;
}

/** The accessory block: base units listed, „Ergänzende Produkte“ refs read per base, accessories listed per base. */
export const ACCESSORY_LIMITS = Object.freeze({ bases: 3, scan: 20, items: 10 });

/**
 * The base units whose „Ergänzende Produkte“ go into the accessory block: the
 * base units (role base) — without a strength base the cardio machines (the
 * base unit for „Gesundheit und Ausdauer fördern“ / „Abnehmen und fit
 * bleiben“). The most expensive first (the rack, not the add-on picked for it;
 * equal prices: roots — the ones no other base in the plan lists — then plan
 * order), and a base related to an already kept one — it lists it, or is
 * listed by it — is no base of its own: J-Hooks, Landmine, Jammer Arms or the
 * Latzug-Option picked in the step „Zubehör“, in either direction, also after
 * a swap of the base unit (the widget appends the new rack AFTER the add-ons
 * picked for the old one). At most ACCESSORY_LIMITS.bases.
 * @template {{ id: string, name?: unknown, category?: unknown, compatibleWith?: string[], price?: unknown, salePrice?: unknown }} P
 * @param {ReadonlyArray<P>} planProducts the plan's catalog products in plan order, each once
 * @returns {P[]}
 */
export function planAccessoryBases(planProducts) {
  const list = planProducts ?? [];
  const strength = list.filter((p) => planRoleForProduct(p) === "base");
  const pool = strength.length ? strength : list.filter((p) => planRoleForProduct(p) === "cardio");
  const lists = (/** @type {P} */ a, /** @type {P} */ b) => (a.compatibleWith ?? []).some((ref) => baseId(String(ref)) === b.id);
  const listedBy = (/** @type {P} */ p) => pool.some((o) => o !== p && lists(o, p));
  const price = (/** @type {P} */ p) => {
    const sale = Number(p.salePrice);
    const n = Number.isFinite(sale) && sale > 0 ? sale : Number(p.price);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const order = [...pool.filter((b) => !listedBy(b)), ...pool.filter(listedBy)];
  const ranked = order.map((p, i) => ({ p, i })).sort((a, b) => price(b.p) - price(a.p) || a.i - b.i).map((x) => x.p);
  /** @type {P[]} */
  const kept = [];
  for (const p of ranked) {
    if (kept.some((k) => lists(k, p) || lists(p, k))) continue;
    kept.push(p);
    if (kept.length >= ACCESSORY_LIMITS.bases) break;
  }
  return kept;
}

/**
 * The catalog ids to load for the accessory block: the first
 * ACCESSORY_LIMITS.scan „Ergänzende Produkte“ of every base.
 * @param {ReadonlyArray<{ compatibleWith?: string[] }>} bases planAccessoryBases
 * @returns {string[]}
 */
export function planAccessoryIds(bases) {
  return [...new Set((bases ?? []).flatMap((b) => (b.compatibleWith ?? []).slice(0, ACCESSORY_LIMITS.scan).map((ref) => baseId(String(ref)))))];
}

/**
 * The accessory block of the prompt (renderAccessories): per base unit its
 * „Ergänzende Produkte“ in stock, in their order — without weights, floor
 * protection and cardio machines (they have their own steps; a cardio
 * machine's list mostly holds other machines). Products already in the plan
 * are not offered again but named per base (`inPlan`, in stock or not), so
 * after a swap of the base unit Mo sees which chosen accessories fit the new
 * one. At most ACCESSORY_LIMITS.items offered per base.
 * @param {ReadonlyArray<{ id: string, name: string, compatibleWith?: string[] }>} bases planAccessoryBases
 * @param {ReadonlyMap<string, { id: string, name: string, category?: unknown, price: number, salePrice?: number, inStock?: boolean }>} productsById the loaded planAccessoryIds
 * @param {Iterable<string>} planIds the plan's ids / variant refs
 * @returns {Array<{ baseId: string, baseName: string, items: Array<{ id: string, name: string, price: number }>, inPlan: string[] }>}
 */
export function planAccessories(bases, productsById, planIds) {
  const planned = new Set([...(planIds ?? [])].map((id) => baseId(String(id))));
  return (bases ?? []).map((b) => {
    /** @type {Array<{ id: string, name: string, price: number }>} */
    const items = [];
    /** @type {string[]} */
    const inPlan = [];
    const seen = new Set();
    for (const ref of (b.compatibleWith ?? []).slice(0, ACCESSORY_LIMITS.scan)) {
      const id = baseId(String(ref));
      const a = productsById.get(id);
      if (!a || seen.has(id)) continue;
      const role = planRoleForProduct(a);
      if (role === "weights" || role === "flooring" || role === "cardio") continue;
      if (planned.has(id)) {
        seen.add(id);
        inPlan.push(a.name);
      } else if (a.inStock && items.length < ACCESSORY_LIMITS.items) {
        seen.add(id);
        items.push({ id: a.id, name: a.name, price: a.salePrice ?? a.price });
      }
    }
    return { baseId: b.id, baseName: b.name, items, inPlan };
  });
}

/**
 * The prompt section of a configurator conversation. Rendered into the system
 * prompt right after the opening sentence (system-prompt-core: the
 * `configuratorBlock` slot), on EVERY turn of the thread — the widget sends
 * the answers with every request of a configurator thread, so a change on the
 * page reaches Mo with the next message.
 *
 * @param {{
 *   answers: ConfiguratorAnswers,
 *   assortment: AssortmentProduct[],
 *   assortmentTotal?: number,
 *   settings: Pick<ConfiguratorSettings, "focus" | "notes">,
 *   plan?: Array<{ id: string, qty: number, name?: string, price?: number, added?: boolean }>,
 *   accessories?: Array<{ baseId: string, baseName: string, items: Array<{ id: string, name: string, price: number }>, inPlan?: string[] }>,
 *   locale?: "de" | "en",
 * }} opts
 * @returns {string}
 */
export function renderConfiguratorSection({ answers, assortment, assortmentTotal, settings, plan = [], accessories = [], locale = "de" }) {
  const en = locale === "en";
  // The step-by-step flow when the widget renders offer_plan_options; else the one-plan guide.
  const steps = configuratorHasOptions(answers);
  const extras = `${renderPlan(plan, locale)}${steps ? renderAccessories(accessories, locale) : ""}`;
  const listed = assortment.slice(0, CONFIGURATOR_LIMITS.promptProducts);
  const total = Math.max(assortmentTotal ?? assortment.length, assortment.length);
  const more = total - listed.length;
  const hints = renderHints(answers, locale);
  const notes = (settings.notes ?? "").trim();
  const strict = settings.focus === "only";

  if (en) {
    const assortmentBlock = listed.length
      ? `${listed.map((p) => assortmentLine(p, locale)).join("\n")}${more > 0 ? `\n- … +${more} more — find them with search_products` : ""}`
      : "_(No configurator assortment is marked yet — choose from the whole shop with search_products.)_";
    return `## Home-gym configurator (special consultation — cooperation with Men's Health / Women's Health)

The customer is planning their own home gym in the home-gym configurator on motionsports.de. They picked their basic settings on the left of the page and handed the consultation over to you. You now lead them step by step to a coherent, affordable home-gym plan. The chat sits right next to the configurator; the customer sees your plan there as well.

### Answers from the configurator (already given — do NOT ask for them again)
${answers ? renderAnswers(answers, locale) : ""}
If the customer changes them on the page, you get the new version here.${hints ? `\n\nConsulting cues for these answers:\n${hints}` : ""}

### Guide (in this order)
1. **Greeting** (first message only): 2–3 short sentences. Pick up the answers in your own words (don't recite them), no product names yet.
2. **Ask only what is missing — ONE question per message**, each with \`suggest_replies\` (the question itself stays in your text):
   a) Budget, if open → topic "budget", options along the configurator's budget ranges plus "Not sure yet".
   b) Individual wishes (assembly service, delivery date, noise, floor protection, no drilling, test in the showroom) → topic "wishes", multiSelect true.
   c) At most 1–2 detail questions that really change the recommendation (e.g. ceiling height for racks/pull-ups, training frequency, equipment they already own).
   Skip what you already know. Never ask more than 4 questions before showing ${steps ? "the first options" : "a plan"}. ${steps ? 'If the customer says "just show me something", show the first options right away (base unit) — or, if they explicitly want a complete set at once, build the plan with \`show_gym_plan\`.' : 'If the customer says "just show me something", build the plan right away.'}
${steps ? STEP_GUIDE_EN : '3. **The plan:** put together ONE coherent set with \`show_gym_plan\`: base unit(s) first, then matching accessories (prefer the base unit\'s "Accessories" ids), weights, a cardio machine if it fits the training focus, floor protection where it makes sense. It must fit training focus, space, level and budget — total within the budget (if it is up to ~10 % above, say so openly). Explain in 2–3 sentences why the set fits. Show at most ONE \`show_product\` card, for the central base unit — the plan itself shows all items.'}
   **Weights with several steps** (plates, dumbbells, kettlebells whose line lists "Variants", below or in the retrieved-products block) always as concrete weight steps: one line per step with its variant ref — the product id, \`~\`, the variant id, e.g. \`atx-plates~4711\` —, plates in pairs (quantity 2 per step), matching the bar's diameter (30/50 mm) in the plan. Size the steps to level and training focus — enough load for real progression (beginners at the barbell e.g. 2× 5 kg, 2× 10 kg plus small steps; advanced users heavier). Never only the smallest step, never such a line without its variant, never an invented variant id (search_products returns none). If the step you want is not listed ("+N steps in between"), take the nearest listed step — the customer can pick others in the plan. Weights without variants (adjustable dumbbells, sets, single kettlebells) go in with their product id, role "weights".
${steps ? STEP_AFTER_EN : '4. **After the plan:** offer swaps (cheaper/premium, more compact) and answer questions. Mention once that the customer can adjust quantities and variants in the plan, add further weight steps with "+ Weight step" and further products with "+ Add a product", and put everything into the cart with one click. After every change call \`show_gym_plan\` again with the COMPLETE new plan (not just the change).'}

### Assortment (focus)
${strict ? "Recommend ONLY products from the configurator assortment below. Leave it only when the customer explicitly asks for a specific product outside it — then via search_products." : "Work primarily with the configurator assortment below (curated home-gym products). Other shop products (e.g. a gym ball) are fine when the customer asks for them or the assortment has nothing suitable — then via search_products."}
Recommend only what is in stock. Variants (weight, colour) via \`id~variantId\` — the ids are listed below under "Variants" or in the retrieved-products block; search_products returns no variant ids. For other products with variants (colour, size) whose variant you don't know, use the product id — the customer picks the variant in the plan.

${assortmentBlock}

### Rules in the configurator
- \`suggest_replies\`: 2–6 short answers (max. 40 characters each) that the customer can tap; no \`suggest_replies\` for open questions without sensible presets.
- Per-answer product limits ("max. 2–3 products per answer" and the consulting mode's, e.g. "at most 1–2 products") do not apply to \`show_gym_plan\` (up to ${PLAN_MAX_ITEMS} items, the customer's own included) — they do apply to \`show_product\` cards.${steps ? `\n- \`offer_plan_options\`: one call per answer (plus the replacement for options not shown) and no \`suggest_replies\` with it (the cards bring "Skip" and "Other suggestions"); no \`show_product\` card for products that are in the options. The per-answer product limits do not apply to it (up to ${OPTIONS_LIMITS.options} options of up to ${OPTIONS_LIMITS.items} items).` : ""}
- The whole set goes into the cart through the plan's cart button — use \`add_to_cart\` only when the customer explicitly wants to order a single product directly.
- Assembly service, delivery date: answer from the product data (delivery time) and the additional knowledge; for an assembly service the shop does not offer as a product, or for large projects (budget > €10,000), offer \`show_contact_form\` (reason "general").${notes ? `\n\n### Notes from the motion sports team for the configurator (follow them)\n${notes}` : ""}${extras}`;
  }

  const assortmentBlock = listed.length
    ? `${listed.map((p) => assortmentLine(p, locale)).join("\n")}${more > 0 ? `\n- … +${more} weitere — über search_products finden` : ""}`
    : "_(Noch kein Konfigurator-Sortiment markiert — wähle mit search_products aus dem ganzen Shop.)_";
  return `## Home-Gym-Konfigurator (Sonderberatung — Kooperation mit Men's Health / Women's Health)

Der Kunde plant im Home-Gym-Konfigurator auf motionsports.de sein eigenes Home Gym. Er hat links auf der Seite seine Grundeinstellungen gewählt und die Beratung an dich übergeben. Du führst ihn jetzt Schritt für Schritt zu einem stimmigen, bezahlbaren Home-Gym-Plan. Der Chat steht direkt neben dem Konfigurator; deinen Plan sieht der Kunde dort ebenfalls.

### Angaben aus dem Konfigurator (schon beantwortet — NICHT erneut abfragen)
${renderAnswers(answers, locale)}
Ändert der Kunde sie auf der Seite, bekommst du hier die neue Fassung.${hints ? `\n\nBeratungsimpulse zu diesen Angaben:\n${hints}` : ""}

### Leitfaden (in dieser Reihenfolge)
1. **Begrüßung** (nur in der ersten Nachricht): 2–3 kurze Sätze. Greif die Angaben in eigenen Worten auf (nicht aufzählen), noch keine Produktnamen.
2. **Frag nur noch, was fehlt — pro Nachricht EINE Frage**, jeweils mit \`suggest_replies\` (die Frage selbst steht in deinem Text):
   a) Budget, falls offen → topic "budget", Optionen entlang der Budget-Spannen des Konfigurators plus „Weiß ich noch nicht“.
   b) Individuelle Wünsche (Aufbau-/Montageservice, Liefertermin, Lautstärke, Bodenschutz, ohne Bohren, vorher im Showroom testen) → topic "wishes", multiSelect true.
   c) Höchstens 1–2 Detailfragen, die die Empfehlung wirklich ändern (z. B. Deckenhöhe bei Racks/Klimmzügen, Trainingshäufigkeit, vorhandenes Equipment).
   Überspringe, was du schon weißt. Stell insgesamt nie mehr als 4 Fragen, bevor du ${steps ? "die ersten Optionen" : "einen Plan"} zeigst. ${steps ? "Sagt der Kunde „zeig mir einfach was“, zeig sofort die ersten Optionen (Basisgerät) — oder, wenn er ausdrücklich ein komplettes Set auf einmal will, den Plan mit \`show_gym_plan\`." : "Sagt der Kunde „zeig mir einfach was“, erstelle sofort den Plan."}
${steps ? STEP_GUIDE_DE : "3. **Der Plan:** Stell mit \`show_gym_plan\` EIN stimmiges Set zusammen: zuerst das/die Basisgerät(e), dann passendes Zubehör (bevorzugt die „Zubehör“-IDs des Basisgeräts), Gewichte, ein Cardio-Gerät, wenn es zum Trainingsfokus passt, und Bodenschutz, wo sinnvoll. Es muss zu Trainingsfokus, Platz, Niveau und Budget passen — Gesamtsumme im Budget (liegt sie bis ~10 % darüber, sag es offen). Erkläre in 2–3 Sätzen, warum das Set passt. Zeig höchstens EINE \`show_product\`-Karte, für das zentrale Basisgerät — der Plan selbst zeigt alle Positionen."}
   **Gewichte mit mehreren Gewichtsstufen** (Hantelscheiben, Hanteln, Kettlebells, deren Zeile „Varianten“ nennt — unten oder im Block der vorretrieveten Produkte) immer als konkrete Gewichtsstufen: je Stufe eine Position mit ihrer Varianten-Ref — Produkt-ID, \`~\`, VariantenID, z. B. \`atx-hantelscheiben~4711\` —, Hantelscheiben paarweise (quantity 2 je Stufe), passend zum Durchmesser (30/50 mm) der Stange im Plan. Bemiss die Stufen nach Niveau und Trainingsfokus — genug Gewicht für echten Fortschritt (Einsteiger an der Langhantel z. B. 2× 5 kg, 2× 10 kg plus kleine Stufen; Fortgeschrittene schwerer). Nie nur die kleinste Stufe, nie eine solche Position ohne ihre Variante, nie eine erfundene VariantenID (search_products liefert keine). Steht die gewünschte Stufe nicht in der Liste („+N Stufen dazwischen“), nimm die nächstliegende gelistete — weitere wählt der Kunde im Plan. Gewichte ohne Varianten (verstellbare Hanteln, Sets, einzelne Kettlebells) nimmst du mit ihrer Produkt-ID, role "weights".
${steps ? STEP_AFTER_DE : "4. **Nach dem Plan:** Biete Tausch-Optionen an (günstiger/hochwertiger, kompakter) und beantworte Fragen. Erwähne einmal, dass der Kunde im Plan Mengen und Varianten anpassen, mit „+ Gewichtsstufe“ weitere Gewichtsstufen und mit „+ Produkt hinzufügen“ weitere Produkte ergänzen und alles mit einem Klick in den Warenkorb legen kann. Rufe nach jeder Änderung \`show_gym_plan\` erneut mit dem VOLLSTÄNDIGEN neuen Plan auf (nicht nur die Änderung)."}

### Sortiment (Fokus)
${strict ? "Empfiehl AUSSCHLIESSLICH Produkte aus dem Konfigurator-Sortiment unten. Verlass es nur, wenn der Kunde ausdrücklich nach einem bestimmten Produkt außerhalb fragt — dann über search_products." : "Bewege dich primär im Konfigurator-Sortiment unten (kuratierte Home-Gym-Produkte). Andere Produkte aus dem Shop (z. B. ein Gymnastikball) sind in Ordnung, wenn der Kunde danach fragt oder das Sortiment nichts Passendes hat — dann über search_products."}
Empfiehl nur, was auf Lager ist. Varianten (Gewicht, Farbe) über \`id~VariantenID\` — die IDs stehen unten unter „Varianten“ oder im Block der vorretrieveten Produkte; search_products liefert keine VariantenIDs. Kennst du bei anderen Produkten mit Varianten (Farbe, Größe) die Variante nicht, nimm die Produkt-ID — der Kunde wählt die Variante im Plan.

${assortmentBlock}

### Regeln im Konfigurator
- \`suggest_replies\`: 2–6 kurze Antworten (max. 40 Zeichen), die der Kunde antippen kann; kein \`suggest_replies\` bei offenen Fragen ohne sinnvolle Vorgaben.
- Produktgrenzen pro Antwort („Maximal 2-3 Produkte pro Antwort“ und die des Beratungsmodus, z. B. „maximal 1-2 Produkte“) gelten nicht für \`show_gym_plan\` (bis zu ${PLAN_MAX_ITEMS} Positionen, die des Kunden eingeschlossen) — für \`show_product\`-Karten gelten sie weiter.${steps ? `\n- \`offer_plan_options\`: ein Aufruf pro Antwort (plus der Ersatz für nicht gezeigte Optionen) und kein \`suggest_replies\` dazu (die Karten bringen „Überspringen“ und „Andere Vorschläge“ mit); keine \`show_product\`-Karte für Produkte, die in den Optionen stehen. Die Produktgrenzen pro Antwort gelten dafür nicht (bis zu ${OPTIONS_LIMITS.options} Optionen mit je bis zu ${OPTIONS_LIMITS.items} Positionen).` : ""}
- Das ganze Set kommt über den Warenkorb-Button des Plans in den Warenkorb — \`add_to_cart\` nur, wenn der Kunde ausdrücklich ein einzelnes Produkt direkt bestellen will.
- Aufbau-/Montageservice, Liefertermin: beantworte aus den Produktdaten (Lieferzeit) und dem Zusatzwissen; für einen Aufbauservice, den der Shop nicht als Produkt führt, oder bei großen Projekten (Budget über 10.000 €) biete \`show_contact_form\` an (reason "general").${notes ? `\n\n### Hinweise des motion sports Teams zum Konfigurator (befolge sie)\n${notes}` : ""}${extras}`;
}

/**
 * Server-only trigger turn of a fresh configurator open (never streamed back
 * nor stored — like greetingTriggerText of system-prompt-core).
 * @param {"de" | "en"} locale
 */
export function configuratorGreetingTrigger(locale) {
  return locale === "en"
    ? "[System: The customer handed their home-gym configurator settings over to you — greet them and start the consultation with the first open question.]"
    : "[System: Der Kunde hat dir seine Angaben aus dem Home-Gym-Konfigurator übergeben — begrüße ihn und starte die Beratung mit der ersten offenen Frage.]";
}

// ---------------------------------------------------------------------------
// Tools (configurator conversations only)
// ---------------------------------------------------------------------------

/** The tools only a configurator conversation gets (withheld via activeTools otherwise). */
export const CONFIGURATOR_TOOLS = /** @type {const} */ (["suggest_replies", "show_gym_plan", "offer_plan_options"]);

/**
 * The step-by-step product choice (2026-10-23): Mo offers 1–4 options for one
 * product type, the visitor picks one (or several accessories) into the plan,
 * skips the step or asks for other suggestions. Only offered when the widget
 * sends the "options" feature (configuratorHasOptions).
 */
export const CONFIGURATOR_OPTIONS_TOOL = "offer_plan_options";

/**
 * The tools that make a thread a configurator consultation with products for
 * the attribution rule „über den Konfigurator“ (mo-revenue-store,
 * configurator-store): the plan, or — in the step flow, where the plan is
 * built from the visitor's picks — the product options.
 */
export const CONFIGURATOR_PLAN_TOOLS = /** @type {const} */ (["show_gym_plan", "offer_plan_options"]);

/**
 * The plan tool. An order counts as „über den Konfigurator“ when the latest
 * product consultation of its session before the order (the attribution
 * anchor, CONSULTATION_ANCHOR_TOOLS) sits in a thread where Mo showed this
 * plan — one rule for the KPI screen and the Konfigurator screen
 * (docs/CONFIGURATOR.md §6, spelled out in mo-revenue-store and
 * configurator-store because Neon templates are not composable).
 */
export const CONFIGURATOR_PLAN_TOOL = "show_gym_plan";

/**
 * The Konfigurator screen's ?kpiRange= for a KPI preset: it offers 7, 30 and
 * 90 days, so a custom KPI period opens the 30-day view.
 * @param {string | null | undefined} preset
 * @returns {"7d" | "30d" | "90d"}
 */
export function configuratorRangeParam(preset) {
  return preset === "7d" || preset === "90d" ? preset : "30d";
}

/** True when a thread's fired tools mark it as a configurator consultation. */
export function isConfiguratorThread(toolsFired) {
  if (!Array.isArray(toolsFired)) return false;
  return toolsFired.some((t) => typeof t === "string" && /** @type {readonly string[]} */ (CONFIGURATOR_TOOLS).includes(t));
}

/** suggest_replies topics (the page fills its profile summary from budget/wishes). */
export const REPLY_TOPICS = /** @type {const} */ (["budget", "wishes", "frequency", "space", "equipment", "other"]);

/** show_gym_plan roles (the plan groups its lines by them). */
export const PLAN_ROLES = /** @type {const} */ (["base", "accessory", "weights", "cardio", "flooring", "extra"]);

export const PLAN_ROLE_LABELS = Object.freeze({
  base: { de: "Basisgerät", en: "Base unit" },
  accessory: { de: "Zubehör", en: "Accessory" },
  weights: { de: "Gewichte", en: "Weights" },
  cardio: { de: "Cardio", en: "Cardio" },
  flooring: { de: "Bodenschutz", en: "Floor protection" },
  extra: { de: "Extra", en: "Extra" },
});

/** Lines of one show_gym_plan call (a weights set alone takes 3–5 steps) — the
 * same as the page plan's limit (CONFIGURATOR_LIMITS.planItems), so Mo can
 * keep every line the customer added. */
export const PLAN_MAX_ITEMS = 20;
export const REPLY_MAX_OPTIONS = 6;
export const REPLY_MAX_CHARS = 60;

/** offer_plan_options steps, in the guide's order, and the plan role of each. */
export const OPTION_STEPS = /** @type {const} */ (["base", "accessory", "bench", "weights", "flooring", "cardio", "extra"]);
export const OPTION_STEP_ROLE = Object.freeze({
  base: "base",
  accessory: "accessory",
  bench: "accessory",
  weights: "weights",
  flooring: "flooring",
  cardio: "cardio",
  extra: "extra",
});
export const OPTION_STEP_LABELS = Object.freeze({
  base: { de: "Basisgerät", en: "Base unit" },
  accessory: { de: "Zubehör", en: "Accessories" },
  bench: { de: "Hantelbank", en: "Bench" },
  weights: { de: "Gewichte", en: "Weights" },
  flooring: { de: "Bodenschutz", en: "Floor protection" },
  cardio: { de: "Cardio", en: "Cardio" },
  extra: { de: "Extra", en: "Extra" },
});
export const OPTIONS_LIMITS = Object.freeze({
  options: 4,
  items: 6,
  pros: 3,
  cons: 2,
  pointChars: 90,
  titleChars: 80,
  introChars: 240,
  labelChars: 60,
  badgeChars: 24,
});

/** @param {"de" | "en"} locale */
export function configuratorToolCopy(locale) {
  if (locale === "en") {
    return {
      suggestRepliesDesc: `Shows 2–6 tappable answer chips under your message (home-gym configurator only). A tap sends the chip's text as the customer's next message. Use it for every guided question with sensible presets (budget, wishes, frequency, ceiling height …). The question itself is always in your text — the chips are only the answers. multiSelect=true lets the customer pick several chips and confirm them together (e.g. wishes).`,
      fieldReplyOptions: "2–6 short answers, max. 40 characters each, in the conversation's language, without numbering.",
      fieldReplyMulti: "true = several answers can be picked and confirmed together.",
      fieldReplyTopic: "What the question is about: budget, wishes, frequency, space, equipment or other.",
      showGymPlanDesc: `Shows the customer's home-gym plan (home-gym configurator only): a card with all items, prices and the total — plus the plan view on the configurator page, where the customer adjusts quantities/variants, removes items and puts everything into the cart with one click.
Call it once the guided questions are answered (or the customer wants to see something right away), and again after every change — always with the COMPLETE plan. Only real catalog ids (or variant refs id~variantId) of products in stock; base units first.`,
      fieldPlanTitle: "Short title of the plan, e.g. 'Your strength corner for 6 m²'.",
      fieldPlanSummary: "1–2 sentences on why this set fits the customer (training focus, space, level, budget).",
      fieldPlanItems: `The items (1–${PLAN_MAX_ITEMS}): productId (catalog id or variant ref), quantity (default 1), role and an optional short note (max. 80 characters) on why it belongs in the set. Weights with several steps: one line per step with its variant ref (plates in pairs, quantity 2); weights without variants by product id.`,
      fieldPlanTips: "Optional, up to 3 short tips for setup or training (one sentence each).",
      offerOptionsDesc: `Shows the customer 1–4 product options for ONE step of the home-gym plan (home-gym configurator only): product cards with image, price, your pros and cons and a "Choose" button, plus "Skip" and "Other suggestions". A choice goes straight into the customer's plan on the page and arrives as the customer's next message ("I'll take: …"). Use it for every step of the guide (base unit, accessories, bench, weights, floor protection, cardio); one call per answer, then wait for the choice (a second call only to replace options the result reports as not shown: shownOptions, unknownIds, soldOutIds). Only real catalog ids (or variant refs id~variantId) of products in stock.`,
      fieldOptionsStep: "The step: base (base unit), accessory (accessories for the chosen base unit), bench, weights, flooring, cardio or extra.",
      fieldOptionsTitle: "Short title of the step, e.g. 'Step 1 · Your base unit'.",
      fieldOptionsIntro: "Optional, one sentence on what to look out for in this step.",
      fieldOptionsMulti: "true = several options can be chosen together (accessories); default false.",
      fieldOptionsList: "1–4 options, your recommendation first. Each: items (1–6 lines: productId = catalog id or variant ref, quantity; more than one line = a set, e.g. weight steps), optional label (the set's name), optional badge (e.g. 'Mo's pick'), pros (≤ 3) and cons (≤ 2), each ≤ 90 characters, factual from the product data only.",
    };
  }
  return {
    suggestRepliesDesc: `Zeigt 2–6 antippbare Antwort-Chips unter deiner Nachricht (nur im Home-Gym-Konfigurator). Ein Tipp schickt den Text des Chips als nächste Nachricht des Kunden. Nutze es bei jeder geführten Frage mit sinnvollen Vorgaben (Budget, Wünsche, Häufigkeit, Deckenhöhe …). Die Frage selbst steht immer in deinem Text — die Chips sind nur die Antworten. multiSelect=true lässt den Kunden mehrere Chips wählen und gemeinsam bestätigen (z. B. Wünsche).`,
    fieldReplyOptions: "2–6 kurze Antworten, je max. 40 Zeichen, in der Sprache des Gesprächs, ohne Nummerierung.",
    fieldReplyMulti: "true = mehrere Antworten wählbar und gemeinsam bestätigen.",
    fieldReplyTopic: "Worum es in der Frage geht: budget, wishes, frequency, space, equipment oder other.",
    showGymPlanDesc: `Zeigt den Home-Gym-Plan des Kunden (nur im Home-Gym-Konfigurator): eine Karte mit allen Positionen, Preisen und der Gesamtsumme — plus die Plan-Ansicht auf der Konfigurator-Seite, in der der Kunde Mengen/Varianten anpasst, Positionen entfernt und alles mit einem Klick in den Warenkorb legt.
Rufe es auf, sobald die Leitfragen beantwortet sind (oder der Kunde sofort etwas sehen will), und nach jeder Änderung erneut — immer mit dem VOLLSTÄNDIGEN Plan. Nur echte Katalog-IDs (oder Varianten-Refs id~VariantenID) verfügbarer Produkte; Basisgeräte zuerst.`,
    fieldPlanTitle: "Kurzer Titel des Plans, z. B. „Deine Kraftecke für 6 m²“.",
    fieldPlanSummary: "1–2 Sätze, warum dieses Set zum Kunden passt (Trainingsfokus, Platz, Niveau, Budget).",
    fieldPlanItems: `Die Positionen (1–${PLAN_MAX_ITEMS}): productId (Katalog-ID oder Varianten-Ref), quantity (Standard 1), role und eine optionale kurze note (max. 80 Zeichen), warum sie ins Set gehört. Gewichte mit mehreren Stufen: je Stufe eine Position mit ihrer Varianten-Ref (Hantelscheiben paarweise, quantity 2); Gewichte ohne Varianten per Produkt-ID.`,
    fieldPlanTips: "Optional, bis zu 3 kurze Tipps zu Aufbau oder Training (je ein Satz).",
    offerOptionsDesc: `Zeigt dem Kunden 1–4 Produkt-Optionen für EINEN Schritt des Home-Gym-Plans (nur im Home-Gym-Konfigurator): Produktkarten mit Bild, Preis, deinen Vor- und Nachteilen und einem „Auswählen“-Button, dazu „Überspringen“ und „Andere Vorschläge“. Eine Wahl landet direkt im Plan des Kunden auf der Seite und kommt als nächste Nachricht des Kunden an („Ich nehme: …“). Nutze es für jeden Schritt des Leitfadens (Basisgerät, Zubehör, Hantelbank, Gewichte, Bodenschutz, Cardio); ein Aufruf pro Antwort, dann auf die Wahl warten (ein zweiter nur als Ersatz für Optionen, die laut Ergebnis nicht gezeigt werden: shownOptions, unknownIds, soldOutIds). Nur echte Katalog-IDs (oder Varianten-Refs id~VariantenID) verfügbarer Produkte.`,
    fieldOptionsStep: "Der Schritt: base (Basisgerät), accessory (Zubehör zum gewählten Basisgerät), bench (Hantelbank), weights (Gewichte), flooring (Bodenschutz), cardio oder extra.",
    fieldOptionsTitle: "Kurzer Titel des Schritts, z. B. „Schritt 1 · Dein Basisgerät“.",
    fieldOptionsIntro: "Optional, ein Satz, worauf es in diesem Schritt ankommt.",
    fieldOptionsMulti: "true = mehrere Optionen gemeinsam wählbar (Zubehör); Standard false.",
    fieldOptionsList: "1–4 Optionen, deine Empfehlung zuerst. Je Option: items (1–6 Positionen: productId = Katalog-ID oder Varianten-Ref, quantity; mehr als eine Position = ein Set, z. B. Gewichtsstufen), optional label (Name des Sets), optional badge (z. B. „Mos Empfehlung“), pros (≤ 3) und cons (≤ 2), je ≤ 90 Zeichen, sachlich nur aus den Produktdaten.",
  };
}

/**
 * The model's show_gym_plan input → normalised lines (unknown roles → extra,
 * quantity clamped, duplicates merged). Used for the KPI and the tool result.
 * @param {unknown} input
 * @returns {Array<{ productId: string, quantity: number, role: string }>}
 */
export function normalizePlanItems(input) {
  const items = asRecord(input)?.items;
  if (!Array.isArray(items)) return [];
  /** @type {Array<{ productId: string, quantity: number, role: string }>} */
  const out = [];
  for (const raw of items.slice(0, PLAN_MAX_ITEMS * 2)) {
    const it = asRecord(raw);
    if (!it || typeof it.productId !== "string") continue;
    const productId = it.productId.trim();
    if (!PRODUCT_REF_RE.test(productId)) continue;
    const q = Number(it.quantity);
    const quantity = Number.isInteger(q) && q >= 1 ? Math.min(q, CONFIGURATOR_LIMITS.planQuantityMax) : 1;
    const role = typeof it.role === "string" && /** @type {readonly string[]} */ (PLAN_ROLES).includes(it.role) ? it.role : "extra";
    const existing = out.find((x) => x.productId === productId);
    if (existing) {
      existing.quantity = Math.min(existing.quantity + quantity, CONFIGURATOR_LIMITS.planQuantityMax);
      continue;
    }
    out.push({ productId, quantity, role });
    if (out.length >= PLAN_MAX_ITEMS) break;
  }
  return out;
}

/**
 * The model's offer_plan_options input → normalised options: known step
 * (else "extra"), 1–4 options of 1–6 item lines each (catalog ids or variant
 * refs, quantity clamped, duplicate lines within an option merged), points
 * trimmed and capped. Options without a valid item are dropped. Used for the
 * KPI and the tool result.
 * @param {unknown} input
 * @returns {{ step: string, multiSelect: boolean, options: Array<{ items: Array<{ productId: string, quantity: number }>, label: string | null, badge: string | null, pros: string[], cons: string[] }> }}
 */
export function normalizeOfferOptions(input) {
  const rec = asRecord(input);
  const step =
    typeof rec?.step === "string" && /** @type {readonly string[]} */ (OPTION_STEPS).includes(rec.step) ? rec.step : "extra";
  const text = (/** @type {unknown} */ v, /** @type {number} */ max) =>
    typeof v === "string" && v.trim() ? clip(v, max) : null;
  const points = (/** @type {unknown} */ v, /** @type {number} */ max) =>
    (Array.isArray(v) ? v : [])
      .map((x) => text(x, OPTIONS_LIMITS.pointChars))
      .filter((x) => x !== null)
      .slice(0, max);
  /** @type {Array<{ items: Array<{ productId: string, quantity: number }>, label: string | null, badge: string | null, pros: string[], cons: string[] }>} */
  const options = [];
  for (const raw of Array.isArray(rec?.options) ? rec.options.slice(0, OPTIONS_LIMITS.options * 2) : []) {
    const o = asRecord(raw);
    if (!o) continue;
    /** @type {Array<{ productId: string, quantity: number }>} */
    const items = [];
    for (const rawItem of Array.isArray(o.items) ? o.items.slice(0, OPTIONS_LIMITS.items * 2) : []) {
      const it = asRecord(rawItem);
      if (!it || typeof it.productId !== "string") continue;
      const productId = it.productId.trim();
      if (!PRODUCT_REF_RE.test(productId)) continue;
      const q = Number(it.quantity);
      const quantity = Number.isInteger(q) && q >= 1 ? Math.min(q, CONFIGURATOR_LIMITS.planQuantityMax) : 1;
      const same = items.find((x) => x.productId === productId);
      if (same) {
        same.quantity = Math.min(same.quantity + quantity, CONFIGURATOR_LIMITS.planQuantityMax);
        continue;
      }
      items.push({ productId, quantity });
      if (items.length >= OPTIONS_LIMITS.items) break;
    }
    if (!items.length) continue;
    options.push({
      items,
      label: text(o.label, OPTIONS_LIMITS.labelChars),
      badge: text(o.badge, OPTIONS_LIMITS.badgeChars),
      pros: points(o.pros, OPTIONS_LIMITS.pros),
      cons: points(o.cons, OPTIONS_LIMITS.cons),
    });
    if (options.length >= OPTIONS_LIMITS.options) break;
  }
  return { step, multiSelect: rec?.multiSelect === true, options };
}

/**
 * The offer_plan_options tool result (model only), counted with the widget's
 * rule: an option is shown only when EVERY item is known and available — the
 * widget leaves out an option with an unknown, sold-out or vanished-variant
 * item. A ref whose pinned variant does not exist (an invented or stale
 * variant id) is reported as unknown, so Mo replaces the id instead of
 * calling it sold out.
 * @param {ReadonlyArray<{ items: ReadonlyArray<{ productId: string }> }>} options normalizeOfferOptions(input).options
 * @param {ReadonlyArray<{ ref: string, available: boolean, missingVariant?: boolean }>} resolved resolveProductSelections of the refs
 * @returns {{ ok: true, shownOptions: number, unknownIds?: string[], soldOutIds?: string[] }}
 */
export function offerOptionsResult(options, resolved) {
  const byRef = new Map((resolved ?? []).map((r) => [r.ref, r]));
  const refs = [...new Set((options ?? []).flatMap((o) => o.items.map((it) => it.productId)))];
  const unknownIds = refs.filter((ref) => !byRef.has(ref) || byRef.get(ref)?.missingVariant === true);
  const soldOutIds = refs.filter((ref) => {
    const r = byRef.get(ref);
    return r !== undefined && r.missingVariant !== true && r.available !== true;
  });
  const shownOptions = (options ?? []).filter((o) => o.items.every((it) => byRef.get(it.productId)?.available === true)).length;
  return unknownIds.length || soldOutIds.length ? { ok: true, shownOptions, unknownIds, soldOutIds } : { ok: true, shownOptions };
}

/**
 * The configurator_options_shown events of one turn: one per valid
 * offer_plan_options call the widget renders (its tool result shows at least
 * one option). Counted with the widget's rule: an option with any unknown or
 * sold-out item is left out, and items / productIds come from the kept
 * options only.
 * @param {ReadonlyArray<{ toolCallId?: string, toolName?: string, input?: unknown, invalid?: boolean } | null | undefined>} calls
 * @param {ReadonlyMap<string, unknown>} results toolCallId → tool result output
 * @returns {Array<{ step: string, options: number, items: number, multi: boolean, productIds: string[] }>}
 */
export function optionsShownEvents(calls, results) {
  /** @type {Array<{ step: string, options: number, items: number, multi: boolean, productIds: string[] }>} */
  const out = [];
  const strings = (/** @type {unknown} */ v) => (Array.isArray(v) ? v : []).filter((x) => typeof x === "string");
  for (const c of calls ?? []) {
    if (!c || c.toolName !== CONFIGURATOR_OPTIONS_TOOL || c.invalid === true) continue;
    const output = asRecord(typeof c.toolCallId === "string" ? results?.get(c.toolCallId) : undefined);
    if (!output || output.ok !== true || !(Number(output.shownOptions) > 0)) continue;
    const bad = new Set([...strings(output.unknownIds), ...strings(output.soldOutIds)]);
    const norm = normalizeOfferOptions(c.input);
    const shown = norm.options.filter((o) => o.items.every((it) => !bad.has(it.productId)));
    if (!shown.length) continue;
    const ids = [...new Set(shown.flatMap((o) => o.items.map((it) => baseId(it.productId))))];
    out.push({
      step: norm.step,
      options: shown.length,
      items: shown.reduce((n, o) => n + o.items.length, 0),
      multi: norm.multiSelect,
      productIds: ids,
    });
  }
  return out;
}

/**
 * A stored show_gym_plan row (messages.content = the tool input as JSON,
 * truncated at 8000 characters) → title, summary, tips and the normalised lines
 * with their note and German role label — what Gespräche shows above the
 * transcript. Null when the row is unreadable or has no valid line.
 * @param {unknown} content
 * @returns {null | { title: string, summary: string, tips: string[], items: Array<{ productId: string, quantity: number, role: string, roleLabel: string, note: string | null }> }}
 */
export function parseStoredGymPlan(content) {
  if (typeof content !== "string" || !content.trim()) return null;
  /** @type {unknown} */
  let input;
  try {
    input = JSON.parse(content);
  } catch {
    return null;
  }
  const items = normalizePlanItems(input);
  if (items.length === 0) return null;
  const rec = asRecord(input) ?? {};
  /** @type {Map<string, string>} */
  const notes = new Map();
  for (const raw of Array.isArray(rec.items) ? rec.items : []) {
    const it = asRecord(raw);
    if (!it || typeof it.productId !== "string" || typeof it.note !== "string") continue;
    const id = it.productId.trim();
    const note = it.note.trim().slice(0, 120);
    if (note && !notes.has(id)) notes.set(id, note);
  }
  const text = (/** @type {unknown} */ v, /** @type {number} */ max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const roleLabels = /** @type {Record<string, { de: string }>} */ (PLAN_ROLE_LABELS);
  return {
    title: text(rec.title, 80),
    summary: text(rec.summary, 400),
    tips: (Array.isArray(rec.tips) ? rec.tips : []).map((t) => text(t, 200)).filter(Boolean).slice(0, 3),
    items: items.map((i) => ({ ...i, roleLabel: roleLabels[i.role]?.de ?? i.role, note: notes.get(i.productId) ?? null })),
  };
}

// ---------------------------------------------------------------------------
// KPI (ids, enums, booleans and counts only — API_CONTRACT §0 rule 13)
// ---------------------------------------------------------------------------

/** Server-only: a configurator thread was opened (the fresh handover turn). */
export const KPI_CONFIGURATOR_CHAT_STARTED = "configurator_chat_started";
/** Server-only: Mo showed a plan (one per show_gym_plan call). */
export const KPI_CONFIGURATOR_PLAN_SHOWN = "configurator_plan_shown";
/** Server-only: Mo offered product options for one step (one per rendered offer_plan_options call). */
export const KPI_CONFIGURATOR_OPTIONS_SHOWN = "configurator_options_shown";

/** Widget events of the configurator page (docs/frontend/API_CONTRACT.md §5). */
export const CONFIGURATOR_WIDGET_EVENTS = Object.freeze({
  viewed: "configurator_viewed",
  started: "configurator_started",
  handover: "configurator_handover",
  chipClicked: "configurator_chip_clicked",
  answersChanged: "configurator_answers_changed",
  planEdited: "configurator_plan_edited",
  cartAdded: "configurator_cart_added",
  /** Step-by-step choice (2026-10-23): an option picked into the plan, a step skipped, other suggestions asked for. */
  optionPicked: "configurator_option_picked",
  optionSkipped: "configurator_option_skipped",
  optionMore: "configurator_option_more",
});

/**
 * data of configurator_chat_started.
 * @param {ConfiguratorAnswers} a @param {"de" | "en"} locale
 */
export function chatStartedEventData(a, locale) {
  return {
    persona: a.persona ?? "",
    location: a.location ?? "",
    space: a.space ?? "",
    training: a.training.join(","),
    level: a.level ?? "",
    budget: a.budget ?? "",
    wishes: a.wishes.join(","),
    partner: a.partner ?? "",
    // The step-by-step flow (the widget renders offer_plan_options) or the one-plan guide.
    steps: configuratorHasOptions(a),
    locale,
  };
}

/**
 * data of configurator_plan_shown (catalog handles are ids, not names).
 * @param {unknown} input @param {number} planNumber
 */
export function planShownEventData(input, planNumber) {
  const items = normalizePlanItems(input);
  return {
    planNumber,
    items: items.length,
    units: items.reduce((n, it) => n + it.quantity, 0),
    productIds: items.map((it) => baseId(it.productId)),
  };
}

/**
 * The configurator_plan_shown events of one turn: one per show_gym_plan call
 * the widget renders — a valid call (the SDK keeps schema failures in the
 * step's toolCalls, flagged invalid; the widget never renders those) whose tool
 * result shows at least one line — numbered on from `before`. Lines the result
 * named unknown are left out of the counts and productIds.
 *
 * @param {ReadonlyArray<{ toolCallId?: string, toolName?: string, input?: unknown, invalid?: boolean } | null | undefined>} calls
 * @param {ReadonlyMap<string, unknown>} results toolCallId → tool result output
 * @param {number} before plans already shown in the thread
 * @returns {Array<{ planNumber: number, items: number, units: number, productIds: string[] }>}
 */
export function planShownEvents(calls, results, before) {
  /** @type {Array<{ planNumber: number, items: number, units: number, productIds: string[] }>} */
  const out = [];
  let n = Number.isInteger(before) && before > 0 ? before : 0;
  for (const c of calls ?? []) {
    if (!c || c.toolName !== CONFIGURATOR_PLAN_TOOL || c.invalid === true) continue;
    const output = asRecord(typeof c.toolCallId === "string" ? results?.get(c.toolCallId) : undefined);
    if (!output || output.ok !== true || !(Number(output.shownItems) > 0)) continue;
    const unknown = new Set(
      (Array.isArray(output.unknownIds) ? output.unknownIds : []).filter((x) => typeof x === "string")
    );
    const items = normalizePlanItems(c.input).filter((it) => !unknown.has(it.productId));
    if (items.length === 0) continue;
    n += 1;
    out.push({
      planNumber: n,
      items: items.length,
      units: items.reduce((sum, it) => sum + it.quantity, 0),
      productIds: items.map((it) => baseId(it.productId)),
    });
  }
  return out;
}

/**
 * Plans already shown in a thread, counted from the replayed UI history (the
 * `before` of planShownEvents): every `tool-show_gym_plan` part except one
 * whose stored result showed nothing (`ok` with `shownItems` 0 — all lines
 * unknown, never rendered). A part without a result counts (older histories).
 * @param {ReadonlyArray<{ role?: string, parts?: ReadonlyArray<{ type?: string, output?: unknown }> }> | null | undefined} messages
 * @returns {number}
 */
export function countShownGymPlans(messages) {
  let count = 0;
  for (const msg of messages ?? []) {
    if (!msg || msg.role !== "assistant") continue;
    for (const part of msg.parts ?? []) {
      if (!part || part.type !== `tool-${CONFIGURATOR_PLAN_TOOL}`) continue;
      const out = asRecord(part.output);
      if (out && out.ok === true && !(Number(out.shownItems) > 0)) continue;
      count++;
    }
  }
  return count;
}

/**
 * Distribution of one answer over configurator_chat_started rows — every
 * option of the vocabulary in its order (zero rows included), then „ohne
 * Angabe“. Multi-answer fields count each chosen option.
 * @param {string} key
 * @param {Array<{ value: string | null, n: number }>} rows  value = the stored data field (comma list for multi)
 * @returns {Array<{ key: string, label: string, count: number }>}
 */
export function answerDistribution(key, rows) {
  const field = configuratorField(key);
  if (!field) return [];
  /** @type {Map<string, number>} */
  const counts = new Map(field.options.map((o) => [o.id, 0]));
  let none = 0;
  for (const row of rows) {
    const n = Number(row.n) || 0;
    const ids = String(row.value ?? "")
      .split(",")
      .map((s) => (key === "persona" ? (personaAnswer(s) ?? "") : s.trim()))
      .filter((s) => counts.has(s));
    if (!ids.length) {
      none += n;
      continue;
    }
    for (const id of field.multi ? ids : ids.slice(0, 1)) counts.set(id, (counts.get(id) ?? 0) + n);
  }
  const out = field.options.map((o) => ({ key: o.id, label: o.de, count: counts.get(o.id) ?? 0 }));
  if (none > 0) out.push({ key: "", label: "ohne Angabe", count: none });
  return out;
}

/**
 * The step-by-step table of the Konfigurator screen: one row per product type
 * in the guide's order (OPTION_STEPS), only types with any count, German labels.
 * @param {ReadonlyArray<{ step: string, shown?: number, picked?: number, skipped?: number, more?: number }>} rows
 * @returns {Array<{ step: string, label: string, shown: number, picked: number, skipped: number, more: number }>}
 */
export function optionStepRows(rows) {
  /** @type {Map<string, { shown: number, picked: number, skipped: number, more: number }>} */
  const by = new Map();
  for (const r of rows ?? []) {
    const step = /** @type {readonly string[]} */ (OPTION_STEPS).includes(r?.step) ? r.step : "extra";
    const cur = by.get(step) ?? { shown: 0, picked: 0, skipped: 0, more: 0 };
    cur.shown += Number(r.shown) || 0;
    cur.picked += Number(r.picked) || 0;
    cur.skipped += Number(r.skipped) || 0;
    cur.more += Number(r.more) || 0;
    by.set(step, cur);
  }
  const labels = /** @type {Record<string, { de: string }>} */ (OPTION_STEP_LABELS);
  return OPTION_STEPS.flatMap((step) => {
    const c = by.get(step);
    return c && c.shown + c.picked + c.skipped + c.more > 0 ? [{ step, label: labels[step].de, ...c }] : [];
  });
}

/**
 * The configurator funnel (sessions): page view (only with analytics
 * consent) → first answer → handover click → Mo started → plan shown → cart.
 * @param {{ viewed: number, started: number, handover: number, chats: number, plans: number, carts: number, orders: number }} c
 */
export function configuratorFunnel(c) {
  const stages = [
    { key: "started", label: "Konfigurator begonnen", value: c.started },
    { key: "handover", label: "An Mo übergeben", value: c.handover },
    { key: "chats", label: "Beratung gestartet", value: c.chats },
    { key: "plans", label: "Plan erstellt", value: c.plans },
    { key: "carts", label: "In den Warenkorb", value: c.carts },
    { key: "orders", label: "Bestellt", value: c.orders },
  ];
  const rate = (/** @type {number} */ part, /** @type {number} */ whole) => (whole > 0 ? Math.min(1, part / whole) : null);
  return {
    stages,
    handoverRate: rate(c.handover, c.started),
    planRate: rate(c.plans, c.chats),
    cartRate: rate(c.carts, c.plans),
    orderRate: rate(c.orders, c.chats),
  };
}
