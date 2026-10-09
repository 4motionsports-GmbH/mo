#!/usr/bin/env node
// Read-only live checks after a widget release, straight from kpi_events and
// consent_events — the queries behind docs/ROLLOUT_TODO.md 1.11 (live check
// after a widget upload). Only SELECTs (with `--shopify` also read-only Admin API
// queries); no names, e-mail addresses, discount codes or message text are
// printed (session ids are shortened).
//
//   npm run verify:live                       (since 2026-10-04, Europe/Berlin)
//   npm run verify:live -- --since 2026-10-05
//   npm run verify:live -- --since 2026-10-05 --session <sid prefix>   (sections 3, 9 and 10)
//   npm run verify:live -- --ran-at <ISO>     (V2/V2b against that retention run)
//   npm run verify:live -- --since <T2 deploy time> [--shopify] [--cooldown <min>]
//        [--welcome-tag <tag>] [--welcome-code <PREFIX>] [--sample <n>]       (section 10)
//
// Sections: 1 sign-in chain + diagnosis (login_gate_shown split by teaser; popup
// funnel by the first popup's teaser), 3 consent (consent_gate_* by surface /
// placement / reward; confirmations by source / variant / placement) + no
// widget-sent erasures, 4 campaign chat starts (once per send), 5 contact form,
// 6 order status, 7 order attribution (pre-checks P1–P6; after migration 0076
// the live checks V0, V2/V2b, V3, V4 and the kept tokens), 8 shop-login
// recognition (App Proxy, P0.3; manual whoami checks with session=livecheck-…
// never count), 9 page context on typed product-page messages (A3) + product
// clicks by samePage, 10 „Einmal-Garantie“ (OPTIN_REWARD T2.7): DOI mails per
// address from the mail log (subject match, DOI_MAIL_SUBJECTS) against the
// opt-in events, opt-ins with a DOI mail per customer within the resend
// cooldown, confirmations per customer (KPI, consent acts, Shopify writes),
// welcome codes (ledger, else the mirrored Shopify tag and redemptions from the
// order ledger) and C.29 (lost shop sign-up consent). `--session <prefix>` adds
// one session's rows to sections 3 (sign-in popup, consent ask, opt-in and
// confirmation with variant / placement / reward / teaser), 9 and 10 (per
// customer). V2/V2b read against the latest nightly retention run (03:30 UTC,
// vercel.json) unless `--ran-at` names the `ranAt` of the cron log; window and
// cap come from .env (defaults 30 + 7 and 180 days).
//
// Section 10 options: the cooldown is `--cooldown <min>`, else
// MARKETING_DOI_RESEND_COOLDOWN_MINUTES from .env (default 30; the script says
// which — pass the Vercel value), clamped below the link's life like the app.
// `--welcome-tag <tag>` names the tag the shop's welcome automation sets:
// given, a confirmed customer without it in the live read (`--shopify`) is a
// finding (⚑); without it the default welcome_code_issued is only counted.
// `--welcome-code <PREFIX>` counts orders with a code of that prefix (codes are
// never printed). `--since` takes a day (midnight Europe/Berlin) or an ISO time
// with zone, e.g. the deploy time 2026-10-09T14:05+02:00. Options take their
// value after a space; an unknown option, a missing or invalid value stops the
// script (exit 1) instead of falling back to a default.
// `--shopify` reads the live consent and tags of the C.29 candidates, the
// confirmed customers and the `--session` customers from the Admin API
// (read-only, client credentials, read_customers; at most `--sample` candidates,
// default 50, max 250). Before the T2 deploy every accept sent a DOI mail, so
// use `--since <deploy time>` for the acceptance; erasure deletes the evidence,
// so run `--session` before „Meine Daten löschen“.

import { neon, neonConfig } from "@neondatabase/serverless";
import { SIGNIN_DIAGNOSIS, classifySigninSession } from "../src/lib/kpi-widget-events.mjs";
import { parseRetentionOptions } from "../src/lib/retention-options.mjs";
import { CONSULTATION_ANCHOR_TOOLS, SESSION_ANCHORED_SOURCES } from "../src/lib/order-attribution.mjs";
import { DOI_MAIL_SUBJECTS } from "../src/lib/consent-copy-core.mjs";
import {
  MAX_DOI_RESEND_COOLDOWN_MINUTES,
  effectiveDoiResendCooldownMinutes,
  parseDoiResendCooldownMinutes,
} from "../src/lib/doi-cooldown.mjs";
import { c29Verdict, consentWebhookVerdict, welcomeVerdict } from "../src/lib/once-guarantee.mjs";
import { customerGid, mapShopifyConsent } from "../src/lib/shopify-customer-map.mjs";

if (process.env.NEON_FETCH_ENDPOINT) neonConfig.fetchEndpoint = process.env.NEON_FETCH_ENDPOINT;

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
  console.error("DATABASE_URL fehlt (.env).");
  process.exit(1);
}
const sql = neon(url);
const args = process.argv.slice(2);
/** Stop on an unusable option instead of silently checking with a default. */
const usage = (message) => {
  console.error(`${message} — siehe die Hinweise oben in scripts/verify-live-kpis.mjs.`);
  process.exit(1);
};
const VALUE_FLAGS = ["--since", "--ran-at", "--session", "--cooldown", "--welcome-tag", "--welcome-code", "--sample"];
for (const a of args) {
  if (!a.startsWith("--")) continue;
  if (a.includes("=")) usage(`„${a}“: den Wert mit Leerzeichen angeben (${a.slice(0, a.indexOf("="))} <Wert>)`);
  if (!VALUE_FLAGS.includes(a) && a !== "--shopify") usage(`unbekannte Option „${a}“`);
}
/** The value after a flag: undefined without the flag; stops when the flag has no value. */
const argValue = (name) => {
  if (!args.includes(name)) return undefined;
  const v = args[args.indexOf(name) + 1];
  if (v == null || v.startsWith("--") || v.trim() === "") usage(`${name} ohne Wert`);
  return v.trim();
};
// --since: a day (midnight Europe/Berlin) or an ISO timestamp with zone (the deploy time).
const sinceArg = argValue("--since") ?? null;
const SINCE_DAY = /^\d{4}-\d{2}-\d{2}$/;
const SINCE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
const validDay = (d) => SINCE_DAY.test(d) && !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
if (sinceArg != null && !validDay(sinceArg) && !(SINCE_ISO.test(sinceArg) && validDay(sinceArg.slice(0, 10)) && !Number.isNaN(Date.parse(sinceArg)))) {
  usage(`--since „${sinceArg}“ ist weder ein Tag (2026-10-08) noch ein ISO-Zeitpunkt mit Zone (2026-10-08T14:05:00+02:00)`);
}
const since = sinceArg ?? "2026-10-04";
/** The retention run V2/V2b read against: `--ran-at <ISO>`, else the latest 03:30 UTC. */
const ranAtArg = argValue("--ran-at") ?? null;
if (ranAtArg != null && Number.isNaN(Date.parse(ranAtArg))) usage(`--ran-at „${ranAtArg}“ ist kein Zeitpunkt (ranAt aus dem Cron-Log)`);
const ranAt = (() => {
  if (ranAtArg != null) return new Date(ranAtArg).toISOString();
  const now = new Date();
  const run = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 3, 30));
  if (run > now) run.setUTCDate(run.getUTCDate() - 1);
  return run.toISOString();
})();

