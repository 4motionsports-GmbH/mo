#!/usr/bin/env node
// Read-only live checks after a widget release, straight from kpi_events and
// consent_events — the queries behind docs/ROLLOUT_TODO.md 1.11 (live check
// after a widget upload). Only SELECTs; no names, e-mail addresses or message text
// are printed (session ids are shortened).
//
//   npm run verify:live                       (since 2026-10-04, Europe/Berlin)
//   npm run verify:live -- --since 2026-10-05
//   npm run verify:live -- --since 2026-10-05 --session <sid prefix>   (sections 3 and 9)
//
// Sections: 1 sign-in chain + diagnosis, 3 consent + no widget-sent erasures,
// 4 campaign chat starts (once per send), 5 contact form, 6 order status,
// 7 order attribution (pre-checks P1–P6; after migration 0076 the live
// checks V0, V3, V4 and the kept tokens), 8 shop-login recognition (App
// Proxy, P0.3; manual whoami checks with session=livecheck-… never count),
// 9 page context on typed product-page messages (A3). `--session <prefix>`
// adds one session's rows to sections 3 (consent with variant / placement) and 9.

import { neon, neonConfig } from "@neondatabase/serverless";
import { SIGNIN_DIAGNOSIS, classifySigninSession } from "../src/lib/kpi-widget-events.mjs";

if (process.env.NEON_FETCH_ENDPOINT) neonConfig.fetchEndpoint = process.env.NEON_FETCH_ENDPOINT;

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
  console.error("DATABASE_URL fehlt (.env).");
  process.exit(1);
}
const sql = neon(url);
const args = process.argv.slice(2);
const sinceArg = args[args.indexOf("--since") + 1];
const since = args.includes("--since") && /^\d{4}-\d{2}-\d{2}$/.test(sinceArg ?? "") ? sinceArg : "2026-10-04";

/** Midnight Europe/Berlin of `since`, as the lower bound of every query. */
const SINCE = `(($1::date)::timestamp AT TIME ZONE 'Europe/Berlin')`;
const q = (text, params = []) => sql.query(text, [since, ...params]);
const short = (s) => (typeof s === "string" ? `${s.slice(0, 8)}…` : s);
const head = (t) => console.log(`\n=== ${t} ===`);
/** console.table, or one line when there is nothing to show. */
const table = (rows) => (rows.length ? console.table(rows) : console.log("  (keine Zeilen)"));

console.log(`Live-Check ab ${since} (Europe/Berlin)`);

// ---------------------------------------------------------------------------
head("1 · Anmeldung: Kette started → succeeded → return → linked");
table(
  await q(
    `SELECT event,
            COALESCE(data->>'result', data->>'kind', data->>'reason', data->>'source', '') AS detail,
            count(*)::int AS events, count(DISTINCT session_id)::int AS sessions,
            min(created_at) AS first, max(created_at) AS last
       FROM kpi_events
      WHERE event IN ('login_gate_shown','login_gate_signin_clicked','login_gate_declined','login_gate_dismissed',
                      'account_signin_started','account_signin_succeeded','account_signin_return',
                      'account_signin_linked','account_signin_link_refused')
        AND created_at >= ${SINCE}
      GROUP BY 1, 2
      ORDER BY 1, 2`
  )
);

