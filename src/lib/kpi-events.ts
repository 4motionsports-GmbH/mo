// Server-side emission into the same pseudonymous kpi_events pipeline that
// POST /api/kpi feeds (Cluster A — legitimate interest). Session-keyed only:
// callers must never put an email address or any other direct identifier in
// `data`. Best-effort like the ingestion route — a missing database or a
// failed write is logged and swallowed, never surfaced to the caller.

import { getSql } from "./db";
import { reportError } from "./observability";

// ---------------------------------------------------------------------------
// Email-capture funnel (value-triggered capture experiment)
// ---------------------------------------------------------------------------
//
// Canonical event names so the opt-in funnel can be measured per trigger
// moment (the `trigger` value from the offer_email_summary tool call rides
// along in `data`). The first four are emitted server-side; DECLINED can only
// be seen by the widget (the backend never observes a dismissal of the capture
// card), so the widget emits it through POST /api/kpi using this exact name.
// Shapes are documented in docs/API_CONTRACT.md §5.

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
// (kpi-widget-events.mjs). Shapes in docs/API_CONTRACT.md §5.

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
// identifier. Shapes in docs/API_CONTRACT.md §5.

/** A storefront contact-form submission was accepted (before delivery — the
 * form is the outcome the `show_contact_form` tool asks for, so tool-fires vs
 * submissions become comparable). `data: {reason, productCount}`. */
export const KPI_CONTACT_FORM_SUBMITTED = "contact_form_submitted";
/** A Shopify customer-account sign-in completed (OAuth callback success). */
export const KPI_ACCOUNT_SIGNIN_SUCCEEDED = "account_signin_succeeded";
/** The chat redeemed the one-time sign-in code (POST /api/auth/link, 0073) —
 * the sign-in now counts for that session. `data: {kind}` (customer_account | app_proxy). */
export const KPI_ACCOUNT_SIGNIN_LINKED = "account_signin_linked";
/** POST /api/auth/link refused a code. `data: {reason}` — invalid (expired, used,
 * unknown) | session_mismatch (another session's code: a planted link or a widget bug). */
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