// Section 10: the resend cooldown — `--cooldown`, else the shared parser over .env;
// clamped below the link's life as in the app (effectiveDoiResendCooldownMinutes).
/** A whole number of minutes the parser accepts as given (not its fallback). */
const validCooldown = (raw) => /^\d+$/.test(raw) && Number(raw) >= 1 && Number(raw) <= MAX_DOI_RESEND_COOLDOWN_MINUTES;
const cooldownArg = argValue("--cooldown") ?? "";
if (cooldownArg !== "" && !validCooldown(cooldownArg)) {
  usage(`--cooldown „${cooldownArg}“ ist keine ganze Minutenzahl von 1 bis ${MAX_DOI_RESEND_COOLDOWN_MINUTES}`);
}
const cooldownEnv = String(process.env.MARKETING_DOI_RESEND_COOLDOWN_MINUTES ?? "").trim();
const expiryDaysRaw = Number.parseInt(String(process.env.MARKETING_DOI_EXPIRY_DAYS ?? ""), 10);
const expiryDays = Number.isFinite(expiryDaysRaw) && expiryDaysRaw >= 1 ? expiryDaysRaw : 7;
const cooldownGiven = cooldownArg !== "" ? Number(cooldownArg) : parseDoiResendCooldownMinutes(cooldownEnv);
const cooldown = effectiveDoiResendCooldownMinutes(cooldownGiven, expiryDays);
const cooldownSource =
  (cooldownArg !== ""
    ? "aus --cooldown"
    : validCooldown(cooldownEnv)
      ? "aus .env (MARKETING_DOI_RESEND_COOLDOWN_MINUTES; falls Vercel abweicht: --cooldown)"
      : `Standard${cooldownEnv ? " (Angabe in .env ungültig)" : ""} — den Vercel-Wert mit --cooldown angeben`) +
  (cooldown !== cooldownGiven
    ? `; auf ${cooldown} min begrenzt — der Link gilt ${expiryDays} Tag(e), MARKETING_DOI_EXPIRY_DAYS`
    : "");
// Section 10d: the tag the Shopify automation sets (a Shopify tag: no comma, at most 255
// characters). Given explicitly, a confirmed customer without it is a finding (⚑) in the
// live read (--shopify); with the default name it is only counted — the shop's automation
// may tag differently.
const welcomeTagArg = argValue("--welcome-tag");
const tagRequired = welcomeTagArg !== undefined;
if (tagRequired && !/^[^,]{1,255}$/u.test(welcomeTagArg)) usage(`--welcome-tag „${welcomeTagArg}“ ist kein Shopify-Tag (1–255 Zeichen, kein Komma)`);
const welcomeTag = tagRequired ? welcomeTagArg : "welcome_code_issued";
const welcomeCodeArg = argValue("--welcome-code") ?? null;
if (welcomeCodeArg != null && !/^[A-Za-z0-9_-]{2,32}$/.test(welcomeCodeArg)) {
  usage(`--welcome-code „${welcomeCodeArg}“ ist kein Code-Präfix (2–32 Zeichen A–Z, 0–9, _ und -)`);
}
const welcomeCode = welcomeCodeArg;
const sampleRaw = argValue("--sample") ?? null;
if (sampleRaw != null && !(/^\d+$/.test(sampleRaw) && Number(sampleRaw) >= 1 && Number(sampleRaw) <= 250)) {
  usage(`--sample „${sampleRaw}“ ist keine Zahl von 1 bis 250`);
}
const sample = sampleRaw != null ? Number(sampleRaw) : 50;
const withShopify = args.includes("--shopify");
/** `--session <prefix>`: one session's rows in sections 3, 9 and 10. */
const sessionArg = argValue("--session") ?? "";
const sessionOk = /^[A-Za-z0-9_-]{4,64}$/.test(sessionArg);
if (sessionArg !== "" && !sessionOk) usage(`--session „${sessionArg}“ ist kein Sitzungs-Präfix (4–64 Zeichen A–Z, 0–9, _ und -)`);

/** The lower bound of every query: midnight Europe/Berlin of a `--since` day, or the given instant. */
// A day is midnight Europe/Berlin; anything else was checked above as an ISO timestamp with zone.
const SINCE = `(CASE WHEN $1::text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                    THEN (left($1::text, 10)::date)::timestamp AT TIME ZONE 'Europe/Berlin'
                    ELSE $1::text::timestamptz END)`;
const q = (text, params = []) => sql.query(text, [since, ...params]);
// Postgres decides the instant (e.g. an offset it does not accept) before any section runs.
try {
  await q(`SELECT ${SINCE} AS t`);
} catch (err) {
  if (/timestamp|time zone|date|out of range/i.test(String(err?.message ?? ""))) {
    usage(`--since „${since}“ versteht die Datenbank nicht als Zeitpunkt`);
  }
  throw err;
}
const short = (s) => (typeof s === "string" ? `${s.slice(0, 8)}…` : s);
const head = (t) => console.log(`\n=== ${t} ===`);
/** console.table, or one line when there is nothing to show. */
const table = (rows) => (rows.length ? console.table(rows) : console.log("  (keine Zeilen)"));

console.log(`Live-Check ab ${since}${SINCE_DAY.test(since) ? " (Europe/Berlin)" : ""}`);

