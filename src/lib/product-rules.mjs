// Product rules (Home-Gym-Konfigurator round of 2026-10-27) — pure, no I/O.
//
// Data-driven constraints the recommendation VALIDATES instead of trusting the
// prompt: weight plates and single dumbbells go in pairs, floor tiles cover a
// known area per unit and are planned for the whole room (any positive
// coverage means „whole room“ — fillsRoom), and whether a
// product is on display in the showroom (showroom-core.mjs). A new rule is an
// entry of PRODUCT_RULES (code) or, for one product, a Shopify metafield of the
// namespace `mo` (catalog-mapping.ts → product.moRules; a metafield beats the
// registry) — the prompt templates never name a product:
//   - the prompt's product lines carry ruleHint() (system-prompt-core: the
//     retrieved products; configurator-core: assortment, accessories, plan),
//   - the configurator tools validate their input (validateLines /
//     validateOptions) and tell the model what they `adjusted`, the coverage
//     of floor tiles and which products are in the showroom,
//   - GET /api/products and the configurator cards publish publicRules() — the
//     widget normalises its plan lines with them (round up to the step, ≥ min,
//     ≤ max).
//
// docs/CONFIGURATOR.md §4a owns the feature.

import { planRoleForProduct } from "./plan-role.mjs";
import { resolveProductRef } from "./product-ref.mjs";

export const RULE_LIMITS = Object.freeze({
  /** Units per plan line without a coverage — the widget's and the tools' cap. */
  lineMax: 20,
  /**
   * Units per floor line — a line whose resolved rules have a coverage (a
   * whole room in small tiles needs more than 20). The configurator's parsers,
   * which do not know the product, clamp at this generically
   * (configurator-core CONFIGURATOR_LIMITS.planQuantityMax).
   */
  floorLineMax: 200,
  /** A metafield quantity above this is ignored (a typo). */
  quantityMax: 999,
  /** Plausible area of ONE tile or mat in m² — outside, no coverage is derived. */
  tileMinM2: 0.04,
  tileMaxM2: 12,
  /** At most this many tiles in one pack („Set 10 Stück“). */
  packMax: 100,
  /** Largest floor area the tools accept in m² (larger is a typo). */
  areaMaxM2: 500,
});

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/** A set, pack or kit — never a single plate or dumbbell („Hantelset“, „Kurzhantel-Set“, „Hantelsatz“, „Vorteilspaket“). */
const SET_NAME = /sets?\b|vorteilspaket|paket\b|satz\b|sätze|komplett|\bkit\b/i;
/** Already a pair: „Paar“, „paarweise“, „2 x 24 kg“. */
const PAIR_NAME = /\bpaar\b|paarweise|\bpairs?\b|\b2\s*[x×]\s*\d/i;
/** The merchant's sales unit in the description: „Preisstellung paarweise“, „Bestelleinheit / Preisstellung: Paarweise“. */
const PAIR_PRICING = /(?:preisstellung|bestelleinheit|liefereinheit|verkaufseinheit|preis)\b[^.!?\n]{0,25}?\bpaar(?:weise)?\b/i;
/** Adjustable dumbbells (one product = the whole set of weights). */
const ADJUSTABLE_NAME = /verstellbar|adjustable|n[üu]obell|octa|selecttech|power\s*block|bowflex/i;

/** Floor tiles and protection mats that cover a room (not gym mats, not mats under one machine). */
const FLOOR_TILE_NAME = /bodenschutz(?:matte|platte)|fallschutz(?:matte|platte)|schutzplatte|bodenplatte|puzzle(?:matte|platte)|gewichthebermatte|granulat(?:matte|platte)|floor\s*(?:tiles?|protection\s+tiles?)/i;
const NOT_ROOM_FLOOR = /unterleg|gymnastik|yoga|reiniger|klebeband|\btape\b|rampe|wandhalter|kampfsport|komplett|\bracks?\b|deadlift|plattform|platform/i;

/**
 * @typedef {{
 *   roles?: readonly string[],
 *   category?: RegExp, name?: RegExp, categoryOrName?: RegExp, tags?: RegExp,
 *   handles?: readonly string[],
 *   salesUnits?: readonly ("piece" | "pair" | "set" | "unknown")[],
 * }} RuleWhen
 * @typedef {{ category?: RegExp, name?: RegExp, tags?: RegExp, description?: RegExp, handles?: readonly string[] }} RuleUnless
 * @typedef {{
 *   quantityStep?: number, minQuantity?: number, maxQuantity?: number,
 *   coveragePerUnitM2?: number | "dimensions", coverageFromDescription?: boolean,
 * }} RuleEffects
 * coveragePerUnitM2: m² one unit covers — a coverage always means „plan it for
 * the whole room“ (fillsRoom); "dimensions" = from the variant, the name, the
 * catalog dimensions or the footprint, and with coverageFromDescription also
 * from the description's „Länge … Breite …“ / „Maße: A x B mm“ as the last
 * source (coverageFromDimensions).
 * @typedef {{
 *   id: string,
 *   label: { de: string, en: string },
 *   description: string,
 *   effect: string,
 *   when: RuleWhen,
 *   unless?: RuleUnless,
 *   effects: RuleEffects,
 *   requiresCoverage?: boolean,
 * }} ProductRule
 */

/**
 * The rules of the shop, in order (a later rule overrides an earlier one for
 * the same effect; a metafield overrides both). `when`: every condition given
 * must hold — the plan role (planRoleForProduct), regexes on category / name /
 * tags, the sales unit („Liefereinheit“ of the catalog: Stück / Paar / Set),
 * or the product is listed in `handles` (then only `unless.handles` can still
 * exclude it). `unless`: any match excludes the product. Checked against the
 * real catalog (docs/CONFIGURATOR.md §4a lists what each rule matches).
 * @type {ReadonlyArray<ProductRule>}
 */
