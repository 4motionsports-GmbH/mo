// Server-side emission into the same pseudonymous kpi_events pipeline that
// POST /api/kpi feeds (Cluster A — legitimate interest). Session-keyed only:
// callers must never put an email address or any other direct identifier in
// `data`. Best-effort like the ingestion route — a missing database or a
// failed write is logged and swallowed, never surfaced to the caller.

import { getSql } from "./db";
import { reportError } from "./observability";
import { eventSource } from "./capture-funnel.mjs";

// ---------------------------------------------------------------------------
// Email-capture funnel (value-triggered capture experiment)
// ---------------------------------------------------------------------------
//
// Canonical event names so the opt-in funnel can be measured per trigger
// moment (the `trigger` value from the offer_email_summary tool call rides
// along in `data`). The first four are emitted server-side; DECLINED can only
// be seen by the widget (the backend never observes a dismissal of the capture
// card), so the widget emits it through POST /api/kpi using this exact name.
// Shapes are documented in docs/frontend/API_CONTRACT.md §5.

/** Mo made the email-summary offer (one event per offer_email_summary call). */
export const KPI_EMAIL_CAPTURE_ASK_SHOWN = "email_capture_ask_shown";
/** The user submitted the capture form (transactional consent given). */
export const KPI_EMAIL_CAPTURE_SUBMITTED = "email_capture_submitted";
/** The user also ticked the separate marketing checkbox (pre-DOI intent). */
export const KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN =
  "email_capture_marketing_opted_in";
/** The user clicked the DOI link — marketing consent is now confirmed. */
export const KPI_EMAIL_CAPTURE_MARKETING_CONFIRMED =
  "email_capture_marketing_confirmed";
/** Widget-emitted: the user dismissed/declined the capture card. */
export const KPI_EMAIL_CAPTURE_DECLINED = "email_capture_declined";

// ---------------------------------------------------------------------------
// Consent-gate funnel (v4 button-consent marketing surfaces)
// ---------------------------------------------------------------------------
//
// ALL widget-emitted through POST /api/kpi (the gate render and its taps are
// UI moments the backend never observes directly; the accept ALSO reaches the
// backend as POST /api/account/marketing-opt-in). Each event carries
// `data: { surface: "signin" | "chat" }`. Since the widget of 2026-10-01 only
// the signed-in gate (`signin`) is shown; the anonymous e-mail gate (`chat`,
// POST /api/chat-marketing-opt-in) was replaced by the sign-in popup
// (kpi-widget-events.mjs). Shapes in docs/frontend/API_CONTRACT.md §5.

/** The consent gate was rendered (once per session per surface). */
export const KPI_CONSENT_GATE_SHOWN = "consent_gate_shown";
/** The user tapped the affirmative "Ja, Angebote aktivieren" button. */
export const KPI_CONSENT_GATE_ACCEPTED = "consent_gate_accepted";
/** The user tapped the decline option. */
export const KPI_CONSENT_GATE_DECLINED = "consent_gate_declined";
/** The user dismissed the gate without an explicit accept/decline. */
export const KPI_CONSENT_GATE_DISMISSED = "consent_gate_dismissed";

// ---------------------------------------------------------------------------
// Outbound-email click events (server-emitted from the tracked redirect)
// ---------------------------------------------------------------------------

/** A tracked CAMPAIGN-email CTA (/api/r/<token>, MK- channel) was clicked.
 * Emitted by campaign-store.recordCampaignClick with
 * `data: {sendId, firstClick}` and a NULL session. */
export const KPI_CAMPAIGN_EMAIL_CLICKED = "campaign_email_clicked";
/** The widget opened a chat from a campaign mail's Mo link (`mo_c`). Session-less, once per send. */
export const KPI_CAMPAIGN_CHAT_STARTED = "campaign_chat_started";

// ---------------------------------------------------------------------------
// Contact-form hand-over + customer-account lifecycle (server-emitted)
// ---------------------------------------------------------------------------
//
// All pseudonymous: session-keyed where the caller has a widget session,
// NULL-session otherwise; `data` never carries an email or another direct
// identifier. Shapes in docs/frontend/API_CONTRACT.md §5.

/** A storefront contact-form submission was accepted (before delivery — the
 * form is the outcome the `show_contact_form` tool asks for, so tool-fires vs
 * submissions become comparable). `data: {reason, productCount}`. */