// ---------------------------------------------------------------------------
head("1 · Anmeldung: Kette started → succeeded → return → linked");
table(
  await q(
    `SELECT event,
            COALESCE(data->>'result', data->>'kind', data->>'reason', data->>'source',
                     CASE WHEN data->>'teaser' = 'true' THEN 'teaser' END, '') AS detail,
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

console.log("\nAnmelde-Popup-Funnel (Sitzungen; gutschein_hinweis = Teaser im ersten Popup der Sitzung, Widget 495fdf6 + Text v6):");
table(
  await q(
    `WITH s AS (
       SELECT session_id,
              COALESCE((array_agg(data->>'teaser' ORDER BY created_at, id)
                          FILTER (WHERE event = 'login_gate_shown'))[1] = 'true', false) AS teaser,
              min(created_at) FILTER (WHERE event = 'login_gate_shown') AS shown,
              min(created_at) FILTER (WHERE event = 'login_gate_signin_clicked') AS clicked,
              bool_or(event = 'login_gate_declined') AS declined,
              bool_or(event = 'login_gate_dismissed') AS dismissed
         FROM kpi_events
        WHERE event LIKE 'login_gate_%' AND session_id IS NOT NULL AND created_at >= ${SINCE}
        GROUP BY session_id)
     SELECT CASE WHEN s.teaser THEN 'mit' ELSE 'ohne' END AS gutschein_hinweis,
            count(*) FILTER (WHERE s.shown IS NOT NULL)::int AS angezeigt,
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
       FROM s
      GROUP BY 1 ORDER BY 1 DESC`
  )
);

// ---------------------------------------------------------------------------

head("3 · Einwilligung nach der Anmeldung");
console.log("Einwilligungsfrage nach Oberfläche, Platzierung und Gutschein-Hinweis (gutschein = reward im Widget-Event, ab Text v6):");
table(
  await q(
    `SELECT event, COALESCE(data->>'surface', '(ohne)') AS surface,
            COALESCE(data->>'placement', '') AS platzierung, COALESCE(data->>'reward', '') AS gutschein,
            count(*)::int AS events, count(DISTINCT session_id)::int AS sessions
       FROM kpi_events
      WHERE event LIKE 'consent_gate_%' AND created_at >= ${SINCE}
      GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4`
  )
);
console.log("Wer sich im Chat angemeldet hat — Einwilligungsstand (Popup nur bei marketing_status = none + echter E-Mail + nicht gesperrt; Anti-Nag nicht geprüft):");
table(
  await q(
    `SELECT left(k.session_id, 8) AS sitzung, k.created_at, c.marketing_status, c.email_consent_state,
            c.email NOT LIKE 'shopify:%' AS echte_email,
            EXISTS (SELECT 1 FROM suppression_list s WHERE s.email = c.email) AS gesperrt,
            (c.marketing_status = 'none' AND c.email NOT LIKE 'shopify:%'
             AND NOT EXISTS (SELECT 1 FROM suppression_list s WHERE s.email = c.email)) AS popup_erwartet
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
console.log(
  "Opt-ins nach Quelle und Ergebnis (seit 05.10.: source/outcome; ältere über trigger/doiStatus genähert; " +
    "doi_verschickt nur bei doi_required, „–“ = vor der Versand-Erfassung; doi_pending = Mail der Sperrfrist schon " +
    "unterwegs, shopify_pending = Bestätigungsmail des Shops unterwegs — beide ohne Mo-Mail):"
);
table(
  await q(
    `SELECT COALESCE(data->>'source',
                     CASE data->>'trigger' WHEN 'signin_optin' THEN 'mo_signin' WHEN 'chat_gate' THEN 'mo_chat_gate'
                                           ELSE 'mo_capture_form' END) AS quelle,
            COALESCE(data->>'outcome',
                     CASE WHEN data->>'doiStatus' = 'pending' AND data->>'doiCooldown' = 'true' THEN 'doi_pending (genähert)'
                          WHEN data->>'doiStatus' = 'pending' THEN 'doi_required (genähert)'
                          WHEN data->>'doiStatus' = 'confirmed' THEN 'already_confirmed (genähert)' ELSE 'unbekannt' END) AS ergebnis,
            COALESCE(data->>'doiSent', '–') AS doi_verschickt,
            COALESCE(data->>'variant', '') AS variante, COALESCE(data->>'placement', '') AS platzierung,
            count(*)::int AS events, count(DISTINCT session_id)::int AS sitzungen
       FROM kpi_events
      WHERE event = 'email_capture_marketing_opted_in' AND created_at >= ${SINCE}
      GROUP BY 1, 2, 3, 4, 5 ORDER BY 1, 2, 3`
  )
);
if (sessionOk) {
  console.log(
    `Sitzung ${sessionArg}… — Anmelde-Popup, Einwilligungsfrage, Opt-in und Bestätigung ` +
      "(Variante, Platzierung, Gutschein, Teaser, Sperrfrist, Shop-Prüfung; leere Schlüssel weggelassen):"
  );
  const rows = await q(
    `SELECT session_id, event, created_at,
            jsonb_strip_nulls(jsonb_build_object(
              'surface', data->'surface', 'variant', data->'variant', 'placement', data->'placement',
              'reward', data->'reward', 'teaser', data->'teaser', 'mode', data->'mode', 'valueMoment', data->'valueMoment',
              'source', data->'source', 'outcome', data->'outcome', 'doiSent', data->'doiSent',
              'doiCooldown', data->'doiCooldown', 'doiResend', data->'doiResend', 'shopifyConsent', data->'shopifyConsent',
              'variantMismatch', data->'variantMismatch')) AS daten
       FROM kpi_events
      WHERE (event LIKE 'login_gate_%' OR event LIKE 'consent_gate_%'
             OR event IN ('email_capture_submitted', 'email_capture_marketing_opted_in', 'email_capture_marketing_confirmed',
                          'consent_ask_eligible', 'consent_copy_served'))
        AND session_id LIKE $2 || '%' AND created_at >= ${SINCE}
      ORDER BY created_at, id LIMIT 80`,
    [sessionArg]
  );
  table(rows.map((r) => ({ sitzung: short(r.session_id), event: r.event, zeit: r.created_at, daten: JSON.stringify(r.daten) })));
}
console.log(
  "DOI-Bestätigungen nach Quelle, Variante und Platzierung (Klick auf den Link; Variante/Platzierung vom letzten " +
    "Opt-in der Sitzung mit DOI-Mail, ab dem T6-Deploy; das Opt-in-Event selbst ändert sich nie):"
);
table(
  await q(
    `SELECT COALESCE(data->>'source', '(vor 05.10.)') AS quelle, COALESCE(data->>'variant', '') AS variante,
            COALESCE(data->>'placement', '') AS platzierung, count(*)::int AS bestaetigt,
            min(created_at) AS first, max(created_at) AS last
       FROM kpi_events
      WHERE event = 'email_capture_marketing_confirmed' AND created_at >= ${SINCE}
      GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`
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
// V2/V2b (ATTR-TOKEN-LIFETIME §4.12, archived plan): against the nightly run at
// `ranAt`; a 5-minute margin on every horizon because the run computes its
// cutoffs at its start and stamps ranAt at its end. Same keep rule as
// runRetention (retention.ts), incl. the legacy rows without messages.session_id.
const ret = parseRetentionOptions(process.env);
const horizonDays = ret.attributionWindowDays + 7;
console.log(
  `V2 · Nachtlauf ${ranAt}: Token älter als ${horizonDays} Tage ohne Beratung derselben Sitzung (muss 0 sein); ` +
    `V2b · Token älter als ${ret.attributionTokenMaxDays} Tage (muss 0 sein):`
);
try {
  table(
    await sql.query(
      `SELECT
         (SELECT count(*)::int FROM mo_attribution_tokens t
           WHERE t.created_at < $1::timestamptz - make_interval(days => $2::int) - interval '5 minutes'
             AND NOT (
               t.source = ANY($4::text[]) AND t.session_id IS NOT NULL
               AND t.created_at >= $1::timestamptz - make_interval(days => $3::int) - interval '5 minutes'
               AND (EXISTS (SELECT 1 FROM messages m
                             WHERE m.session_id = t.session_id
                               AND m.created_at >= $1::timestamptz - make_interval(days => $2::int) - interval '5 minutes'
                               AND m.tool_name = ANY($5::text[]))
                    OR EXISTS (SELECT 1 FROM conversations c JOIN messages m ON m.conversation_id = c.id
                                WHERE c.session_id = t.session_id AND m.session_id IS NULL
                                  AND m.created_at >= $1::timestamptz - make_interval(days => $2::int) - interval '5 minutes'
                                  AND m.tool_name = ANY($5::text[]))))) AS v2_ohne_beratung,
         (SELECT count(*)::int FROM mo_attribution_tokens
           WHERE created_at < $1::timestamptz - make_interval(days => $3::int) - interval '5 minutes') AS v2b_ueber_obergrenze`,
      [ranAt, horizonDays, ret.attributionTokenMaxDays, [...SESSION_ANCHORED_SOURCES], [...CONSULTATION_ANCHOR_TOOLS]]
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
console.log("product_cta_clicked nach gleicher Seite (samePage; leer = Widget vor bc7fb5d):");
table(
  await q(
    `SELECT COALESCE(data->>'samePage', '') AS gleiche_seite, count(*)::int AS klicks,
            count(DISTINCT session_id)::int AS sitzungen, max(created_at) AS letzter
       FROM kpi_events WHERE event = 'product_cta_clicked' AND created_at >= ${SINCE}
      GROUP BY 1 ORDER BY 1`
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

// ---------------------------------------------------------------------------
// OPTIN_REWARD T2.7. DOI mails are found in the mail log by subject
// (email_messages has no send kind; DOI_MAIL_SUBJECTS is append-only) and
// grouped by the normalised recipient — the anonymous routes log it as typed.
// The address is grouped on, never selected; codes are never selected either.
head("10 · Einmal-Garantie (eine DOI-Mail je Sperrfrist, eine Bestätigung, ein Willkommens-Code, C.29)");
console.log(
  `Sperrfrist ${cooldown} min (${cooldownSource}). ⚑ = ansehen; ab dem T2-Deploy (--since <Deploy-Zeitpunkt, z. B. 2026-10-09T14:05+02:00>) ` +
    "0 oder jeder erklärt. Nur Kunden-/Erfassungs-Ids und gekürzte Sitzungen."
);
let onceFlags = 0;
/** Adds n to the closing count and renders it („⚑ n“ / „0“). */
const flagged = (n) => {
  onceFlags += n;
  return n > 0 ? `⚑ ${n}` : "0";
};
/**
 * An opt-in whose DOI mail went out — the rule of kpi-events.ts latestDoiOptIn:
 * outcome doi_required and doiSent not false; legacy rows without an outcome
 * by doiStatus pending, unless doiCooldown (no mail within the cooldown).
 */
const DOI_MAIL_SENT = `((k.data->>'outcome' = 'doi_required' AND COALESCE(k.data->>'doiSent', 'true') <> 'false')
                       OR (k.data->>'outcome' IS NULL AND k.data->>'doiStatus' = 'pending'
                           AND COALESCE(k.data->>'doiCooldown', 'false') <> 'true'))`;
/**
 * Opt-in / confirmation event → the address it was about (kpi_events has no
 * customer id). Exact by `captureId` (one capture per address; on every event
 * since this release, kept as the key even when the row is gone); older events
 * without it: the sign-in link only for a sign-in opt-in (its address is the
 * account's), else the event on its own. Two addresses typed in one session (a
 * corrected typo, a capture-form address and a different account) are never
 * merged.
 */
const KPI_CUSTOMER_JOINS = `
       LEFT JOIN email_captures eid
              ON eid.id = CASE WHEN k.data->>'captureId' ~ '^[0-9]{1,18}$' THEN (k.data->>'captureId')::bigint END
       LEFT JOIN customer_session_links l
              ON l.session_id = k.session_id AND k.data->>'source' = 'mo_signin' AND NOT (k.data ? 'captureId')`;
/** The customer of an event joined by KPI_CUSTOMER_JOINS, or NULL. */
const KPI_CUSTOMER = `COALESCE(eid.customer_id, l.customer_id)`;
/** Grouping key: the customer, else the capture (address), else the event itself. */
const KPI_WHO = `COALESCE(${KPI_CUSTOMER}::text, 'c:' || (k.data->>'captureId'), 'e:' || k.id)`;
const doiSubjects = [...DOI_MAIL_SUBJECTS];

// 10a — DOI mails in the mail log per address (the gap reaches back one cooldown before --since).
const doiRows = await q(
  `WITH doi AS (
     SELECT lower(btrim(m.to_address)) AS addr, m.customer_id, m.occurred_at,
            m.occurred_at - lag(m.occurred_at) OVER (PARTITION BY lower(btrim(m.to_address)) ORDER BY m.occurred_at) AS gap
       FROM email_messages m
      WHERE m.direction = 'sent' AND m.subject = ANY($2::text[])
        AND m.occurred_at >= ${SINCE} - make_interval(mins => $3::int))
   SELECT COALESCE(max(d.customer_id), max(c.id)) AS kunde, max(ec.id) AS erfassung,
          count(*) FILTER (WHERE d.occurred_at >= ${SINCE})::int AS mails,
          count(*) FILTER (WHERE d.occurred_at >= ${SINCE} AND d.gap < make_interval(mins => $3::int))::int AS in_sperrfrist,
          date_trunc('second', min(d.gap) FILTER (WHERE d.occurred_at >= ${SINCE}))::text AS min_abstand,
          min(d.occurred_at) FILTER (WHERE d.occurred_at >= ${SINCE}) AS erste, max(d.occurred_at) AS letzte
     FROM doi d
     LEFT JOIN customers c ON c.email = d.addr
     LEFT JOIN email_captures ec ON ec.email = d.addr
    GROUP BY d.addr
   HAVING count(*) FILTER (WHERE d.occurred_at >= ${SINCE}) > 0
    ORDER BY 4 DESC, 3 DESC`,
  [doiSubjects, cooldown]
);
const optStats = (
  await q(
    `SELECT count(*) FILTER (WHERE ${DOI_MAIL_SENT})::int AS verschickt,
            count(*) FILTER (WHERE ${DOI_MAIL_SENT} AND k.data->>'doiResend' = 'true')::int AS erneut,
            count(*) FILTER (WHERE k.data->>'outcome' = 'doi_pending' OR k.data->>'doiCooldown' = 'true')::int AS abgefangen,
            count(*) FILTER (WHERE k.data->>'outcome' = 'shopify_pending')::int AS shop
       FROM kpi_events k
      WHERE k.event = 'email_capture_marketing_opted_in' AND k.created_at >= ${SINCE}`
  )
)[0] ?? { verschickt: 0, erneut: 0, abgefangen: 0, shop: 0 };
const doiMails = doiRows.reduce((s, r) => s + r.mails, 0);
const logDiff = doiMails - optStats.verschickt;
console.log(
  `10a · DOI-Mails von Mo (Mail-Log, Betreff de/en): ${doiMails} an ${doiRows.length} Adresse(n) — laut Opt-in-Events ` +
    `verschickt: ${optStats.verschickt} (davon nach der Sperrfrist erneut: ${optStats.erneut})`
);
if (logDiff !== 0) {
  onceFlags += 1;
  console.log(
    `  ⚑ Mail-Log ${logDiff > 0 ? "+" : ""}${logDiff} gegenüber den Opt-in-Events — ` +
      (logDiff < 0
        ? "weniger im Log: Mitschrift (recordSentMessage), Betreff oder ein fehlgeschlagener Versand ohne doiSent (Chat-Gate) prüfen"
        : "mehr im Log: ein Versandweg ohne Opt-in-Event oder eine andere Mail mit demselben Betreff")
  );
}
console.log(`  mehr als 1 innerhalb der Sperrfrist: ${flagged(doiRows.filter((r) => r.in_sperrfrist > 0).length)} Adresse(n)`);
console.log(`  mehr als 2 im Zeitraum:              ${flagged(doiRows.filter((r) => r.mails > 2).length)} Adresse(n)`);
console.log(
  `  ohne Mo-Mail beantwortet: in der Sperrfrist abgefangen (doi_pending / doiCooldown) ${optStats.abgefangen}, ` +
    `Bestätigungsmail des Shops unterwegs (shopify_pending) ${optStats.shop}`
);
table(
  doiRows
    .filter((r) => r.in_sperrfrist > 0 || r.mails > 2)
    .slice(0, 25)
    .map((r) => ({
      kunde: r.kunde ?? "–",
      erfassung: r.erfassung ?? "–",
      mails: r.mails,
      in_sperrfrist: r.in_sperrfrist,
      min_abstand: r.min_abstand ?? "",
      erste: r.erste,
      letzte: r.letzte,
    }))
);

// 10b — opt-ins that sent a DOI mail, per customer (no customer: per session).
const optRows = await q(
  `WITH o AS (
     SELECT k.id, k.session_id, k.created_at, COALESCE(k.data->>'source', '') AS quelle,
            ${KPI_CUSTOMER}::text AS kunde, ${KPI_WHO} AS who
       FROM kpi_events k ${KPI_CUSTOMER_JOINS}
      WHERE k.event = 'email_capture_marketing_opted_in' AND ${DOI_MAIL_SENT}
        AND k.created_at >= ${SINCE} - make_interval(mins => $2::int)),
   g AS (
     SELECT o.*, created_at - lag(created_at) OVER (PARTITION BY who ORDER BY created_at) AS gap
       FROM o)
   SELECT max(kunde) AS kunde, CASE WHEN who LIKE 'c:%' THEN substr(who, 3) END AS erfassung,
          CASE WHEN max(kunde) IS NULL THEN min(session_id) END AS sitzung,
          count(DISTINCT session_id) FILTER (WHERE created_at >= ${SINCE})::int AS sitzungen,
          count(*) FILTER (WHERE created_at >= ${SINCE})::int AS opt_ins_mit_doi,
          count(*) FILTER (WHERE created_at >= ${SINCE} AND gap < make_interval(mins => $2::int))::int AS in_sperrfrist,
          date_trunc('second', min(gap) FILTER (WHERE created_at >= ${SINCE}))::text AS min_abstand,
          string_agg(DISTINCT quelle, ',') AS quellen
     FROM g GROUP BY who
   HAVING count(*) FILTER (WHERE created_at >= ${SINCE} AND gap < make_interval(mins => $2::int)) > 0
    ORDER BY 6 DESC, 5 DESC`,
  [cooldown]
);
console.log(
  `10b · Opt-ins mit DOI-Mail (email_capture_marketing_opted_in) — mehr als 1 je Kunde innerhalb der Sperrfrist: ` +
    `${flagged(optRows.length)} (je Adresse über die Erfassung des Opt-ins; ältere Events ohne Erfassungs-Id: ` +
    `Anmelde-Opt-ins über die Anmeldung, sonst je Event)`
);
table(optRows.slice(0, 25).map((r) => ({ ...r, kunde: r.kunde ?? "–", erfassung: r.erfassung ?? "–", sitzung: r.sitzung ? short(r.sitzung) : "" })));

// 10c — confirmations per customer: the KPI, the consent act and the Shopify write.
const confRows = await q(
  `WITH kpi AS (
     SELECT ${KPI_CUSTOMER} AS kunde, count(*)::int AS n
       FROM kpi_events k ${KPI_CUSTOMER_JOINS}
      WHERE k.event = 'email_capture_marketing_confirmed' AND k.created_at >= ${SINCE}
      GROUP BY 1),
   acts AS (
     SELECT customer_id AS kunde, count(*)::int AS n,
            round(extract(epoch FROM max(occurred_at) - min(occurred_at)))::int AS spanne_s
       FROM consent_events
      WHERE state = 'subscribed' AND level = 'confirmed_opt_in'
        AND source IN ('mo_signin', 'mo_chat_gate', 'mo_capture_form', 'mo')
        AND (origin_ref = 'doi' OR origin_ref LIKE 'email_capture:%')
        AND recorded_at >= ${SINCE} AND customer_id IS NOT NULL
      GROUP BY 1),
   pushes AS (
     SELECT customer_id AS kunde, count(*)::int AS n
       FROM shopify_outbox
      WHERE kind IN ('consent_update', 'customer_create') AND payload->>'state' = 'subscribed'
        AND status = 'done' AND created_at >= ${SINCE}
        AND customer_id IS NOT NULL
      GROUP BY 1)
   SELECT COALESCE(kpi.kunde, acts.kunde, pushes.kunde)::text AS kunde,
          COALESCE(kpi.n, 0) AS kpi_bestaetigt, COALESCE(acts.n, 0) AS einwilligungsakte,
          acts.spanne_s, COALESCE(pushes.n, 0) AS shopify_schreibvorgaenge
     FROM kpi
     FULL JOIN acts ON acts.kunde = kpi.kunde
     FULL JOIN pushes ON pushes.kunde = COALESCE(kpi.kunde, acts.kunde)`
);
const confFlag = confRows.filter(
  (r) => r.kunde != null && (r.kpi_bestaetigt > 1 || r.einwilligungsakte > 1 || r.shopify_schreibvorgaenge > 1)
);
const confirmedCustomers = confRows
  .filter((r) => r.kunde != null && (r.kpi_bestaetigt > 0 || r.einwilligungsakte > 0))
  .map((r) => r.kunde);
const unmappedConf = confRows.find((r) => r.kunde == null)?.kpi_bestaetigt ?? 0;
console.log(
  `10c · Bestätigungen: ${confirmedCustomers.length} Kunde(n) bestätigt — mehr als 1 Bestätigung, Einwilligungsakt ` +
    `oder Shopify-Schreibvorgang je Kunde: ${flagged(confFlag.length)}` +
    (unmappedConf ? ` (Bestätigungs-Events ohne zuordenbaren Kunden: ${unmappedConf})` : "")
);
table(confFlag.slice(0, 25).map((r) => ({ ...r, spanne_s: r.spanne_s ?? "" })));

// 10d — welcome codes: Mo's ledger (design b) when it exists; design (a) = Shopify's automation.
const ledgerPresent = (await q0(`SELECT to_regclass('welcome_code_ledger') IS NOT NULL AS present`))[0]?.present;
if (ledgerPresent) {
  try {
    const l = (
      await q(
        `SELECT (SELECT count(*)::int FROM welcome_code_ledger WHERE issued_at >= ${SINCE}) AS codes,
                (SELECT count(*)::int FROM (SELECT customer_id FROM welcome_code_ledger
                   WHERE issued_at >= ${SINCE} AND customer_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1) x) AS je_kunde,
                (SELECT count(*)::int FROM (SELECT email_hash FROM welcome_code_ledger
                   WHERE issued_at >= ${SINCE} GROUP BY 1 HAVING count(*) > 1) y) AS je_adresse`
      )
    )[0];
    console.log(
      `10d · Willkommens-Codes von Mo (welcome_code_ledger): ${l.codes} — mehr als 1 je Kunde: ${flagged(l.je_kunde)}, ` +
        `je Adresse (email_hash): ${flagged(l.je_adresse)}`
    );
  } catch (err) {
    console.log(`10d · welcome_code_ledger vorhanden, aber nicht lesbar (erwartet customer_id, email_hash, issued_at): ${err?.message ?? err}`);
  }
} else {
  console.log("10d · Willkommens-Codes: Mo vergibt keine (welcome_code_ledger fehlt) — Aussteller ist Shopify (Design a).");
}
const legacyIssued = (await q(`SELECT count(*)::int AS n FROM customers WHERE welcome_issued_at >= ${SINCE}`))[0]?.n ?? 0;
console.log(`  alter Mo-Pfad (customers.welcome_issued_at, entfernt) im Zeitraum: ${flagged(legacyIssued)} — erwartet 0`);
const welcomeRows = await q(
  `SELECT c.id::text AS kunde, c.shopify_customer_id, c.shopify_tags, c.email_consent_state AS mo_state,
          'mo-welcome-issued' = ANY(c.shopify_tags) AS mo_tag,
          (SELECT max(e.occurred_at) FROM consent_events e
            WHERE e.customer_id = c.id AND e.state = 'subscribed' AND e.level = 'confirmed_opt_in'
              AND (e.origin_ref = 'doi' OR e.origin_ref LIKE 'email_capture:%') AND e.recorded_at >= ${SINCE}) AS confirmed_at,
          (SELECT min(o.done_at) FROM shopify_outbox o
            WHERE o.customer_id = c.id AND o.status = 'done' AND o.kind IN ('consent_update', 'customer_create')
              AND o.payload->>'state' = 'subscribed' AND o.created_at >= ${SINCE}) AS pushed_at
     FROM customers c
    WHERE c.id = ANY($2::bigint[])
    ORDER BY c.id DESC`,
  [confirmedCustomers]
);
// Only a confirmation that changed the consent (a DOI act) is written to Shopify
// and can trigger its automation; a click by someone already subscribed is an
// echo (KPI only, no act, no write).
const actRows = welcomeRows.filter((r) => r.confirmed_at != null);
const mirrorVerdicts = actRows.map((r) => ({
  r,
  v: welcomeVerdict({ confirmedAt: r.confirmed_at, pushedAt: r.pushed_at, tags: r.shopify_tags, tag: welcomeTag, shopify: null, moState: r.mo_state, tagRequired }),
}));
const countKey = (list, key) => list.filter((x) => x.v.key === key).length;
// From the mirror only Mo's own side is a finding (not written / written late);
// a missing tag in the mirror may be lag — the live read (--shopify) decides it.
const moSideFlags = mirrorVerdicts.filter((x) => x.v.key === "not_pushed" || x.v.key === "late_push");
console.log(
  `  Design (a), die ${actRows.length} Bestätigten mit Einwilligungsakt im Spiegel: Tag „${welcomeTag}“ ` +
    `${countKey(mirrorVerdicts, "tagged")}, ohne Tag nach 2 h ${countKey(mirrorVerdicts, "no_tag")} (Spiegel kann ` +
    `nachhängen — live mit --shopify), wartend ${countKey(mirrorVerdicts, "waiting")}, ohne Shopify-Kunde ` +
    `${actRows.filter((r) => !r.shopify_customer_id).length}; ohne neuen Akt (war schon angemeldet) ${welcomeRows.length - actRows.length}`
);
console.log(
  `  nicht oder > 24 h nach der Bestätigung nach Shopify geschrieben (Automation feuert dann vermutlich nicht): ` +
    `${flagged(moSideFlags.length)}; zwei Aussteller (mo-welcome-issued und „${welcomeTag}“): ` +
    `${flagged(welcomeRows.filter((r) => r.mo_tag && (r.shopify_tags ?? []).includes(welcomeTag)).length)}`
);
table(moSideFlags.slice(0, 25).map((x) => ({ kunde: x.r.kunde, befund: x.v.label, bestaetigt: x.r.confirmed_at, geschrieben: x.r.pushed_at })));
if (welcomeCode) {
  const red = (
    await q(
      `WITH w AS (
         SELECT o.customer_id, o.shopify_order_id, upper(c) AS code
           FROM customer_orders o, unnest(o.discount_codes) AS c
          WHERE o.processed_at >= ${SINCE} AND o.cancelled_at IS NULL
            AND left(upper(c), length($2)) = upper($2))
       SELECT count(DISTINCT shopify_order_id)::int AS bestellungen, count(DISTINCT customer_id)::int AS kunden,
              count(DISTINCT customer_id) FILTER (WHERE customer_id = ANY($3::bigint[]))::int AS davon_bestaetigt,
              count(DISTINCT code)::int AS codes,
              (SELECT count(*)::int FROM (SELECT customer_id FROM w WHERE customer_id IS NOT NULL
                 GROUP BY 1 HAVING count(DISTINCT shopify_order_id) > 1) x) AS kunden_mehrfach,
              (SELECT count(*)::int FROM (SELECT code FROM w GROUP BY 1 HAVING count(DISTINCT customer_id) > 1) y) AS codes_mehrere_kunden
         FROM w`,
      [welcomeCode, confirmedCustomers]
    )
  )[0];
  // One shared code for everyone makes „several customers per code“ expected; only unique codes flag it.
  const shared = red.codes <= 1;
  console.log(
    `  Einlösungen (customer_orders.discount_codes, Präfix ${welcomeCode.toUpperCase()}, ohne Stornos): ${red.bestellungen} ` +
      `Bestellung(en) von ${red.kunden} Kunde(n), davon im Zeitraum bestätigt ${red.davon_bestaetigt}; ` +
      `ein Kunde mehrfach: ${flagged(red.kunden_mehrfach)}; ein Code bei mehreren Kunden: ` +
      (shared ? `${red.codes_mehrere_kunden} (ein gemeinsamer Code — erwartet)` : flagged(red.codes_mehrere_kunden))
  );
} else {
  console.log("  Einlösungen: mit --welcome-code <PRÄFIX> (Präfix des Willkommenscodes) aus customer_orders.discount_codes.");
}
console.log(
  "  Hinweis: Ein Tag ist kein Code — ausgegebene Codes zählt nur Shopify (Bericht der Automation); " +
    "Einlösungen über customer_orders.discount_codes."
);

// 10e — C.29: a shop sign-up consent that never reached Mo.
const hooks = await q(
  `SELECT topic, outcome, count(*)::int AS events, max(received_at) AS letzte
     FROM shopify_webhook_events
    WHERE topic IN ('customers/create', 'customers/update', 'customers_email_marketing_consent/update')
      AND received_at >= ${SINCE}
    GROUP BY 1, 2 ORDER BY 1, 3 DESC`
);
const hookKind = (key) =>
  hooks.filter((h) => consentWebhookVerdict(h.outcome).key === key).reduce((s, h) => s + h.events, 0);
console.log(
  `10e · C.29 — Kunden-Webhooks: Shop-Einwilligung verloren (ignored:unknown-customer) ${flagged(hookKind("lost"))}; ` +
    `beim Webhook nachgeladen (…:imported…) ${hookKind("imported")}; gleichzeitige Anlage aufgelöst (raced) ${hookKind("raced")}; ` +
    `Kunden-Sync aus ${hookKind("sync_off")}`
);
table(
  hooks.map((h) => ({
    thema: h.topic,
    ergebnis: h.outcome ?? "(offen)",
    events: h.events,
    befund: consentWebhookVerdict(h.outcome).label,
    letzte: h.letzte,
  }))
);
console.log("  Shopify-Einwilligungsakte nach Webhook-Thema und Stand (welches Thema trägt die Einwilligung):");
table(
  await q(
    `SELECT w.topic AS thema, e.state AS stand, count(*)::int AS akte
       FROM consent_events e
       JOIN shopify_webhook_events w ON w.webhook_id = substr(e.origin_ref, 9)
      WHERE e.origin_ref LIKE 'webhook:%' AND w.received_at >= ${SINCE}
      GROUP BY 1, 2 ORDER BY 1, 2`
  )
);
const precheck = await q(
  `SELECT state AS stand, count(*)::int AS akte, count(DISTINCT customer_id)::int AS kunden
     FROM consent_events
    WHERE origin_ref = 'optin_precheck' AND recorded_at >= ${SINCE}
    GROUP BY 1 ORDER BY 1`
);
console.log(
  `  Vom Opt-in nachgeholt (origin_ref optin_precheck — der Spiegel kannte den Shop-Stand nicht): ` +
    `${flagged(precheck.reduce((s, r) => s + r.kunden, 0))} Kunde(n)`
);
if (precheck.length) table(precheck);
console.log("  Opt-ins nach Shop-Prüfung (shopifyConsent) und Ergebnis (Anmelde-Opt-in; leer = vor dem C.29-Deploy):");
table(
  await q(
    `SELECT COALESCE(data->>'source', '') AS quelle, COALESCE(data->>'shopifyConsent', '') AS shop_pruefung,
            COALESCE(data->>'outcome', '') AS ergebnis, count(*)::int AS events, count(DISTINCT session_id)::int AS sitzungen
       FROM kpi_events
      WHERE event = 'email_capture_marketing_opted_in' AND created_at >= ${SINCE}
        AND (data->>'source' = 'mo_signin' OR data->>'shopifyConsent' IS NOT NULL OR data->>'outcome' = 'shopify_pending')
      GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`
  )
);
const c29 = await q(
  `WITH doi AS (
     SELECT DISTINCT lower(btrim(to_address)) AS addr FROM email_messages
      WHERE direction = 'sent' AND subject = ANY($3::text[]) AND occurred_at >= ${SINCE})
   SELECT c.id::text AS kunde, c.shopify_customer_id, c.email_consent_state AS mo_stand, (doi.addr IS NOT NULL) AS mo_doi_mail
     FROM customers c
     LEFT JOIN doi ON doi.addr = c.email
    WHERE c.shopify_customer_id IS NOT NULL
      AND c.email_consent_state IN ('not_subscribed', 'pending')
      AND (COALESCE(c.shopify_created_at, c.created_at) >= ${SINCE} OR doi.addr IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM consent_events e WHERE e.customer_id = c.id AND e.source = 'shopify')
    ORDER BY (doi.addr IS NOT NULL) DESC, c.id DESC
    LIMIT $2::int`,
  [sample, doiSubjects]
);
console.log(
  `  Kandidaten (Shopify-Kunde, im Zeitraum angelegt oder mit Mo-DOI-Mail, Mo nicht angemeldet, ohne Shopify-Einwilligungsakt; ` +
    `max. ${sample}): ${c29.length}, davon mit Mo-DOI-Mail ${c29.filter((r) => r.mo_doi_mail).length}` +
    (withShopify ? "" : " — den Shopify-Stand liest --shopify")
);
table(c29.slice(0, 25).map((r) => ({ kunde: r.kunde, mo_stand: r.mo_stand, mo_doi_mail: r.mo_doi_mail })));

/**
 * Read-only Admin API access with client credentials (as diagnose-address.mjs).
 * customers(ids) → Map(numeric id → { consent, tags }); null when not found.
 */
async function shopifyReader() {
  const need = ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET", "SHOPIFY_API_VERSION"];
  const missing = need.filter((key) => !process.env[key]?.trim());
  if (missing.length) return { error: `fehlende Variablen: ${missing.join(", ")}` };
  const domain = process.env.SHOPIFY_STORE_DOMAIN.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  let token;
  try {
    const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.SHOPIFY_CLIENT_ID.trim(),
        client_secret: process.env.SHOPIFY_CLIENT_SECRET.trim(),
      }).toString(),
    });
    if (!res.ok) return { error: `Token: HTTP ${res.status}` };
    token = (await res.json()).access_token;
  } catch (err) {
    return { error: `Token: ${err?.cause?.code ?? err?.message ?? err}` };
  }
  if (!token) return { error: "Token: keine Antwort" };
  const url = `https://${domain}/admin/api/${process.env.SHOPIFY_API_VERSION.trim()}/graphql.json`;
  const query = `query MoOnceGuarantee($ids: [ID!]!) {
    nodes(ids: $ids) { ... on Customer { id tags emailMarketingConsent { marketingState marketingOptInLevel consentUpdatedAt } } }
  }`;
  return {
    async customers(ids) {
      const out = new Map();
      const unique = [...new Set(ids.filter(Boolean).map(String))];
      for (let i = 0; i < unique.length; i += 100) {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
          body: JSON.stringify({ query, variables: { ids: unique.slice(i, i + 100).map(customerGid) } }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.errors) throw new Error(`GraphQL HTTP ${res.status} ${JSON.stringify(json.errors ?? "").slice(0, 200)}`);
        for (const node of json.data?.nodes ?? []) {
          if (node?.id) {
            out.set(String(node.id).split("/").pop(), { consent: mapShopifyConsent(node.emailMarketingConsent), tags: node.tags ?? [] });
          }
        }
      }
      return out;
    },
  };
}
const shop = withShopify ? await shopifyReader() : null;
/** The live read, or null after printing why the live part is skipped. */
async function liveCustomers(ids, what) {
  if (!shop || shop.error) return null;
  try {
    return await shop.customers(ids);
  } catch (err) {
    console.log(`  --shopify (${what}): Shopify nicht erreichbar (${err?.message ?? err}) — Live-Teil übersprungen.`);
    return null;
  }
}
if (shop?.error) console.log(`  --shopify: Shopify nicht erreichbar (${shop.error}) — Live-Teil übersprungen.`);
if (shop && !shop.error) {
  const live = await liveCustomers(c29.map((r) => r.shopify_customer_id), "C.29");
  if (live) {
    const verdicts = c29.map((r) => {
      const l = live.get(String(r.shopify_customer_id));
      const v = l
        ? c29Verdict({ moState: r.mo_stand, hasShopifyEvent: false, moDoiMail: r.mo_doi_mail, shopify: l.consent })
        : { flag: false, key: "not_found", label: "in Shopify nicht gefunden" };
      return { kunde: r.kunde, shopify: l?.consent?.state ?? "–", befund: v.label, flag: v.flag };
    });
    console.log(
      `  Live in Shopify (C.29): ${flagged(verdicts.filter((v) => v.flag).length)} von ${verdicts.length} Kandidaten auffällig`
    );
    table(
      verdicts
        .filter((v) => v.flag)
        .slice(0, 25)
        .map((v) => ({ kunde: v.kunde, shopify: v.shopify, befund: v.befund }))
    );
  }
  const welcomeSample = actRows.filter((r) => r.shopify_customer_id).slice(0, sample);
  const tagsLive = await liveCustomers(welcomeSample.map((r) => r.shopify_customer_id), "Willkommens-Tag");
  if (tagsLive) {
    const moFlagged = new Set(moSideFlags.map((x) => x.r.kunde));
    const wv = welcomeSample.map((r) => {
      const l = tagsLive.get(String(r.shopify_customer_id));
      const v = l
        ? welcomeVerdict({ confirmedAt: r.confirmed_at, pushedAt: r.pushed_at, tags: l.tags, tag: welcomeTag, shopify: l.consent, moState: r.mo_state, tagRequired })
        : { flag: true, key: "not_found", label: "in Shopify nicht gefunden" };
      return { kunde: r.kunde, key: v.key, befund: v.label, flag: v.flag };
    });
    // Mo-side findings were counted from the mirror already.
    const liveOnly = wv.filter((v) => v.flag && !moFlagged.has(v.kunde));
    console.log(
      `  Live in Shopify (Willkommens-Tag, Stichprobe ${wv.length} von ${actRows.length}): ` +
        `${wv.filter((v) => v.key === "tagged").length} mit Tag, ${wv.filter((v) => v.key === "no_tag").length} ohne Tag ` +
        `(${tagRequired ? "⚑ — --welcome-tag gesetzt" : "nur gezählt; mit --welcome-tag ein Befund"}), ` +
        `${wv.filter((v) => v.key === "withdrawn").length} später abgemeldet, ${wv.filter((v) => v.key === "waiting").length} wartend, ` +
        `auffällig ${flagged(liveOnly.length)} (zusätzlich zu den oben gezählten)`
    );
    table(liveOnly.slice(0, 25).map((v) => ({ kunde: v.kunde, befund: v.befund })));
  }
}

// --session: the customer(s) behind one session — one T9 case, before its clean-up.
if (sessionOk) {
  const ids = (
    await sql.query(
      `SELECT DISTINCT customer_id::text AS id FROM (
         SELECT customer_id FROM customer_session_links WHERE session_id LIKE $1 || '%'
         UNION SELECT customer_id FROM conversations WHERE session_id LIKE $1 || '%' AND customer_id IS NOT NULL
         UNION SELECT customer_id FROM email_captures WHERE session_id LIKE $1 || '%' AND customer_id IS NOT NULL) x
       ORDER BY 1`,
      [sessionArg]
    )
  ).map((r) => r.id);
  console.log(`\nSitzung ${sessionArg}… — Kunde(n): ${ids.join(", ") || "– (keiner verknüpft; gelöscht?)"}`);
  const perCustomer = await q(
    `SELECT c.id::text AS kunde, c.shopify_customer_id, c.email_consent_state AS stand, c.email_consent_level AS stufe,
            c.email_consent_source AS quelle,
            (SELECT count(*)::int FROM email_messages m WHERE lower(btrim(m.to_address)) = c.email AND m.direction = 'sent'
               AND m.subject = ANY($3::text[]) AND m.occurred_at >= ${SINCE}) AS doi_mails,
            (SELECT count(*)::int FROM consent_events e WHERE e.customer_id = c.id AND e.state = 'subscribed'
               AND e.level = 'confirmed_opt_in' AND (e.origin_ref = 'doi' OR e.origin_ref LIKE 'email_capture:%')
               AND e.recorded_at >= ${SINCE}) AS bestaetigungen,
            (SELECT count(*)::int FROM consent_events e WHERE e.customer_id = c.id AND e.source = 'shopify') AS shopify_akte,
            (SELECT count(*)::int FROM shopify_outbox o WHERE o.customer_id = c.id AND o.status = 'done'
               AND o.payload->>'state' = 'subscribed' AND o.created_at >= ${SINCE}) AS shopify_angemeldet,
            ec.id AS erfassung, ec.marketing_doi_status AS doi_status, ec.doi_sent_at, ec.doi_confirmed_at,
            $4::text = ANY(c.shopify_tags) AS willkommens_tag
       FROM customers c LEFT JOIN email_captures ec ON ec.email = c.email
      WHERE c.id = ANY($2::bigint[])
      ORDER BY c.id`,
    [ids, doiSubjects, welcomeTag]
  );
  // The Shopify id is only for the live read below; ids of Mo rows are printed.
  table(perCustomer.map((r) => Object.fromEntries(Object.entries(r).filter(([key]) => key !== "shopify_customer_id"))));
  for (const id of ids) {
    console.log(`  Kunde ${id} — Verlauf im Zeitraum (DOI-Mails, Einwilligungsakte, Shopify-Outbox):`);
    table(
      await q(
        `SELECT zeit, was, detail FROM (
           SELECT m.occurred_at AS zeit, 'DOI-Mail' AS was, '' AS detail
             FROM email_messages m
            WHERE lower(btrim(m.to_address)) = (SELECT email FROM customers WHERE id = $2::bigint)
              AND m.direction = 'sent' AND m.subject = ANY($3::text[]) AND m.occurred_at >= ${SINCE}
           UNION ALL
           SELECT e.recorded_at, 'Einwilligung',
                  e.source || ' ' || e.state || COALESCE(' ' || e.level, '') || ' (' || COALESCE(split_part(e.origin_ref, ':', 1), '–') || ')'
             FROM consent_events e WHERE e.customer_id = $2::bigint AND e.recorded_at >= ${SINCE}
           UNION ALL
           SELECT o.created_at, 'Shopify-Outbox', o.kind || ' ' || COALESCE(o.payload->>'state', '') || ' → ' || o.status
             FROM shopify_outbox o WHERE o.customer_id = $2::bigint AND o.created_at >= ${SINCE}) t
         ORDER BY zeit LIMIT 40`,
        [id, doiSubjects]
      )
    );
  }
  if (shop && !shop.error && perCustomer.length) {
    const live = await liveCustomers(perCustomer.map((r) => r.shopify_customer_id), "Sitzung");
    if (live) {
      const welcomeById = new Map(welcomeRows.map((r) => [r.kunde, r]));
      table(
        perCustomer.map((r) => {
          const l = r.shopify_customer_id ? live.get(String(r.shopify_customer_id)) : null;
          const w = welcomeById.get(r.kunde);
          return {
            kunde: r.kunde,
            shopify: l?.consent ? `${l.consent.state}${l.consent.level ? ` / ${l.consent.level}` : ""}` : "–",
            c29: c29Verdict({ moState: r.stand, hasShopifyEvent: r.shopify_akte > 0, moDoiMail: r.doi_mails > 0, shopify: l?.consent ?? null }).label,
            willkommen: !w
              ? "im Zeitraum nicht bestätigt"
              : w.confirmed_at == null
                ? "bestätigt ohne neuen Einwilligungsakt (war schon angemeldet)"
                : welcomeVerdict({ confirmedAt: w.confirmed_at, pushedAt: w.pushed_at, tags: l?.tags ?? null, tag: welcomeTag, shopify: l?.consent ?? null, moState: w.mo_state, tagRequired }).label,
          };
        })
      );
    }
  }
}

console.log(
  `\nEinmal-Garantie: ${onceFlags} Hinweis(e) (⚑) — ab dem T2-Deploy 0 oder jeder erklärt ` +
    "(vor dem Deploy schickte jedes Ja eine DOI-Mail: --since <Deploy-Zeitpunkt>)."
);