export const PRODUCT_RULES = Object.freeze([
  {
    id: "plates-pairs",
    label: { de: "Hantelscheiben paarweise", en: "Weight plates in pairs" },
    description:
      "Einzeln verkaufte Hantelscheiben (Liefereinheit Stück — keine Sets, Pakete oder Paare) nur paarweise: eine Scheibe je Hantelseite, Menge 2, 4, 6 …",
    effect: "paarweise (Schritt 2, mindestens 2)",
    when: {
      roles: ["weights"],
      categoryOrName: /hantelscheib|gewichtsscheib|technikscheib|bumper|weight\s*plates?|\bplates?\b/i,
      salesUnits: ["piece", "unknown"],
    },
    unless: { name: new RegExp(`${SET_NAME.source}|${PAIR_NAME.source}|weste|\\bvest`, "i"), category: /vest|weste/i, description: PAIR_PRICING },
    effects: { quantityStep: 2, minQuantity: 2 },
  },
  {
    id: "dumbbells-pairs",
    label: { de: "Kurzhanteln paarweise", en: "Dumbbells in pairs" },
    description:
      "Einzeln verkaufte Kurzhanteln und Kurzhantelstangen (Liefereinheit Stück — keine Sets, Paare oder verstellbaren Hanteln) nur paarweise. Kettlebells nicht.",
    effect: "paarweise (Schritt 2, mindestens 2)",
    when: {
      roles: ["weights"],
      categoryOrName: /dumbbells?|kurzhantel|kompakthantel|\bhanteln\b|hex.?hantel|trainingshantel|vinyl.?hantel/i,
      salesUnits: ["piece", "unknown"],
    },
    unless: {
      name: new RegExp(`${SET_NAME.source}|${PAIR_NAME.source}|${ADJUSTABLE_NAME.source}|kettlebell`, "i"),
      description: PAIR_PRICING,
    },
    effects: { quantityStep: 2, minQuantity: 2 },
  },
  {
    id: "flooring-room",
    label: { de: "Bodenschutz für den ganzen Raum", en: "Flooring for the whole room" },
    description:
      "Bodenschutzmatten und -platten mit Maßen im Namen oder in der Variante („1000 x 1000 mm“; ein „Set 10 Stück“ zählt zehnfach), sonst in der Beschreibung („Länge: 101 cm“ und „Breite: 101 cm“): Mo plant die ganze Raumfläche, nicht nur die Fläche unter dem Gerät, und die Tools rechnen die Stückzahl aus der Fläche (bis 200 Stück je Position). Ohne erkennbare Maße keine Regel.",
    effect: "Deckung je Stück aus den Maßen, ganze Raumfläche",
    when: { name: FLOOR_TILE_NAME },
    unless: { name: NOT_ROOM_FLOOR },
    effects: { coveragePerUnitM2: "dimensions", coverageFromDescription: true },
    requiresCoverage: true,
  },
]);

// ---------------------------------------------------------------------------
// Catalog facts
// ---------------------------------------------------------------------------

/**
 * The merchant's sales unit — custom.liefereinheit (catalog-mapping.ts puts it
 * into specifications.Liefereinheit): „Stück“, „Paar“, „Set“ ("unknown" when
 * not maintained, e.g. the bundled fallback catalog).
 * @param {unknown} product
 * @returns {"piece" | "pair" | "set" | "unknown"}
 */
export function salesUnitOf(product) {
  const specs = /** @type {any} */ (product)?.specifications;
  const raw = String((specs && typeof specs === "object" ? specs.Liefereinheit : "") ?? "").trim().toLowerCase();
  if (!raw) return "unknown";
  if (/paar|pair/.test(raw)) return "pair";
  if (/\bset\b|satz|paket|kit/.test(raw)) return "set";
  if (/st(?:ü|ue|u)ck|sück|stk|einzel|piece/.test(raw)) return "piece";
  return "unknown";
}

/** @type {WeakMap<object, { id: string, role: string, category: string, name: string, tags: string[], description: string, salesUnit: string }>} */
const FACTS = new WeakMap();

/** @param {any} p */
function factsOf(p) {
  if (!p || typeof p !== "object") {
    return { id: "", role: "extra", category: "", name: "", tags: [], description: "", salesUnit: "unknown" };
  }
  let f = FACTS.get(p);
  if (f) return f;
  f = {
    id: String(p.id ?? ""),
    role: planRoleForProduct(p),
    category: String(p.category ?? ""),
    name: String(p.name ?? ""),
    tags: Array.isArray(p.tags) ? p.tags.filter((/** @type {unknown} */ t) => typeof t === "string") : [],
    description: `${String(p.shortDescription ?? "")}\n${String(p.detailedDescription ?? "").slice(0, 6000)}`,
    salesUnit: salesUnitOf(p),
  };
  FACTS.set(p, f);
  return f;
}

/**
 * Does a registry rule apply to the product (before any coverage check)?
 * @param {ProductRule} rule
 * @param {ReturnType<typeof factsOf>} f
 */
