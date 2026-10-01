// The Kunden list filter (pure, tested): URL parameters ↔ one normalised
// filter ↔ the parameter tuple of the ONE list query
// (lib/customer-list-store.ts). The list is server-side — tens of thousands
// of customers never ship to the browser — so every filter, preset ("Ansicht"),
// sort and page lives in the URL (docs/ADMIN_DASHBOARD.md §2.2):
//
//   ?kq=      search (name / e-mail)        ?kview=   preset (CUSTOMER_VIEWS)
//   ?kmo=     yes | no                      ?kconsent= subscribed | pending |
//   ?kseg=    lifecycle segment                        unsubscribed | not_subscribed | blocked
//   ?kvalue=  klein | komponente | grossgeraet          ?kpersona= archetype | unknown
//   ?kshop=   shopify | lead                ?kchurn=  niedrig | mittel | hoch
//   ?ksort=   activity | revenue | orders | last_order | name | created
//   ?kpage=   1-based page                  ?customer= the open customer
//
// A preset only seeds the other fields — what is filtered is always the
// normalised filter, so a link with a view plus an extra field just works.

export const CUSTOMER_PAGE_SIZE = 50;

export const CUSTOMER_SORTS = /** @type {const} */ (["activity", "revenue", "orders", "last_order", "name", "created"]);
export const CONSENT_FILTERS = /** @type {const} */ (["subscribed", "pending", "unsubscribed", "not_subscribed", "blocked"]);
export const SEGMENT_FILTERS = /** @type {const} */ ([
  "frisch",
  "ausbauen_frueh",
  "ausbauen",
  "weiterentwickeln",
  "zurueckholen",
  "ruhen",
  "keine_bestellung",
]);
export const VALUE_FILTERS = /** @type {const} */ (["klein", "komponente", "grossgeraet"]);
export const CHURN_FILTERS = /** @type {const} */ (["niedrig", "mittel", "hoch"]);

/**
 * The presets ("Ansichten") — label, InfoTip text and the fields they set.
 * @type {Record<string, { label: string, info: string, set: Record<string, unknown> }>}
 */
export const CUSTOMER_VIEWS = {
  alle: { label: "Alle", info: "Jede Person im Kundenstamm.", set: {} },
  mo: { label: "Mit Mo gesprochen", info: "Personen mit mindestens einem Gespräch mit Mo.", set: { mo: "yes" } },
  ohne_mo: { label: "Noch ohne Mo", info: "Kunden, die noch nie mit Mo gesprochen haben.", set: { mo: "no" } },
  einwilligung: {
    label: "Mit Einwilligung",
    info: "Angemeldet für E-Mail-Werbung (aus Shopify oder Mo) und nicht gesperrt.",
    set: { consent: "subscribed" },
  },
  aufgaben: { label: "Offene Aufgaben", info: "Personen mit offenen Punkten im Eingang.", set: { tasks: true } },
  neu: { label: "Neu (30 Tage)", info: "Seit höchstens 30 Tagen im Kundenstamm.", set: { newDays: 30 } },
  top: {
    label: "Top-Kunden",
    info: "Ab 1.500 € Umsatz, nach Umsatz sortiert.",
    set: { minSpentEur: 1500, sort: "revenue" },
  },
  abwanderung: {
    label: "Abwanderungsgefahr",
    info: "Hohes Abwanderungsrisiko gemessen am persönlichen Kaufrhythmus.",
    set: { churn: "hoch" },
  },
  interessenten: {
    label: "Interessenten",
    info: "Haben mit Mo gesprochen und eine E-Mail hinterlassen, sind aber (noch) keine Shop-Kunden.",
    set: { shop: "lead" },
  },
  aktiv_ohne_einwilligung: {
    label: "Aktiv, ohne Einwilligung",
    info: "Mindestens zwei Bestellungen oder ein Gespräch, aber keine Einwilligung für E-Mail-Werbung — erreichbar nur per Brief oder im Chat.",
    set: { activeNoConsent: true },
  },
};

/** @typedef {ReturnType<typeof defaultCustomerFilter>} CustomerFilter */

export function defaultCustomerFilter() {
  return {
    q: "",
    view: "alle",
    mo: /** @type {"any" | "yes" | "no"} */ ("any"),
    consent: /** @type {string | null} */ (null),
    segment: /** @type {string | null} */ (null),
    value: /** @type {string | null} */ (null),
    persona: /** @type {string | null} */ (null),
    shop: /** @type {"any" | "shopify" | "lead"} */ ("any"),
    churn: /** @type {string | null} */ (null),
    tasks: false,
    newDays: /** @type {number | null} */ (null),
    minSpentEur: /** @type {number | null} */ (null),
    activeNoConsent: false,
    sort: /** @type {(typeof CUSTOMER_SORTS)[number]} */ ("activity"),
    page: 1,
  };
}

const oneOf = (value, allowed) => (typeof value === "string" && allowed.includes(value) ? value : null);

/**
 * URL search params (object or URLSearchParams) → the normalised filter.
 * Unknown values are dropped, never guessed.
 */
