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
  KPI_ACCOUNT_SIGNIN_LINKED,
  KPI_ACCOUNT_SIGNIN_LINK_REFUSED,
  KPI_ACCOUNT_SHOP_RECOGNISED,
  KPI_ACCOUNT_EXPORT_REQUESTED,
  KPI_ACCOUNT_ERASED,
  KPI_CONTACT_FORM_SUBMITTED,
  KPI_ORDER_STATUS_LOOKUP,
  KPI_PAGE_CONTEXT_APPLIED,
  KPI_PAGE_CONTEXT_ANSWERED,
} from "./kpi-events";
import { PAGE_CONTEXT_EXPERIMENT, summarisePageContextRows } from "./page-context.mjs";
// The two headline click-signal shapes — shared with the Gespräche inspector
// and the Komplettanalyse (kpi-event-patterns.mjs) so the definition of a
// "click" can never drift between surfaces.
import { CTA_PATTERNS, CART_PATTERNS } from "./kpi-event-patterns.mjs";
import {
  ACCOUNT_SIGNIN_RETURN,
  ACCOUNT_SIGNIN_STARTED,
  classifySigninSession,
  LOGIN_GATE_DECLINED,
  LOGIN_GATE_DISMISSED,
  LOGIN_GATE_SHOWN,
  LOGIN_GATE_SIGNIN_CLICKED,
  loginGateRates,
  shopRecognitionRates,
  signinSource,
  normalizeConsentVariantRows,
} from "./kpi-widget-events.mjs";
import { isKnownSigninVariant, normalizePlacement } from "./consent-variants.mjs";
import { OFFER_TRIGGERS, normaliseTrigger } from "./capture-funnel.mjs";

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
  /** Distinct sessions that produced ANY widget telemetry — reach (incl. the
   * interaction-free launcher bounce), not opens. */
  sessionsWithTelemetry: number;
  /** Distinct sessions that opened the chat (`chat_opened`). */
  openedSessions: number;
  /** Distinct sessions in which the visitor wrote (`message_sent`). */
  wroteSessions: number;
  /** Conversations rows (incl. nudge greetings without a visitor message). */
  chatsWithMessages: number;
  /** wroteSessions / openedSessions — open → message (null without opens). */
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
          SELECT count(DISTINCT session_id)::int AS sessions,
                 count(DISTINCT session_id) FILTER (WHERE event = 'chat_opened')::int AS opened,
                 count(DISTINCT session_id) FILTER (WHERE event = 'message_sent')::int AS wrote
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
    const openedSessions = Number(telemetryRows[0]?.opened ?? 0);
    const wroteSessions = Number(telemetryRows[0]?.wrote ?? 0);

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
      openedSessions,
      wroteSessions,
      chatsWithMessages: totalChats,
      // Open → message (docs/frontend/05 §12): the old ratio divided
      // conversations by every session with telemetry, but the launcher bounce
      // fires without an open and nudge greetings create rows without a
      // visitor message.
      engagementRate: openedSessions > 0 ? Math.min(1, wroteSessions / openedSessions) : null,
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
   * Split by the widget-reported `data.surface` ("signin" = the consent popup
   * after a sign-in — the only one the widget shows since 2026-10-01; "chat" =
   * the retired anonymous e-mail gate, kept for older events). Events without a
   * surface (a misbehaving widget) land in neither split but still count in
   * `total`.
   */
  bySurface: { chat: ConsentGateCounts; signin: ConsentGateCounts };
  /**
   * The popup after a sign-in, per SESSION and by how the session signed in:
   * „Anmelden“ in the chat, recognised by the shop login (App Proxy), or no
   * sign-in event at all. accepted is the final state (an accept followed by
   * a dismiss counts once, as accepted); optedIn = the server's opt-in
   * (email_capture_marketing_opted_in, trigger signin_optin) in the period.
   */
  signinByWay: Record<"signin" | "shop" | "unknown", { shown: number; accepted: number; declined: number; optedIn: number }>;
  /** The popup after a sign-in by framing variant and placement (OI3), sessions; display keys normalised. */
  byVariant: ConsentVariantRow[];
}