function ruleMatches(rule, f) {
  const w = rule.when ?? {};
  const u = rule.unless ?? {};
  if (u.handles?.includes(f.id)) return false;
  if (w.handles?.includes(f.id)) return true;
  const textual = w.roles || w.category || w.name || w.categoryOrName || w.tags || w.salesUnits;
  if (!textual) return false;
  if (w.roles && !w.roles.includes(f.role)) return false;
  if (w.category && !w.category.test(f.category)) return false;
  if (w.name && !w.name.test(f.name)) return false;
  if (w.categoryOrName && !(w.categoryOrName.test(f.category) || w.categoryOrName.test(f.name))) return false;
  if (w.tags) {
    const re = w.tags;
    if (!f.tags.some((t) => re.test(t))) return false;
  }
  if (w.salesUnits && !w.salesUnits.includes(/** @type {any} */ (f.salesUnit))) return false;
  if (u.category && u.category.test(f.category)) return false;
  if (u.name && u.name.test(f.name)) return false;
  if (u.tags) {
    const re = u.tags;
    if (f.tags.some((t) => re.test(t))) return false;
  }
  if (u.description && u.description.test(f.description)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Coverage of floor tiles
// ---------------------------------------------------------------------------

const NUM = String.raw`\d{1,5}(?:[.,]\d{1,3})?`;
/** „1000 x 1000 x 15 / 20 mm“, „500 x 500 x 30 mm“, „100x100x2,0cm“, „3 x 3 m“, „1000 x 1000“. */
const DIM_RE = new RegExp(
  String.raw`(${NUM})\s*[x×*]\s*(${NUM})(?:\s*[x×*]\s*${NUM}(?:\s*\/\s*${NUM})*)?\s*(mm|cm|m)?(?![a-zäöüß])`,
  "i"
);
/** „Set 10 Stück“, „10 Stück“, „10er-Set“, „10 Stk.“ */
const PACK_RE = /\bset\s*(?:à|a|aus|mit|von)?\s*(\d{1,3})\s*(?:stück|stk\.?|teile|platten|matten)?|(\d{1,3})\s*(?:stück|stk\b\.?|teilig|er[-\s]?set|er[-\s]?pack|pcs\b|pieces\b)/i;
/** A variant that is no tile: connectors, tape, ramps, the edge pieces of a puzzle system. */
const NON_TILE_VARIANT = /verbinder|frog|clip|connector|kleber|klebeband|\btape\b|rampe|\brechts\b|\blinks\b|\bgerade\b|abschluss|kantenleiste/i;

/** @param {string} s */
function toNumber(s) {
  const n = Number(String(s).replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

/** @param {number} n */
function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * The area of ONE piece from dimensions in a text, in m² — „1000 x 1000 x 15 mm“
 * → 1, „500 x 500 x 30 mm“ → 0.25. Without a unit: ≥ 300 mm, ≥ 30 cm, else m.
 * Null without dimensions.
 * @param {unknown} text
 * @returns {number | null}
 */
export function areaFromText(text) {
  const m = DIM_RE.exec(String(text ?? ""));
  if (!m) return null;
  const a = toNumber(m[1]);
  const b = toNumber(m[2]);
  if (!(a > 0) || !(b > 0)) return null;
  let unit = String(m[3] ?? "").toLowerCase();
  if (!unit) {
    const big = Math.max(a, b);
    unit = big >= 300 ? "mm" : big >= 30 ? "cm" : "m";
  }
  const f = unit === "mm" ? 0.001 : unit === "cm" ? 0.01 : 1;
  return Math.round(a * f * (b * f) * 10000) / 10000;
}

/**
 * Pieces in one pack („Set 10 Stück“ → 10), null for a single piece.
 * @param {unknown} text
 * @returns {number | null}
 */
export function packCountFromText(text) {
  const m = PACK_RE.exec(String(text ?? ""));
  if (!m) return null;
  const n = Number(m[1] ?? m[2]);
  return Number.isInteger(n) && n > 1 && n <= RULE_LIMITS.packMax ? n : null;
}

/** A length with its unit (descriptions always name the unit). */
const LEN = String.raw`(${NUM})\s*(mm|cm|m)\b`;
/** „Länge: 101 cm +/- 1 %“ … „Breite: 101 cm“ — the merchant's „Produktdetails“ lines. */
const DESC_LENGTH_RE = new RegExp(String.raw`(?:^|[^\p{L}])l(?:ä|ae)nge\s*:?\s*${LEN}`, "iu");
const DESC_WIDTH_RE = new RegExp(String.raw`(?:^|[^\p{L}])breite\s*:?\s*${LEN}`, "iu");
/** „Maße: 1000 x 1000 mm“, „Abmessungen (L x B x H): 100 x 100 x 4 cm“ — one labelled line. */
const DESC_SIZE_RE = /(?:^|[^\p{L}])(?:ma(?:ß|ss)e|abmessungen?)\s*(?:\([^)\n]{0,20}\))?\s*:\s*([^\n]{3,80})/iu;

/** @param {string} n @param {string} unit → metres */
function toMetres(n, unit) {
  const v = toNumber(n);
  const u = unit.toLowerCase();
  return v * (u === "mm" ? 0.001 : u === "cm" ? 0.01 : 1);
}

/**
 * The area of ONE piece from the product description, in m² — the labelled
 * „Länge: … cm“ and „Breite: … cm“ lines (at most 300 characters apart), else a
 * labelled „Maße: A x B mm“ line; units are required (no guessing). Null
 * without. Used only as the LAST coverage source of the flooring-room rule
 * (coverageFromDimensions with `description`), i.e. for products whose NAME
 * already says they are floor tiles.
 * @param {unknown} text
 * @returns {number | null}
 */
export function areaFromDescription(text) {
  const s = String(text ?? "");
  const len = DESC_LENGTH_RE.exec(s);
  const wid = DESC_WIDTH_RE.exec(s);
  if (len && wid && Math.abs(len.index - wid.index) <= 300) {
    const a = toMetres(len[1], len[2]);
    const b = toMetres(wid[1], wid[2]);
    if (a > 0 && b > 0) return Math.round(a * b * 10000) / 10000;
  }
  const size = DESC_SIZE_RE.exec(s);
  if (size) {
    const m = DIM_RE.exec(size[1]);
    // only with a unit — a bare „100 x 100“ in a description stays unread
    if (m && m[3]) return areaFromText(m[0]);
  }
  return null;
}

/**
 * Area one unit of the product (or of its variant) covers, in m² (2 decimals):
 * the variant's own dimensions, else the name's, else width × depth of the
 * catalog dimensions, else the footprint, else (only with `description`, the
 * flooring-room rule) the description's „Länge … Breite …“ — times the pieces
 * of a pack. Null for a variant that is no tile (connector, ramp, edge piece)
 * or an implausible size.
 * @param {any} product
 * @param {any} [variant]
 * @param {{ description?: boolean }} [opts]
 * @returns {number | null}
 */
export function coverageFromDimensions(product, variant, opts = {}) {
  const vTitle = variant && typeof variant === "object" ? String(variant.title ?? "") : "";
  if (vTitle && NON_TILE_VARIANT.test(vTitle)) return null;
  const dims = product?.dimensions;
  const fromDims =
    dims && Number(dims.width) > 0 && Number(dims.depth) > 0 ? (Number(dims.width) * Number(dims.depth)) / 10000 : null;
  const footprint = typeof product?.footprintM2 === "number" && product.footprintM2 > 0 ? product.footprintM2 : null;
  const fromDescription = () =>
    opts?.description === true
      ? areaFromDescription(`${String(product?.shortDescription ?? "")}\n${String(product?.detailedDescription ?? "").slice(0, 6000)}`)
      : null;
  const piece = (vTitle ? areaFromText(vTitle) : null) ?? areaFromText(product?.name) ?? fromDims ?? footprint ?? fromDescription();
  if (piece == null || piece < RULE_LIMITS.tileMinM2 || piece > RULE_LIMITS.tileMaxM2) return null;
  const pack = (vTitle ? packCountFromText(vTitle) : null) ?? packCountFromText(product?.name) ?? 1;
  const total = round2(piece * pack);
  return total > 0 ? total : null;
}

// ---------------------------------------------------------------------------
// Metafields (namespace `mo`)
// ---------------------------------------------------------------------------

/** The `mo.*` product metafields the rules read (catalog-mapping.ts, scripts/convert-catalog.mjs). */
export const MO_RULE_METAFIELDS = Object.freeze(["sold_in_pairs", "quantity_step", "min_quantity", "max_quantity", "coverage_m2"]);

/**
 * @typedef {{ soldInPairs?: boolean, quantityStep?: number, minQuantity?: number, maxQuantity?: number, coverageM2?: number }} MoRules
 */

/** @param {unknown} v @returns {boolean | null} */
function metaBool(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (["true", "1", "ja", "yes", "wahr"].includes(s)) return true;
  if (["false", "0", "nein", "no", "falsch"].includes(s)) return false;
  return null;
}

/** @param {unknown} v @param {number} max @returns {number | null} */
function metaInt(v, max) {
  const s = String(v ?? "").trim();
  if (!/^\d{1,4}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= max ? n : null;
}

/** @param {unknown} v @returns {number | null} */
function metaDecimal(v) {
  const s = String(v ?? "").trim().replace(",", ".");
  if (!/^\d{1,4}(?:\.\d{1,4})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= RULE_LIMITS.tileMaxM2 * RULE_LIMITS.packMax ? n : null;
}

/**
 * The `mo.*` metafields of one product → product.moRules (only the fields that
 * parse; null when none does). `get(key)` returns the raw metafield value of
 * `mo.<key>` (Shopify: boolean "true"/"false", integer "2", decimal "1.0";
 * a text field „ja“ / „1,5“ is accepted too). coverage_m2 = 0 switches a
 * derived coverage off.
 * @param {(key: string) => unknown} get
 * @returns {MoRules | null}
 */
export function parseMoRuleMetafields(get) {
  /** @type {MoRules} */
  const out = {};
  const pairs = metaBool(get("sold_in_pairs"));
  if (pairs !== null) out.soldInPairs = pairs;
  const step = metaInt(get("quantity_step"), RULE_LIMITS.lineMax);
  if (step !== null) out.quantityStep = step;
  const min = metaInt(get("min_quantity"), RULE_LIMITS.lineMax);
  if (min !== null) out.minQuantity = min;
  const max = metaInt(get("max_quantity"), RULE_LIMITS.quantityMax);
  if (max !== null) out.maxQuantity = max;
  const cov = metaDecimal(get("coverage_m2"));
  if (cov !== null) out.coverageM2 = cov;
  return Object.keys(out).length ? out : null;
}

/** @param {any} p @returns {MoRules | null} */
function moRulesOf(p) {
  const mo = p?.moRules;
  return mo && typeof mo === "object" && !Array.isArray(mo) ? mo : null;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   step: number,
 *   min: number,
 *   max: number | null,
 *   coverageM2: number | null,
 *   fillsRoom: boolean,
 *   showroom: boolean,
 *   ruleIds: string[],
 * }} ResolvedRules
 */

/** The rules of a product no rule touches. */
export const DEFAULT_RULES = Object.freeze({
  step: 1,
  min: 1,
  max: null,
  coverageM2: null,
  fillsRoom: false,
  showroom: false,
  ruleIds: Object.freeze([]),
});

/** @param {Iterable<string> | ReadonlySet<string> | null | undefined} ids @param {string} id */
function hasId(ids, id) {
  if (!ids || !id) return false;
  if (typeof (/** @type {any} */ (ids).has) === "function") return /** @type {ReadonlySet<string>} */ (ids).has(id);
  for (const x of /** @type {Iterable<string>} */ (ids)) if (x === id) return true;
  return false;
}

/**
 * The cap of one plan line under the rules: RULE_LIMITS.floorLineMax for a
 * line with a coverage (a floor line — or `floorLineMax` when the caller caps
 * floor lines lower, e.g. for a widget without rules), else RULE_LIMITS.lineMax.
 * @param {Partial<ResolvedRules> | null | undefined} rules
 * @param {{ floorLineMax?: number }} [opts]
 * @returns {number}
 */
export function lineCapOf(rules, opts = {}) {
  const floor = Number.isInteger(opts?.floorLineMax) && /** @type {number} */ (opts.floorLineMax) >= 1
    ? Math.min(/** @type {number} */ (opts.floorLineMax), RULE_LIMITS.floorLineMax)
    : RULE_LIMITS.floorLineMax;
  return typeof rules?.coverageM2 === "number" && rules.coverageM2 > 0 ? floor : RULE_LIMITS.lineMax;
}

/**
 * The rules of one product (or one of its variants): the registry, then the
 * `mo.*` metafields on top, then the showroom flag.
 *   step — units go in steps of this (2 = pairs); min — at least (a multiple of
 *   step, default step); max — at most (null = only the plan line's cap:
 *   RULE_LIMITS.lineMax, or RULE_LIMITS.floorLineMax for a floor line);
 *   coverageM2 — m² one unit covers (floor tiles: the flooring-room rule or
 *   `mo.coverage_m2` > 0; `mo.coverage_m2` = 0 switches it off; none for an
 *   edge-piece / connector variant, NON_TILE_VARIANT); fillsRoom —
 *   plan it for the whole room: true exactly when there is a coverage;
 *   showroom — on display in the showroom (id in `showroomIds`); ruleIds — the
 *   registry ids and metafield keys behind them (admin).
 * Conflicts resolve towards the smaller quantity: a max below the step drops
 * the step, a min above the max becomes the max.
 * @param {any} product
 * @param {{ showroomIds?: Iterable<string> | ReadonlySet<string> | null, variant?: any }} [ctx]
 * @returns {ResolvedRules}
 */
export function resolveProductRules(product, ctx = {}) {
  const f = factsOf(product);
  const variant = ctx?.variant && typeof ctx.variant === "object" ? ctx.variant : null;
  /** @type {{ step: number, min: number | null, max: number | null, coverage: number | null }} */
  const v = { step: 1, min: null, max: null, coverage: null };
  /** @type {{ step: string | null, min: string | null, max: string | null, coverage: string | null }} */
  const src = { step: null, min: null, max: null, coverage: null };
  if (product && typeof product === "object") {
    for (const rule of PRODUCT_RULES) {
      if (!ruleMatches(rule, f)) continue;
      const e = rule.effects;
      if (e.coveragePerUnitM2 !== undefined) {
        const c =
          e.coveragePerUnitM2 === "dimensions"
            ? coverageFromDimensions(product, variant, { description: e.coverageFromDescription === true })
            : typeof e.coveragePerUnitM2 === "number" && e.coveragePerUnitM2 > 0
              ? round2(e.coveragePerUnitM2)
              : null;
        if (c == null && rule.requiresCoverage) continue;
        if (c != null) {
          v.coverage = c;
          src.coverage = rule.id;
        }
      }
      if (e.quantityStep) {
        v.step = e.quantityStep;
        src.step = rule.id;
      }
      if (e.minQuantity) {
        v.min = e.minQuantity;
        src.min = rule.id;
      }
      if (e.maxQuantity) {
        v.max = e.maxQuantity;
        src.max = rule.id;
      }
    }
    const mo = moRulesOf(product);
    if (mo) {
      if (mo.soldInPairs === true) {
        v.step = 2;
        v.min = 2;
        src.step = src.min = "mo.sold_in_pairs";
      } else if (mo.soldInPairs === false) {
        v.step = 1;
        v.min = null;
        src.step = "mo.sold_in_pairs";
        src.min = null;
      }
      if (mo.quantityStep) {
        v.step = mo.quantityStep;
        src.step = "mo.quantity_step";
        // A registry minimum belonged to the registry's step.
        if (src.min && !src.min.startsWith("mo.")) {
          v.min = null;
          src.min = null;
        }
      }
      if (mo.minQuantity) {
        v.min = mo.minQuantity;
        src.min = "mo.min_quantity";
      }
      if (mo.maxQuantity) {
        v.max = mo.maxQuantity;
        src.max = "mo.max_quantity";
      }
      if (typeof mo.coverageM2 === "number") {
        // > 0: floor protection sized to the whole room (any product); 0: no
        // coverage and no whole room, whatever the registry derived.
        v.coverage = mo.coverageM2 > 0 ? round2(mo.coverageM2) : null;
        src.coverage = "mo.coverage_m2";
      }
    }
    // An edge piece or connector variant covers nothing, whatever the product's
    // coverage comes from (round-6 decision L6 — the widget's cfgRulesOf drops
    // it for the chosen variant the same way): no coverage line for sizing.
    const vTitle = variant ? String(variant.title ?? "") : "";
    if (v.coverage != null && vTitle && NON_TILE_VARIANT.test(vTitle)) {
      v.coverage = null;
      src.coverage = null;
    }
  }
  // Consistency: integers within the plan line's cap (a floor line's is
  // higher), the smaller quantity wins.
  const L = lineCapOf({ coverageM2: v.coverage });
  let step = Number.isInteger(v.step) && v.step >= 1 ? Math.min(v.step, L) : 1;
  const max = Number.isInteger(v.max) && /** @type {number} */ (v.max) >= 1 ? /** @type {number} */ (v.max) : null;
  const cap = max != null ? Math.min(max, L) : L;
  if (step > cap) {
    step = 1;
    if (src.step && src.step !== "mo.sold_in_pairs") src.step = null;
  }
  let min = Number.isInteger(v.min) && /** @type {number} */ (v.min) >= 1 ? /** @type {number} */ (v.min) : step;
  min = Math.ceil(min / step) * step;
  if (min > cap) min = Math.max(1, Math.floor(cap / step) * step);
  const ruleIds = [...new Set([src.step && (step > 1 || src.step.startsWith("mo.")) ? src.step : null, src.min, src.max, src.coverage].filter(Boolean))];
  return {
    step,
    min,
    max,
    coverageM2: v.coverage,
    // Coverage means „whole room“ (L1): the registry's floor tiles and any
    // product with mo.coverage_m2 > 0 alike.
    fillsRoom: typeof v.coverage === "number" && v.coverage > 0,
    showroom: hasId(ctx?.showroomIds, f.id),
    ruleIds: /** @type {string[]} */ (ruleIds),
  };
}

/**
 * A quantity under the rules: at least `min`, rounded up to the step, at most
 * the cap (the rule's max, never above the plan line's cap — lineCapOf: 20, a
 * floor line 200) — then the largest multiple of the step below it.
 * Invalid → min.
 * @param {unknown} qty
 * @param {Partial<ResolvedRules> | null | undefined} rules
 * @param {{ floorLineMax?: number }} [opts] a lower cap for floor lines (lineCapOf)
 * @returns {number}
 */
export function normalizeQuantity(qty, rules, opts = {}) {
  return normalizeWithReason(qty, rules, opts).quantity;
}

/**
 * @param {unknown} qty
 * @param {Partial<ResolvedRules> | null | undefined} rules
 * @param {{ floorLineMax?: number }} [opts]
 * @returns {{ quantity: number, reason: "min" | "step" | "max" | "line" | null, cap: number }}
 */
function normalizeWithReason(qty, rules, opts = {}) {
  const L = lineCapOf(rules, opts);
  const step = Number.isInteger(rules?.step) && /** @type {number} */ (rules?.step) >= 1 ? Math.min(/** @type {number} */ (rules?.step), L) : 1;
  const max = Number.isInteger(rules?.max) && /** @type {number} */ (rules?.max) >= 1 ? /** @type {number} */ (rules?.max) : null;
  const cap = max != null ? Math.min(max, L) : L;
  const rawMin = Number.isInteger(rules?.min) && /** @type {number} */ (rules?.min) >= 1 ? /** @type {number} */ (rules?.min) : step;
  const min = Math.min(Math.ceil(rawMin / step) * step, Math.max(1, Math.floor(cap / step) * step));
  const n = Number(qty);
  /** @type {"min" | "step" | "max" | "line" | null} */
  let reason = null;
  let q = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 0;
  if (q < min) {
    q = min;
    reason = "min";
  }
  if (q % step !== 0) {
    q = Math.ceil(q / step) * step;
    reason = reason ?? "step";
  }
  if (q > cap) {
    q = Math.max(min, Math.floor(cap / step) * step);
    reason = max != null && max <= L ? "max" : "line";
  }
  return { quantity: q, reason, cap: L };
}

/** @param {number} n @param {"de" | "en"} locale */
function fmtNumber(n, locale) {
  const s = String(round2(n));
  return locale === "en" ? s : s.replace(".", ",");
}

/**
 * The rules as a compact text for a product line of the prompt — „nur
 * paarweise“, „deckt ca. 1 m² je Stück“, „im Showroom ausgestellt“ … — "" when
 * no rule applies (so a product line without rules stays byte-identical).
 * @param {Partial<ResolvedRules> | null | undefined} rules
 * @param {"de" | "en"} [locale]
 */
export function ruleHint(rules, locale = "de") {
  if (!rules) return "";
  const en = locale === "en";
  const step = Number(rules.step) || 1;
  const min = Number(rules.min) || step;
  /** @type {string[]} */
  const parts = [];
  if (step === 2) parts.push(en ? "pairs only" : "nur paarweise");
  else if (step > 2) parts.push(en ? `only in steps of ${step}` : `nur in Schritten von ${step}`);
  if (min > Math.max(1, step)) parts.push(en ? `at least ${min}` : `mindestens ${min} Stück`);
  if (typeof rules.max === "number") parts.push(en ? `at most ${rules.max}` : `höchstens ${rules.max} Stück`);
  if (typeof rules.coverageM2 === "number" && rules.coverageM2 > 0) {
    parts.push(en ? `covers approx. ${fmtNumber(rules.coverageM2, "en")} m² per unit` : `deckt ca. ${fmtNumber(rules.coverageM2, "de")} m² je Stück`);
  }
  if (rules.fillsRoom) parts.push(en ? "plan for the whole room" : "für die ganze Raumfläche planen");
  if (rules.showroom) parts.push(en ? "on display in the showroom" : "im Showroom ausgestellt");
  return parts.join(" · ");
}

/**
 * Short German labels of the rules for the admin's assortment table:
 * „paarweise“, „1 m²/Stk“, „Showroom“ …
 * @param {Partial<ResolvedRules> | null | undefined} rules
 * @returns {string[]}
 */
export function ruleBadges(rules) {
  if (!rules) return [];
  const step = Number(rules.step) || 1;
  const min = Number(rules.min) || step;
  /** @type {string[]} */
  const out = [];
  if (step === 2) out.push("paarweise");
  else if (step > 2) out.push(`${step}er-Schritte`);
  if (min > Math.max(1, step)) out.push(`ab ${min} Stk`);
  if (typeof rules.max === "number") out.push(`max. ${rules.max} Stk`);
  if (typeof rules.coverageM2 === "number" && rules.coverageM2 > 0) out.push(`${fmtNumber(rules.coverageM2, "de")} m²/Stk`);
  if (rules.showroom) out.push("Showroom");
  return out;
}

/**
 * The public part of the rules for GET /api/products and the configurator
 * cards — only the fields that differ from „one by one, no coverage“:
 * `{ step?, min?, max?, coverageM2? }`; undefined when nothing applies (the
 * callers then send `rules: {}`, so the field is on every entry of a backend
 * that knows rules). `coverageM2` only together with `fillsRoom`: a published
 * coverage always means „sized to the room“ (the widget sizes every product
 * with coverageM2 > 0, and a floor line may hold up to 200 pieces).
 * @param {Partial<ResolvedRules> | null | undefined} rules
 * @returns {{ step?: number, min?: number, max?: number, coverageM2?: number } | undefined}
 */
export function publicRules(rules) {
  if (!rules) return undefined;
  /** @type {{ step?: number, min?: number, max?: number, coverageM2?: number }} */
  const out = {};
  if (Number(rules.step) > 1) out.step = Number(rules.step);
  if (Number(rules.min) > 1) out.min = Number(rules.min);
  if (typeof rules.max === "number") out.max = rules.max;
  if (rules.fillsRoom === true && typeof rules.coverageM2 === "number" && rules.coverageM2 > 0) out.coverageM2 = rules.coverageM2;
  return Object.keys(out).length ? out : undefined;
}

// ---------------------------------------------------------------------------
// Validation of a plan / of product options (the configurator tools)
// ---------------------------------------------------------------------------

/** Why a quantity changed, as the model reads it in `adjusted[].rule` („line“: the cap that applied). */
const REASON_LABELS = Object.freeze({
  pairs: { de: "paarweise", en: "pairs" },
  min: { de: "Mindestmenge", en: "minimum quantity" },
  step: { de: "Schrittweite", en: "quantity step" },
  max: { de: "Höchstmenge", en: "maximum quantity" },
  line: { de: "höchstens {n} je Position", en: "at most {n} per line" },
  area: { de: "Raumfläche", en: "room area" },
});

/**
 * @param {"min" | "step" | "max" | "line" | "area" | null} reason
 * @param {Partial<ResolvedRules>} rules
 * @param {"de" | "en"} locale
 * @param {number} [cap] the line cap that applied (lineCapOf) — „höchstens 20 / 200 je Position“
 */
function reasonLabel(reason, rules, locale, cap = RULE_LIMITS.lineMax) {
  const key = (reason === "min" || reason === "step") && rules.step === 2 ? "pairs" : reason ?? "step";
  const l = /** @type {Record<string, { de: string, en: string }>} */ (REASON_LABELS)[key] ?? REASON_LABELS.step;
  return (locale === "en" ? l.en : l.de).replace("{n}", String(cap));
}

/**
 * A floor area as the tools accept it (m², > 0, ≤ RULE_LIMITS.areaMaxM2, two
 * decimals); null otherwise.
 * @param {unknown} v
 * @returns {number | null}
 */
export function normalizeAreaM2(v) {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) && n > 0 && n <= RULE_LIMITS.areaMaxM2 ? round2(n) : null;
}

/**
 * @typedef {{
 *   areaM2: number | null,
 *   coveredM2: number,
 *   lines: Array<{ productId: string, quantity: number, coverageM2: number, coveredM2: number }>,
 *   missingM2?: number,
 *   neededQuantity?: number,
 * }} CoverageReport
 */

/**
 * Validate the lines of a plan (show_gym_plan, add_to_cart) — or of ONE
 * option of offer_plan_options — against the product rules:
 *   - every quantity normalised (pairs, min, max, the line cap: 20, a floor
 *     line 200 — lineCapOf) → `adjusted` [{ productId, from, to, rule }] (rule
 *     = a short label in the locale; the cap's label names the cap that
 *     applied, „höchstens 20 je Position“ / „höchstens 200 je Position“);
 *   - with an area (`areaM2`) ONE floor product is sized to it: only when the
 *     lines hold exactly one line with a coverage (a floor tile — a line whose
 *     variant is an edge piece or connector has none), that line gets
 *     ceil(area / coverage) units (respecting step / min / cap) → `adjusted`
 *     with rule „Raumfläche“. Two or more coverage lines (e.g. a drop zone
 *     under the rack plus mats for the rest) are never resized — Mo works out
 *     their counts (the guide says so) and the report tells what is missing;
 *   - `coverage` of the coverage lines (m² per unit and in total; with an area
 *     the part left uncovered as `missingM2`, and — for the one sized line —
 *     the uncapped `neededQuantity` when the cap stopped it) — null without
 *     coverage lines;
 *   - `inShowroom`: the products of the lines on display (base ids).
 * Unknown products and refs whose variant vanished keep their quantity.
 * `floorLineMax`: a lower cap for floor lines — the tools pass the widget's
 * 20 when the widget does not apply the rules itself (no feature "rules").
 * @param {ReadonlyArray<{ productId: string, quantity?: number }>} lines
 * @param {ReadonlyMap<string, any>} productsById
 * @param {{ showroomIds?: Iterable<string> | ReadonlySet<string> | null, areaM2?: unknown, locale?: "de" | "en", floorLineMax?: number }} [ctx]
 * @returns {{ lines: Array<{ productId: string, quantity: number, rules: ResolvedRules | null }>, adjusted: Array<{ productId: string, from: number, to: number, rule: string }>, coverage: CoverageReport | null, inShowroom: string[] }}
 */
export function validateLines(lines, productsById, ctx = {}) {
  const locale = ctx?.locale === "en" ? "en" : "de";
  const capOpts = { floorLineMax: ctx?.floorLineMax };
  /** @type {Array<{ productId: string, quantity: number, from: number, rules: ResolvedRules | null, reason: string | null, cap: number }>} */
  const out = [];
  for (const line of lines ?? []) {
    const ref = String(line?.productId ?? "").trim();
    if (!ref) continue;
    const q = Number(line?.quantity);
    const from = Number.isInteger(q) && q >= 1 ? q : 1;
    const hit = /** @type {{ product: any, variant: any, missingVariant: boolean } | null} */ (resolveProductRef(productsById, ref));
    if (!hit || hit.missingVariant) {
      out.push({ productId: ref, quantity: from, from, rules: null, reason: null, cap: RULE_LIMITS.lineMax });
      continue;
    }
    const rules = resolveProductRules(hit.product, { showroomIds: ctx?.showroomIds ?? null, variant: hit.variant });
    const n = normalizeWithReason(from, rules, capOpts);
    out.push({ productId: ref, quantity: n.quantity, from, rules, reason: n.quantity !== from ? n.reason : null, cap: n.cap });
  }

  /** @type {CoverageReport | null} */
  let coverage = null;
  const area = normalizeAreaM2(ctx?.areaM2);
  const tiles = out.filter((l) => l.rules?.fillsRoom && /** @type {number} */ (l.rules.coverageM2) > 0);
  if (tiles.length) {
    /** @type {number | undefined} */
    let neededQuantity;
    // Only ONE floor product is sized (L3): with two or more, nothing is resized.
    if (area != null && tiles.length === 1) {
      const main = tiles[0];
      const per = /** @type {number} */ (main.rules?.coverageM2);
      const needed = Math.max(1, Math.ceil(area / per - 1e-9));
      const to = normalizeQuantity(needed, main.rules, capOpts);
      if (to < needed) neededQuantity = needed;
      if (to !== main.quantity) {
        main.quantity = to;
        main.reason = to !== main.from ? "area" : null;
      }
    }
    const covered = round2(tiles.reduce((n, l) => n + l.quantity * /** @type {number} */ (l.rules?.coverageM2), 0));
    coverage = {
      areaM2: area,
      coveredM2: covered,
      lines: tiles.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        coverageM2: /** @type {number} */ (l.rules?.coverageM2),
        coveredM2: round2(l.quantity * /** @type {number} */ (l.rules?.coverageM2)),
      })),
      ...(area != null && covered + 1e-9 < area ? { missingM2: round2(area - covered) } : {}),
      ...(neededQuantity != null ? { neededQuantity } : {}),
    };
  }

  const adjusted = out
    .filter((l) => l.quantity !== l.from)
    .map((l) => ({
      productId: l.productId,
      from: l.from,
      to: l.quantity,
      rule: reasonLabel(/** @type {any} */ (l.reason), l.rules ?? {}, locale, l.cap),
    }));
  const inShowroom = [
    ...new Set(out.filter((l) => l.rules?.showroom).map((l) => l.productId.split("~")[0])),
  ];
  return {
    lines: out.map((l) => ({ productId: l.productId, quantity: l.quantity, rules: l.rules })),
    adjusted,
    coverage,
    inShowroom,
  };
}

