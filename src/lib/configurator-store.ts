// Home-Gym-Konfigurator — the I/O half (rules, vocabulary and texts live in the
// pure, tested configurator-core.mjs). Three jobs:
//   - the operator settings (admin_settings key 'configurator', migration
//     0078 — no new migration; since 24.10.2026 with the „Konfigurator-
//     Rabatt“), cached for the chat path and GET /api/configurator/offer;
//   - the curated assortment („Konfigurator-Sortiment“) resolved against the
//     live catalog;
//   - the KPIs of the admin screen „Konfigurator“ (and the summary on the KPI
//     screen and in the Komplettanalyse) over kpi_events + mo_orders + messages,
//     plus the „Konfigurator-Rabatt“ card (its page events, orders with the code).
// Fail-soft throughout: without a database, before migration 0078 or on a read
// error the defaults apply and the KPIs are null. Nothing here can break a chat
// response. docs/CONFIGURATOR.md.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { loadProductCatalog } from "./catalog-store";
import { REALISED_FINANCIAL_STATUSES } from "./kpi-revenue-core.mjs";
import { CONSULTATION_ANCHOR_TOOLS } from "./order-attribution.mjs";
import {
  CONFIGURATOR_FIELDS,
  CONFIGURATOR_PLAN_TOOLS,
  CONFIGURATOR_SETTINGS_KEY,
  CONFIGURATOR_TOOLS,
  CONFIGURATOR_WIDGET_EVENTS,
  DEFAULT_CONFIGURATOR_SETTINGS,
  KPI_CONFIGURATOR_CHAT_STARTED,
  KPI_CONFIGURATOR_OPTIONS_SHOWN,
  KPI_CONFIGURATOR_PLAN_SHOWN,
  answerDistribution,
  optionStepRows,
  parseConfiguratorSettings,
  selectAssortment,
  unknownExtraIds,
  type ConfiguratorSettings,
} from "./configurator-core.mjs";
import type { KpiRange } from "./kpi-range";
import type { Product } from "./types";

// A thread with a Home-Gym plan or the step-by-step product options — the rule
// „über den Konfigurator“ (configurator-core CONFIGURATOR_PLAN_TOOLS).
const CONFIGURATOR_THREAD_TOOLS = [...CONFIGURATOR_PLAN_TOOLS];

export type { ConfiguratorSettings };

/** SQLSTATE 42P01 (undefined_table) on the error or one level down. */
function isMissingTable(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  return e?.code === "42P01" || e?.cause?.code === "42P01";
}

function defaults(): ConfiguratorSettings {
  return { ...DEFAULT_CONFIGURATOR_SETTINGS, extraProductIds: [], discount: { ...DEFAULT_CONFIGURATOR_SETTINGS.discount } };
}

/** The stored settings, or the defaults (no database, no row, before 0078, read error). */
export async function getConfiguratorSettings(sql: Sql | null = getSql()): Promise<ConfiguratorSettings> {
  if (!sql) return defaults();
  try {
    const rows = (await sql`
      SELECT value FROM admin_settings WHERE key = ${CONFIGURATOR_SETTINGS_KEY}
    `) as Array<{ value: unknown }>;
    return rows.length ? parseConfiguratorSettings(rows[0]?.value) : defaults();
  } catch (err) {
    if (!isMissingTable(err)) {
      reportError(err, { route: "lib/configurator-store", phase: "getConfiguratorSettings" });
    }
    return defaults();
  }
}

// Chat-path cache: one settings read per instance and minute at most. A save
// in the admin drops this instance's copy; other warm instances follow within
// the TTL.
const SETTINGS_TTL_MS = 60_000;
let settingsCache: { at: number; settings: ConfiguratorSettings } | null = null;

export async function getCachedConfiguratorSettings(): Promise<ConfiguratorSettings> {
  if (settingsCache && Date.now() - settingsCache.at < SETTINGS_TTL_MS) return settingsCache.settings;
  const settings = await getConfiguratorSettings();
  settingsCache = { at: Date.now(), settings };
  return settings;
}