export function parseCustomerFilter(params) {
  const get = (k) => {
    if (!params) return undefined;
    if (typeof params.get === "function") return params.get(k) ?? undefined;
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const f = defaultCustomerFilter();
  const view = get("kview");
  if (typeof view === "string" && CUSTOMER_VIEWS[view]) {
    f.view = view;
    Object.assign(f, CUSTOMER_VIEWS[view].set);
  }
  const q = get("kq");
  if (typeof q === "string") f.q = q.trim().slice(0, 120);
  const mo = oneOf(get("kmo"), ["yes", "no"]);
  if (mo) f.mo = mo;
  const consent = oneOf(get("kconsent"), CONSENT_FILTERS);
  if (consent) f.consent = consent;
  const seg = oneOf(get("kseg"), SEGMENT_FILTERS);
  if (seg) f.segment = seg;
  const value = oneOf(get("kvalue"), VALUE_FILTERS);
  if (value) f.value = value;
  const persona = get("kpersona");
  if (typeof persona === "string" && /^[a-z_]{2,40}$/.test(persona)) f.persona = persona;
  const shop = oneOf(get("kshop"), ["shopify", "lead"]);
  if (shop) f.shop = shop;
  const churn = oneOf(get("kchurn"), CHURN_FILTERS);
  if (churn) f.churn = churn;
  const sort = oneOf(get("ksort"), CUSTOMER_SORTS);
  if (sort) f.sort = sort;
  const page = Number.parseInt(String(get("kpage") ?? ""), 10);
  if (Number.isFinite(page) && page >= 1) f.page = Math.min(page, 10_000);
  return f;
}

/** The normalised filter → URL params (only what differs from the view/defaults). */
export function customerFilterParams(f) {
  const out = new URLSearchParams();
  const base = { ...defaultCustomerFilter(), ...(CUSTOMER_VIEWS[f.view]?.set ?? {}) };
  if (f.view && f.view !== "alle") out.set("kview", f.view);
  if (f.q) out.set("kq", f.q);
  if (f.mo !== base.mo && f.mo !== "any") out.set("kmo", f.mo);
  if (f.consent && f.consent !== base.consent) out.set("kconsent", f.consent);
  if (f.segment && f.segment !== base.segment) out.set("kseg", f.segment);
  if (f.value && f.value !== base.value) out.set("kvalue", f.value);
  if (f.persona && f.persona !== base.persona) out.set("kpersona", f.persona);
  if (f.shop !== "any" && f.shop !== base.shop) out.set("kshop", f.shop);
  if (f.churn && f.churn !== base.churn) out.set("kchurn", f.churn);
  if (f.sort !== base.sort) out.set("ksort", f.sort);
  if (f.page > 1) out.set("kpage", String(f.page));
  return out;
}

/** How many fields narrow the list beyond the chosen view (FilterBar badge). */
export function activeCustomerFilterCount(f) {
  const base = { ...defaultCustomerFilter(), ...(CUSTOMER_VIEWS[f.view]?.set ?? {}) };
  let n = 0;
  if (f.q) n++;
  for (const k of ["mo", "consent", "segment", "value", "persona", "shop", "churn"]) {
    if (f[k] !== base[k]) n++;
  }
  return n;
}

/**
 * The parameter tuple of the list query — every predicate is nullable, so
 * the one spelled-out query covers all combinations (no SQL composition).
 */
export function customerQueryParams(f, now = new Date()) {
  const q = f.q ? `%${f.q.replace(/[%_\\]/g, (m) => `\\${m}`).toLowerCase()}%` : null;
  return {
    q,
    mo: f.mo === "any" ? null : f.mo,
    consent: f.consent,
    segment: f.segment,
    value: f.value,
    persona: f.persona,
    shop: f.shop === "any" ? null : f.shop,
    churn: f.churn,
    tasks: f.tasks ? true : null,
    newSince: f.newDays ? new Date(now.getTime() - f.newDays * 86_400_000).toISOString() : null,
    minSpentCents: f.minSpentEur != null ? Math.round(f.minSpentEur * 100) : null,
    activeNoConsent: f.activeNoConsent ? true : null,
    sort: f.sort,
    limit: CUSTOMER_PAGE_SIZE,
    offset: (f.page - 1) * CUSTOMER_PAGE_SIZE,
  };
}

/** German labels for the badges and selects. */
export const SEGMENT_LABELS = {
  frisch: "Frisch gekauft",
  ausbauen_frueh: "Ausbauen — früh",
  ausbauen: "Ausbauen",
  weiterentwickeln: "Weiterentwickeln",
  zurueckholen: "Zurückholen",
  ruhen: "Ruhen lassen",
  unbekannt: "Unbekannt",
  keine_bestellung: "Ohne Bestellung",
};

export const SORT_LABELS = {
  activity: "Zuletzt aktiv",
  revenue: "Umsatz",
  orders: "Bestellungen",
  last_order: "Letzter Kauf",
  name: "Name A–Z",
  created: "Neueste zuerst",
};
