// Campaign audiences (pure, tested): validate, normalise and DESCRIBE a spec,
// and turn it into the nullable parameter tuple of the ONE audience query
// (lib/audience-store.ts — predicates written once, never composed). An
// audience is defined over the whole customer base; the e-mail channel always
// adds consent + "not blocked" on top (docs/archive/CUSTOMER_PLATFORM_PLAN.md §10.4).
//
// Spec v1 (every field optional; absent = no restriction):
//   optInLevels      ["confirmed_opt_in", "single_opt_in", "unknown"]
//   lifecycle        segment keys (campaign-segments.mjs) + "unbekannt" (no purchase date)
//   valueTier        ["klein", "komponente", "grossgeraet"]
//   churn            ["niedrig", "mittel", "hoch"]
//   lastOrderDays    { min?, max? }       days since the last purchase
//   ordersCount      { min?, max? }
//   totalSpentEur    { min?, max? }
//   boughtAny        catalog handles — bought at least one of them
//   boughtNone       catalog handles — bought none of them
//   categories       catalog categories bought
//   persona          archetype keys + "unknown"
//   moContact        "yes" | "no"
//   language         ["de", "en"]
//   country          ISO alpha-2 codes
//   shopifyTags      Shopify customer tags (any)
//   clickedWithinDays  clicked a marketing mail within N days
//   excludeMailedWithinDays  no marketing mail within N days
//   excludeCampaignIds  not (yet) a recipient of these campaigns

export const AUDIENCE_SPEC_VERSION = 1;

const LEVELS = ["confirmed_opt_in", "single_opt_in", "unknown"];
const SEGMENTS = ["frisch", "ausbauen_frueh", "ausbauen", "weiterentwickeln", "zurueckholen", "ruhen", "unbekannt"];
const VALUE_TIERS = ["klein", "komponente", "grossgeraet"];
const CHURN = ["niedrig", "mittel", "hoch"];
const LANGS = ["de", "en"];

const SEGMENT_LABELS = {
  frisch: "Frisch gekauft",
  ausbauen_frueh: "Ausbauen — früh",
  ausbauen: "Ausbauen",
  weiterentwickeln: "Weiterentwickeln",
  zurueckholen: "Zurückholen",
  ruhen: "Ruhen lassen",
  unbekannt: "ohne Kaufdatum",
};
const VALUE_LABELS = { klein: "Kleinteile", komponente: "Komponenten", grossgeraet: "Großgeräte" };
const LEVEL_LABELS = { confirmed_opt_in: "DOI", single_opt_in: "Single-Opt-in", unknown: "unbekanntes Opt-in" };

function cleanList(value, allowed, max = 50) {
  if (!Array.isArray(value)) return undefined;
  const out = [];
  for (const v of value) {
    if (typeof v !== "string") continue;
    const s = v.trim();
    if (!s || out.includes(s)) continue;
    if (allowed && !allowed.includes(s)) continue;
    out.push(s);
    if (out.length >= max) break;
  }
  return out.length > 0 ? out : undefined;
}

function cleanHandles(value) {
  if (!Array.isArray(value)) return undefined;
  const out = [];
  for (const v of value) {
    if (typeof v !== "string") continue;
    const s = v.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,200}$/.test(s) || out.includes(s)) continue;
    out.push(s);
    if (out.length >= 100) break;
  }
  return out.length > 0 ? out : undefined;
}

function cleanRange(value, max) {
  if (!value || typeof value !== "object") return undefined;
  const num = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), max) : undefined);
  const min = num(value.min);
  const hi = num(value.max);
  if (min === undefined && hi === undefined) return undefined;
  if (min !== undefined && hi !== undefined && min > hi) return { min: hi, max: min };
  return { ...(min !== undefined ? { min } : {}), ...(hi !== undefined ? { max: hi } : {}) };
}

function cleanDays(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.min(Math.round(value), 3650) : undefined;
}

/**
 * Validate + normalise. Unknown fields and values are dropped (never
 * guessed); the result is the canonical spec stored on the campaign.
 *
 * @param {unknown} raw
 */
