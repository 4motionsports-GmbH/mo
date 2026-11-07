#!/usr/bin/env node
// scripts/reset-konfigurator-data.mjs — delete the Home-Gym-Konfigurator's TEST
// data before the go-live, so its KPIs (and every other figure the tests
// touched) count only real visitors. docs/CONFIGURATOR.md „Go-live: Testdaten
// löschen“; the rules are the tested src/lib/konfigurator-reset-core.mjs.
//
//   npm run konfigurator:reset -- --before 2026-11-08T09:00:00+01:00            # preview, deletes nothing
//   ALLOW_KONFIGURATOR_RESET=true npm run konfigurator:reset -- \
//     --before 2026-11-08T09:00:00+01:00 --apply [--orders "#1001,#1002" | --keep-orders]
//
// Deletes — only what was created BEFORE --before (and after the day before
// the configurator's first release):
//   * kpi_events „configurator_*“ (the page's and Mo's configurator events);
//   * the configurator chats (conversations → messages by cascade) — their
//     ai_usage rows are kept WITHOUT the chat link, so „KI-Kosten“ stay true;
//   * the other widget events of those chats (chat_opened, message_sent,
//     product clicks, popups …): every event of an anonymous configurator
//     session, and for a signed-in or mixed session only the events inside the
//     configurator chat's time window;
//   * the test orders you name (--orders) from the ledger mo_orders;
//   * feedback sent from the configurator or its chats;
//   * the caches built from those chats: Gespräche insights overlapping the test
//     period, the persona Top-Fragen (regenerate with one click).
// Keeps: the configurator settings (Konfigurator, Showroom, Rabatt), customers,
// consents, e-mail captures, Shopify's own data, Komplettanalysen and
// Verbesserungsläufe (history), Wissen entries (listed for a look).
//
// Safety: preview by default; --apply needs ALLOW_KONFIGURATOR_RESET=true, a
// fixed --before (never in the future), a decision on every candidate test
// order, and refuses a second applied run without --again (admin_access_log
// 'konfigurator.reset'). Everything happens in ONE transaction (all or nothing).
// Local Postgres behind the Neon-protocol proxy: NEON_FETCH_ENDPOINT (docs/DATABASE.md).

import { neon, neonConfig } from "@neondatabase/serverless";
import { CONFIGURATOR_PLAN_TOOLS } from "../src/lib/configurator-core.mjs";
import { CONSULTATION_ANCHOR_TOOLS } from "../src/lib/order-attribution.mjs";
import {
  CONFIGURATOR_EVENT_PREFIX,
  CONFIGURATOR_ONLY_PERSONAS,
  KONFIGURATOR_RESET_SINCE,
  RESET_AUDIT_ACTION,
  RESET_CHAT_STARTED_EVENT,
  RESET_CONFIGURATOR_TOOLS,
  classifySessions,
  decideOrders,
  parseResetArgs,
  selectConfiguratorConversations,
} from "../src/lib/konfigurator-reset-core.mjs";

if (process.env.NEON_FETCH_ENDPOINT) neonConfig.fetchEndpoint = process.env.NEON_FETCH_ENDPOINT;

const USAGE = `
Konfigurator-Testdaten löschen (docs/CONFIGURATOR.md „Go-live: Testdaten löschen“)

  Vorschau (löscht nichts):
    npm run konfigurator:reset -- --before 2026-11-08T09:00:00+01:00
  Löschen:
    ALLOW_KONFIGURATOR_RESET=true npm run konfigurator:reset -- --before 2026-11-08T09:00:00+01:00 --apply

  --before <Zeitpunkt|now>  Pflicht. Alles Konfigurator-Bezogene VOR diesem Zeitpunkt wird gelöscht
                            (mit Zeitzone, z. B. +01:00 für Berlin im Winter). Nie in der Zukunft.
  --apply                   wirklich löschen (eine Transaktion: alles oder nichts)
  --orders "#1001,#1002"    Test-Bestellungen, die aus dem Bestell-Ledger (mo_orders) gelöscht werden
  --keep-orders             alle Kandidaten-Bestellungen behalten (zählen danach als normaler „Umsatz durch Mo“)
  --again                   einen zweiten Lauf erlauben (der erste steht in admin_access_log)
`;