/**
 * validateLines per option of offer_plan_options (each flooring option sized
 * to the same area — an option with exactly one coverage line): `adjusted`
 * and `coverage` carry the option's 1-based position in Mo's list (`option`,
 * normalizeOfferOptions' `rank`), `inShowroom` the union.
 * @param {ReadonlyArray<{ items: ReadonlyArray<{ productId: string, quantity?: number }>, option?: number }>} options
 * @param {ReadonlyMap<string, any>} productsById
 * @param {{ showroomIds?: Iterable<string> | ReadonlySet<string> | null, areaM2?: unknown, locale?: "de" | "en", floorLineMax?: number }} [ctx]
 */
export function validateOptions(options, productsById, ctx = {}) {
  /** @type {Array<{ option: number, productId: string, from: number, to: number, rule: string }>} */
  const adjusted = [];
  /** @type {Array<{ option: number } & CoverageReport>} */
  const coverage = [];
  /** @type {Set<string>} */
  const inShowroom = new Set();
  (options ?? []).forEach((o, i) => {
    const option = Number.isInteger(o?.option) ? /** @type {number} */ (o.option) : i + 1;
    const v = validateLines(o?.items ?? [], productsById, ctx);
    for (const a of v.adjusted) adjusted.push({ option, ...a });
    if (v.coverage) coverage.push({ option, ...v.coverage });
    for (const id of v.inShowroom) inShowroom.add(id);
  });
  return { adjusted, coverage, inShowroom: [...inShowroom] };
}