export const KPI_CONTACT_FORM_SUBMITTED = "contact_form_submitted";
/** A Shopify customer-account sign-in completed (OAuth callback success). */
export const KPI_ACCOUNT_SIGNIN_SUCCEEDED = "account_signin_succeeded";
/** The chat redeemed the one-time sign-in code (POST /api/auth/link, 0073) —
 * the sign-in now counts for that session. `data: {kind, renewed}` — kind
 * customer_account | app_proxy; renewed = the session was already signed in as
 * this customer (a new tab confirming it, not a new sign-in). */
export const KPI_ACCOUNT_SIGNIN_LINKED = "account_signin_linked";
/** POST /api/auth/link refused a code. `data: {reason, kind?}` — reason invalid
 * (expired, used, unknown) | session_mismatch (another session's code: a planted
 * link or a widget bug); kind = the grant's kind when the code was known. */
export const KPI_ACCOUNT_SIGNIN_LINK_REFUSED = "account_signin_link_refused";
/** Shopify's App Proxy (whoami) vouched for a logged-in shop customer on a
 * signed, fresh request (P0.3). Session-keyed; `data: {proof: token|shop|none,
 * hasToken, alreadySignedIn, codeIssued, noCode?: flag_off|no_proof|handover|failed}`
 * — never a customer id, name, e-mail, the code or the URL. */
export const KPI_ACCOUNT_SHOP_RECOGNISED = "account_shop_recognised";
/** A signed-in customer requested their GDPR data export. */
export const KPI_ACCOUNT_EXPORT_REQUESTED = "account_export_requested";
/** A signed-in customer completed self-service erasure. */
export const KPI_ACCOUNT_ERASED = "account_erased";

// ---------------------------------------------------------------------------
// Order status in the chat (server-emitted, lib/order-status.ts)
// ---------------------------------------------------------------------------

/** Mo looked up the customer's orders (one event per get_order_status call).
 * Session-keyed; `data: {outcome, topic, source: "ledger"|"ledger+live",
 * orders}` — never an order number, amount or any other id. */
export const KPI_ORDER_STATUS_LOOKUP = "order_status_lookup";

// ---------------------------------------------------------------------------
// Order attribution (server-emitted, POST /api/webhooks/shopify)
// ---------------------------------------------------------------------------

/** A Mo-marked order no consultation could claim (ATTR-TOKEN-LIFETIME).
 * Session NULL; `data: {reason: 'unknown_token'|'outside_window', source?}`
 * (`source` only for outside_window). orders/create only, after the delivery
 * was recorded — never an order id, token or amount. */
export const KPI_MO_ORDER_MARKER_UNRESOLVED = "mo_order_marker_unresolved";

// ---------------------------------------------------------------------------
// Page context on typed product-page messages (A3, server-emitted, /api/chat)
// ---------------------------------------------------------------------------

/** One per `context.source: "page"` request, written when it arrives (the arm).
 * `data: {applied, kind: product|collection, resolved, locale, pct}` — pct is
 * the control-group share in force (100 while the switch is off, 0 for
 * collections). Session-keyed, no product id. */
export const KPI_PAGE_CONTEXT_APPLIED = "page_context_applied";
/** When that turn finished: `{kind, productCards, otherCards}` — counts only. */
export const KPI_PAGE_CONTEXT_ANSWERED = "page_context_answered";

// ---------------------------------------------------------------------------
// Welcome-voucher test of the consent ask (OPTIN_REWARD T6, server-emitted)
// ---------------------------------------------------------------------------

/** A signed-in session the consent ask may be offered to (GET /api/auth/me
 * answered `optInActionable: true`) — the test's intention-to-treat population.
 * `data: {variant, mode: popup|value_moment, locale}` = what the server assigned
 * this session. At most once per session per 24 h (consent-ask-kpi.ts). */
export const KPI_CONSENT_ASK_ELIGIBLE = "consent_ask_eligible";
/** GET /api/consent-copy?surface=signin served a per-session copy (only while
 * several variants are active) to a request with `x-ms-session` — the variant of
 * anonymous sign-in popup sessions too. `data: {variant, locale, reward,
 * valueMoment}` (booleans = what renders). At most once per session per 24 h. */
export const KPI_CONSENT_COPY_SERVED = "consent_copy_served";

/**
 * Record one pseudonymous KPI event from server code. Same table and shape as
 * the widget's fail-silent track() → POST /api/kpi path, so dashboard
 * aggregation sees one unified stream.
 */