const sessions = await q(
  `SELECT session_id,
          bool_or(event = 'login_gate_signin_clicked') AS gate_clicked,
          COALESCE(max(created_at) FILTER (WHERE event = 'login_gate_dismissed')
                   > min(created_at) FILTER (WHERE event = 'login_gate_signin_clicked'), false) AS dismissed_after_click,
          bool_or(event = 'account_signin_started') AS started,
          bool_or(event = 'account_signin_succeeded') AS succeeded,
          bool_or(event = 'account_signin_return' AND data->>'result' = 'ok') AS return_ok,
          bool_or(event = 'account_signin_return' AND data->>'result' = 'link_failed') AS return_link_failed,
          bool_or(event = 'account_signin_return'
                  AND COALESCE(data->>'result', '') NOT IN ('ok', 'link_failed', 'logged_out')) AS return_other,
          bool_or(event = 'account_signin_linked') AS linked,
          bool_or(event = 'account_signin_linked' AND data->>'kind' = 'app_proxy') AS linked_via_shop,
          bool_or(event = 'account_signin_linked' AND data->>'kind' = 'app_proxy'
                  AND COALESCE(data->>'renewed', 'false') = 'false') AS linked_via_shop_new,
          bool_or(event = 'account_shop_recognised' AND data->>'codeIssued' = 'true') AS shop_code_issued,
          bool_or(event = 'account_signin_link_refused' AND data->>'reason' = 'session_mismatch') AS refused_mismatch,
          bool_or(event = 'account_signin_link_refused' AND COALESCE(data->>'reason', '') <> 'session_mismatch') AS refused_invalid,
          min(created_at) AS first, max(created_at) AS last
     FROM kpi_events
    WHERE event IN ('login_gate_signin_clicked','login_gate_dismissed','account_signin_started','account_signin_succeeded',
                    'account_signin_return','account_signin_linked','account_signin_link_refused','account_shop_recognised')
      AND session_id IS NOT NULL
      AND session_id NOT LIKE 'livecheck-%'
      AND created_at >= ${SINCE}
    GROUP BY session_id
   HAVING bool_or(event <> 'account_shop_recognised')
       OR bool_or(event = 'account_shop_recognised' AND data->>'codeIssued' = 'true')`
);
const byOutcome = new Map();
const stuck = [];
for (const r of sessions) {
  const key = classifySigninSession({
    gateClicked: r.gate_clicked,
    dismissedAfterClick: r.dismissed_after_click,
    started: r.started,
    succeeded: r.succeeded,
    returnOk: r.return_ok,
    returnLinkFailed: r.return_link_failed,
    returnOther: r.return_other,
    linked: r.linked,
    linkedViaShop: r.linked_via_shop,
    linkedViaShopNew: r.linked_via_shop_new,
    shopCodeIssued: r.shop_code_issued,
    refusedInvalid: r.refused_invalid,
    refusedMismatch: r.refused_mismatch,
  });
  byOutcome.set(key, (byOutcome.get(key) ?? 0) + 1);
  if (r.succeeded && !r.linked) stuck.push({ session: short(r.session_id), outcome: key, first: r.first, last: r.last });
}
console.log("\nDiagnose je Sitzung (docs/frontend/05 §12.1):");
table(
  SIGNIN_DIAGNOSIS.filter((d) => byOutcome.has(d.key)).map((d) => ({
    ergebnis: d.label,
    sitzungen: byOutcome.get(d.key),
    ok: d.ok ? "ja" : "nein",
  }))
);
console.log(`Zwischen succeeded und linked hängengeblieben: ${stuck.length}`);
if (stuck.length) table(stuck.slice(0, 25));

console.log("\nAnmelde-Popup-Funnel (Sitzungen):");
table(
  await q(
    `WITH s AS (
       SELECT session_id,
              min(created_at) FILTER (WHERE event = 'login_gate_shown') AS shown,
              min(created_at) FILTER (WHERE event = 'login_gate_signin_clicked') AS clicked,
              bool_or(event = 'login_gate_declined') AS declined,
              bool_or(event = 'login_gate_dismissed') AS dismissed
         FROM kpi_events
        WHERE event LIKE 'login_gate_%' AND session_id IS NOT NULL AND created_at >= ${SINCE}
        GROUP BY session_id)
     SELECT count(*) FILTER (WHERE s.shown IS NOT NULL)::int AS angezeigt,
            count(*) FILTER (WHERE s.clicked IS NOT NULL)::int AS anmelden_geklickt,
            count(*) FILTER (WHERE s.clicked IS NOT NULL AND EXISTS (
              SELECT 1 FROM kpi_events k WHERE k.session_id = s.session_id
                 AND k.event = 'account_signin_succeeded' AND k.created_at >= s.clicked))::int AS bei_shopify,
            count(*) FILTER (WHERE s.clicked IS NOT NULL AND EXISTS (
              SELECT 1 FROM kpi_events k WHERE k.session_id = s.session_id
                 AND k.event = 'account_signin_linked'
                 AND COALESCE(k.data->>'kind', 'customer_account') = 'customer_account'
                 AND k.created_at >= s.clicked))::int AS im_chat,
            count(*) FILTER (WHERE s.declined)::int AS spaeter,
            count(*) FILTER (WHERE s.dismissed)::int AS weggeklickt
       FROM s`
  )
);