export type SaveConfiguratorSettingsResult =
  | { ok: true; settings: ConfiguratorSettings }
  | { ok: false; reason: "no_db" | "missing_table" | "failed" };

/** Store the settings (UPSERT); the caller validated them (validateConfiguratorSettingsInput). */
export async function setConfiguratorSettings(
  settings: ConfiguratorSettings,
  sql: Sql | null = getSql()
): Promise<SaveConfiguratorSettingsResult> {
  if (!sql) return { ok: false, reason: "no_db" };
  const value = JSON.stringify({
    enabled: settings.enabled,
    tag: settings.tag,
    extraProductIds: settings.extraProductIds,
    focus: settings.focus,
    notes: settings.notes,
    discount: {
      enabled: settings.discount.enabled,
      code: settings.discount.code,
      title: settings.discount.title,
      text: settings.discount.text,
      terms: settings.discount.terms,
      trigger: settings.discount.trigger,
      endsOn: settings.discount.endsOn,
    },
  });
  try {
    const rows = (await sql`
      INSERT INTO admin_settings (key, value, updated_at)
      VALUES (${CONFIGURATOR_SETTINGS_KEY}, ${value}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
      RETURNING value
    `) as Array<{ value: unknown }>;
    settingsCache = null;
    return { ok: true, settings: parseConfiguratorSettings(rows[0]?.value ?? value) };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, reason: "missing_table" };
    reportError(err, { route: "lib/configurator-store", phase: "setConfiguratorSettings" });
    return { ok: false, reason: "failed" };
  }
}

export interface ConfiguratorAssortment {
  products: Product[];
  /** Per product: matched via the Shopify tag and/or the extra list. */
  via: Record<string, { tag: boolean; list: boolean }>;
  /** Extra handles that match no catalog product. */
  unknownExtraIds: string[];
}

/** The curated assortment against the live catalog. Empty on a catalog failure. */
export async function loadConfiguratorAssortment(settings: ConfiguratorSettings): Promise<ConfiguratorAssortment> {
  try {
    const catalog = await loadProductCatalog();
    const selected = selectAssortment(catalog, settings);
    const via: ConfiguratorAssortment["via"] = {};
    for (const s of selected) via[s.product.id] = { tag: s.viaTag, list: s.viaList };
    return {
      products: selected.map((s) => s.product),
      via,
      unknownExtraIds: unknownExtraIds(catalog, settings.extraProductIds),
    };
  } catch (err) {
    reportError(err, { route: "lib/configurator-store", phase: "loadConfiguratorAssortment" });
    return { products: [], via: {}, unknownExtraIds: [] };
  }
}

// ---------------------------------------------------------------------------
// KPIs (admin screen „Konfigurator“, KPI screen, Komplettanalyse) — pure DB,
// never cached
// ---------------------------------------------------------------------------

/** The funnel and money of a period — what the KPI screen and the business
 * snapshot show, without the Konfigurator screen's detail lists. */
export interface ConfiguratorSummary {
  /** Distinct sessions per stage (each stage counted on its own — the widget
   * starts a fresh thread at the handover, which can change the session id).
   * `orders` = sessions with an order „über den Konfigurator“ in the period. */
  sessions: {
    viewed: number;
    started: number;
    handover: number;
    chats: number;
    plans: number;
    carts: number;
    orders: number;
  };
  plansShown: number;
  /** Step-by-step flow (2026-10-23): option groups Mo showed, options the visitors picked. */
  optionsShown: number;
  optionsPicked: number;
  chipClicks: number;
  planEdits: number;
  cartAdds: number;
  cartUnits: number;
  cartValue: number;
  /** Realised orders of the period „über den Konfigurator“ (docs/CONFIGURATOR.md
   * §6) — the same orders as the KPI screen's row in „Wie der Umsatz entstand“. */
  orders: number;
  revenue: number;
}

