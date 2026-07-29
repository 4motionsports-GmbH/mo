// KPI aggregation for the admin dashboard's KPI tab (Cluster A — analytics,
// legitimate interest). Pure read-only aggregation over the pseudonymous
// conversations / messages / kpi_events tables. NEVER touches email/Cluster B.
//
// Everything degrades gracefully: when no database is configured getSql() is
// null and the public getters return null so the UI can show an empty state.
//
// Design notes / caveats (mirrored in docs/ADMIN_DASHBOARD.md):
//   - "Daily chats" is windowed (default 30d); the headline totals are all-time
//     (which, given the 180d retention windows, is effectively last-180d).
//   - The in-chat click signals are derived from the widget's fail-silent
//     track() telemetry. The exact event NAMES are owned by the frontend, so we
//     match by PATTERN (see CTA_PATTERN / CART_PATTERN) rather than hard-coding a
//     single string, and additionally surface the full event breakdown so an
//     operator can always see the raw truth.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import type { KpiRange } from "./kpi-range";
import {
  KPI_CONSENT_GATE_ACCEPTED,
  KPI_CONSENT_GATE_DECLINED,
  KPI_CONSENT_GATE_DISMISSED,
  KPI_CONSENT_GATE_SHOWN,
  KPI_EMAIL_CAPTURE_ASK_SHOWN,
  KPI_EMAIL_CAPTURE_SUBMITTED,
  KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN,
  KPI_EMAIL_CAPTURE_MARKETING_CONFIRMED,
  KPI_EMAIL_CAPTURE_DECLINED,
  KPI_ACCOUNT_SIGNIN_SUCCEEDED,
  KPI_ACCOUNT_EXPORT_REQUESTED,
  KPI_ACCOUNT_ERASED,
  KPI_CONTACT_FORM_SUBMITTED,
} from "./kpi-events";
// The two headline click-signal shapes — shared with the Gespräche inspector
// and the Komplettanalyse (kpi-event-patterns.mjs) so the definition of a
// "click" can never drift between surfaces.
import { CTA_PATTERNS, CART_PATTERNS } from "./kpi-event-patterns.mjs";

export interface DailyCount {
  /** ISO date (YYYY-MM-DD). */
  day: string;
  count: number;
}

export interface EventCount {
  event: string;
  count: number;
}

export interface StatusBreakdown {
  active: number;
  abandoned: number;
  converted: number;
}

export interface CoreMetrics {
  /** All-time conversation count (one row per chat that sent ≥1 message). */
  totalChats: number;
  /** Daily new-chat counts across the selected window, gap-filled with 0s. */
  chatsByDay: DailyCount[];
  /** Inclusive day count of the selected window (see lib/kpi-range). */
  windowDays: number;
  /** Mean message_count across conversations (user + assistant + tool turns). */
  avgMessagesPerChat: number;
  status: StatusBreakdown;
  /** abandoned / totalChats (0 when no chats). */
  abandonedRate: number;
  /** In-chat product-card / CTA clicks (kpi_events, pattern-matched). */
  productCtaClicks: number;
  /** In-chat add-to-cart / checkout clicks (kpi_events, pattern-matched). */
  addToCartClicks: number;
  /** productCtaClicks / totalChats. */
  productCtaRatePerChat: number;
  /** addToCartClicks / totalChats. */
  addToCartRatePerChat: number;
  /** Distinct sessions that produced ANY telemetry (a proxy for "opened"). */
  sessionsWithTelemetry: number;
  /** Conversations = a message was actually sent. */
  chatsWithMessages: number;
  /** chatsWithMessages / sessionsWithTelemetry (engagement proxy; null if no telemetry). */
  engagementRate: number | null;
  /** Full event-name breakdown (top 20), so the raw telemetry is always visible. */
  topEvents: EventCount[];
}


function ratePerChat(numerator: number, totalChats: number): number {
  return totalChats > 0 ? numerator / totalChats : 0;
}

/**
 * Aggregate the core dashboard metrics in a handful of round-trips. Returns null
 * when no DB is configured or on a hard failure (the caller renders an empty
 * state rather than crashing the page).
 *
 * Scoped to the resolved [from, to] window (the date picker — see lib/kpi-range)
 * via `created_at >= from AND created_at < to+1` (i.e. `to` inclusive of the
 * whole day). Both range bounds are calendar dates; conversations has a
 * created_at index (migration 0027) and kpi_events one from migration 0001, so
 * these stay index scans.
 */