// ---------------------------------------------------------------------------
const sessionArg = args.includes("--session") ? String(args[args.indexOf("--session") + 1] ?? "") : "";
const sessionOk = /^[A-Za-z0-9_-]{4,64}$/.test(sessionArg);

head("3 · Einwilligung nach der Anmeldung");
table(
  await q(
    `SELECT event, COALESCE(data->>'surface', '(ohne)') AS surface, count(*)::int AS events,
            count(DISTINCT session_id)::int AS sessions
       FROM kpi_events
      WHERE event LIKE 'consent_gate_%' AND created_at >= ${SINCE}
      GROUP BY 1, 2 ORDER BY 1, 2`
  )
);
console.log("Wer sich im Chat angemeldet hat — Einwilligungsstand (Popup nur bei marketing_status = none + echter E-Mail):");
table(
  await q(
    `SELECT left(k.session_id, 8) AS sitzung, k.created_at, c.marketing_status, c.email_consent_state,
            c.email NOT LIKE 'shopify:%' AS echte_email,
            (c.marketing_status = 'none' AND c.email NOT LIKE 'shopify:%') AS popup_erwartet
       FROM kpi_events k
       LEFT JOIN customer_session_links l ON l.session_id = k.session_id
       LEFT JOIN LATERAL (SELECT customer_id FROM conversations
                           WHERE session_id = k.session_id AND customer_id IS NOT NULL LIMIT 1) cv ON true
       LEFT JOIN customers c ON c.id = COALESCE(l.customer_id, cv.customer_id)
      WHERE k.event = 'account_signin_linked' AND k.created_at >= ${SINCE}
      ORDER BY k.created_at
      LIMIT 25`
  )
);
console.log("Opt-ins nach Quelle und Ergebnis (seit 05.10.: source/outcome; ältere über trigger/doiStatus genähert):");
table(
  await q(
    `SELECT COALESCE(data->>'source',
                     CASE data->>'trigger' WHEN 'signin_optin' THEN 'mo_signin' WHEN 'chat_gate' THEN 'mo_chat_gate'
                                           ELSE 'mo_capture_form' END) AS quelle,
            COALESCE(data->>'outcome',
                     CASE data->>'doiStatus' WHEN 'pending' THEN 'doi_required (genähert)'
                                             WHEN 'confirmed' THEN 'already_confirmed (genähert)' ELSE 'unbekannt' END) AS ergebnis,
            COALESCE(data->>'variant', '') AS variante, COALESCE(data->>'placement', '') AS platzierung,
            count(*)::int AS events, count(DISTINCT session_id)::int AS sitzungen
       FROM kpi_events
      WHERE event = 'email_capture_marketing_opted_in' AND created_at >= ${SINCE}
      GROUP BY 1, 2, 3, 4 ORDER BY 1, 2`
  )
);
if (sessionOk) {
  console.log(`Sitzung ${sessionArg}… — Einwilligungs-Ereignisse mit Variante und Platzierung:`);
  const rows = await q(
    `SELECT session_id, event, created_at,
            jsonb_build_object('surface', data->'surface', 'variant', data->'variant', 'placement', data->'placement',
                               'source', data->'source', 'outcome', data->'outcome', 'variantMismatch', data->'variantMismatch') AS daten
       FROM kpi_events
      WHERE (event LIKE 'consent_gate_%' OR event IN ('email_capture_submitted', 'email_capture_marketing_opted_in'))
        AND session_id LIKE $2 || '%' AND created_at >= ${SINCE}
      ORDER BY created_at LIMIT 50`,
    [sessionArg]
  );
  table(rows.map((r) => ({ sitzung: short(r.session_id), event: r.event, zeit: r.created_at, daten: JSON.stringify(r.daten) })));
}
console.log("DOI-Bestätigungen nach Quelle (Klick auf den Link; das Opt-in-Event selbst ändert sich nie):");
table(
  await q(
    `SELECT COALESCE(data->>'source', '(vor 05.10.)') AS quelle, count(*)::int AS bestaetigt,
            min(created_at) AS first, max(created_at) AS last
       FROM kpi_events
      WHERE event = 'email_capture_marketing_confirmed' AND created_at >= ${SINCE}
      GROUP BY 1 ORDER BY 1`
  )
);
console.log("Einwilligungs-Ereignisse aus Mo (consent_events; mo_signin = Popup nach der Anmeldung):");
table(
  await q(
    `SELECT source, state, count(*)::int AS events, count(DISTINCT customer_id)::int AS kunden
       FROM consent_events
      WHERE source IN ('mo_signin', 'mo_chat_gate', 'mo_capture_form', 'mo') AND recorded_at >= ${SINCE}
      GROUP BY 1, 2 ORDER BY 1, 2`
  )
);
console.log("account_erased vom Widget (mit Sitzung) — erwartet 0; der Server schreibt ohne Sitzung:");
table(
  await q(
    `SELECT (session_id IS NOT NULL) AS vom_widget, count(*)::int AS events, min(created_at) AS first, max(created_at) AS last
       FROM kpi_events
      WHERE event = 'account_erased' AND created_at >= ${SINCE}
      GROUP BY 1`
  )
);

