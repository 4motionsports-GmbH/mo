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
