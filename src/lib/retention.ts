// Data retention enforcement.
//
// Implements the windows documented in docs/DATA_RETENTION.md. Runs from the
// /api/cron/retention endpoint (or manually). All windows are configurable via
// env so the policy can be tuned without a code change once Legal signs off.
//
// What it does, per run:
//   1. Flip stale 'active' conversations to 'abandoned' (a lazy, cron-driven
//      version of the abandonment check).
//   2. Delete conversations (messages cascade) past the retention window.
//   3. Delete kpi_events past the telemetry retention window, and the
//      dashboard/admin AI-usage rows (the ones with no conversation) on the same
//      analytics window. Chat AI-usage rows carry a conversation FK and cascade
//      with step 2 instead.
//   4. Purge PII for suppressed/unsubscribed email_captures after a grace
//      period — the suppression_list record itself is kept so we keep honouring
//      the opt-out. The matching `customers` row (email + cached profile /
//      purchase summaries — all PII) is purged with the same criteria; its
//      ON DELETE SET NULL FKs return the linked conversations to plain
//      pseudonymous rows.

import { getSql } from "./db";
import { purgeExpiredPendingAuth } from "./customer-oauth-store";
import { parseIntEnv } from "./env-num";

export interface RetentionOptions {
  /** Conversations + messages older than this (by last_activity_at) are deleted. */
  retentionDays: number;
  /** kpi_events older than this (by created_at) are deleted. */
  kpiRetentionDays: number;
  /** Active conversations idle longer than this are marked 'abandoned'. */
  abandonAfterMinutes: number;
  /** email_captures that are unsubscribed or suppressed are purged after this grace. */
  suppressedPurgeDays: number;
  /** email_messages (Korrespondenz) older than this (by occurred_at) are deleted. */
  correspondenceRetentionDays: number;
  /** physical_letters older than this (by created_at) are deleted. */
  physicalLetterRetentionDays: number;
  /** feedback rows older than this (by created_at) are deleted. 0 disables. */
  feedbackRetentionDays: number;
  /**
   * Storage limitation (Art. 5(1)(e)): purge IDENTIFIED but dormant customers —
   * last_seen_at older than this AND not holding an active marketing consent
   * ('confirmed'/'pending', which is its own basis to retain). 0 disables.
   */
  customerInactivityRetentionDays: number;
  /** admin_access_log rows older than this (by occurred_at) are deleted. 0 disables. */
  adminAccessLogRetentionDays: number;
}

export interface RetentionResult {
  abandonedConversations: number;
  deletedConversations: number;
  deletedKpiEvents: number;
  /** Dashboard/admin AI-usage rows (no conversation) purged by created_at. */
  deletedAiUsage: number;
  purgedSuppressedCaptures: number;
  purgedSuppressedCustomers: number;
  /** email_messages (correspondence) purged past the Korrespondenz window. */
  deletedEmailMessages: number;
  /** physical_letters purged past their retention window. */
  deletedPhysicalLetters: number;
  /** feedback rows purged past their retention window. */
  deletedFeedback: number;
  /** Dormant identified customers purged for storage limitation. */
  deletedInactiveCustomers: number;
  /** admin_access_log rows purged past their window. */
  deletedAdminAccessLog: number;
  /** Expired customer_auth_pending rows (CSRF/PKCE state) removed. */
  purgedAuthPending: number;
  ranAt: string;
}