// ---------------------------------------------------------------------------
head("4 · Kampagnen-Chats (campaign_chat_started einmal pro Versand)");
table(
  await q(
    `SELECT COALESCE(data->>'test', 'false') AS test, count(*)::int AS events,
            count(DISTINCT data->>'sendId')::int AS sends
       FROM kpi_events
      WHERE event = 'campaign_chat_started' AND created_at >= ${SINCE}
      GROUP BY 1`
  )
);
const dupes = await q(
  `SELECT count(*)::int AS doppelt
     FROM (SELECT data->>'sendId' FROM kpi_events
            WHERE event = 'campaign_chat_started' AND created_at >= ${SINCE}
            GROUP BY 1 HAVING count(*) > 1) d`
);
console.log(`Versände mit mehr als einem Chat-Start: ${dupes[0]?.doppelt ?? "?"} (erwartet 0, Migration 0075)`);

// ---------------------------------------------------------------------------
head("5 · Kontaktformular (seit dem Widget-Upload 04.10. 21:33 Berlin mit Sitzung erwartet)");
table(
  await q(
    `SELECT COALESCE(data->>'reason', '(ohne)') AS reason,
            count(*)::int AS events,
            count(*) FILTER (WHERE session_id IS NOT NULL)::int AS mit_sitzung,
            max(created_at) FILTER (WHERE session_id IS NULL) AS letzte_ohne_sitzung,
            max(created_at) FILTER (WHERE session_id IS NOT NULL) AS letzte_mit_sitzung
       FROM kpi_events
      WHERE event = 'contact_form_submitted' AND created_at >= ${SINCE}
      GROUP BY 1 ORDER BY 2 DESC`
  )
);

// ---------------------------------------------------------------------------
head("6 · Bestellstatus im Chat");
table(
  await q(
    `SELECT COALESCE(data->>'outcome', '?') AS outcome, COALESCE(data->>'topic', '?') AS topic,
            COALESCE(data->>'source', '–') AS source, count(*)::int AS events,
            count(DISTINCT session_id)::int AS sessions
       FROM kpi_events
      WHERE event = 'order_status_lookup' AND created_at >= ${SINCE}
      GROUP BY 1, 2, 3 ORDER BY 4 DESC`
  )
);

