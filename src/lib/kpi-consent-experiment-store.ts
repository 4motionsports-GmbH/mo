// Welcome-voucher test and welcome-code redemptions for the KPI tab's
// „Einwilligung nach der Anmeldung“ section (OPTIN_REWARD T6). Read-only.
//
// Its own file because the code count reads the order ledger
// (customer_orders, identified data — aggregate output only), and kpi-store.ts
// promises to stay on the pseudonymous Cluster A tables.
//
//   getConsentExperiment — intention-to-treat per assigned variant: every
//     signed-in session the ask may be offered to (server event
//     consent_ask_eligible, consent-ask-kpi.ts) with its FIRST assigned
//     variant; opt-in, DOI mail and confirmation in the same session within
//     MARKETING_DOI_EXPIRY_DAYS after it; folded by consent-experiment.mjs.
//     Orders / revenue per arm are deliberately not included (open option:
//     customer_session_links → customer_orders, 30-day window, aggregate only,
//     after the owner's OK).
//   getWelcomeCodeStats — orders of the order copy in the period with a
//     welcome code (WELCOME_CODE_MATCH, welcome-code-match.mjs); „n/a“
//     without a pattern. „Ausgegeben“ is not knowable in Mo (the codes come
//     from a Shopify-side automation).

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import type { KpiRange } from "./kpi-range";
import {
  KPI_CONSENT_ASK_ELIGIBLE,
  KPI_EMAIL_CAPTURE_MARKETING_CONFIRMED,
  KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN,
} from "./kpi-events";
import { doiExpiryDays } from "./email-capture-store";
import { isKnownSigninVariant } from "./consent-variants.mjs";
import {
  CONSENT_REWARD_EXPERIMENT,
  summariseConsentExperiment,
  type ConsentRewardExperiment,
} from "./consent-experiment.mjs";
import { parseWelcomeCodeMatch, welcomeCodeLikePatterns } from "./welcome-code-match.mjs";

/** Eligible sessions folded at most (the rest is reported as truncated). */
const CONSENT_EXPERIMENT_MAX = 20_000;

export type ConsentExperimentSummary = ReturnType<typeof summariseConsentExperiment>;

export interface ConsentExperimentKpis extends ConsentExperimentSummary {
  /** Days after eligibility in which an opt-in / confirmation counts (MARKETING_DOI_EXPIRY_DAYS). */
  windowDays: number;
  /** More than CONSENT_EXPERIMENT_MAX eligible sessions in the period (the latest are left out). */
  truncated: boolean;
}

/**
 * The welcome-voucher test over the period's eligible sessions. Null without a
 * database or on failure.
 */