/**
 * The rule facts a tool result carries — only the non-empty ones, so a result
 * without any stays exactly as before the rules (`{ ok, shownItems }` …).
 * `inShowroom` only while the showroom list is known.
 * @param {{ adjusted?: unknown[], coverage?: unknown, inShowroom?: string[] }} v
 * @param {{ showroomKnown?: boolean }} [opts]
 */
export function ruleFacts(v, opts = {}) {
  /** @type {Record<string, unknown>} */
  const out = {};
  if (Array.isArray(v?.adjusted) && v.adjusted.length) out.adjusted = v.adjusted;
  const cov = v?.coverage;
  if (Array.isArray(cov) ? cov.length > 0 : cov != null) out.coverage = cov;
  if (opts.showroomKnown && Array.isArray(v?.inShowroom) && v.inShowroom.length) out.inShowroom = v.inShowroom;
  return out;
}

// ---------------------------------------------------------------------------
// Admin overview
// ---------------------------------------------------------------------------

/**
 * The registry for the admin (Konfigurator → „Sortiment“): per rule its label,
 * what it does, how many catalog products it applies to now (metafields
 * included — a product a metafield takes out of a rule does not count) and
 * which (by name, at most `listMax`), plus the products with `mo.*`
 * metafields and the number on display in the showroom.
 * @param {ReadonlyArray<any>} catalog
 * @param {{ showroomIds?: Iterable<string> | ReadonlySet<string> | null, listMax?: number }} [ctx]
 */