// ---------------------------------------------------------------------------
// Before C.21 (docs/archive/plans-2026-10-04/ATTR-TOKEN-LIFETIME.md §2): counts and
// dates only, no session ids. Independent of --since.
head("7 · Bestell-Zuordnung — Vorab-Checks P1–P6 (ATTR)");
const q0 = (text) => sql.query(text, []);
console.log("P1 · Zuordnungs-Token pro Quelle und Woche (keine 'widget'-Zeilen → Cookie-Banner-Frage zuerst):");
table(
  await q0(
    `SELECT source, date_trunc('week', created_at)::date AS woche, count(*)::int AS tokens
       FROM mo_attribution_tokens GROUP BY 1, 2 ORDER BY 2, 1`
  )
);
console.log("P2 · Zugeordnete Bestellungen (mo_orders):");
table(
  await q0(
    `SELECT attribution_source, attribution_tier, count(*)::int AS bestellungen,
            min(processed_at) AS erste, max(processed_at) AS letzte
       FROM mo_orders GROUP BY 1, 2 ORDER BY 1, 2`
  )
);
console.log("P2b · Ankommende Bestell-Webhooks (orders/create muss dabei sein):");
table(
  await q0(
    `SELECT topic, count(*)::int AS events, max(received_at) AS letzte
       FROM shopify_webhook_events WHERE topic LIKE 'orders/%' GROUP BY 1 ORDER BY 1`
  )
);
console.log("P3 · Ab wann Widget-Token gelöscht werden (ältester Token + 37 Tage):");
table(
  await q0(
    `SELECT min(created_at) AS aeltester_widget_token,
            min(created_at) + interval '37 days' AS erste_loeschung
       FROM mo_attribution_tokens WHERE source = 'widget'`
  )
);
console.log("P4–P6 · Betroffene Geräte und Token (Obergrenzen):");
table(
  await q0(
    `SELECT
       (SELECT count(DISTINCT c.session_id)::int
          FROM conversations c
         WHERE c.last_activity_at >= now() - interval '30 days'
           AND EXISTS (SELECT 1 FROM conversations c2 JOIN messages m ON m.conversation_id = c2.id
                        WHERE c2.session_id = c.session_id AND m.tool_name = 'show_product'
                          AND m.created_at < now() - interval '37 days')
           AND NOT EXISTS (SELECT 1 FROM mo_attribution_tokens t
                            WHERE t.session_id = c.session_id AND t.source = 'widget')) AS p4_geraete_ohne_token,
       (SELECT count(*)::int
          FROM mo_attribution_tokens t
         WHERE t.source = 'widget' AND t.created_at < now() - interval '30 days'
           AND EXISTS (SELECT 1 FROM conversations c JOIN messages m ON m.conversation_id = c.id
                        WHERE c.session_id = t.session_id
                          AND m.tool_name IN ('show_product','compare_products','add_to_cart','suggest_showroom')
                          AND m.created_at >= now() - interval '30 days')) AS p5_sofort_gerettet,
       (SELECT count(*)::int
          FROM mo_attribution_tokens t
         WHERE t.created_at < now() - interval '37 days'
           AND t.created_at >= now() - interval '180 days'
           AND t.source = 'widget' AND t.session_id IS NOT NULL
           AND EXISTS (SELECT 1 FROM conversations c JOIN messages m ON m.conversation_id = c.id
                        WHERE c.session_id = t.session_id
                          AND c.last_activity_at >= now() - interval '37 days'
                          AND m.created_at >= now() - interval '37 days'
                          AND m.tool_name IN ('show_product','compare_products','add_to_cart','suggest_showroom'))) AS p6_behalten_statt_geloescht`
  )
);