export async function recordKpiEvent(opts: {
  sessionId: string | null;
  event: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  const sql = getSql();
  if (!sql) return;
  try {
    await sql`
      INSERT INTO kpi_events (session_id, event, data)
      VALUES (${opts.sessionId}, ${opts.event}, ${JSON.stringify(opts.data ?? {})}::jsonb)
    `;
  } catch (err) {
    reportError(err, { route: "lib/kpi-events", phase: "insert", event: opts.event });
  }
}

/** The session's latest opt-in whose DOI mail went out — what a DOI click confirms. */
export interface LatestDoiOptIn {
  source: string;
  /** Sign-in ask placement / variant of that opt-in (OPTIN_REWARD T6); null when it carried none. */
  placement: string | null;
  variant: string | null;
}

/**
 * The session's latest opt-in that sent a DOI mail (OI1 §4): the surface a
 * DOI click in that session confirms. Opt-ins that sent no mail (a failed
 * send, `doi_pending` within the resend cooldown, `shopify_pending`) do not
 * count. Legacy rows (no `outcome`, no `source`) map through their trigger.
 * Null on no row, no DB or an error.
 */
export async function latestDoiOptIn(sessionId: string | null): Promise<LatestDoiOptIn | null> {
  if (!sessionId) return null;
  const sql = getSql();
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT COALESCE(data->>'source', '') AS source, COALESCE(data->>'trigger', '') AS trigger,
             data->>'placement' AS placement, data->>'variant' AS variant
        FROM kpi_events
       WHERE session_id = ${sessionId}
         AND event = ${KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN}
         AND ((data->>'outcome' = 'doi_required' AND COALESCE(data->>'doiSent', 'true') <> 'false')
              OR (data->>'outcome' IS NULL AND data->>'doiStatus' = 'pending'
                  AND COALESCE(data->>'doiCooldown', 'false') <> 'true'))
       ORDER BY created_at DESC, id DESC
       LIMIT 1
    `) as Array<{ source: string; trigger: string; placement: string | null; variant: string | null }>;
    const r = rows[0];
    return r ? { source: eventSource(r.source, r.trigger), placement: r.placement || null, variant: r.variant || null } : null;
  } catch (err) {
    reportError(err, { route: "lib/kpi-events", phase: "latestDoiOptIn" });
    return null;
  }
}

/** The source of the session's latest DOI opt-in (see latestDoiOptIn). */
export async function latestDoiOptInSource(sessionId: string | null): Promise<string | null> {
  return (await latestDoiOptIn(sessionId))?.source ?? null;
}

/**
 * True if this session has recorded an email_capture_declined event (emitted
 * by the widget through POST /api/kpi when the user dismisses a capture card
 * — a dismissal is a UI click the conversation history never shows). Gates
 * the deterministic checkout-intent email offer in api/chat: after an
 * explicit decline the backend never FORCES another ask; any second ask stays
 * the model's prompt-gated decision. Best-effort like the rest of this
 * module: no database or a failed read resolves to false (no decline known).
 */
export async function hasDeclinedEmailCapture(
  sessionId: string | null
): Promise<boolean> {
  if (!sessionId) return false;
  const sql = getSql();
  if (!sql) return false;
  try {
    const rows = await sql`
      SELECT 1 FROM kpi_events
      WHERE session_id = ${sessionId} AND event = ${KPI_EMAIL_CAPTURE_DECLINED}
      LIMIT 1
    `;
    return rows.length > 0;
  } catch (err) {
    reportError(err, {
      route: "lib/kpi-events",
      phase: "select",
      event: KPI_EMAIL_CAPTURE_DECLINED,
    });
    return false;
  }
}

/**
 * Record a session-keyed event at most once per session within `hours` (one
 * statement: insert unless the session already has that event in the window).
 * Not race-proof — two parallel requests can both insert — so readers count
 * DISTINCT sessions. No session, no database or a failed write → nothing
 * recorded, logged, never thrown (like recordKpiEvent).
 */
export async function recordKpiEventOncePerWindow(opts: {
  sessionId: string | null;
  event: string;
  data?: Record<string, unknown>;
  hours: number;
}): Promise<void> {
  if (!opts.sessionId) return;
  const sql = getSql();
  if (!sql) return;
  const hours = Math.max(1, Math.floor(opts.hours) || 1);
  try {
    await sql`
      INSERT INTO kpi_events (session_id, event, data)
      SELECT ${opts.sessionId}, ${opts.event}, ${JSON.stringify(opts.data ?? {})}::jsonb
       WHERE NOT EXISTS (
         SELECT 1 FROM kpi_events
          WHERE session_id = ${opts.sessionId}
            AND event = ${opts.event}
            AND created_at >= now() - make_interval(hours => ${hours}::int))
    `;
  } catch (err) {
    reportError(err, { route: "lib/kpi-events", phase: "insertOnce", event: opts.event });
  }
}