export function normalizeAudienceSpec(raw) {
  const s = raw && typeof raw === "object" ? /** @type {Record<string, any>} */ (raw) : {};
  const spec = {
    v: AUDIENCE_SPEC_VERSION,
    optInLevels: cleanList(s.optInLevels, LEVELS),
    lifecycle: cleanList(s.lifecycle, SEGMENTS),
    valueTier: cleanList(s.valueTier, VALUE_TIERS),
    churn: cleanList(s.churn, CHURN),
    lastOrderDays: cleanRange(s.lastOrderDays, 36500),
    ordersCount: cleanRange(s.ordersCount, 100000),
    totalSpentEur: cleanRange(s.totalSpentEur, 10_000_000),
    boughtAny: cleanHandles(s.boughtAny),
    boughtNone: cleanHandles(s.boughtNone),
    categories: cleanList(s.categories, null, 30),
    persona: cleanList(s.persona, null, 20)?.filter((p) => /^[a-z_]{2,40}$/.test(p)),
    moContact: s.moContact === "yes" || s.moContact === "no" ? s.moContact : undefined,
    language: cleanList(s.language, LANGS),
    country: cleanList(
      Array.isArray(s.country) ? s.country.map((c) => (typeof c === "string" ? c.toUpperCase() : c)) : undefined,
      null,
      40
    )?.filter((c) => /^[A-Z]{2}$/.test(c)),
    shopifyTags: cleanList(s.shopifyTags, null, 20),
    clickedWithinDays: cleanDays(s.clickedWithinDays),
    excludeMailedWithinDays: cleanDays(s.excludeMailedWithinDays),
    excludeCampaignIds: Array.isArray(s.excludeCampaignIds)
      ? [...new Set(s.excludeCampaignIds.filter((n) => Number.isInteger(n) && n > 0))].slice(0, 20)
      : undefined,
  };
  for (const k of Object.keys(spec)) if (spec[k] === undefined || (Array.isArray(spec[k]) && spec[k].length === 0)) delete spec[k];
  return spec;
}

/**
 * The nullable parameter tuple of the audience query. Arrays stay arrays (or
 * null), ranges become min/max scalars, days become ISO cut-off instants.
 *
 * @param {ReturnType<typeof normalizeAudienceSpec>} spec
 * @param {Date} [now]
 */
export function audienceQueryParams(spec, now = new Date()) {
  const daysAgo = (d) => (d == null ? null : new Date(now.getTime() - d * 86_400_000).toISOString());
  const lifecycle = spec.lifecycle ?? null;
  return {
    optInLevels: spec.optInLevels ?? null,
    lifecycle: lifecycle ? lifecycle.filter((s) => s !== "unbekannt") : null,
    lifecycleUnknown: lifecycle ? lifecycle.includes("unbekannt") : null,
    valueTier: spec.valueTier ?? null,
    churn: spec.churn ?? null,
    // lastOrderDays {min, max}: bought at most `max` and at least `min` days ago.
    lastOrderAfter: daysAgo(spec.lastOrderDays?.max ?? null),
    lastOrderBefore: daysAgo(spec.lastOrderDays?.min ?? null),
    ordersMin: spec.ordersCount?.min ?? null,
    ordersMax: spec.ordersCount?.max ?? null,
    spentMinCents: spec.totalSpentEur?.min != null ? spec.totalSpentEur.min * 100 : null,
    spentMaxCents: spec.totalSpentEur?.max != null ? spec.totalSpentEur.max * 100 : null,
    boughtAny: spec.boughtAny ?? null,
    boughtNone: spec.boughtNone ?? null,
    categories: spec.categories ?? null,
    persona: spec.persona ? spec.persona.filter((p) => p !== "unknown") : null,
    personaUnknown: spec.persona ? spec.persona.includes("unknown") : null,
    moContact: spec.moContact ?? null,
    language: spec.language ?? null,
    country: spec.country ?? null,
    shopifyTags: spec.shopifyTags ?? null,
    clickedAfter: daysAgo(spec.clickedWithinDays ?? null),
    notMailedAfter: daysAgo(spec.excludeMailedWithinDays ?? null),
    excludeCampaignIds: spec.excludeCampaignIds ?? null,
  };
}