export interface ConfiguratorKpis extends ConfiguratorSummary {
  distributions: Array<{ key: string; label: string; rows: Array<{ key: string; label: string; count: number }> }>;
  partners: Array<{ key: string; label: string; count: number }>;
  chipTopics: Array<{ key: string; count: number }>;
  /** Step-by-step flow per product type: option groups shown, picks, skips, „Andere Vorschläge“. */
  steps: Array<{ step: string; label: string; shown: number; picked: number; skipped: number; more: number }>;
  topProducts: Array<{ id: string; name: string; count: number; inStock: boolean | null }>;
  recent: Array<{
    sessionId: string;
    startedAt: string;
    answers: Record<string, string>;
    plans: number;
    /** Options of Mo the visitor picked into the plan (step-by-step flow). */
    picks: number;
    cart: boolean;
    ordered: boolean;
    conversationId: number | null;
  }>;
}

const PARTNER_LABELS: Record<string, string> = { mh: "Men's Health", wh: "Women's Health", "": "Direkt / ohne Partner" };

/**
 * Stage counts (kpi_events of the period) and the orders „über den
 * Konfigurator“: realised mo_orders processed in the period whose latest
 * consultation row before the order — the attribution anchor — sits in a
 * thread where Mo showed a Home-Gym plan. Counted by order date like „Umsatz
 * durch Mo“ (mo-revenue-store spells out the same predicate). Throws.
 */