export function retentionOptionsFromEnv(): RetentionOptions {
  return {
    retentionDays: parseIntEnv("RETENTION_DAYS", 180, 0),
    kpiRetentionDays: parseIntEnv("KPI_RETENTION_DAYS", 180, 0),
    abandonAfterMinutes: parseIntEnv("ABANDON_AFTER_MINUTES", 30, 0),
    suppressedPurgeDays: parseIntEnv("SUPPRESSED_CAPTURE_PURGE_DAYS", 30, 0),
    // Correspondence (Art. 6(1)(b)/(f)) is kept longer than analytics — a reply
    // thread stays useful well beyond a chat session. 12 months by default.
    correspondenceRetentionDays: parseIntEnv("CORRESPONDENCE_RETENTION_DAYS", 365, 0),
    physicalLetterRetentionDays: parseIntEnv("PHYSICAL_LETTER_RETENTION_DAYS", 365, 0),
    // Free-text feedback can carry user-supplied PII; keep it 12 months by default.
    feedbackRetentionDays: parseIntEnv("FEEDBACK_RETENTION_DAYS", 365, 0),
    // Storage-limitation backstop for dormant identified customers. Conservative
    // 3-year default; set 0 to disable. Confirmed/pending-consent customers are
    // always excluded (their consent is a live basis to retain).
    customerInactivityRetentionDays: parseIntEnv("CUSTOMER_INACTIVITY_RETENTION_DAYS", 1095, 0),
    // Admin PII-access audit (security record); kept 2 years by default.
    adminAccessLogRetentionDays: parseIntEnv("ADMIN_ACCESS_LOG_RETENTION_DAYS", 730, 0),
  };
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/**
 * Run all retention steps. Throws if no database is configured (the caller —
 * the cron route — surfaces that as a 503).
 */
export async function runRetention(
  opts: RetentionOptions = retentionOptionsFromEnv()
): Promise<RetentionResult> {
  const sql = getSql();
  if (!sql) {
    throw new Error("No database configured — cannot run retention");
  }

  const abandonCutoff = minutesAgo(opts.abandonAfterMinutes);
  const conversationCutoff = daysAgo(opts.retentionDays);
  const kpiCutoff = daysAgo(opts.kpiRetentionDays);
  const suppressedCutoff = daysAgo(opts.suppressedPurgeDays);
  const correspondenceCutoff = daysAgo(opts.correspondenceRetentionDays);
  const physicalLetterCutoff = daysAgo(opts.physicalLetterRetentionDays);
  const feedbackCutoff = daysAgo(opts.feedbackRetentionDays);
  const inactiveCustomerCutoff = daysAgo(opts.customerInactivityRetentionDays);
  const adminAccessLogCutoff = daysAgo(opts.adminAccessLogRetentionDays);

  // 1. Mark stale active conversations abandoned.
  const abandoned = await sql`
    WITH upd AS (
      UPDATE conversations
         SET status = 'abandoned', updated_at = now()
       WHERE status = 'active'
         AND last_activity_at < ${abandonCutoff}
      RETURNING 1
    )
    SELECT count(*)::int AS n FROM upd
  `;

  // 2. Delete expired conversations (messages cascade via FK ON DELETE CASCADE).
  const deletedConvos = await sql`
    WITH del AS (
      DELETE FROM conversations
       WHERE last_activity_at < ${conversationCutoff}
      RETURNING 1
    )
    SELECT count(*)::int AS n FROM del
  `;

  // 3. Delete expired telemetry.
  const deletedKpi = await sql`
    WITH del AS (
      DELETE FROM kpi_events
       WHERE created_at < ${kpiCutoff}
      RETURNING 1
    )
    SELECT count(*)::int AS n FROM del
  `;

  // 3b. Delete expired dashboard/admin AI-usage rows (conversation_id IS NULL).
  //     Chat rows (conversation_id set) are already gone via the step-2 cascade.
  const deletedAiUsage = await sql`
    WITH del AS (
      DELETE FROM ai_usage
       WHERE conversation_id IS NULL
         AND created_at < ${kpiCutoff}
      RETURNING 1
    )
    SELECT count(*)::int AS n FROM del
  `;

  // 4. Purge PII for opted-out captures past the grace period. The
  //    suppression_list row stays so future sends keep respecting the opt-out.
  const purgedCaptures = await sql`
    WITH del AS (
      DELETE FROM email_captures ec
       WHERE (
               ec.unsubscribed_at IS NOT NULL
               AND ec.unsubscribed_at < ${suppressedCutoff}
             )
          OR (
               EXISTS (SELECT 1 FROM suppression_list s WHERE s.email = ec.email)
               AND ec.created_at < ${suppressedCutoff}
             )
      RETURNING 1
    )
    SELECT count(*)::int AS n FROM del
  `;

  // 5. Purge the customer entity for the same opted-out addresses. Runs AFTER
  //    the capture purge so a freshly purged capture's customer goes in the
  //    same run. Customers carry email + cached profile/purchase summaries —
  //    all PII under the same consent. ON DELETE SET NULL detaches their
  //    conversations back to anonymous, pseudonymous rows.
  const purgedCustomers = await sql`
    WITH del AS (
      DELETE FROM customers c
       WHERE EXISTS (SELECT 1 FROM suppression_list s WHERE s.email = c.email)
         AND c.created_at < ${suppressedCutoff}
         AND NOT EXISTS (SELECT 1 FROM email_captures ec WHERE ec.email = c.email)
      RETURNING 1
    )
    SELECT count(*)::int AS n FROM del
  `;

  // 5b. Purge correspondence (email_messages) past its OWN window. It is its
  //     own data category (Korrespondenz), so it purges on its own schedule —
  //     NOT with the consent-capture grace. The customer FK is ON DELETE SET
  //     NULL, so a customer erasure detaches (but does not cascade-delete) these
  //     rows; they leave here, by occurred_at, on the correspondence window.
  const deletedEmailMessages = await sql`
    WITH del AS (
      DELETE FROM email_messages
       WHERE occurred_at < ${correspondenceCutoff}
      RETURNING 1
    )
    SELECT count(*)::int AS n FROM del
  `;

  // 5c. Purge physical_letters past their OWN window. A letter is its own data
  //     category (NOT email); like email_messages the customer FK is ON DELETE
  //     SET NULL, so a customer erasure detaches (never cascade-deletes) the
  //     audit row, and letters leave here, by created_at, on their own window.
  const deletedPhysicalLetters = await sql`
    WITH del AS (
      DELETE FROM physical_letters
       WHERE created_at < ${physicalLetterCutoff}
      RETURNING 1
    )
    SELECT count(*)::int AS n FROM del
  `;

  // 5d. Purge free-text feedback past its own window (storage limitation): a
  //     comment can carry user-supplied PII (an optional email, or PII typed into
  //     the message), so it doesn't live forever. Independent of the conversation
  //     it references (no FK; the conversation may already be gone). 0 disables.
  let deletedFeedback = [{ n: 0 }] as Array<{ n: number }>;
  if (opts.feedbackRetentionDays > 0) {
    deletedFeedback = (await sql`
      WITH del AS (
        DELETE FROM feedback WHERE created_at < ${feedbackCutoff} RETURNING 1
      )
      SELECT count(*)::int AS n FROM del
    `) as Array<{ n: number }>;
  }

  // 5e. Storage limitation (Art. 5(1)(e)): purge IDENTIFIED but DORMANT customers
  //     — no activity since the inactivity window — UNLESS they hold an active
  //     marketing consent ('confirmed' = live consent, 'pending' = mid-DOI), which
  //     is its own lawful basis to retain. Like step 5, the ON DELETE SET NULL FKs
  //     return their conversations/correspondence to pseudonymous rows and the
  //     ON DELETE CASCADE drops their OAuth tokens; the suppression_list (keyed by
  //     email, not customer_id) is untouched, so opt-outs are still honoured.
  //     Disabled when the window is 0.
  let deletedInactiveCustomers = [{ n: 0 }] as Array<{ n: number }>;
  if (opts.customerInactivityRetentionDays > 0) {
    deletedInactiveCustomers = (await sql`
      WITH del AS (
        DELETE FROM customers
         WHERE last_seen_at < ${inactiveCustomerCutoff}
           AND marketing_status NOT IN ('confirmed', 'pending')
        RETURNING 1
      )
      SELECT count(*)::int AS n FROM del
    `) as Array<{ n: number }>;
  }

  // 5f. Purge the admin PII-access audit log past its own (security) window.
  let deletedAdminAccessLog = [{ n: 0 }] as Array<{ n: number }>;
  if (opts.adminAccessLogRetentionDays > 0) {
    deletedAdminAccessLog = (await sql`
      WITH del AS (
        DELETE FROM admin_access_log WHERE occurred_at < ${adminAccessLogCutoff} RETURNING 1
      )
      SELECT count(*)::int AS n FROM del
    `) as Array<{ n: number }>;
  }

  // 6. Purge expired pending-auth records (short-lived CSRF/PKCE state). The
  //    encrypted token rows (customer_oauth_tokens) carry no separate window —
  //    they cascade with the customer (ON DELETE CASCADE), so a GDPR erasure /
  //    customer purge in step 5 already removes them.
  const purgedAuthPending = await purgeExpiredPendingAuth(sql);

  return {
    abandonedConversations: abandoned[0]?.n ?? 0,
    deletedConversations: deletedConvos[0]?.n ?? 0,
    deletedKpiEvents: deletedKpi[0]?.n ?? 0,
    deletedAiUsage: deletedAiUsage[0]?.n ?? 0,
    purgedSuppressedCaptures: purgedCaptures[0]?.n ?? 0,
    purgedSuppressedCustomers: purgedCustomers[0]?.n ?? 0,
    deletedEmailMessages: deletedEmailMessages[0]?.n ?? 0,
    deletedPhysicalLetters: deletedPhysicalLetters[0]?.n ?? 0,
    deletedFeedback: deletedFeedback[0]?.n ?? 0,
    deletedInactiveCustomers: deletedInactiveCustomers[0]?.n ?? 0,
    deletedAdminAccessLog: deletedAdminAccessLog[0]?.n ?? 0,
    purgedAuthPending,
    ranAt: new Date().toISOString(),
  };
}