export async function getCoreMetrics(
  range: KpiRange,
  sql: Sql | null = getSql()
): Promise<CoreMetrics | null> {
  if (!sql) return null;
  const from = range.from;
  const to = range.to;
  const days = Number.isFinite(range.days) && range.days > 0 ? Math.floor(range.days) : 30;

  try {
    const [totalsRows, dailyRows, statusRows, clickRows, telemetryRows, eventRows] =
      await Promise.all([
        sql`
          SELECT count(*)::int AS total,
                 COALESCE(avg(message_count), 0)::float AS avg_messages
            FROM conversations
           WHERE created_at >= ${from}::date
             AND created_at < (${to}::date + 1)
        `,
        sql`
          SELECT to_char(g.day, 'YYYY-MM-DD') AS day, COALESCE(c.n, 0)::int AS count
            FROM generate_series(
                   ${from}::date,
                   ${to}::date,
                   interval '1 day'
                 ) AS g(day)
            LEFT JOIN (
                   SELECT date_trunc('day', created_at)::date AS day, count(*)::int AS n
                     FROM conversations
                    WHERE created_at >= ${from}::date
                      AND created_at < (${to}::date + 1)
                    GROUP BY 1
                 ) c ON c.day = g.day::date
           ORDER BY g.day
        `,
        sql`
          SELECT status, count(*)::int AS n
            FROM conversations
           WHERE created_at >= ${from}::date
             AND created_at < (${to}::date + 1)
           GROUP BY status
        `,
        sql`
          SELECT
            count(*) FILTER (
              WHERE event ILIKE ${CTA_PATTERNS[0]} OR event ILIKE ${CTA_PATTERNS[1]}
            )::int AS cta,
            count(*) FILTER (
              WHERE event ILIKE ${CART_PATTERNS[0]} OR event ILIKE ${CART_PATTERNS[1]}
            )::int AS cart
            FROM kpi_events
           WHERE created_at >= ${from}::date
             AND created_at < (${to}::date + 1)
        `,
        sql`
          SELECT count(DISTINCT session_id)::int AS sessions
            FROM kpi_events
           WHERE session_id IS NOT NULL
             AND created_at >= ${from}::date
             AND created_at < (${to}::date + 1)
        `,
        sql`
          SELECT event, count(*)::int AS n
            FROM kpi_events
           WHERE created_at >= ${from}::date
             AND created_at < (${to}::date + 1)
           GROUP BY event
           ORDER BY n DESC, event ASC
           LIMIT 20
        `,
      ]);

    const totalChats = Number(totalsRows[0]?.total ?? 0);
    const avgMessagesPerChat = Number(totalsRows[0]?.avg_messages ?? 0);

    const status: StatusBreakdown = { active: 0, abandoned: 0, converted: 0 };
    for (const r of statusRows as Array<{ status: string; n: number }>) {
      if (r.status === "active" || r.status === "abandoned" || r.status === "converted") {
        status[r.status] = Number(r.n);
      }
    }

    const productCtaClicks = Number(clickRows[0]?.cta ?? 0);
    const addToCartClicks = Number(clickRows[0]?.cart ?? 0);
    const sessionsWithTelemetry = Number(telemetryRows[0]?.sessions ?? 0);

    return {
      totalChats,
      chatsByDay: (dailyRows as Array<{ day: string; count: number }>).map((r) => ({
        day: String(r.day),
        count: Number(r.count),
      })),
      windowDays: days,
      avgMessagesPerChat,
      status,
      abandonedRate: totalChats > 0 ? status.abandoned / totalChats : 0,
      productCtaClicks,
      addToCartClicks,
      productCtaRatePerChat: ratePerChat(productCtaClicks, totalChats),
      addToCartRatePerChat: ratePerChat(addToCartClicks, totalChats),
      sessionsWithTelemetry,
      chatsWithMessages: totalChats,
      engagementRate:
        sessionsWithTelemetry > 0 ? totalChats / sessionsWithTelemetry : null,
      topEvents: (eventRows as Array<{ event: string; n: number }>).map((r) => ({
        event: String(r.event),
        count: Number(r.n),
      })),
    } satisfies CoreMetrics;
  } catch (err) {
    reportError(err, { route: "lib/kpi-store", phase: "getCoreMetrics" });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Consent-gate funnel (v4) — shown → accepted, with decline/dismiss split
// ---------------------------------------------------------------------------

/** Event counts for one gate surface (or the total across surfaces). */
export interface ConsentGateCounts {
  shown: number;
  accepted: number;
  declined: number;
  dismissed: number;
}

export interface ConsentGateFunnel {
  total: ConsentGateCounts;
  /**
   * Split by the widget-reported `data.surface` ("chat" = the in-chat consent
   * gate, "signin" = the at-sign-in opt-in card). Events without a surface (a
   * misbehaving widget) land in neither split but still count in `total`.
   */
  bySurface: { chat: ConsentGateCounts; signin: ConsentGateCounts };
}

const EMPTY_GATE_COUNTS: ConsentGateCounts = {
  shown: 0,
  accepted: 0,
  declined: 0,
  dismissed: 0,
};

/**
 * Aggregate the widget-emitted consent-gate events (consent_gate_shown /
 * _accepted / _declined / _dismissed, each carrying `data.surface`) over the
 * selected window. All four are widget-truth — the backend only observes the
 * accept as an opt-in POST — so this funnel measures the UI, not the DOI
 * outcome (that's the email-capture funnel). Returns null when no DB is
 * configured or on a hard failure.
 */
export async function getConsentGateFunnel(
  range: KpiRange,
  sql: Sql | null = getSql()
): Promise<ConsentGateFunnel | null> {
  if (!sql) return null;
  try {
    const rows = await sql`
      SELECT event,
             COALESCE(data->>'surface', '') AS surface,
             count(*)::int AS n
        FROM kpi_events
       WHERE event IN (${KPI_CONSENT_GATE_SHOWN}, ${KPI_CONSENT_GATE_ACCEPTED},
                       ${KPI_CONSENT_GATE_DECLINED}, ${KPI_CONSENT_GATE_DISMISSED})
         AND created_at >= ${range.from}::date
         AND created_at < (${range.to}::date + 1)
       GROUP BY 1, 2
    `;

    const funnel: ConsentGateFunnel = {
      total: { ...EMPTY_GATE_COUNTS },
      bySurface: { chat: { ...EMPTY_GATE_COUNTS }, signin: { ...EMPTY_GATE_COUNTS } },
    };
    const keyByEvent: Record<string, keyof ConsentGateCounts> = {
      [KPI_CONSENT_GATE_SHOWN]: "shown",
      [KPI_CONSENT_GATE_ACCEPTED]: "accepted",
      [KPI_CONSENT_GATE_DECLINED]: "declined",
      [KPI_CONSENT_GATE_DISMISSED]: "dismissed",
    };
    for (const r of rows as Array<{ event: string; surface: string; n: number }>) {
      const key = keyByEvent[r.event];
      if (!key) continue;
      const n = Number(r.n);
      funnel.total[key] += n;
      if (r.surface === "chat" || r.surface === "signin") {
        funnel.bySurface[r.surface][key] += n;
      }
    }
    return funnel;
  } catch (err) {
    reportError(err, { route: "lib/kpi-store", phase: "getConsentGateFunnel" });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Email-capture funnel — ask → submitted → marketing opt-in → DOI confirmed
// ---------------------------------------------------------------------------

export interface EmailCaptureFunnel {
  /** Mo made the email-summary offer (server-emitted, one per tool call). */
  askShown: number;
  /** The user submitted the capture form (transactional consent). */
  submitted: number;
  /** The user also ticked the separate marketing checkbox (pre-DOI intent). */
  marketingOptedIn: number;
  /** The user clicked the DOI link — marketing consent confirmed. */
  confirmed: number;
  /** Widget-emitted: the capture card was dismissed/declined. */
  declined: number;
  /** submitted / askShown — null when nothing was asked. */
  submitRate: number | null;
  /** confirmed / marketingOptedIn — null when nobody opted in. */
  doiRate: number | null;
  /** askShown split by the offer trigger (data.trigger from the tool call);
   * events without a trigger land under "unknown". */
  asksByTrigger: Array<{ trigger: string; count: number }>;
}

/**
 * Aggregate the five canonical email-capture events (lib/kpi-events) over the
 * selected window. Counts are per-event, not per-session — each stage counts
 * events INSIDE the window, so a DOI click confirming yesterday's opt-in counts
 * in today's `confirmed` (documented in the UI caveat; the stages are close
 * enough in time that the funnel reads correctly at every practical window).
 * Returns null when no DB is configured or on a hard failure.
 */
export async function getEmailCaptureFunnel(
  range: KpiRange,
  sql: Sql | null = getSql()
): Promise<EmailCaptureFunnel | null> {
  if (!sql) return null;
  try {
    const [countRows, triggerRows] = await Promise.all([
      sql`
        SELECT event, count(*)::int AS n
          FROM kpi_events
         WHERE event IN (${KPI_EMAIL_CAPTURE_ASK_SHOWN}, ${KPI_EMAIL_CAPTURE_SUBMITTED},
                         ${KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN},
                         ${KPI_EMAIL_CAPTURE_MARKETING_CONFIRMED},
                         ${KPI_EMAIL_CAPTURE_DECLINED})
           AND created_at >= ${range.from}::date
           AND created_at < (${range.to}::date + 1)
         GROUP BY event
      `,
      sql`
        SELECT COALESCE(NULLIF(data->>'trigger', ''), 'unknown') AS trigger,
               count(*)::int AS n
          FROM kpi_events
         WHERE event = ${KPI_EMAIL_CAPTURE_ASK_SHOWN}
           AND created_at >= ${range.from}::date
           AND created_at < (${range.to}::date + 1)
         GROUP BY 1
         ORDER BY n DESC, 1 ASC
      `,
    ]);

    const byEvent: Record<string, number> = {};
    for (const r of countRows as Array<{ event: string; n: number }>) {
      byEvent[r.event] = Number(r.n);
    }
    const askShown = byEvent[KPI_EMAIL_CAPTURE_ASK_SHOWN] ?? 0;
    const submitted = byEvent[KPI_EMAIL_CAPTURE_SUBMITTED] ?? 0;
    const marketingOptedIn = byEvent[KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN] ?? 0;
    const confirmed = byEvent[KPI_EMAIL_CAPTURE_MARKETING_CONFIRMED] ?? 0;

    return {
      askShown,
      submitted,
      marketingOptedIn,
      confirmed,
      declined: byEvent[KPI_EMAIL_CAPTURE_DECLINED] ?? 0,
      submitRate: askShown > 0 ? submitted / askShown : null,
      doiRate: marketingOptedIn > 0 ? confirmed / marketingOptedIn : null,
      asksByTrigger: (triggerRows as Array<{ trigger: string; n: number }>).map((r) => ({
        trigger: String(r.trigger),
        count: Number(r.n),
      })),
    } satisfies EmailCaptureFunnel;
  } catch (err) {
    reportError(err, { route: "lib/kpi-store", phase: "getEmailCaptureFunnel" });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Language split (de/en) — chats + email captures
// ---------------------------------------------------------------------------

export interface LocaleCount {
  /** 'de' | 'en' | 'unknown' (rows from before the locale columns). */
  locale: string;
  count: number;
}

export interface LocaleSplit {
  /** Conversations in the window by storefront-selected chat language
   * (conversations.locale, migration 0041 — null ⇒ 'unknown'). */
  chats: LocaleCount[];
  /** Email captures in the window by capture locale (migration 0030). */
  captures: LocaleCount[];
}

/**
 * The DE/EN dimension over the window: chats by conversations.locale and
 * captures by email_captures.locale. Counts only — the capture side reads no
 * email/identity value (Cluster-B table, but a pure GROUP BY over locale).
 * Returns null when no DB is configured or on a hard failure.
 */
export async function getLocaleSplit(
  range: KpiRange,
  sql: Sql | null = getSql()
): Promise<LocaleSplit | null> {
  if (!sql) return null;
  try {
    const [chatRows, captureRows] = await Promise.all([
      sql`
        SELECT COALESCE(locale, 'unknown') AS locale, count(*)::int AS n
          FROM conversations
         WHERE created_at >= ${range.from}::date
           AND created_at < (${range.to}::date + 1)
         GROUP BY 1
         ORDER BY n DESC, 1 ASC
      `,
      sql`
        SELECT COALESCE(locale, 'unknown') AS locale, count(*)::int AS n
          FROM email_captures
         WHERE created_at >= ${range.from}::date
           AND created_at < (${range.to}::date + 1)
         GROUP BY 1
         ORDER BY n DESC, 1 ASC
      `,
    ]);
    const map = (rows: unknown) =>
      (rows as Array<{ locale: string; n: number }>).map((r) => ({
        locale: String(r.locale),
        count: Number(r.n),
      }));
    return { chats: map(chatRows), captures: map(captureRows) } satisfies LocaleSplit;
  } catch (err) {
    reportError(err, { route: "lib/kpi-store", phase: "getLocaleSplit" });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Customer-account activity — sign-ins, GDPR self-service, summaries
// ---------------------------------------------------------------------------

export interface AccountActivity {
  /** Completed sign-ins (OAuth callback success), incl. silent re-detects. */
  signins: number;
  /** Of those, prompt=none silent already-signed-in detections. */
  silentSignins: number;
  /** GDPR data exports downloaded (Art. 15/20 self-service). */
  exports: number;
  /** Full self-service erasures completed (Art. 17). */
  erasures: number;
  /** Contact-form submissions accepted (widget hand-over). */
  contactFormSubmissions: number;
  /** Chat-summary PDFs downloaded by signed-in customers (ai_usage). */
  summaryDownloads: number;
  /** Chat-summary emails generated after a capture (ai_usage). */
  summaryEmails: number;
}

/**
 * Windowed account/self-service usage: the server-emitted kpi_events from the
 * auth callback, export/erase routes and the contact form, plus the two
 * summary call sites from ai_usage (each generation = one row = one delivered
 * summary). Returns null when no DB is configured or on a hard failure.
 */
export async function getAccountActivity(
  range: KpiRange,
  sql: Sql | null = getSql()
): Promise<AccountActivity | null> {
  if (!sql) return null;
  try {
    const [eventRows, usageRows] = await Promise.all([
      sql`
        SELECT event,
               count(*)::int AS n,
               count(*) FILTER (WHERE data->>'silent' = 'true')::int AS silent
          FROM kpi_events
         WHERE event IN (${KPI_ACCOUNT_SIGNIN_SUCCEEDED}, ${KPI_ACCOUNT_EXPORT_REQUESTED},
                         ${KPI_ACCOUNT_ERASED}, ${KPI_CONTACT_FORM_SUBMITTED})
           AND created_at >= ${range.from}::date
           AND created_at < (${range.to}::date + 1)
         GROUP BY event
      `,
      sql`
        SELECT call_site, count(*)::int AS n
          FROM ai_usage
         WHERE call_site IN ('summary_download', 'summary_email')
           AND created_at >= ${range.from}::date
           AND created_at < (${range.to}::date + 1)
         GROUP BY call_site
      `,
    ]);

    const activity: AccountActivity = {
      signins: 0,
      silentSignins: 0,
      exports: 0,
      erasures: 0,
      contactFormSubmissions: 0,
      summaryDownloads: 0,
      summaryEmails: 0,
    };
    for (const r of eventRows as Array<{ event: string; n: number; silent: number }>) {
      const n = Number(r.n);
      if (r.event === KPI_ACCOUNT_SIGNIN_SUCCEEDED) {
        activity.signins = n;
        activity.silentSignins = Number(r.silent);
      } else if (r.event === KPI_ACCOUNT_EXPORT_REQUESTED) activity.exports = n;
      else if (r.event === KPI_ACCOUNT_ERASED) activity.erasures = n;
      else if (r.event === KPI_CONTACT_FORM_SUBMITTED) activity.contactFormSubmissions = n;
    }
    for (const r of usageRows as Array<{ call_site: string; n: number }>) {
      if (r.call_site === "summary_download") activity.summaryDownloads = Number(r.n);
      else if (r.call_site === "summary_email") activity.summaryEmails = Number(r.n);
    }
    return activity;
  } catch (err) {
    reportError(err, { route: "lib/kpi-store", phase: "getAccountActivity" });
    return null;
  }
}