async function queryConfiguratorSummary(range: KpiRange, sql: Sql): Promise<ConfiguratorSummary> {
  const realised = [...REALISED_FINANCIAL_STATUSES];
  const consultationTools = [...CONSULTATION_ANCHOR_TOOLS];
  const W = CONFIGURATOR_WIDGET_EVENTS;
  const [stageRows, orderRows] = await Promise.all([
    sql`
      SELECT
        count(DISTINCT session_id) FILTER (WHERE event = ${W.viewed})::int AS viewed,
        count(DISTINCT session_id) FILTER (WHERE event = ${W.started})::int AS started,
        count(DISTINCT session_id) FILTER (WHERE event = ${W.handover})::int AS handover,
        count(DISTINCT session_id) FILTER (WHERE event = ${KPI_CONFIGURATOR_CHAT_STARTED})::int AS chats,
        count(DISTINCT session_id) FILTER (WHERE event = ${KPI_CONFIGURATOR_PLAN_SHOWN}
                                              OR event = ${W.optionPicked})::int AS plans,
        count(DISTINCT session_id) FILTER (WHERE event = ${W.cartAdded})::int AS carts,
        count(*) FILTER (WHERE event = ${KPI_CONFIGURATOR_PLAN_SHOWN})::int AS plans_shown,
        count(*) FILTER (WHERE event = ${KPI_CONFIGURATOR_OPTIONS_SHOWN})::int AS options_shown,
        count(*) FILTER (WHERE event = ${W.optionPicked})::int AS options_picked,
        count(*) FILTER (WHERE event = ${W.chipClicked})::int AS chip_clicks,
        count(*) FILTER (WHERE event = ${W.planEdited})::int AS plan_edits,
        count(*) FILTER (WHERE event = ${W.cartAdded})::int AS cart_adds,
        COALESCE(sum(CASE WHEN event = ${W.cartAdded} AND data->>'units' ~ '^[0-9]{1,6}$'
                          THEN (data->>'units')::int ELSE 0 END), 0)::int AS cart_units,
        COALESCE(sum(CASE WHEN event = ${W.cartAdded} AND data->>'value' ~ '^[0-9]{1,9}([.][0-9]{1,2})?$'
                          THEN (data->>'value')::numeric ELSE 0 END), 0)::float AS cart_value
        FROM kpi_events
       WHERE event IN (${W.viewed}, ${W.started}, ${W.handover}, ${KPI_CONFIGURATOR_CHAT_STARTED},
                       ${KPI_CONFIGURATOR_PLAN_SHOWN}, ${W.cartAdded}, ${W.chipClicked}, ${W.planEdited},
                       ${KPI_CONFIGURATOR_OPTIONS_SHOWN}, ${W.optionPicked})
         AND session_id IS NOT NULL
         AND session_id NOT LIKE 'livecheck-%'
         AND created_at >= ${range.from}::date
         AND created_at < (${range.to}::date + 1)
    `,
    sql`
      SELECT count(DISTINCT o.session_id)::int AS sessions,
             count(*)::int AS orders,
             COALESCE(sum(o.total_price), 0)::float AS revenue
        FROM mo_orders o
       WHERE o.processed_at >= ${range.from}::date
         AND o.processed_at < (${range.to}::date + 1)
         AND upper(COALESCE(o.financial_status, '')) = ANY(${realised}::text[])
         AND o.session_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM messages g
            WHERE g.tool_name = ANY(${CONFIGURATOR_THREAD_TOOLS}::text[])
              AND g.created_at <= o.processed_at
              AND g.conversation_id = (
                SELECT m.conversation_id FROM messages m
                 WHERE m.session_id = o.session_id
                   AND m.tool_name = ANY(${consultationTools}::text[])
                   AND m.created_at <= o.processed_at
                 ORDER BY m.created_at DESC, m.id DESC
                 LIMIT 1)
         )
    `,
  ]);
  const s = (stageRows as Array<Record<string, number>>)[0] ?? {};
  const o = (orderRows as Array<Record<string, number>>)[0] ?? {};
  return {
    sessions: {
      viewed: Number(s.viewed ?? 0),
      started: Number(s.started ?? 0),
      handover: Number(s.handover ?? 0),
      chats: Number(s.chats ?? 0),
      plans: Number(s.plans ?? 0),
      carts: Number(s.carts ?? 0),
      orders: Number(o.sessions ?? 0),
    },
    plansShown: Number(s.plans_shown ?? 0),
    optionsShown: Number(s.options_shown ?? 0),
    optionsPicked: Number(s.options_picked ?? 0),
    chipClicks: Number(s.chip_clicks ?? 0),
    planEdits: Number(s.plan_edits ?? 0),
    cartAdds: Number(s.cart_adds ?? 0),
    cartUnits: Number(s.cart_units ?? 0),
    cartValue: Number(s.cart_value ?? 0),
    orders: Number(o.orders ?? 0),
    revenue: Number(o.revenue ?? 0),
  };
}

/**
 * The configurator's funnel and money for `range` (KPI screen „Home-Gym-
 * Konfigurator“, Komplettanalyse). Null without a database or on failure.
 */
export async function getConfiguratorSummary(
  range: KpiRange,
  sql: Sql | null = getSql()
): Promise<ConfiguratorSummary | null> {
  if (!sql) return null;
  try {
    return await queryConfiguratorSummary(range, sql);
  } catch (err) {
    reportError(err, { route: "lib/configurator-store", phase: "getConfiguratorSummary" });
    return null;
  }
}

/**
 * The Konfigurator screen: the summary plus answer distribution, partners,
 * chips, plan products and the latest configurator sessions of `range`.
 * Null without a database or on failure.
 */