function range(label, r, unit) {
  if (!r) return null;
  if (r.min != null && r.max != null) return `${label} ${r.min}–${r.max}${unit}`;
  if (r.min != null) return `${label} ab ${r.min}${unit}`;
  return `${label} bis ${r.max}${unit}`;
}

/**
 * The spec in plain German — shown on the campaign card, in the wizard and in
 * the confirm dialog, so nobody has to read JSON.
 *
 * @param {ReturnType<typeof normalizeAudienceSpec>} spec
 * @param {{ personaLabel?: (key: string) => string, campaignName?: (id: number) => string }} [labels]
 */
export function describeAudienceSpec(spec, labels = {}) {
  const parts = [];
  if (spec.optInLevels) parts.push(`Einwilligung: ${spec.optInLevels.map((l) => LEVEL_LABELS[l]).join(" oder ")}`);
  if (spec.lifecycle) parts.push(`Lebenszyklus: ${spec.lifecycle.map((s) => SEGMENT_LABELS[s]).join(", ")}`);
  if (spec.valueTier) parts.push(`Wertstufe: ${spec.valueTier.map((t) => VALUE_LABELS[t]).join(", ")}`);
  if (spec.churn) parts.push(`Abwanderungsrisiko: ${spec.churn.join(", ")}`);
  const lastOrder = range("letzter Kauf vor", spec.lastOrderDays, " Tagen");
  if (lastOrder) parts.push(lastOrder);
  const orders = range("Bestellungen", spec.ordersCount, "");
  if (orders) parts.push(orders);
  const spent = range("Umsatz", spec.totalSpentEur, " €");
  if (spent) parts.push(spent);
  if (spec.boughtAny) parts.push(`hat gekauft: ${spec.boughtAny.join(", ")}`);
  if (spec.boughtNone) parts.push(`hat nicht gekauft: ${spec.boughtNone.join(", ")}`);
  if (spec.categories) parts.push(`Kategorien: ${spec.categories.join(", ")}`);
  if (spec.persona) {
    const label = labels.personaLabel ?? ((k) => (k === "unknown" ? "ohne Persona" : k));
    parts.push(`Persona: ${spec.persona.map(label).join(", ")}`);
  }
  if (spec.moContact === "yes") parts.push("hat mit Mo gesprochen");
  if (spec.moContact === "no") parts.push("noch nie mit Mo gesprochen");
  if (spec.language) parts.push(`Sprache: ${spec.language.map((l) => l.toUpperCase()).join(", ")}`);
  if (spec.country) parts.push(`Land: ${spec.country.join(", ")}`);
  if (spec.shopifyTags) parts.push(`Shopify-Tags: ${spec.shopifyTags.join(", ")}`);
  if (spec.clickedWithinDays) parts.push(`hat in den letzten ${spec.clickedWithinDays} Tagen geklickt`);
  if (spec.excludeMailedWithinDays) parts.push(`keine Werbe-Mail in den letzten ${spec.excludeMailedWithinDays} Tagen`);
  if (spec.excludeCampaignIds) {
    const name = labels.campaignName ?? ((id) => `#${id}`);
    parts.push(`nicht in: ${spec.excludeCampaignIds.map(name).join(", ")}`);
  }
  const head = "Alle Kunden mit Einwilligung für E-Mail-Werbung";
  return parts.length === 0 ? head : `${head} · ${parts.join(" · ")}`;
}

/** How many restrictions a spec carries (0 = everyone with consent). */
export function audienceRestrictionCount(spec) {
  return Object.keys(spec).filter((k) => k !== "v").length;
}

/** The JSON schema the AI audience builder must answer with (writer tier). */
export const AUDIENCE_SPEC_FIELDS = {
  optInLevels: LEVELS,
  lifecycle: SEGMENTS,
  valueTier: VALUE_TIERS,
  churn: CHURN,
  language: LANGS,
};