console.log("\n7b · Nach Migration 0076 und Deploy (Zuordnungsfenster ab der letzten Beratung):");
try {
  console.log("V0 · Produkt-Zeilen mit schreibender Sitzung (ohne_sitzung_danach muss 0 sein):");
  table(
    await q(
      `WITH first_stamped AS (
         SELECT min(created_at) AS at FROM messages WHERE tool_name IS NOT NULL AND session_id IS NOT NULL
       )
       SELECT (SELECT at FROM first_stamped) AS erste_mit_sitzung,
              count(*) FILTER (WHERE m.session_id IS NOT NULL)::int AS mit_sitzung,
              count(*) FILTER (WHERE m.session_id IS NULL
                                 AND m.created_at > (SELECT at FROM first_stamped))::int AS ohne_sitzung_danach
         FROM messages m
        WHERE m.tool_name IS NOT NULL AND m.created_at >= ${SINCE}`
    )
  );
} catch (err) {
  console.log(`  Migration 0076 fehlt noch (messages.session_id): ${err?.message ?? err}`);
}
console.log("V3 · Markierte Bestellungen ohne Zuordnung (immer ohne Sitzung; nur die Schlüssel reason/source):");
table(
  await q(
    `SELECT data->>'reason' AS reason, COALESCE(data->>'source', '') AS source, count(*)::int AS events,
            bool_and(session_id IS NULL) AS alle_ohne_sitzung,
            bool_and((SELECT count(*) FROM jsonb_object_keys(data) k WHERE k NOT IN ('reason','source')) = 0
                     AND data ? 'reason') AS nur_erlaubte_felder
       FROM kpi_events
      WHERE event = 'mo_order_marker_unresolved' AND created_at >= ${SINCE}
      GROUP BY 1, 2 ORDER BY 1, 2`
  )
);
console.log("V4 · Vom neuen Fenster gerettete Bestellungen (mehr als 30 Tage nach dem Token zugeordnet):");
table(
  await q(
    `SELECT count(*)::int AS bestellungen, COALESCE(sum(o.total_price), 0)::numeric AS umsatz
       FROM mo_orders o JOIN mo_attribution_tokens t ON t.token = o.attribution_token
      WHERE o.attribution_source = 'widget'
        AND o.created_at >= ${SINCE}
        AND o.processed_at > t.created_at + interval '30 days'`
  )
);
console.log("Token älter als 37 Tage (mit Schalter: behalten, weil das Gerät weiter berät; ohne Schalter 0 nach dem Nachtlauf):");
table(
  await q0(
    `SELECT source, count(*)::int AS tokens, min(created_at) AS aeltester
       FROM mo_attribution_tokens WHERE created_at < now() - interval '37 days'
      GROUP BY 1 ORDER BY 1`
  )
);