export async function getConsentExperiment(
  range: KpiRange,
  sql: Sql | null = getSql()
): Promise<ConsentExperimentKpis | null> {
  if (!sql) return null;
  try {
    const experiment = CONSENT_REWARD_EXPERIMENT as ConsentRewardExperiment | null;
    const start = experiment?.start ?? "1970-01-01";
    const days = Math.max(1, Math.floor(doiExpiryDays()) || 7);
    const rows = (await sql`
      WITH s AS (
        SELECT session_id,
               (array_agg(COALESCE(data->>'variant', '') ORDER BY created_at, id))[1] AS raw_arm,
               count(DISTINCT COALESCE(data->>'variant', '')) > 1 AS mixed,
               (array_agg(COALESCE(data->>'locale', '') ORDER BY created_at, id))[1] AS raw_locale,
               min(created_at) AS at
          FROM kpi_events
         WHERE event = ${KPI_CONSENT_ASK_ELIGIBLE}
           AND session_id IS NOT NULL
           AND session_id NOT LIKE 'livecheck-%'
           AND created_at >= ${range.from}::date
           AND created_at < (${range.to}::date + 1)
         GROUP BY session_id
         ORDER BY min(created_at)
         LIMIT ${CONSENT_EXPERIMENT_MAX + 1}
      ), e AS (
        SELECT * FROM s ORDER BY at LIMIT ${CONSENT_EXPERIMENT_MAX}
      ), f AS (
        SELECT e.*,
               e.at <= now() - make_interval(days => ${days}::int) AS window_closed,
               e.at >= ${start}::date AS after_start,
               EXISTS (
                 SELECT 1 FROM kpi_events o
                  WHERE o.session_id = e.session_id
                    AND o.event = ${KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN}
                    AND o.data->>'trigger' = 'signin_optin'
                    AND o.created_at >= e.at
                    AND o.created_at <= e.at + make_interval(days => ${days}::int)
               ) AS opted_in,
               EXISTS (
                 SELECT 1 FROM kpi_events o
                  WHERE o.session_id = e.session_id
                    AND o.event = ${KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN}
                    AND o.data->>'trigger' = 'signin_optin'
                    AND o.created_at >= e.at
                    AND o.created_at <= e.at + make_interval(days => ${days}::int)
                    AND CASE WHEN o.data->>'outcome' IS NOT NULL
                             THEN o.data->>'outcome' = 'doi_required'
                             ELSE COALESCE((o.data->>'doiRequired')::boolean, o.data->>'doiStatus' = 'pending')
                                  AND COALESCE(o.data->>'doiCooldown', 'false') <> 'true' END
                    AND COALESCE(o.data->>'doiSent', 'true') <> 'false'
               ) AS doi_sent,
               EXISTS (
                 SELECT 1 FROM kpi_events o
                  WHERE o.session_id = e.session_id
                    AND o.event = ${KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN}
                    AND o.data->>'trigger' = 'signin_optin'
                    AND o.created_at >= e.at
                    AND o.created_at <= e.at + make_interval(days => ${days}::int)
                    AND (o.data->>'outcome' IN ('already_confirmed', 'already_subscribed')
                         OR (o.data->>'outcome' IS NULL
                             AND COALESCE((o.data->>'alreadyConfirmed')::boolean, o.data->>'doiStatus' = 'confirmed')))
               ) AS already_subscribed,
               EXISTS (
                 SELECT 1 FROM kpi_events c
                  WHERE c.session_id = e.session_id
                    AND c.event = ${KPI_EMAIL_CAPTURE_MARKETING_CONFIRMED}
                    AND c.created_at >= e.at
                    AND c.created_at <= e.at + make_interval(days => ${days}::int)
               ) AS confirmed
          FROM e
      )
      SELECT CASE WHEN raw_arm ~ '^[a-z0-9_-]{1,32}$' THEN raw_arm
                  WHEN raw_arm = '' THEN '' ELSE '?' END AS arm,
             CASE WHEN raw_locale IN ('de', 'en') THEN raw_locale ELSE '?' END AS locale,
             mixed, after_start, window_closed,
             count(*)::int AS sessions,
             count(*) FILTER (WHERE opted_in)::int AS opted_in,
             count(*) FILTER (WHERE doi_sent)::int AS doi_sent,
             count(*) FILTER (WHERE confirmed)::int AS confirmed,
             count(*) FILTER (WHERE already_subscribed)::int AS already_subscribed,
             (SELECT count(*) FROM s)::int AS considered
        FROM f
       GROUP BY 1, 2, 3, 4, 5
    `) as Array<Record<string, unknown>>;
    const summary = summariseConsentExperiment(
      rows.map((r) => ({
        arm: String(r.arm ?? ""),
        locale: String(r.locale ?? ""),
        mixed: r.mixed === true,
        afterStart: r.after_start === true,
        windowClosed: r.window_closed === true,
        sessions: r.sessions,
        optedIn: r.opted_in,
        doiSent: r.doi_sent,
        confirmed: r.confirmed,
        alreadySubscribed: r.already_subscribed,
      })),
      experiment,
      (id: string) => isKnownSigninVariant(id)
    );
    return {
      ...summary,
      windowDays: days,
      truncated: Number(rows[0]?.considered ?? 0) > CONSENT_EXPERIMENT_MAX,
    };
  } catch (err) {
    reportError(err, { route: "lib/kpi-consent-experiment-store", phase: "getConsentExperiment" });
    return null;
  }
}

export interface WelcomeCodeStats {
  /** WELCOME_CODE_MATCH names at least one code or prefix — otherwise „n/a“. */
  configured: boolean;
  /** Orders of the order copy in the period (not cancelled). */
  orders: number;
  /** Of those, orders with a welcome code; null when not configured. */
  redeemed: number | null;
}

/**
 * Orders in the period that used a welcome code (customer_orders.discount_codes
 * against WELCOME_CODE_MATCH). Aggregate only. Null without a database or on
 * failure; `configured: false` (no query) without a pattern.
 */
export async function getWelcomeCodeStats(
  range: KpiRange,
  sql: Sql | null = getSql()
): Promise<WelcomeCodeStats | null> {
  const match = parseWelcomeCodeMatch(process.env.WELCOME_CODE_MATCH);
  if (!match.enabled) return { configured: false, orders: 0, redeemed: null };
  if (!sql) return null;
  try {
    const exact = match.exact;
    const likes = welcomeCodeLikePatterns(match);
    const rows = (await sql`
      SELECT count(*)::int AS orders,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM unnest(discount_codes) AS d(code)
                WHERE upper(btrim(d.code)) = ANY(${exact}::text[])
                   OR upper(btrim(d.code)) LIKE ANY(${likes}::text[])))::int AS redeemed
        FROM customer_orders
       WHERE processed_at >= ${range.from}::date
         AND processed_at < (${range.to}::date + 1)
         AND cancelled_at IS NULL
    `) as Array<{ orders: number; redeemed: number }>;
    return { configured: true, orders: Number(rows[0]?.orders ?? 0), redeemed: Number(rows[0]?.redeemed ?? 0) };
  } catch (err) {
    reportError(err, { route: "lib/kpi-consent-experiment-store", phase: "getWelcomeCodeStats" });
    return null;
  }
}
