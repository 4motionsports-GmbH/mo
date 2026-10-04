#!/usr/bin/env node
// Read-only live checks after a widget release, straight from kpi_events and
// consent_events — the queries behind docs/ROLLOUT_TODO.md „Live-Check nach
// dem Widget-Upload“. Only SELECTs; no names, e-mail addresses or message text
// are printed (session ids are shortened).
//
//   npm run verify:live                       (since 2026-10-04, Europe/Berlin)
//   npm run verify:live -- --since 2026-10-05
//
// Sections: 1 sign-in chain + diagnosis, 3 consent + no widget-sent erasures,
// 4 campaign chat starts (once per send), 5 contact form, 6 order status.

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
          bool_or(event = 'account_signin_link_refused' AND data->>'reason' = 'session_mismatch') AS refused_mismatch,
          bool_or(event = 'account_signin_link_refused' AND COALESCE(data->>'reason', '') <> 'session_mismatch') AS refused_invalid,
          min(created_at) AS first, max(created_at) AS last
     FROM kpi_events
    WHERE event IN ('login_gate_signin_clicked','login_gate_dismissed','account_signin_started','account_signin_succeeded',
                    'account_signin_return','account_signin_linked','account_signin_link_refused')
      AND session_id IS NOT NULL
      AND created_at >= ${SINCE}
    GROUP BY session_id`
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
                 AND k.event = 'account_signin_linked' AND k.created_at >= s.clicked))::int AS im_chat,
            count(*) FILTER (WHERE s.declined)::int AS spaeter,
            count(*) FILTER (WHERE s.dismissed)::int AS weggeklickt
       FROM s`
  )
);

// ---------------------------------------------------------------------------
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
console.log("Opt-ins über /api/account/marketing-opt-in (trigger signin_optin), nach DOI-Status:");
table(
  await q(
    `SELECT event, COALESCE(data->>'doiStatus', '–') AS doi_status, count(*)::int AS events
       FROM kpi_events
      WHERE event IN ('email_capture_submitted', 'email_capture_marketing_opted_in')
        AND data->>'trigger' = 'signin_optin' AND created_at >= ${SINCE}
      GROUP BY 1, 2 ORDER BY 1, 2`
  )
);
console.log("DOI-Bestätigungen (Klick auf den Link; das Opt-in-Event selbst ändert sich nie):");
table(
  await q(
    `SELECT count(*)::int AS bestaetigt, min(created_at) AS first, max(created_at) AS last
       FROM kpi_events
      WHERE event = 'email_capture_marketing_confirmed' AND created_at >= ${SINCE}
     HAVING count(*) > 0`
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