export async function getConfiguratorKpis(range: KpiRange, sql: Sql | null = getSql()): Promise<ConfiguratorKpis | null> {
  if (!sql) return null;
  const realised = [...REALISED_FINANCIAL_STATUSES];
  const consultationTools = [...CONSULTATION_ANCHOR_TOOLS];
  const configuratorTools = [...CONFIGURATOR_TOOLS];
  const W = CONFIGURATOR_WIDGET_EVENTS;
  try {
    const [summary, distRows, chipRows, productRows, recentRows, stepRows] = await Promise.all([
      queryConfiguratorSummary(range, sql),
      sql`
        SELECT f.key, COALESCE(f.value, '') AS value, count(*)::int AS n
          FROM kpi_events e
         CROSS JOIN LATERAL (VALUES
           ('persona', e.data->>'persona'),
           ('location', e.data->>'location'),
           ('space', e.data->>'space'),
           ('training', e.data->>'training'),
           ('level', e.data->>'level'),
           ('budget', e.data->>'budget'),
           ('wishes', e.data->>'wishes'),
           ('partner', e.data->>'partner')
         ) AS f(key, value)
         WHERE e.event = ${KPI_CONFIGURATOR_CHAT_STARTED}
           AND e.session_id NOT LIKE 'livecheck-%'
           AND e.created_at >= ${range.from}::date
           AND e.created_at < (${range.to}::date + 1)
         GROUP BY 1, 2
      `,
      sql`
        SELECT CASE WHEN data->>'topic' ~ '^[a-z_]{1,20}$' THEN data->>'topic' ELSE 'other' END AS topic,
               count(*)::int AS n
          FROM kpi_events
         WHERE event = ${W.chipClicked}
           AND created_at >= ${range.from}::date
           AND created_at < (${range.to}::date + 1)
         GROUP BY 1
         ORDER BY n DESC
      `,
      sql`
        SELECT pid, count(DISTINCT e.session_id)::int AS n
          FROM kpi_events e
         CROSS JOIN LATERAL jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(e.data->'productIds') = 'array' THEN e.data->'productIds' ELSE '[]'::jsonb END
         ) AS pid
         WHERE e.event IN (${KPI_CONFIGURATOR_PLAN_SHOWN}, ${KPI_CONFIGURATOR_OPTIONS_SHOWN})
           AND e.created_at >= ${range.from}::date
           AND e.created_at < (${range.to}::date + 1)
         GROUP BY pid
         ORDER BY n DESC, pid ASC
         LIMIT 12
      `,
      // The latest configurator sessions. „Bestellt“ uses the same rule as the
      // summary (any later order „über den Konfigurator“); the conversation is
      // the first one of the session created at or after the configurator
      // chat, a configurator thread preferred (a signed-in session keeps its
      // id across threads).
      sql`
        WITH cfg AS (
          SELECT DISTINCT ON (session_id) session_id, created_at, data
            FROM kpi_events
           WHERE event = ${KPI_CONFIGURATOR_CHAT_STARTED}
             AND session_id IS NOT NULL
             AND session_id NOT LIKE 'livecheck-%'
             AND created_at >= ${range.from}::date
             AND created_at < (${range.to}::date + 1)
           ORDER BY session_id, created_at DESC
        ),
        latest AS (
          SELECT * FROM cfg ORDER BY created_at DESC LIMIT 12
        )
        SELECT l.session_id, l.created_at, l.data,
               (SELECT count(*)::int FROM kpi_events p
                 WHERE p.session_id = l.session_id AND p.event = ${KPI_CONFIGURATOR_PLAN_SHOWN}
                   AND p.created_at >= l.created_at) AS plans,
               (SELECT count(*)::int FROM kpi_events p
                 WHERE p.session_id = l.session_id AND p.event = ${W.optionPicked}
                   AND p.created_at >= l.created_at) AS picks,
               EXISTS (SELECT 1 FROM kpi_events k
                        WHERE k.session_id = l.session_id AND k.event = ${W.cartAdded}
                          AND k.created_at >= l.created_at) AS cart,
               EXISTS (SELECT 1 FROM mo_orders o
                        WHERE o.session_id = l.session_id AND o.processed_at >= l.created_at
                          AND upper(COALESCE(o.financial_status, '')) = ANY(${realised}::text[])
                          AND EXISTS (
                            SELECT 1 FROM messages g
                             WHERE g.tool_name = ANY(${CONFIGURATOR_THREAD_TOOLS}::text[])
                               AND g.created_at <= o.processed_at
                               AND g.conversation_id = (
                                 SELECT m.conversation_id FROM messages m
                                  WHERE m.session_id = o.session_id
                                    AND m.tool_name = ANY(${consultationTools}::text[])
                                    AND m.created_at <= o.processed_at
                                  ORDER BY m.created_at DESC, m.id DESC
                                  LIMIT 1)
                          )) AS ordered,
               (SELECT c.id FROM conversations c
                 WHERE c.session_id = l.session_id AND c.created_at >= l.created_at
                 ORDER BY (EXISTS (SELECT 1 FROM messages mc
                                    WHERE mc.conversation_id = c.id
                                      AND mc.tool_name = ANY(${configuratorTools}::text[]))) DESC,
                          c.created_at ASC
                 LIMIT 1) AS conversation_id
          FROM latest l
         ORDER BY l.created_at DESC
      `,
      sql`
        SELECT CASE WHEN data->>'step' ~ '^[a-z]{1,12}$' THEN data->>'step' ELSE 'extra' END AS step,
               count(*) FILTER (WHERE event = ${KPI_CONFIGURATOR_OPTIONS_SHOWN})::int AS shown,
               count(*) FILTER (WHERE event = ${W.optionPicked})::int AS picked,
               count(*) FILTER (WHERE event = ${W.optionSkipped})::int AS skipped,
               count(*) FILTER (WHERE event = ${W.optionMore})::int AS more
          FROM kpi_events
         WHERE event IN (${KPI_CONFIGURATOR_OPTIONS_SHOWN}, ${W.optionPicked}, ${W.optionSkipped}, ${W.optionMore})
           AND session_id NOT LIKE 'livecheck-%'
           AND created_at >= ${range.from}::date
           AND created_at < (${range.to}::date + 1)
         GROUP BY 1
      `,
    ]);

    const byField = new Map<string, Array<{ value: string; n: number }>>();
    for (const row of distRows as Array<{ key: string; value: string; n: number }>) {
      const list = byField.get(row.key) ?? [];
      list.push({ value: row.value, n: Number(row.n) || 0 });
      byField.set(row.key, list);
    }
    const distributions = CONFIGURATOR_FIELDS.map((field) => ({
      key: field.key,
      label: field.de,
      rows: answerDistribution(field.key, byField.get(field.key) ?? []),
    }));
    const partnerCounts = new Map<string, number>();
    for (const row of byField.get("partner") ?? []) {
      const key = row.value === "mh" || row.value === "wh" ? row.value : "";
      partnerCounts.set(key, (partnerCounts.get(key) ?? 0) + row.n);
    }
    const partners = ["mh", "wh", ""].map((key) => ({
      key,
      label: PARTNER_LABELS[key],
      count: partnerCounts.get(key) ?? 0,
    }));

    const productCounts = productRows as Array<{ pid: string; n: number }>;
    let catalog: Product[] = [];
    if (productCounts.length) {
      try {
        catalog = await loadProductCatalog();
      } catch (err) {
        reportError(err, { route: "lib/configurator-store", phase: "getConfiguratorKpis.catalog" });
      }
    }
    const byId = new Map(catalog.map((p) => [p.id, p]));
    const topProducts = productCounts.map((r) => {
      const p = byId.get(r.pid);
      return { id: r.pid, name: p?.name ?? r.pid, count: Number(r.n) || 0, inStock: p ? p.inStock : null };
    });

    const recent = (recentRows as Array<{
      session_id: string;
      created_at: string | Date;
      data: Record<string, unknown> | null;
      plans: number;
      picks: number;
      cart: boolean;
      ordered: boolean;
      conversation_id: number | string | null;
    }>).map((r) => {
      const answers: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.data ?? {})) if (typeof v === "string") answers[k] = v;
      return {
        sessionId: r.session_id,
        startedAt: new Date(r.created_at).toISOString(),
        answers,
        plans: Number(r.plans) || 0,
        picks: Number(r.picks) || 0,
        cart: Boolean(r.cart),
        ordered: Boolean(r.ordered),
        conversationId: r.conversation_id != null ? Number(r.conversation_id) : null,
      };
    });

    return {
      ...summary,
      distributions: distributions.filter((d) => d.key !== "partner"),
      partners,
      chipTopics: (chipRows as Array<{ topic: string; n: number }>).map((r) => ({ key: r.topic, count: Number(r.n) || 0 })),
      steps: optionStepRows(stepRows as Array<{ step: string; shown: number; picked: number; skipped: number; more: number }>),
      topProducts,
      recent,
    };
  } catch (err) {
    reportError(err, { route: "lib/configurator-store", phase: "getConfiguratorKpis" });
    return null;
  }
}