// ---------------------------------------------------------------------------
head("8 · Shop-Login-Erkennung (App Proxy, P0.3) — ohne livecheck-Sitzungen");
console.log("Erkennungen nach Nachweis / Ergebnis (Sitzungen):");
table(
  await q(
    `SELECT COALESCE(data->>'proof', '') AS nachweis, COALESCE(data->>'hasToken', '') AS chat_token,
            COALESCE(data->>'alreadySignedIn', '') AS schon_angemeldet,
            COALESCE(data->>'codeIssued', '') AS code, COALESCE(data->>'noCode', '') AS ohne_code_weil,
            count(*)::int AS events, count(DISTINCT session_id)::int AS sitzungen
       FROM kpi_events
      WHERE event = 'account_shop_recognised' AND session_id NOT LIKE 'livecheck-%' AND created_at >= ${SINCE}
      GROUP BY 1, 2, 3, 4, 5 ORDER BY 7 DESC`
  )
);
console.log("Codes eingelöst (Ziel ≥ 80 %), davon neue Anmeldungen, abgelehnt:");
table(
  await q(
    `WITH r AS (
       SELECT session_id, min(created_at) AS at FROM kpi_events
        WHERE event = 'account_shop_recognised' AND data->>'codeIssued' = 'true'
          AND session_id NOT LIKE 'livecheck-%' AND created_at >= ${SINCE}
        GROUP BY 1)
     SELECT count(*)::int AS mit_code,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM kpi_events l WHERE l.session_id = r.session_id
                    AND l.event = 'account_signin_linked' AND l.data->>'kind' = 'app_proxy' AND l.created_at >= r.at))::int AS eingeloest,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM kpi_events l WHERE l.session_id = r.session_id
                    AND l.event = 'account_signin_linked' AND l.data->>'kind' = 'app_proxy'
                    AND COALESCE(l.data->>'renewed','false') = 'false' AND l.created_at >= r.at))::int AS davon_neu,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM kpi_events l WHERE l.session_id = r.session_id
                    AND l.event = 'account_signin_link_refused' AND l.data->>'kind' = 'app_proxy' AND l.created_at >= r.at))::int AS abgelehnt
       FROM r`
  )
);
console.log("Manuelle Prüfung (whoami?session=livecheck-manual) — letzte Zeilen:");
table(
  await q0(
    `SELECT created_at, data FROM kpi_events
      WHERE event = 'account_shop_recognised' AND session_id LIKE 'livecheck-%'
      ORDER BY created_at DESC LIMIT 3`
  )
);
console.log("Einwilligungs-Popup je Kunde in 30 Tagen (Deckel 3 Sitzungen; ueber_deckel erwartet 0):");
table(
  await q0(
    `WITH per AS (
       SELECT l.customer_id, count(DISTINCT k.session_id) AS sitzungen
         FROM kpi_events k JOIN customer_session_links l ON l.session_id = k.session_id
        WHERE k.event = 'consent_gate_shown' AND k.data->>'surface' = 'signin'
          AND k.created_at >= now() - interval '30 days'
        GROUP BY 1)
     SELECT count(*)::int AS kunden, COALESCE(max(sitzungen), 0)::int AS max_sitzungen,
            count(*) FILTER (WHERE sitzungen > 3)::int AS ueber_deckel
       FROM per`
  )
);

// ---------------------------------------------------------------------------
head("9 · Seitenkontext auf Produktseiten (A3)");
console.log("page_context_applied nach Art / Gruppe / erkannt / Sprache / Anteil:");
table(
  await q(
    `SELECT data->>'kind' AS art, data->>'applied' AS angewendet, data->>'resolved' AS erkannt,
            COALESCE(data->>'locale', '') AS sprache, data->>'pct' AS anteil,
            count(*)::int AS events, count(DISTINCT session_id)::int AS sitzungen
       FROM kpi_events WHERE event = 'page_context_applied' AND created_at >= ${SINCE}
      GROUP BY 1, 2, 3, 4, 5 ORDER BY 7 DESC`
  )
);
if (sessionOk) {
  console.log(`Sitzung ${sessionArg}… — Seitenkontext, Antworten, Produkt-Klicks:`);
  const rows = await q(
    `SELECT session_id, event, created_at,
            CASE WHEN event = 'page_context_applied'
                 THEN jsonb_build_object('applied', data->'applied', 'kind', data->'kind', 'resolved', data->'resolved', 'locale', data->'locale', 'pct', data->'pct')
                 WHEN event = 'page_context_answered'
                 THEN jsonb_build_object('productCards', data->'productCards', 'otherCards', data->'otherCards')
                 ELSE jsonb_build_object('samePage', data->'samePage') END AS daten
       FROM kpi_events
      WHERE event IN ('page_context_applied', 'page_context_answered', 'product_cta_clicked')
        AND session_id LIKE $2 || '%' AND created_at >= ${SINCE}
      ORDER BY created_at LIMIT 50`,
    [sessionArg]
  );
  table(rows.map((r) => ({ sitzung: short(r.session_id), event: r.event, zeit: r.created_at, daten: JSON.stringify(r.daten) })));
}