const args = parseResetArgs(process.argv.slice(2), Date.now());
if (args.help) {
  console.log(USAGE);
  process.exit(0);
}
if (!args.ok) {
  for (const e of args.errors) console.error(`✗ ${e}`);
  console.error(USAGE);
  process.exit(1);
}
if (args.apply && process.env.ALLOW_KONFIGURATOR_RESET !== "true") {
  console.error(
    "\n✗ Löschen nur mit ALLOW_KONFIGURATOR_RESET=true davor, z. B.\n" +
      `    ALLOW_KONFIGURATOR_RESET=true npm run konfigurator:reset -- --before ${args.before} --apply\n` +
      "  Erst die Vorschau ohne --apply ansehen.\n"
  );
  process.exit(1);
}

const cs = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!cs) {
  console.error("✗ Keine Datenbank: DATABASE_URL (oder DATABASE_URL_UNPOOLED / POSTGRES_URL) in der .env setzen.");
  process.exit(1);
}
let dbHost = "(unbekannt)";
let dbName = "(unbekannt)";
try {
  const u = new URL(cs.replace(/^postgres:\/\//, "postgresql://"));
  dbHost = u.hostname + (u.port ? `:${u.port}` : "");
  dbName = u.pathname.replace(/^\//, "") || "(unbekannt)";
} catch {
  // non-standard URL — shown as unknown
}

const sql = neon(cs);
const q = (text, params = []) => sql.query(text, params);

const SINCE = KONFIGURATOR_RESET_SINCE;
const BEFORE = /** @type {string} */ (args.before);
const PREFIX = CONFIGURATOR_EVENT_PREFIX;
const TOOLS = [...RESET_CONFIGURATOR_TOOLS];
const PERSONAS = [...CONFIGURATOR_ONLY_PERSONAS];

const berlin = (v) =>
  v == null ? "—" : new Date(v).toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" });
const shortSid = (s) => (s ? `${String(s).slice(0, 10)}${String(s).length > 10 ? "…" : ""}` : "—");
const line = (s = "") => console.log(s);
const rule = () => line("─".repeat(78));
const table = (rows) => (rows.length ? console.table(rows) : line("    (keine)"));

line("");
line("═".repeat(78));
line(`  Konfigurator-Testdaten — ${args.apply ? "LÖSCHEN" : "VORSCHAU (löscht nichts)"}`);
line(`  Datenbank : ${dbHost} / ${dbName}`);
line(`  Zeitraum  : ${berlin(SINCE)} … ${berlin(BEFORE)} (Europe/Berlin)${args.beforeWasNow ? "  [--before now]" : ""}`);
line("  Alles außerhalb dieses Zeitraums bleibt unberührt.");
line("═".repeat(78));

// ── what exists ──────────────────────────────────────────────────────────────

let plan;
try {
  plan = await buildPlan();
} catch (err) {
  console.error(`\n✗ Lesen fehlgeschlagen: ${err?.message ?? err}`);
  process.exit(1);
}
printPlan(plan);

if (!args.apply) {
  line("");
  rule();
  if (!plan.orders.decision.ok) printOrderDecisionHelp(plan);
  line("Nichts gelöscht. Zum Löschen denselben Befehl mit --apply und ALLOW_KONFIGURATOR_RESET=true:");
  line(`  ALLOW_KONFIGURATOR_RESET=true npm run konfigurator:reset -- --before ${BEFORE}${orderFlags()} --apply`);
  if (args.beforeWasNow) line("  (der feste Stichtag dieser Vorschau — so löscht der Lauf genau den gezeigten Zeitraum)");
  line("");
  process.exit(0);
}

// ── apply ────────────────────────────────────────────────────────────────────

if (plan.previousRun && !args.again) {
  console.error(
    `\n✗ Der Reset lief schon am ${berlin(plan.previousRun.occurred_at)} (Stichtag ${berlin(plan.previousRun.detail?.before)}).` +
      "\n  Ein zweiter Lauf nur mit --again — und nie mit einem Stichtag nach dem Go-live.\n"
  );
  process.exit(1);
}
if (!plan.orders.decision.ok) {
  printOrderDecisionHelp(plan);
  console.error("✗ Abgebrochen: erst über die Bestellungen entscheiden (--orders … oder --keep-orders).\n");
  process.exit(1);
}

let results;
try {
  results = await applyPlan(plan);
} catch (err) {
  console.error(`\n✗ Löschen fehlgeschlagen — NICHTS wurde geändert (eine Transaktion): ${err?.message ?? err}\n`);
  process.exit(1);
}
line("");
rule();
line("Gelöscht (eine Transaktion):");
table(results);

// Check: nothing configurator-made is left before the cutoff.
const [left] = await q(
  `SELECT (SELECT count(*)::int FROM kpi_events WHERE starts_with(event, $3) AND created_at >= $1 AND created_at < $2) AS events,
          (SELECT count(*)::int FROM conversations c
            WHERE c.created_at >= $1 AND c.created_at < $2
              AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.tool_name = ANY($4::text[]))) AS chats`,
  [SINCE, BEFORE, PREFIX, TOOLS]
);
line("");
line(`Kontrolle: Konfigurator-Events vor dem Stichtag: ${left.events} · Konfigurator-Chats: ${left.chats}${left.events === 0 && left.chats === 0 ? "  ✓" : "  ✗ bitte melden"}`);
line("");
line("Danach: Testgeräte — Website-Daten von motionsports.de löschen (oder privates Fenster); ab jetzt");
line("zählt jeder Besuch als echt. Gespräche → Insights und KPIs → Top-Fragen bei Bedarf neu erzeugen.");
line("");
process.exit(0);

// ── helpers ──────────────────────────────────────────────────────────────────

function orderFlags() {
  if (args.keepOrders) return " --keep-orders";
  if (args.orders.length > 0) return ` --orders "${args.orders.map((o) => `#${o}`).join(",")}"`;
  return "";
}

async function buildPlan() {
  const [eventsByName, days, partners, chatStartRows, discountRows, previousRuns] = await Promise.all([
    q(
      `SELECT event, count(*)::int AS zeilen, count(DISTINCT session_id)::int AS sitzungen,
              min(created_at) AS erstes, max(created_at) AS letztes
         FROM kpi_events
        WHERE starts_with(event, $3) AND created_at >= $1 AND created_at < $2
        GROUP BY event ORDER BY event`,
      [SINCE, BEFORE, PREFIX]
    ),
    q(
      `SELECT to_char(created_at AT TIME ZONE 'Europe/Berlin', 'YYYY-MM-DD') AS tag,
              count(DISTINCT session_id) FILTER (WHERE event = 'configurator_started')::int AS begonnen,
              count(DISTINCT session_id) FILTER (WHERE event = $4)::int AS chats,
              count(*)::int AS events
         FROM kpi_events
        WHERE starts_with(event, $3) AND created_at >= $1 AND created_at < $2
        GROUP BY 1 ORDER BY 1`,
      [SINCE, BEFORE, PREFIX, RESET_CHAT_STARTED_EVENT]
    ),
    q(
      `SELECT COALESCE(NULLIF(data->>'partner', ''), 'direkt') AS herkunft, count(DISTINCT session_id)::int AS sitzungen
         FROM kpi_events
        WHERE event = 'configurator_started' AND created_at >= $1 AND created_at < $2
        GROUP BY 1 ORDER BY 2 DESC`,
      [SINCE, BEFORE]
    ),
    q(
      `SELECT session_id, created_at FROM kpi_events
        WHERE event = $3 AND session_id IS NOT NULL AND created_at >= $1 AND created_at < $2`,
      [SINCE, BEFORE, RESET_CHAT_STARTED_EVENT]
    ),
    q(
      `SELECT DISTINCT code FROM (
         SELECT btrim(value->'discount'->>'code') AS code FROM admin_settings WHERE key = 'configurator'
         UNION ALL
         SELECT btrim(detail->>'discountCode') FROM admin_access_log
          WHERE action = 'settings.configurator' AND occurred_at >= $1
       ) c WHERE code IS NOT NULL AND code <> ''`,
      [SINCE]
    ),
    q(`SELECT occurred_at, detail FROM admin_access_log WHERE action = $1 ORDER BY occurred_at DESC LIMIT 1`, [RESET_AUDIT_ACTION]),
  ]);

  const candidateRows = await q(
    `SELECT c.id, c.session_id, c.conversation_key, c.customer_id, c.created_at, c.persona_label, c.message_count,
            GREATEST(c.created_at,
                     COALESCE((SELECT max(m.created_at) FROM messages m WHERE m.conversation_id = c.id), c.created_at),
                     COALESCE(c.last_activity_at, c.created_at)) AS last_at,
            EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.tool_name = ANY($3::text[])) AS has_tool,
            (SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.id) AS messages,
            (SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.id AND m.created_at >= $2) AS late_messages
       FROM conversations c
      WHERE c.created_at >= $1 AND c.created_at < $2
        AND (EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.tool_name = ANY($3::text[]))
             OR c.persona_label = ANY($4::text[])
             OR c.session_id IN (SELECT e.session_id FROM kpi_events e
                                  WHERE e.event = $5 AND e.session_id IS NOT NULL
                                    AND e.created_at >= $1 AND e.created_at < $2))`,
    [SINCE, BEFORE, TOOLS, PERSONAS, RESET_CHAT_STARTED_EVENT]
  );
  const candidates = candidateRows.map((r) => ({
    id: Number(r.id),
    sessionId: r.session_id ?? null,
    conversationKey: r.conversation_key ?? null,
    customerId: r.customer_id == null ? null : Number(r.customer_id),
    createdAt: new Date(r.created_at).toISOString(),
    lastAt: new Date(r.last_at).toISOString(),
    hasConfiguratorTool: r.has_tool === true,
    personaLabel: r.persona_label ?? null,
    messages: Number(r.messages ?? 0),
    lateMessages: Number(r.late_messages ?? 0),
  }));
  const picked = selectConfiguratorConversations({
    conversations: candidates,
    chatStarts: chatStartRows.map((r) => ({ sessionId: r.session_id, at: new Date(r.created_at).toISOString() })),
  });
  const chats = candidates.filter((c) => picked.has(c.id)).map((c) => ({ ...c, reasons: picked.get(c.id) ?? [] }));
  const chatIds = chats.map((c) => c.id);

  // Sessions of the chats (own session + every device that wrote to them).
  const writerRows = chatIds.length
    ? await q(`SELECT DISTINCT conversation_id, session_id FROM messages WHERE conversation_id = ANY($1::bigint[]) AND session_id IS NOT NULL`, [chatIds])
    : [];
  /** @type {Map<number, string[]>} */
  const writerSessions = new Map();
  for (const r of writerRows) {
    const id = Number(r.conversation_id);
    writerSessions.set(id, [...(writerSessions.get(id) ?? []), r.session_id]);
  }
  const sessionIds = [...new Set([...chats.map((c) => c.sessionId), ...writerRows.map((r) => r.session_id)].filter(Boolean))];
  const [countRows, signedRows] = sessionIds.length
    ? await Promise.all([
        q(`SELECT session_id, count(*)::int AS n FROM conversations WHERE session_id = ANY($1::text[]) GROUP BY session_id`, [sessionIds]),
        q(
          `SELECT DISTINCT session_id FROM customer_session_links
            WHERE session_id = ANY($1::text[]) AND link_kind IN ('customer_account', 'app_proxy')`,
          [sessionIds]
        ),
      ])
    : [[], []];
  const sessions = classifySessions({
    configuratorConversations: chats,
    writerSessions,
    conversationCounts: new Map(countRows.map((r) => [r.session_id, Number(r.n)])),
    signedInSessions: new Set(signedRows.map((r) => r.session_id)),
  });
  const windowSids = [];
  const windowFrom = [];
  const windowTo = [];
  for (const s of sessions.shared) {
    for (const w of s.windows) {
      windowSids.push(s.sessionId);
      windowFrom.push(w.from);
      windowTo.push(w.to);
    }
  }
  const sharedSids = sessions.shared.map((s) => s.sessionId);

  const discountCodes = discountRows.map((r) => String(r.code));
  const chatKeys = [...new Set(chats.flatMap((c) => [c.conversationKey, String(c.id)]).filter(Boolean))];
  const customerIds = [...new Set(chats.map((c) => c.customerId).filter((v) => v != null))];

  const [exclusiveEvents, windowEvents, orderRows, namedRows, feedbackRows, aiRows, insightRows, summaryRows, reportRows, runRows, qaRows, inboxRows, captureRows] =
    await Promise.all([
      sessions.exclusive.length
        ? q(
            `SELECT event, count(*)::int AS zeilen FROM kpi_events
              WHERE session_id = ANY($3::text[]) AND created_at >= $1 AND created_at < $2 AND NOT starts_with(event, $4)
              GROUP BY event ORDER BY 2 DESC, 1`,
            [SINCE, BEFORE, sessions.exclusive, PREFIX]
          )
        : [],
      windowSids.length
        ? q(
            `SELECT e.event, count(*)::int AS zeilen FROM kpi_events e
              WHERE e.session_id = ANY($3::text[]) AND e.created_at >= $1 AND e.created_at < $2 AND NOT starts_with(e.event, $4)
                AND EXISTS (SELECT 1 FROM unnest($5::text[], $6::timestamptz[], $7::timestamptz[]) AS w(sid, f, t)
                             WHERE w.sid = e.session_id AND e.created_at >= w.f AND e.created_at <= w.t)
              GROUP BY e.event ORDER BY 2 DESC, 1`,
            [SINCE, BEFORE, sharedSids, PREFIX, windowSids, windowFrom, windowTo]
          )
        : [],
      // Candidate test orders: „über den Konfigurator“ (the KPI's own rule), placed from a session that only
      // held configurator chats, or with a Konfigurator-Rabatt code.
      q(
        `SELECT o.id, o.order_name, o.shopify_order_id, o.processed_at, o.financial_status, o.total_price, o.currency,
                o.discount_codes, o.attribution_tier,
                (o.session_id IS NOT NULL AND EXISTS (
                   SELECT 1 FROM messages g
                    WHERE g.tool_name = ANY($3::text[]) AND g.created_at <= o.processed_at
                      AND g.conversation_id = (
                        SELECT m.conversation_id FROM messages m
                         WHERE m.session_id = o.session_id AND m.tool_name = ANY($4::text[]) AND m.created_at <= o.processed_at
                         ORDER BY m.created_at DESC, m.id DESC LIMIT 1))) AS via_konfigurator,
                (o.session_id = ANY($5::text[])) AS aus_testsitzung,
                EXISTS (SELECT 1 FROM unnest(o.discount_codes) d(code) WHERE upper(btrim(d.code)) = ANY($6::text[])) AS mit_rabattcode
           FROM mo_orders o
          WHERE o.processed_at >= $1 AND o.processed_at < $2
            AND ((o.session_id IS NOT NULL AND EXISTS (
                   SELECT 1 FROM messages g
                    WHERE g.tool_name = ANY($3::text[]) AND g.created_at <= o.processed_at
                      AND g.conversation_id = (
                        SELECT m.conversation_id FROM messages m
                         WHERE m.session_id = o.session_id AND m.tool_name = ANY($4::text[]) AND m.created_at <= o.processed_at
                         ORDER BY m.created_at DESC, m.id DESC LIMIT 1)))
                 OR o.session_id = ANY($5::text[])
                 OR EXISTS (SELECT 1 FROM unnest(o.discount_codes) d(code) WHERE upper(btrim(d.code)) = ANY($6::text[])))
          ORDER BY o.processed_at`,
        [SINCE, BEFORE, [...CONFIGURATOR_PLAN_TOOLS], [...CONSULTATION_ANCHOR_TOOLS], sessions.exclusive, discountCodes.map((c) => c.toUpperCase())]
      ),
      args.orders.length
        ? q(
            `SELECT id, order_name, shopify_order_id, processed_at, financial_status, total_price, currency FROM mo_orders
              WHERE processed_at >= $1 AND processed_at < $2
                AND (ltrim(order_name, '#') = ANY($3::text[]) OR shopify_order_id = ANY($3::text[]))`,
            [SINCE, BEFORE, args.orders]
          )
        : [],
      q(
        `SELECT id, created_at, page, left(regexp_replace(COALESCE(message, ''), '\\s+', ' ', 'g'), 120) AS nachricht
           FROM feedback
          WHERE created_at >= $1 AND created_at < $2
            AND (page ILIKE '%home-gym-konfigurator%'
                 OR session_id = ANY($3::text[])
                 OR conversation_id = ANY($4::text[]))
          ORDER BY created_at`,
        [SINCE, BEFORE, sessions.exclusive, chatKeys]
      ),
      chatIds.length
        ? q(`SELECT count(*)::int AS n FROM ai_usage WHERE conversation_id = ANY($1::bigint[])`, [chatIds])
        : [{ n: 0 }],
      q(`SELECT count(*)::int AS n FROM conversation_insights WHERE date_to >= $1::date AND date_from <= $2::date`, [SINCE, BEFORE]),
      q(
        `SELECT count(*)::int AS n FROM kpi_persona_question_summaries WHERE persona_label = ANY($1::text[]) OR generated_at >= $2`,
        [PERSONAS, SINCE]
      ),
      q(`SELECT count(*)::int AS n FROM analytics_reports WHERE date_to >= $1::date AND date_from <= $2::date`, [SINCE, BEFORE]),
      q(`SELECT count(*)::int AS n FROM improvement_runs WHERE created_at >= $1`, [SINCE]),
      chatIds.length
        ? q(`SELECT id, status, left(question, 80) AS frage FROM qa_entries WHERE conversation_id = ANY($1::bigint[]) ORDER BY id`, [chatIds])
        : [],
      customerIds.length
        ? q(
            `SELECT count(*)::int AS n FROM inbox_items
              WHERE customer_id = ANY($1::bigint[]) AND kind = 'kaufabsicht' AND created_at >= $2 AND created_at < $3`,
            [customerIds, SINCE, BEFORE]
          )
        : [{ n: 0 }],
      sessions.exclusive.length
        ? q(`SELECT count(*)::int AS n FROM email_captures WHERE session_id = ANY($1::text[])`, [sessions.exclusive])
        : [{ n: 0 }],
    ]);

  const candidatesOrders = orderRows.map((r) => ({
    id: Number(r.id),
    orderName: r.order_name ?? null,
    shopifyOrderId: r.shopify_order_id ?? null,
    processedAt: r.processed_at,
    status: r.financial_status ?? "",
    total: r.total_price == null ? null : Number(r.total_price),
    currency: r.currency ?? "",
    codes: r.discount_codes ?? [],
    reasons: [r.via_konfigurator ? "über den Konfigurator" : null, r.aus_testsitzung ? "aus Test-Sitzung" : null, r.mit_rabattcode ? "Rabattcode" : null]
      .filter(Boolean)
      .join(", "),
  }));
  const named = namedRows.map((r) => ({ id: Number(r.id), orderName: r.order_name ?? null, shopifyOrderId: r.shopify_order_id ?? null }));
  const decision = decideOrders({ candidates: candidatesOrders, named, requested: args.orders, keepOrders: args.keepOrders });

  return {
    events: { byName: eventsByName, days, partners, total: eventsByName.reduce((n, r) => n + Number(r.zeilen), 0) },
    chats,
    chatIds,
    customerIds,
    sessions,
    windows: { sids: windowSids, from: windowFrom, to: windowTo },
    sharedSids,
    otherEvents: { exclusive: exclusiveEvents, windows: windowEvents },
    orders: { candidates: candidatesOrders, named, decision, discountCodes },
    feedback: feedbackRows,
    aiUsage: Number(aiRows[0]?.n ?? 0),
    insights: Number(insightRows[0]?.n ?? 0),
    summaries: Number(summaryRows[0]?.n ?? 0),
    reports: Number(reportRows[0]?.n ?? 0),
    runs: Number(runRows[0]?.n ?? 0),
    qa: qaRows,
    inbox: Number(inboxRows[0]?.n ?? 0),
    captures: Number(captureRows[0]?.n ?? 0),
    previousRun: previousRuns[0] ?? null,
  };
}

function printPlan(p) {
  if (p.previousRun) {
    line("");
    line(`⚠  Der Reset lief schon am ${berlin(p.previousRun.occurred_at)} (Stichtag ${berlin(p.previousRun.detail?.before)}).`);
  }
  line("");
  line(`1) Konfigurator-Events (kpi_events „configurator_*“): ${p.events.total} Zeilen — werden gelöscht`);
  table(p.events.byName.map((r) => ({ event: r.event, zeilen: r.zeilen, sitzungen: r.sitzungen, erstes: berlin(r.erstes), letztes: berlin(r.letztes) })));
  line("   Je Tag (Europe/Berlin) — prüfen: nur eure Tests? Echte Besucher wären hier mitgezählt:");
  table(p.events.days);
  line("   Herkunft der begonnenen Durchgänge:");
  table(p.events.partners);

  line("");
  const by = (reason) => p.chats.filter((c) => c.reasons.includes(reason)).length;
  line(
    `2) Konfigurator-Chats: ${p.chats.length} Gespräche mit ${p.chats.reduce((n, c) => n + c.messages, 0)} Nachrichten — werden gelöscht` +
      ` (Werkzeug ${by("werkzeug")}, Persona ${by("persona")}, Übergabe ${by("übergabe")})`
  );
  line(`   KI-Kosten-Zeilen dieser Chats: ${p.aiUsage} — bleiben in „KI-Kosten“, nur ohne Gesprächsbezug.`);
  table(
    p.chats.map((c) => ({
      id: c.id,
      erstellt: berlin(c.createdAt),
      sitzung: shortSid(c.sessionId),
      nachrichten: c.messages,
      kunde: c.customerId ?? "",
      grund: c.reasons.join("+"),
      ...(c.lateMessages > 0 ? { "nach Stichtag": c.lateMessages } : {}),
    }))
  );
  const late = p.chats.filter((c) => c.lateMessages > 0);
  if (late.length > 0) {
    line(`   ⚠  ${late.length} Chat(s) haben Nachrichten NACH dem Stichtag — sie werden trotzdem ganz gelöscht (Chat begann davor).`);
  }

  line("");
  const sum = (rows) => rows.reduce((n, r) => n + Number(r.zeilen), 0);
  line(
    `3) Weitere Widget-Events dieser Chats: ${sum(p.otherEvents.exclusive) + sum(p.otherEvents.windows)} Zeilen — werden gelöscht`
  );
  line(`   ${p.sessions.exclusive.length} Sitzung(en) nur mit Konfigurator-Chats (alle Events im Zeitraum): ${sum(p.otherEvents.exclusive)}`);
  table(p.otherEvents.exclusive);
  line(
    `   ${p.sessions.shared.length} geteilte Sitzung(en) (angemeldet oder weitere Chats; nur im Zeitfenster der Konfigurator-Chats): ${sum(p.otherEvents.windows)}`
  );
  table(p.otherEvents.windows);

  line("");
  const o = p.orders;
  line(
    `4) Bestellungen im Bestell-Ledger (mo_orders), die nach Test aussehen: ${o.candidates.length}` +
      (o.discountCodes.length ? `  (Rabattcode(s): ${o.discountCodes.join(", ")})` : "")
  );
  table(
    o.candidates.map((c) => ({
      bestellung: c.orderName ?? c.shopifyOrderId,
      datum: berlin(c.processedAt),
      status: c.status,
      betrag: c.total == null ? "" : `${c.total} ${c.currency}`,
      grund: c.reasons,
      löschen: o.decision.deleteIds.includes(c.id) ? "ja (--orders)" : args.keepOrders ? "nein (--keep-orders)" : "offen",
    }))
  );
  for (const m of o.decision.missing) line(`   ✗ --orders ${m}: keine solche Bestellung im Zeitraum.`);
  const extra = o.named.filter((n) => !o.candidates.some((c) => c.id === n.id));
  if (extra.length) line(`   + zusätzlich per --orders: ${extra.map((n) => n.orderName ?? n.shopifyOrderId).join(", ")}`);

  line("");
  line(`5) Feedback aus dem Konfigurator / seinen Chats: ${p.feedback.length} — wird gelöscht (Text unten, falls ihr etwas behalten wollt)`);
  table(p.feedback.map((f) => ({ id: Number(f.id), datum: berlin(f.created_at), seite: f.page ?? "", nachricht: f.nachricht })));

  line("");
  line(`6) Zwischenspeicher aus den Test-Chats — werden gelöscht (bei Bedarf mit einem Klick neu erzeugen):`);
  line(`   Gespräche → Insights, die den Testzeitraum abdecken: ${p.insights}`);
  line(`   KPIs → Top-Fragen je Persona: ${p.summaries}`);

  line("");
  line("7) Bleibt (nur zur Info):");
  line(`   Komplettanalysen im Testzeitraum: ${p.reports} · Verbesserungsläufe seit dem Konfigurator: ${p.runs} (Historie — enthalten Testzahlen)`);
  line(`   Wissen-Einträge aus Test-Chats: ${p.qa.length}${p.qa.length ? " (Verknüpfung zum Chat entfällt; veröffentlichte ggf. in Wissen zurückziehen)" : ""}`);
  if (p.qa.length) table(p.qa.map((r) => ({ id: Number(r.id), status: r.status, frage: r.frage })));
  line(`   Eingang „Kaufabsicht“ von Test-Kund:innen: ${p.inbox} · E-Mail-Erfassungen in Test-Sitzungen: ${p.captures}`);
  line(`   Angemeldete Test-Kund:innen: ${p.customerIds.length} (Kennzahlen werden markiert und heute Nacht neu berechnet)`);
  line("   Einstellungen (Konfigurator, Showroom, Rabatt), Katalog, Kund:innen, Einwilligungen, Shopify — unverändert.");
}

function printOrderDecisionHelp(p) {
  const d = p.orders.decision;
  if (d.ok) return;
  line("");
  if (d.undecided.length) {
    line(`⚠  ${d.undecided.length} Bestellung(en) ohne Entscheidung. Nach dem Löschen der Chats zählt eine behaltene`);
    line("   Test-Bestellung nicht mehr „über den Konfigurator“, sondern als normaler „Umsatz durch Mo“. Entweder");
    line(`     --orders "${d.undecided.map((c) => `#${String(c.orderName ?? c.shopifyOrderId).replace(/^#/, "")}`).join(",")}"   (Test-Bestellungen löschen)`);
    line("   oder --keep-orders (echte Bestellungen behalten). Test-Bestellungen vorher in Shopify stornieren/erstatten.");
  }
  for (const m of d.missing) line(`✗ --orders ${m}: keine solche Bestellung im Zeitraum.`);
  line("");
}

async function applyPlan(p) {
  const detail = {
    before: BEFORE,
    since: SINCE,
    chats: p.chatIds.length,
    events: p.events.total,
    exclusiveSessions: p.sessions.exclusive.length,
    sharedSessions: p.sessions.shared.length,
    orders: p.orders.decision.deleteIds.length,
    feedback: p.feedback.length,
    by: "scripts/reset-konfigurator-data.mjs",
  };
  const feedbackIds = p.feedback.map((f) => Number(f.id));
  const steps = [
    ["KI-Kosten-Zeilen vom Chat gelöst (bleiben)", `WITH u AS (UPDATE ai_usage SET conversation_id = NULL WHERE conversation_id = ANY($1::bigint[]) RETURNING 1) SELECT count(*)::int AS n FROM u`, [p.chatIds]],
    ["Nachrichten der Konfigurator-Chats", `SELECT count(*)::int AS n FROM messages WHERE conversation_id = ANY($1::bigint[])`, [p.chatIds]],
    ["Test-Bestellungen (mo_orders)", `WITH d AS (DELETE FROM mo_orders WHERE id = ANY($1::bigint[]) RETURNING 1) SELECT count(*)::int AS n FROM d`, [p.orders.decision.deleteIds]],
    [
      "Konfigurator-Events (configurator_*)",
      `WITH d AS (DELETE FROM kpi_events WHERE starts_with(event, $3) AND created_at >= $1 AND created_at < $2 RETURNING 1) SELECT count(*)::int AS n FROM d`,
      [SINCE, BEFORE, PREFIX],
    ],
    [
      "Weitere Events der Konfigurator-Sitzungen",
      `WITH d AS (DELETE FROM kpi_events WHERE session_id = ANY($3::text[]) AND created_at >= $1 AND created_at < $2 RETURNING 1) SELECT count(*)::int AS n FROM d`,
      [SINCE, BEFORE, p.sessions.exclusive],
    ],
    [
      "Weitere Events geteilter Sitzungen im Chat-Zeitfenster",
      `WITH d AS (DELETE FROM kpi_events e
                   WHERE e.session_id = ANY($3::text[]) AND e.created_at >= $1 AND e.created_at < $2
                     AND EXISTS (SELECT 1 FROM unnest($4::text[], $5::timestamptz[], $6::timestamptz[]) AS w(sid, f, t)
                                  WHERE w.sid = e.session_id AND e.created_at >= w.f AND e.created_at <= w.t)
                  RETURNING 1) SELECT count(*)::int AS n FROM d`,
      [SINCE, BEFORE, p.sharedSids, p.windows.sids, p.windows.from, p.windows.to],
    ],
    ["Feedback", `WITH d AS (DELETE FROM feedback WHERE id = ANY($1::bigint[]) RETURNING 1) SELECT count(*)::int AS n FROM d`, [feedbackIds]],
    ["Konfigurator-Chats (Nachrichten per Kaskade)", `WITH d AS (DELETE FROM conversations WHERE id = ANY($1::bigint[]) RETURNING 1) SELECT count(*)::int AS n FROM d`, [p.chatIds]],
    [
      "Gespräche-Insights (Zeitraum überlappt)",
      `WITH d AS (DELETE FROM conversation_insights WHERE date_to >= $1::date AND date_from <= $2::date RETURNING 1) SELECT count(*)::int AS n FROM d`,
      [SINCE, BEFORE],
    ],
    [
      "Top-Fragen je Persona",
      `WITH d AS (DELETE FROM kpi_persona_question_summaries WHERE persona_label = ANY($1::text[]) OR generated_at >= $2 RETURNING 1) SELECT count(*)::int AS n FROM d`,
      [PERSONAS, SINCE],
    ],
    [
      "Kund:innen-Kennzahlen zum Neuberechnen markiert",
      `WITH u AS (UPDATE customers SET facts_dirty_at = now() WHERE id = ANY($1::bigint[]) RETURNING 1) SELECT count(*)::int AS n FROM u`,
      [p.customerIds],
    ],
    [
      "Protokoll (admin_access_log)",
      `WITH i AS (INSERT INTO admin_access_log (action, target_customer_id, detail, ip, session_fp)
                  VALUES ($1, NULL, $2::jsonb, NULL, 'script') RETURNING 1) SELECT count(*)::int AS n FROM i`,
      [RESET_AUDIT_ACTION, JSON.stringify(detail)],
    ],
  ];
  const out = await sql.transaction((tx) => steps.map(([, text, params]) => tx.query(text, params)));
  return steps.map(([label], i) => ({ schritt: label, zeilen: Number(out[i]?.[0]?.n ?? 0) }));
}