export interface ConsentVariantRow {
  variant: string;
  placement: string;
  shown: number;
  accepted: number;
  declined: number;
  dismissed: number;
  acceptedWithoutShown: number;
  optedIn: number;
  alreadyConfirmed: number;
  /** Sessions whose opt-in's DOI mail went out (OI1 F3: `doiSent`; rows before
   *  F3 carry none and count when a DOI mail was due) — the DOI-rate base. */
  doiRequired: number;
  doiConfirmed: number;
  variantMismatch: number;
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
    const [rows, wayRows, variantGateRows, variantOptInRows] = await Promise.all([
      sql`
        SELECT event,
               COALESCE(data->>'surface', '') AS surface,
               count(*)::int AS n
          FROM kpi_events
         WHERE event IN (${KPI_CONSENT_GATE_SHOWN}, ${KPI_CONSENT_GATE_ACCEPTED},
                         ${KPI_CONSENT_GATE_DECLINED}, ${KPI_CONSENT_GATE_DISMISSED})
           AND created_at >= ${range.from}::date
           AND created_at < (${range.to}::date + 1)
         GROUP BY 1, 2
      `,
      sql`
        WITH g AS (
          SELECT session_id,
                 bool_or(event = ${KPI_CONSENT_GATE_SHOWN})    AS shown,
                 bool_or(event = ${KPI_CONSENT_GATE_ACCEPTED}) AS accepted,
                 bool_or(event = ${KPI_CONSENT_GATE_DECLINED}) AS declined
            FROM kpi_events
           WHERE event IN (${KPI_CONSENT_GATE_SHOWN}, ${KPI_CONSENT_GATE_ACCEPTED}, ${KPI_CONSENT_GATE_DECLINED})
             AND data->>'surface' = 'signin'
             AND session_id IS NOT NULL
             AND created_at >= ${range.from}::date
             AND created_at < (${range.to}::date + 1)
           GROUP BY session_id
        ), w AS (
          SELECT g.*,
                 EXISTS (SELECT 1 FROM kpi_events l WHERE l.session_id = g.session_id
                            AND l.event = ${KPI_ACCOUNT_SIGNIN_LINKED} AND l.data->>'kind' = 'customer_account') AS via_signin,
                 EXISTS (SELECT 1 FROM kpi_events l WHERE l.session_id = g.session_id
                            AND l.event = ${KPI_ACCOUNT_SIGNIN_LINKED} AND l.data->>'kind' = 'app_proxy') AS via_shop,
                 EXISTS (SELECT 1 FROM kpi_events o WHERE o.session_id = g.session_id
                            AND o.event = ${KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN}
                            AND o.data->>'trigger' = 'signin_optin'
                            AND o.created_at >= ${range.from}::date
                            AND o.created_at < (${range.to}::date + 1)) AS opted_in
            FROM g
        )
        SELECT CASE WHEN via_signin THEN 'signin' WHEN via_shop THEN 'shop' ELSE 'unknown' END AS way,
               count(*) FILTER (WHERE shown)::int                     AS shown,
               count(*) FILTER (WHERE accepted)::int                  AS accepted,
               count(*) FILTER (WHERE declined AND NOT accepted)::int AS declined,
               count(*) FILTER (WHERE opted_in)::int                  AS opted_in
          FROM w
         GROUP BY 1
      `,
      sql`
        WITH gate AS (
          SELECT session_id,
                 CASE WHEN data->>'variant' ~ '^[a-z0-9_-]{1,32}$' THEN data->>'variant'
                      WHEN data ? 'variant' THEN '?' ELSE '' END AS variant,
                 CASE WHEN data->>'placement' ~ '^[a-z_]{1,32}$' THEN data->>'placement'
                      WHEN data ? 'placement' THEN '?' ELSE '' END AS placement,
                 bool_or(event = ${KPI_CONSENT_GATE_SHOWN}) AS shown,
                 bool_or(event = ${KPI_CONSENT_GATE_ACCEPTED}) AS accepted,
                 bool_or(event = ${KPI_CONSENT_GATE_DECLINED}) AS declined,
                 bool_or(event = ${KPI_CONSENT_GATE_DISMISSED}) AS dismissed
            FROM kpi_events
           WHERE event IN (${KPI_CONSENT_GATE_SHOWN}, ${KPI_CONSENT_GATE_ACCEPTED},
                           ${KPI_CONSENT_GATE_DECLINED}, ${KPI_CONSENT_GATE_DISMISSED})
             AND data->>'surface' = 'signin' AND session_id IS NOT NULL
             AND created_at >= ${range.from}::date AND created_at < (${range.to}::date + 1)
           GROUP BY 1, 2, 3)
        SELECT variant, placement,
               count(*) FILTER (WHERE shown)::int AS shown,
               count(*) FILTER (WHERE shown AND accepted)::int AS accepted,
               count(*) FILTER (WHERE shown AND declined AND NOT accepted)::int AS declined,
               count(*) FILTER (WHERE shown AND dismissed AND NOT accepted AND NOT declined)::int AS dismissed,
               count(*) FILTER (WHERE accepted AND NOT shown)::int AS accepted_without_shown
          FROM gate GROUP BY 1, 2
      `,
      sql`
        WITH o AS (
          SELECT session_id,
                 CASE WHEN data->>'variant' ~ '^[a-z0-9_-]{1,32}$' THEN data->>'variant'
                      WHEN data ? 'variant' THEN '?' ELSE '' END AS variant,
                 CASE WHEN data->>'placement' ~ '^[a-z_]{1,32}$' THEN data->>'placement'
                      WHEN data ? 'placement' THEN '?' ELSE '' END AS placement,
                 min(created_at) AS at,
                 bool_or(COALESCE((data->>'alreadyConfirmed')::boolean, data->>'doiStatus' = 'confirmed')) AS already_confirmed,
                 bool_or(COALESCE((data->>'doiRequired')::boolean, data->>'doiStatus' = 'pending')
                         AND COALESCE((data->>'doiSent')::boolean, true)) AS doi_required,
                 bool_or(COALESCE((data->>'variantMismatch')::boolean, false)) AS variant_mismatch
            FROM kpi_events
           WHERE event = ${KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN}
             AND data->>'trigger' = 'signin_optin' AND session_id IS NOT NULL
             AND created_at >= ${range.from}::date AND created_at < (${range.to}::date + 1)
           GROUP BY 1, 2, 3)
        SELECT variant, placement,
               count(*)::int AS opted_in,
               count(*) FILTER (WHERE already_confirmed)::int AS already_confirmed,
               count(*) FILTER (WHERE doi_required)::int AS doi_required,
               count(*) FILTER (WHERE doi_required AND EXISTS (
                 SELECT 1 FROM kpi_events c
                  WHERE c.session_id = o.session_id
                    AND c.event = ${KPI_EMAIL_CAPTURE_MARKETING_CONFIRMED}
                    AND c.created_at >= o.at))::int AS doi_confirmed,
               count(*) FILTER (WHERE variant_mismatch)::int AS variant_mismatch
          FROM o GROUP BY 1, 2
      `,
    ]);