export function ruleRegistryOverview(catalog, ctx = {}) {
  const listMax = Number.isInteger(ctx?.listMax) && /** @type {number} */ (ctx.listMax) >= 0 ? /** @type {number} */ (ctx.listMax) : 100;
  /** @type {Map<string, Array<{ id: string, name: string }>>} */
  const matched = new Map(PRODUCT_RULES.map((r) => [r.id, []]));
  /** @type {Array<{ id: string, name: string }>} */
  const withMetafields = [];
  let showroom = 0;
  for (const p of catalog ?? []) {
    if (!p || typeof p !== "object") continue;
    const r = resolveProductRules(p, ctx);
    const item = { id: String(p.id ?? ""), name: String(p.name ?? p.id ?? "") };
    for (const id of r.ruleIds) matched.get(id)?.push(item);
    if (moRulesOf(p)) withMetafields.push(item);
    if (r.showroom) showroom++;
  }
  /** @param {Array<{ id: string, name: string }>} list */
  const sorted = (list) => [...list].sort((a, b) => a.name.localeCompare(b.name, "de")).slice(0, listMax);
  return {
    rules: PRODUCT_RULES.map((r) => {
      const list = matched.get(r.id) ?? [];
      return { id: r.id, label: r.label.de, description: r.description, effect: r.effect, count: list.length, products: sorted(list) };
    }),
    metafields: withMetafields.length,
    metafieldProducts: sorted(withMetafields),
    showroom,
  };
}