/** „Konfigurator-Rabatt“ in the period (Konfigurator → „Wirkung“, card „Konfigurator-Rabatt“). */
export interface ConfiguratorDiscountKpis {
  /** Distinct sessions per page event (configurator_discount_*). */
  shown: number;
  activated: number;
  copied: number;
  closed: number;
  /** Realised mo_orders processed in the period whose discount codes contain the current code (case-insensitive). */
  orders: number;
  revenue: number;
}

/**
 * The discount's page events and the orders with its code for `range` — pure
 * DB, never cached. Orders come from mo_orders (the ledger of the Konfigurator
 * screen's orders: only orders with the Mo marker are in it), realised and by
 * order date like „Bestellungen“; without a code (never configured) no order
 * query. Null without a database or on failure.
 */
export async function getConfiguratorDiscountKpis(
  range: KpiRange,
  code: string,
  sql: Sql | null = getSql()
): Promise<ConfiguratorDiscountKpis | null> {
  if (!sql) return null;
  const realised = [...REALISED_FINANCIAL_STATUSES];
  const W = CONFIGURATOR_WIDGET_EVENTS;
  const wanted = code.trim().toUpperCase();
  try {
    const [eventRows, orderRows] = await Promise.all([
      sql`
        SELECT
          count(DISTINCT session_id) FILTER (WHERE event = ${W.discountShown})::int AS shown,
          count(DISTINCT session_id) FILTER (WHERE event = ${W.discountActivated})::int AS activated,
          count(DISTINCT session_id) FILTER (WHERE event = ${W.discountCopied})::int AS copied,
          count(DISTINCT session_id) FILTER (WHERE event = ${W.discountClosed})::int AS closed
          FROM kpi_events
         WHERE event IN (${W.discountShown}, ${W.discountActivated}, ${W.discountCopied}, ${W.discountClosed})
           AND session_id IS NOT NULL
           AND session_id NOT LIKE 'livecheck-%'
           AND created_at >= ${range.from}::date
           AND created_at < (${range.to}::date + 1)
      `,
      wanted
        ? sql`
            SELECT count(*)::int AS orders,
                   COALESCE(sum(o.total_price), 0)::float AS revenue
              FROM mo_orders o
             WHERE o.processed_at >= ${range.from}::date
               AND o.processed_at < (${range.to}::date + 1)
               AND upper(COALESCE(o.financial_status, '')) = ANY(${realised}::text[])
               AND EXISTS (
                 SELECT 1 FROM unnest(o.discount_codes) AS d(code)
                  WHERE upper(btrim(d.code)) = ${wanted}
               )
          `
        : Promise.resolve([{ orders: 0, revenue: 0 }]),
    ]);
    const e = (eventRows as Array<Record<string, number>>)[0] ?? {};
    const o = (orderRows as Array<Record<string, number>>)[0] ?? {};
    return {
      shown: Number(e.shown ?? 0),
      activated: Number(e.activated ?? 0),
      copied: Number(e.copied ?? 0),
      closed: Number(e.closed ?? 0),
      orders: Number(o.orders ?? 0),
      revenue: Number(o.revenue ?? 0),
    };
  } catch (err) {
    reportError(err, { route: "lib/configurator-store", phase: "getConfiguratorDiscountKpis" });
    return null;
  }
}