    const emptyWay = () => ({ shown: 0, accepted: 0, declined: 0, optedIn: 0 });
    const funnel: ConsentGateFunnel = {
      total: { ...EMPTY_GATE_COUNTS },
      bySurface: { chat: { ...EMPTY_GATE_COUNTS }, signin: { ...EMPTY_GATE_COUNTS } },
      signinByWay: { signin: emptyWay(), shop: emptyWay(), unknown: emptyWay() },
      byVariant: normalizeConsentVariantRows(
        [
          ...(variantGateRows as Array<Record<string, unknown>>).map((r) => ({
            variant: r.variant,
            placement: r.placement,
            shown: r.shown,
            accepted: r.accepted,
            declined: r.declined,
            dismissed: r.dismissed,
            acceptedWithoutShown: r.accepted_without_shown,
          })),
          ...(variantOptInRows as Array<Record<string, unknown>>).map((r) => ({
            variant: r.variant,
            placement: r.placement,
            optedIn: r.opted_in,
            alreadyConfirmed: r.already_confirmed,
            doiRequired: r.doi_required,
            doiConfirmed: r.doi_confirmed,
            variantMismatch: r.variant_mismatch,
          })),
        ],
        (id: string) => isKnownSigninVariant(id),
        (p: string) => normalizePlacement(p)
      ) as unknown as ConsentVariantRow[],
    };
    for (const r of wayRows as Array<{ way: string; shown: number; accepted: number; declined: number; opted_in: number }>) {
      const way = r.way === "signin" || r.way === "shop" ? r.way : "unknown";
      funnel.signinByWay[way] = {
        shown: Number(r.shown),
        accepted: Number(r.accepted),
        declined: Number(r.declined),
        optedIn: Number(r.opted_in),
      };
    }
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
    // The popup after a sign-in counts SESSIONS with their final state (OI1
    // §6): accepted beats declined beats dismissed, so an accept followed by
    // Esc on the success view counts once. Sums of the per-variant session rows.
    const sessionCounts = { ...EMPTY_GATE_COUNTS };
    for (const r of variantGateRows as Array<Record<string, unknown>>) {
      sessionCounts.shown += Number(r.shown ?? 0);
      sessionCounts.accepted += Number(r.accepted ?? 0);
      sessionCounts.declined += Number(r.declined ?? 0);
      sessionCounts.dismissed += Number(r.dismissed ?? 0);
    }
    funnel.total.shown += sessionCounts.shown - funnel.bySurface.signin.shown;
    funnel.total.accepted += sessionCounts.accepted - funnel.bySurface.signin.accepted;
    funnel.total.declined += sessionCounts.declined - funnel.bySurface.signin.declined;
    funnel.total.dismissed += sessionCounts.dismissed - funnel.bySurface.signin.dismissed;
    funnel.bySurface.signin = sessionCounts;
    return funnel;
  } catch (err) {
    reportError(err, { route: "lib/kpi-store", phase: "getConsentGateFunnel" });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sign-in popup funnel — popup → „Anmelden“ → Shopify sign-in → chat sign-in
// ---------------------------------------------------------------------------

export interface LoginGateFunnel {
  /** Sessions that saw the sign-in popup. */
  shown: number;
  /** Of those, sessions that clicked „Anmelden“. */
  clicked: number;
  /** Of those, sessions that clicked „Später“ (snoozed 24 h on the device). */
  declined: number;
  /** Of those, sessions that closed it with Esc / a backdrop click. */
  dismissed: number;
  /** Clicked AND a successful Shopify sign-in (account_signin_succeeded) in the same session afterwards. */
  signedIn: number;
  /** Clicked AND the chat redeemed the one-time code (account_signin_linked) — the sign-in that counts. */
  linked: number;
  rates: ReturnType<typeof loginGateRates>;
  /** All sign-in starts in the window by origin: the popup or the welcome card / header button. */
  startsBySource: { login_gate: number; other: number };
}

/**
 * The sign-in popup for anonymous visitors (widget 2026-10-01), counted per
 * SESSION: the four widget events, joined in the same session to the
 * server-side sign-in events after the click. Starts by source come from the
 * widget's account_signin_started (`data.source`). Returns null when no DB is
 * configured or on a hard failure.
 */
export async function getLoginGateFunnel(
  range: KpiRange,
  sql: Sql | null = getSql()
): Promise<LoginGateFunnel | null> {
  if (!sql) return null;
  try {
    const [funnelRows, sourceRows] = await Promise.all([
      sql`
        WITH g AS (
          SELECT session_id,
                 bool_or(event = ${LOGIN_GATE_SHOWN}) AS shown,
                 bool_or(event = ${LOGIN_GATE_SIGNIN_CLICKED}) AS clicked,
                 bool_or(event = ${LOGIN_GATE_DECLINED}) AS declined,
                 bool_or(event = ${LOGIN_GATE_DISMISSED}) AS dismissed,
                 min(created_at) FILTER (WHERE event = ${LOGIN_GATE_SIGNIN_CLICKED}) AS clicked_at
            FROM kpi_events
           WHERE event IN (${LOGIN_GATE_SHOWN}, ${LOGIN_GATE_SIGNIN_CLICKED},
                           ${LOGIN_GATE_DECLINED}, ${LOGIN_GATE_DISMISSED})
             AND session_id IS NOT NULL
             AND created_at >= ${range.from}::date
             AND created_at < (${range.to}::date + 1)
           GROUP BY session_id
        ), h AS (
          SELECT g.*,
                 g.clicked_at IS NOT NULL AND EXISTS (
                   SELECT 1 FROM kpi_events s
                    WHERE s.session_id = g.session_id
                      AND s.event = ${KPI_ACCOUNT_SIGNIN_SUCCEEDED}
                      AND s.created_at >= g.clicked_at
                 ) AS signed_in,
                 g.clicked_at IS NOT NULL AND EXISTS (
                   SELECT 1 FROM kpi_events s
                    WHERE s.session_id = g.session_id
                      AND s.event = ${KPI_ACCOUNT_SIGNIN_LINKED}
                      AND COALESCE(s.data->>'kind', 'customer_account') = 'customer_account'
                      AND s.created_at >= g.clicked_at
                 ) AS linked
            FROM g
        )
        SELECT count(*) FILTER (WHERE shown)::int AS shown,
               count(*) FILTER (WHERE shown AND clicked)::int AS clicked,
               count(*) FILTER (WHERE shown AND declined)::int AS declined,
               count(*) FILTER (WHERE shown AND dismissed)::int AS dismissed,
               count(*) FILTER (WHERE shown AND clicked AND signed_in)::int AS signed_in,
               count(*) FILTER (WHERE shown AND clicked AND linked)::int AS linked
          FROM h
      `,
      sql`
        SELECT COALESCE(data->>'source', '') AS source, count(*)::int AS n
          FROM kpi_events
         WHERE event = ${ACCOUNT_SIGNIN_STARTED}
           AND created_at >= ${range.from}::date
           AND created_at < (${range.to}::date + 1)
         GROUP BY 1
      `,
    ]);
    const r = ((funnelRows as Array<Record<string, unknown>>)[0] ?? {}) as Record<string, unknown>;
    const n = (k: string) => Number(r[k] ?? 0);
    const counts = {
      shown: n("shown"),
      clicked: n("clicked"),
      declined: n("declined"),
      dismissed: n("dismissed"),
      signedIn: n("signed_in"),
      linked: n("linked"),
    };
    const startsBySource = { login_gate: 0, other: 0 };
    for (const row of sourceRows as Array<{ source: string; n: number }>) {
      startsBySource[signinSource(row.source)] += Number(row.n);
    }
    return { ...counts, rates: loginGateRates(counts), startsBySource };
  } catch (err) {
    reportError(err, { route: "lib/kpi-store", phase: "getLoginGateFunnel" });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sign-in diagnosis — where each session's sign-in ended (docs/frontend/05 §12.1)
// ---------------------------------------------------------------------------

export interface SigninDiagnosis {
  /** Sessions per outcome key (kpi-widget-events.mjs SIGNIN_DIAGNOSIS). */
  byOutcome: Record<string, number>;
  /** account_signin_return by `data.result` (widget truth). */
  returnResults: Array<{ result: string; count: number }>;
  /** Sessions considered (any sign-in event in the period). */
  sessions: number;
  /** True when more sessions than SIGNIN_DIAGNOSIS_MAX had events (the rest is not classified). */
  truncated: boolean;
}

const SIGNIN_DIAGNOSIS_MAX = 20_000;

/**
 * Classify every session with a sign-in event in the period by where its
 * sign-in ended (popup click → start → Shopify → return → code redeemed),
 * joining the widget events and the server events of the same session.
 * Returns null without a database or on a hard failure.
 */
export async function getSigninDiagnosis(
  range: KpiRange,
  sql: Sql | null = getSql()
): Promise<SigninDiagnosis | null> {
  if (!sql) return null;
  try {
    const [sessionRows, resultRows] = await Promise.all([
      sql`
        SELECT session_id,
               bool_or(event = ${LOGIN_GATE_SIGNIN_CLICKED}) AS gate_clicked,
               COALESCE(max(created_at) FILTER (WHERE event = ${LOGIN_GATE_DISMISSED})
                        > min(created_at) FILTER (WHERE event = ${LOGIN_GATE_SIGNIN_CLICKED}), false) AS dismissed_after_click,
               bool_or(event = ${ACCOUNT_SIGNIN_STARTED}) AS started,
               bool_or(event = ${KPI_ACCOUNT_SIGNIN_SUCCEEDED}) AS succeeded,
               bool_or(event = ${ACCOUNT_SIGNIN_RETURN} AND data->>'result' = 'ok') AS return_ok,
               bool_or(event = ${ACCOUNT_SIGNIN_RETURN} AND data->>'result' = 'link_failed') AS return_link_failed,
               bool_or(event = ${ACCOUNT_SIGNIN_RETURN}
                       AND COALESCE(data->>'result', '') NOT IN ('ok', 'link_failed', 'logged_out')) AS return_other,
               bool_or(event = ${KPI_ACCOUNT_SIGNIN_LINKED}) AS linked,
               bool_or(event = ${KPI_ACCOUNT_SIGNIN_LINKED} AND data->>'kind' = 'app_proxy') AS linked_via_shop,
               bool_or(event = ${KPI_ACCOUNT_SIGNIN_LINKED} AND data->>'kind' = 'app_proxy'
                       AND COALESCE(data->>'renewed', 'false') = 'false') AS linked_via_shop_new,
               bool_or(event = ${KPI_ACCOUNT_SHOP_RECOGNISED} AND data->>'codeIssued' = 'true') AS shop_code_issued,
               bool_or(event = ${KPI_ACCOUNT_SIGNIN_LINK_REFUSED} AND data->>'reason' = 'session_mismatch') AS refused_mismatch,
               bool_or(event = ${KPI_ACCOUNT_SIGNIN_LINK_REFUSED} AND COALESCE(data->>'reason', '') <> 'session_mismatch') AS refused_invalid
          FROM kpi_events
         WHERE event IN (${LOGIN_GATE_SIGNIN_CLICKED}, ${LOGIN_GATE_DISMISSED}, ${ACCOUNT_SIGNIN_STARTED},
                         ${KPI_ACCOUNT_SIGNIN_SUCCEEDED}, ${ACCOUNT_SIGNIN_RETURN}, ${KPI_ACCOUNT_SIGNIN_LINKED},
                         ${KPI_ACCOUNT_SIGNIN_LINK_REFUSED}, ${KPI_ACCOUNT_SHOP_RECOGNISED})
           AND session_id IS NOT NULL
           AND session_id NOT LIKE 'livecheck-%'
           AND created_at >= ${range.from}::date
           AND created_at < (${range.to}::date + 1)
         GROUP BY session_id
        HAVING bool_or(event IN (${LOGIN_GATE_SIGNIN_CLICKED}, ${ACCOUNT_SIGNIN_STARTED}, ${KPI_ACCOUNT_SIGNIN_SUCCEEDED},
                                 ${ACCOUNT_SIGNIN_RETURN}, ${KPI_ACCOUNT_SIGNIN_LINKED}, ${KPI_ACCOUNT_SIGNIN_LINK_REFUSED}))
            OR bool_or(event = ${KPI_ACCOUNT_SHOP_RECOGNISED} AND data->>'codeIssued' = 'true')
         ORDER BY max(created_at) DESC
         LIMIT ${SIGNIN_DIAGNOSIS_MAX + 1}
      `,
      sql`
        SELECT COALESCE(NULLIF(data->>'result', ''), 'unbekannt') AS result, count(*)::int AS n
          FROM kpi_events
         WHERE event = ${ACCOUNT_SIGNIN_RETURN}
           AND created_at >= ${range.from}::date
           AND created_at < (${range.to}::date + 1)
         GROUP BY 1
         ORDER BY 2 DESC
      `,
    ]);
    const rows = sessionRows as Array<Record<string, unknown>>;
    const truncated = rows.length > SIGNIN_DIAGNOSIS_MAX;
    const byOutcome: Record<string, number> = {};
    for (const r of rows.slice(0, SIGNIN_DIAGNOSIS_MAX)) {
      const key = classifySigninSession({
        gateClicked: r.gate_clicked === true,
        dismissedAfterClick: r.dismissed_after_click === true,
        started: r.started === true,
        succeeded: r.succeeded === true,
        returnOk: r.return_ok === true,
        returnLinkFailed: r.return_link_failed === true,
        returnOther: r.return_other === true,
        linked: r.linked === true,
        linkedViaShop: r.linked_via_shop === true,
        linkedViaShopNew: r.linked_via_shop_new === true,
        shopCodeIssued: r.shop_code_issued === true,
        refusedInvalid: r.refused_invalid === true,
        refusedMismatch: r.refused_mismatch === true,
      });
      if (key !== "none") byOutcome[key] = (byOutcome[key] ?? 0) + 1;
    }
    return {
      byOutcome,
      returnResults: (resultRows as Array<{ result: string; n: number }>).map((r) => ({ result: String(r.result), count: Number(r.n) })),
      sessions: Math.min(rows.length, SIGNIN_DIAGNOSIS_MAX),
      truncated,
    };
  } catch (err) {
    reportError(err, { route: "lib/kpi-store", phase: "getSigninDiagnosis" });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Order status in the chat — get_order_status outcomes (order_status_lookup)
// ---------------------------------------------------------------------------

export interface OrderStatusKpis {
  lookups: number;
  sessions: number;
  byOutcome: Array<{ outcome: string; count: number }>;
  byTopic: Array<{ topic: string; count: number }>;
  /** ledger | ledger+live — how often the answer needed the short live read. */
  bySource: Array<{ source: string; count: number }>;
}

/** The server's order_status_lookup events in the period. Null without a DB or on failure. */
export async function getOrderStatusKpis(
  range: KpiRange,
  sql: Sql | null = getSql()
): Promise<OrderStatusKpis | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT COALESCE(NULLIF(data->>'outcome', ''), 'unknown') AS outcome,
             COALESCE(NULLIF(data->>'topic', ''), 'unknown') AS topic,
             COALESCE(NULLIF(data->>'source', ''), '–') AS source,
             count(*)::int AS n,
             count(DISTINCT session_id)::int AS sessions
        FROM kpi_events
       WHERE event = ${KPI_ORDER_STATUS_LOOKUP}
         AND created_at >= ${range.from}::date
         AND created_at < (${range.to}::date + 1)
       GROUP BY 1, 2, 3
    `) as Array<{ outcome: string; topic: string; source: string; n: number; sessions: number }>;
    const sum = (key: "outcome" | "topic" | "source") => {
      const m = new Map<string, number>();
      for (const r of rows) m.set(r[key], (m.get(r[key]) ?? 0) + Number(r.n));
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    const [sessionRow] = (await sql`
      SELECT count(DISTINCT session_id)::int AS n
        FROM kpi_events
       WHERE event = ${KPI_ORDER_STATUS_LOOKUP}
         AND created_at >= ${range.from}::date
         AND created_at < (${range.to}::date + 1)
    `) as Array<{ n: number }>;
    return {
      lookups: rows.reduce((t, r) => t + Number(r.n), 0),
      sessions: Number(sessionRow?.n ?? 0),
      byOutcome: sum("outcome").map(([outcome, count]) => ({ outcome, count })),
      byTopic: sum("topic").map(([topic, count]) => ({ topic, count })),
      bySource: sum("source").filter(([s]) => s !== "–").map(([source, count]) => ({ source, count })),
    };
  } catch (err) {
    reportError(err, { route: "lib/kpi-store", phase: "getOrderStatusKpis" });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Email-capture funnel — ask → submitted → marketing opt-in → DOI confirmed
// ---------------------------------------------------------------------------

export interface EmailCaptureFunnel {
  /** Mo made the email-summary offer (server-emitted, one per tool call). */
  askShown: number;
  /** The capture FORM was submitted (transactional consent). Since OI1 the
   * sign-in opt-in and the retired chat gate are left out (their own sections). */
  submitted: number;
  /** The form's separate marketing box was ticked. */
  marketingOptedIn: number;
  /** Of those, the DOI mail actually went out („DOI-Mail verschickt“, OI1 F3:
   * `doiSent` on the opt-in; rows before F3 have none and count as sent). */
  doiSent: number;
  /** Of those, a DOI mail was due but not sent (failed or skipped send, F3). */
  doiNotSent: number;
  /** Of those, the address was already subscribed (Mo DOI or Shopify) — no DOI. */
  alreadySubscribed: number;
  /** Of those, the address is suppressed (unsubscribed / bounced) — no DOI. */
  suppressed: number;
  /** DOI links clicked for capture-form opt-ins (source mo_capture_form; legacy rows by their session). */
  confirmed: number;
  /** Capture cards dismissed (widget), once per session and trigger. */
  declined: number;
  /** submitted / askShown — null when nothing was asked. */
  submitRate: number | null;
  /** confirmed / doiSent — null when no DOI mail went out. */
  doiRate: number | null;
  /** askShown by the offer trigger, bounded ('other' for unknown values). */
  asksByTrigger: Array<{ trigger: string; count: number }>;
}

/**
 * The capture form's funnel over the selected window (OI1): offer → form →
 * marketing box → DOI click. Event counts inside the window (a DOI click on
 * yesterday's opt-in counts today). Only the capture form: opt-ins carry
 * `source` since 05.10.2026; older rows are told apart by their server-set
 * trigger (signin_optin / chat_gate). „DOI-Mail verschickt“ counts opt-ins
 * whose DOI mail went out (`doiSent`, OI1 F3 — capture-funnel.mjs →
 * isDoiMailSent; rows before F3 count as sent). Returns null without a DB or
 * on failure.
 */
export async function getEmailCaptureFunnel(
  range: KpiRange,
  sql: Sql | null = getSql()
): Promise<EmailCaptureFunnel | null> {
  if (!sql) return null;
  try {
    const knownTriggers = [...OFFER_TRIGGERS];
    const [countRows, triggerRows] = await Promise.all([
      sql`
        SELECT
          count(*) FILTER (WHERE event = ${KPI_EMAIL_CAPTURE_ASK_SHOWN})::int AS ask_shown,
          count(*) FILTER (WHERE event = ${KPI_EMAIL_CAPTURE_SUBMITTED}
                             AND (data->>'source' = 'mo_capture_form'
                                  OR (data->>'source' IS NULL
                                      AND COALESCE(data->>'trigger', '') NOT IN ('signin_optin', 'chat_gate'))))::int AS submitted,
          count(*) FILTER (WHERE event = ${KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN}
                             AND (data->>'source' = 'mo_capture_form'
                                  OR (data->>'source' IS NULL
                                      AND COALESCE(data->>'trigger', '') NOT IN ('signin_optin', 'chat_gate'))))::int AS opted_in,
          count(*) FILTER (WHERE event = ${KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN}
                             AND (data->>'source' = 'mo_capture_form'
                                  OR (data->>'source' IS NULL
                                      AND COALESCE(data->>'trigger', '') NOT IN ('signin_optin', 'chat_gate')))
                             AND (data->>'outcome' = 'doi_required'
                                  OR (data->>'outcome' IS NULL AND data->>'doiStatus' = 'pending'))
                             AND COALESCE((data->>'doiSent')::boolean, true))::int AS doi_sent,
          count(*) FILTER (WHERE event = ${KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN}
                             AND (data->>'source' = 'mo_capture_form'
                                  OR (data->>'source' IS NULL
                                      AND COALESCE(data->>'trigger', '') NOT IN ('signin_optin', 'chat_gate')))
                             AND data->>'outcome' = 'doi_required'
                             AND (data->>'doiSent')::boolean = false)::int AS doi_not_sent,
          count(*) FILTER (WHERE event = ${KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN}
                             AND (data->>'source' = 'mo_capture_form'
                                  OR (data->>'source' IS NULL
                                      AND COALESCE(data->>'trigger', '') NOT IN ('signin_optin', 'chat_gate')))
                             AND (data->>'outcome' IN ('already_confirmed', 'already_subscribed')
                                  OR (data->>'outcome' IS NULL AND data->>'doiStatus' = 'confirmed')))::int AS already_subscribed,
          count(*) FILTER (WHERE event = ${KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN}
                             AND data->>'source' = 'mo_capture_form'
                             AND data->>'outcome' = 'suppressed')::int AS suppressed,
          count(*) FILTER (WHERE event = ${KPI_EMAIL_CAPTURE_MARKETING_CONFIRMED}
                             AND (data->>'source' = 'mo_capture_form'
                                  OR (data->>'source' IS NULL AND NOT EXISTS (
                                        SELECT 1 FROM kpi_events o
                                         WHERE o.session_id = kpi_events.session_id
                                           AND o.event = ${KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN}
                                           AND o.data->>'trigger' IN ('signin_optin', 'chat_gate')))))::int AS confirmed,
          count(DISTINCT COALESCE(session_id, '') || '|' || COALESCE(data->>'trigger', ''))
            FILTER (WHERE event = ${KPI_EMAIL_CAPTURE_DECLINED})::int AS declined
          FROM kpi_events
         WHERE event IN (${KPI_EMAIL_CAPTURE_ASK_SHOWN}, ${KPI_EMAIL_CAPTURE_SUBMITTED},
                         ${KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN},
                         ${KPI_EMAIL_CAPTURE_MARKETING_CONFIRMED},
                         ${KPI_EMAIL_CAPTURE_DECLINED})
           AND created_at >= ${range.from}::date
           AND created_at < (${range.to}::date + 1)
      `,
      sql`
        SELECT CASE WHEN COALESCE(data->>'trigger', '') = '' THEN 'none'
                    WHEN data->>'trigger' = ANY(${knownTriggers}::text[]) THEN data->>'trigger'
                    ELSE 'other' END AS trigger,
               count(*)::int AS n
          FROM kpi_events
         WHERE event = ${KPI_EMAIL_CAPTURE_ASK_SHOWN}
           AND created_at >= ${range.from}::date
           AND created_at < (${range.to}::date + 1)
         GROUP BY 1
         ORDER BY n DESC, 1 ASC
      `,
    ]);

    const r = ((countRows as Array<Record<string, unknown>>)[0] ?? {}) as Record<string, unknown>;
    const n = (k: string) => Number(r[k] ?? 0);
    const askShown = n("ask_shown");
    const submitted = n("submitted");
    const doiSent = n("doi_sent");
    const confirmed = n("confirmed");
    return {
      askShown,
      submitted,
      marketingOptedIn: n("opted_in"),
      doiSent,
      doiNotSent: n("doi_not_sent"),
      alreadySubscribed: n("already_subscribed"),
      suppressed: n("suppressed"),
      confirmed,
      declined: n("declined"),
      submitRate: askShown > 0 ? Math.min(1, submitted / askShown) : null,
      doiRate: doiSent > 0 ? Math.min(1, confirmed / doiSent) : null,
      asksByTrigger: (triggerRows as Array<{ trigger: string; n: number }>).map((t) => ({
        trigger: normaliseTrigger(String(t.trigger) === "none" ? "" : String(t.trigger)),
        count: Number(t.n),
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
  /** Sign-ins the chat completed by redeeming the one-time code (0073) — the ones that count. */
  linkedSignins: number;
  /** Codes POST /api/auth/link refused (expired, used, another session's). */
  refusedLinks: number;
  /** GDPR data exports downloaded (Art. 15/20 self-service). */
  exports: number;
  /** Full self-service erasures completed (Art. 17). */
  erasures: number;
  /** Contact-form submissions accepted (widget hand-over). */
  contactFormSubmissions: number;
  /** Of those, the order support form (reason order_support). */
  contactOrderSupport: number;
  /** Of those, submissions keyed to a widget session (body sessionId / x-ms-session, widget since 2026-10-04). */
  contactWithSession: number;
  /** Chat-summary PDFs downloaded by signed-in customers (ai_usage). */
  summaryDownloads: number;
  /** Chat-summary emails generated after a capture (ai_usage). */
  summaryEmails: number;
  /** Sessions signed in to the chat in the period, by way: „Anmelden“ (any
   * customer_account redeem), a NEW shop-login link (App Proxy, renewed=false),
   * and sessions whose only link was a renewal of an existing sign-in. */
  linkedSessions: { signin: number; shop: number; renewedOnly: number };
  /** Shop-login recognition (App Proxy whoami, P0.3) — sessions. */
  shopRecognition: {
    recognised: number;
    recognisedNew: number;
    withToken: number;
    withCode: number;
    redeemed: number;
    refused: number;
    flagOff: number;
    noProof: number;
    handover: number;
    codeFailed: number;
    rates: ReturnType<typeof shopRecognitionRates>;
  };
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
    const [eventRows, usageRows, shopRows] = await Promise.all([
      sql`
        SELECT event,
               count(*)::int AS n,
               count(*) FILTER (WHERE data->>'silent' = 'true')::int AS silent,
               count(*) FILTER (WHERE data->>'reason' = 'order_support')::int AS order_support,
               count(*) FILTER (WHERE session_id IS NOT NULL)::int AS with_session
          FROM kpi_events
         WHERE event IN (${KPI_ACCOUNT_SIGNIN_SUCCEEDED}, ${KPI_ACCOUNT_SIGNIN_LINKED},
                         ${KPI_ACCOUNT_SIGNIN_LINK_REFUSED}, ${KPI_ACCOUNT_EXPORT_REQUESTED},
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
      sql`
        WITH s AS (
          SELECT session_id,
                 min(created_at) FILTER (WHERE event = ${KPI_ACCOUNT_SHOP_RECOGNISED}) AS recognised_at,
                 bool_or(event = ${KPI_ACCOUNT_SHOP_RECOGNISED}
                         AND COALESCE(data->>'alreadySignedIn', 'false') = 'false') AS recognised_new,
                 bool_or(event = ${KPI_ACCOUNT_SHOP_RECOGNISED} AND data->>'hasToken' = 'true') AS has_token,
                 min(created_at) FILTER (WHERE event = ${KPI_ACCOUNT_SHOP_RECOGNISED}
                                           AND data->>'codeIssued' = 'true') AS code_at,
                 bool_or(event = ${KPI_ACCOUNT_SHOP_RECOGNISED} AND data->>'noCode' = 'flag_off') AS no_code_flag_off,
                 bool_or(event = ${KPI_ACCOUNT_SHOP_RECOGNISED} AND data->>'noCode' = 'no_proof') AS no_code_no_proof,
                 bool_or(event = ${KPI_ACCOUNT_SHOP_RECOGNISED} AND data->>'noCode' = 'handover') AS handover,
                 bool_or(event = ${KPI_ACCOUNT_SHOP_RECOGNISED} AND data->>'noCode' = 'failed') AS code_failed,
                 bool_or(event = ${KPI_ACCOUNT_SIGNIN_LINKED} AND data->>'kind' = 'customer_account') AS linked_signin,
                 bool_or(event = ${KPI_ACCOUNT_SIGNIN_LINKED} AND data->>'kind' = 'app_proxy'
                         AND COALESCE(data->>'renewed', 'false') = 'false') AS linked_shop_new,
                 bool_or(event = ${KPI_ACCOUNT_SIGNIN_LINKED} AND data->>'kind' = 'app_proxy'
                         AND data->>'renewed' = 'true') AS linked_shop_renewed,
                 max(created_at) FILTER (WHERE event = ${KPI_ACCOUNT_SIGNIN_LINKED}
                                           AND data->>'kind' = 'app_proxy') AS shop_linked_at,
                 max(created_at) FILTER (WHERE event = ${KPI_ACCOUNT_SIGNIN_LINK_REFUSED}
                                           AND data->>'kind' = 'app_proxy') AS shop_refused_at
            FROM kpi_events
           WHERE event IN (${KPI_ACCOUNT_SHOP_RECOGNISED}, ${KPI_ACCOUNT_SIGNIN_LINKED}, ${KPI_ACCOUNT_SIGNIN_LINK_REFUSED})
             AND session_id IS NOT NULL
             AND session_id NOT LIKE 'livecheck-%'
             AND created_at >= ${range.from}::date
             AND created_at < (${range.to}::date + 1)
           GROUP BY session_id
        )
        SELECT count(*) FILTER (WHERE linked_signin)::int                                         AS linked_signin,
               count(*) FILTER (WHERE linked_shop_new AND NOT linked_signin)::int                 AS linked_shop,
               count(*) FILTER (WHERE linked_shop_renewed AND NOT linked_shop_new
                                  AND NOT linked_signin)::int                                     AS renewed_only,
               count(*) FILTER (WHERE recognised_at IS NOT NULL)::int                             AS recognised,
               count(*) FILTER (WHERE recognised_new)::int                                        AS recognised_new,
               count(*) FILTER (WHERE recognised_at IS NOT NULL AND has_token)::int               AS with_token,
               count(*) FILTER (WHERE code_at IS NOT NULL)::int                                   AS with_code,
               count(*) FILTER (WHERE code_at IS NOT NULL AND shop_linked_at >= code_at)::int     AS redeemed,
               count(*) FILTER (WHERE code_at IS NOT NULL
                                  AND (shop_linked_at IS NULL OR shop_linked_at < code_at)
                                  AND shop_refused_at >= code_at)::int                            AS refused,
               count(*) FILTER (WHERE code_at IS NULL AND no_code_flag_off)::int                  AS flag_off,
               count(*) FILTER (WHERE code_at IS NULL AND no_code_no_proof)::int                  AS no_proof,
               count(*) FILTER (WHERE handover)::int                                              AS handover,
               count(*) FILTER (WHERE code_at IS NULL AND code_failed)::int                       AS code_failed
          FROM s
      `,
    ]);

    const activity: AccountActivity = {
      signins: 0,
      silentSignins: 0,
      linkedSignins: 0,
      refusedLinks: 0,
      exports: 0,
      erasures: 0,
      contactFormSubmissions: 0,
      contactOrderSupport: 0,
      contactWithSession: 0,
      summaryDownloads: 0,
      summaryEmails: 0,
      linkedSessions: { signin: 0, shop: 0, renewedOnly: 0 },
      shopRecognition: {
        recognised: 0,
        recognisedNew: 0,
        withToken: 0,
        withCode: 0,
        redeemed: 0,
        refused: 0,
        flagOff: 0,
        noProof: 0,
        handover: 0,
        codeFailed: 0,
        rates: shopRecognitionRates({ recognised: 0, withToken: 0, withCode: 0, redeemed: 0 }),
      },
    };
    const sh = ((shopRows as Array<Record<string, unknown>>)[0] ?? {}) as Record<string, unknown>;
    const shn = (k: string) => Number(sh[k] ?? 0);
    activity.linkedSessions = { signin: shn("linked_signin"), shop: shn("linked_shop"), renewedOnly: shn("renewed_only") };
    const recognition = {
      recognised: shn("recognised"),
      recognisedNew: shn("recognised_new"),
      withToken: shn("with_token"),
      withCode: shn("with_code"),
      redeemed: shn("redeemed"),
      refused: shn("refused"),
      flagOff: shn("flag_off"),
      noProof: shn("no_proof"),
      handover: shn("handover"),
      codeFailed: shn("code_failed"),
    };
    activity.shopRecognition = { ...recognition, rates: shopRecognitionRates(recognition) };
    for (const r of eventRows as Array<{ event: string; n: number; silent: number; order_support: number; with_session: number }>) {
      const n = Number(r.n);
      if (r.event === KPI_ACCOUNT_SIGNIN_SUCCEEDED) {
        activity.signins = n;
        activity.silentSignins = Number(r.silent);
      } else if (r.event === KPI_ACCOUNT_SIGNIN_LINKED) activity.linkedSignins = n;
      else if (r.event === KPI_ACCOUNT_SIGNIN_LINK_REFUSED) activity.refusedLinks = n;
      else if (r.event === KPI_ACCOUNT_EXPORT_REQUESTED) activity.exports = n;
      else if (r.event === KPI_ACCOUNT_ERASED) activity.erasures = n;
      else if (r.event === KPI_CONTACT_FORM_SUBMITTED) {
        activity.contactFormSubmissions = n;
        activity.contactOrderSupport = Number(r.order_support);
        activity.contactWithSession = Number(r.with_session);
      }
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

// ---------------------------------------------------------------------------
// Page context on typed product-page messages (A3) — coverage and, while a
// control group runs, the pre-registered comparison. Pure DB, never cached.
// ---------------------------------------------------------------------------

export type PageContextKpis = ReturnType<typeof summarisePageContextRows> & {
  collection: { sessions: number; resolved: number };
  experiment: typeof PAGE_CONTEXT_EXPERIMENT;
};

export async function getPageContextKpis(
  range: KpiRange,
  sql: Sql | null = getSql()
): Promise<PageContextKpis | null> {
  if (!sql) return null;
  try {
    const [rows, collectionRows] = await Promise.all([
      sql`
        WITH pc AS (
          SELECT session_id,
                 min(created_at) AS first_at,
                 bool_and((data->>'applied')::boolean) AS all_applied,
                 bool_or((data->>'applied')::boolean)  AS any_applied,
                 bool_or((data->>'resolved')::boolean) AS resolved,
                 min(COALESCE((data->>'pct')::int, -1)) AS pct_min,
                 max(COALESCE((data->>'pct')::int, -1)) AS pct_max,
                 (array_agg(data->>'locale' ORDER BY created_at))[1] AS locale,
                 count(*)::int AS turns
            FROM kpi_events
           WHERE event = ${KPI_PAGE_CONTEXT_APPLIED} AND data->>'kind' = 'product'
             AND session_id IS NOT NULL
             AND created_at >= ${range.from}::date AND created_at < (${range.to}::date + 1)
           GROUP BY session_id
        ), answered AS (
          SELECT a.session_id,
                 (array_agg(COALESCE((a.data->>'productCards')::int, 0) ORDER BY a.created_at))[1] AS first_cards,
                 (array_agg(COALESCE((a.data->>'otherCards')::int, 0) ORDER BY a.created_at))[1] AS first_other_cards
            FROM kpi_events a JOIN pc ON pc.session_id = a.session_id
           WHERE a.event = ${KPI_PAGE_CONTEXT_ANSWERED} AND a.data->>'kind' = 'product'
             AND a.created_at >= pc.first_at AND a.created_at < pc.first_at + interval '24 hours'
           GROUP BY a.session_id
        ), primed AS (
          SELECT DISTINCT e.session_id FROM kpi_events e JOIN pc ON pc.session_id = e.session_id
           WHERE e.event IN ('product_cta_opened', 'nudge_clicked')
             AND e.created_at < pc.first_at AND e.created_at >= pc.first_at - interval '24 hours'
        ), outcome AS (
          SELECT e.session_id,
                 bool_or(e.event ILIKE ${CTA_PATTERNS[0]} OR e.event ILIKE ${CTA_PATTERNS[1]}) AS clicked,
                 bool_or((e.event ILIKE ${CTA_PATTERNS[0]} OR e.event ILIKE ${CTA_PATTERNS[1]})
                         AND COALESCE(e.data->>'samePage', '') <> 'true') AS clicked_other,
                 bool_or(e.event ILIKE ${CART_PATTERNS[0]} OR e.event ILIKE ${CART_PATTERNS[1]}) AS cart,
                 bool_or(e.event = 'product_cta_opened') AS cta_after
            FROM kpi_events e JOIN pc ON pc.session_id = e.session_id
           WHERE e.created_at >= pc.first_at AND e.created_at < pc.first_at + interval '24 hours'
           GROUP BY e.session_id
        ), orders AS (
          SELECT o.session_id, bool_or(o.attribution_tier = 'assisted') AS assisted
            FROM mo_orders o JOIN pc ON pc.session_id = o.session_id
           WHERE o.processed_at >= pc.first_at AND o.processed_at < pc.first_at + interval '7 days'
           GROUP BY o.session_id
        )
        SELECT CASE WHEN pc.all_applied THEN 'applied' WHEN NOT pc.any_applied THEN 'holdout' ELSE 'mixed' END AS arm,
               CASE WHEN pc.pct_min = pc.pct_max THEN pc.pct_min ELSE -1 END AS pct,
               pc.resolved, (primed.session_id IS NOT NULL) AS primed, COALESCE(pc.locale, 'de') AS locale,
               (pc.first_at > now() - interval '24 hours') AS click_window_open,
               count(*)::int AS sessions, sum(pc.turns)::int AS turns,
               count(*) FILTER (WHERE a.session_id IS NULL)::int AS unanswered,
               count(*) FILTER (WHERE a.first_cards > 0)::int AS first_card,
               count(*) FILTER (WHERE a.first_other_cards > 0)::int AS first_other_card,
               count(*) FILTER (WHERE o.clicked)::int AS clicked,
               count(*) FILTER (WHERE o.clicked_other)::int AS clicked_other,
               count(*) FILTER (WHERE o.cart)::int AS cart,
               count(*) FILTER (WHERE o.cta_after)::int AS cta_after,
               count(*) FILTER (WHERE pc.first_at <= now() - interval '7 days')::int AS order_window_closed,
               count(*) FILTER (WHERE pc.first_at <= now() - interval '7 days' AND r.session_id IS NOT NULL)::int AS ordered,
               count(*) FILTER (WHERE pc.first_at <= now() - interval '7 days' AND r.assisted)::int AS ordered_assisted
          FROM pc LEFT JOIN primed ON primed.session_id = pc.session_id
                  LEFT JOIN answered a ON a.session_id = pc.session_id
                  LEFT JOIN outcome o ON o.session_id = pc.session_id
                  LEFT JOIN orders r ON r.session_id = pc.session_id
         GROUP BY 1, 2, 3, 4, 5, 6
      `,
      sql`
        SELECT count(DISTINCT session_id)::int AS sessions,
               count(DISTINCT session_id) FILTER (WHERE (data->>'resolved')::boolean)::int AS resolved
          FROM kpi_events
         WHERE event = ${KPI_PAGE_CONTEXT_APPLIED} AND data->>'kind' = 'collection'
           AND session_id IS NOT NULL
           AND created_at >= ${range.from}::date AND created_at < (${range.to}::date + 1)
      `,
    ]);
    const experiment = PAGE_CONTEXT_EXPERIMENT as { from: string; pct: number; targetPerArm: { applied: number; holdout: number } } | null;
    const inExperiment = experiment && range.from >= experiment.from ? experiment : null;
    const c = ((collectionRows as Array<Record<string, unknown>>)[0] ?? {}) as Record<string, unknown>;
    return {
      ...summarisePageContextRows(rows as Array<Record<string, unknown>>, inExperiment),
      collection: { sessions: Number(c.sessions ?? 0), resolved: Number(c.resolved ?? 0) },
      experiment: PAGE_CONTEXT_EXPERIMENT,
    };
  } catch (err) {
    reportError(err, { route: "lib/kpi-store", phase: "getPageContextKpis" });
    return null;
  }
}
