// Conversion sweep — the cron-driven writer that finally populates
// conversations.status = 'converted'.
//
// WHAT COUNTS AS A CONVERSION (and what deliberately does not): the same
// signal every money KPI in this repo trusts — the send's UNIQUE single-use
// MS5- discount code was redeemed in a real Shopify order
// (wasDiscountCodeRedeemed, read_orders). That code is minted for ONE
// marketing email drafted from ONE capture, and the capture carries the
// pseudonymous session_id bridge — so the redemption can honestly be walked
// back to the conversation the email came from. Campaign MK- contacts have no
// session and stay out of the status flip. Cart-link/bundle orders are
// measured by the separate order-attribution pipeline (lib/mo-orders-store,
// docs/ORDER_ATTRIBUTION.md), which this sweep also uses as a cheap
// short-circuit before asking Shopify.
//
// BOOKKEEPING: marketing_sends.shopify_order_matched (a 0001 column that was
// never written until now) marks a send whose redemption has been observed, so
// a code is never re-checked after it matched. Unmatched codes leave the sweep
// set on their own once their discount expiry lies more than
// EXPIRED_CODE_GRACE_DAYS in the past (an expired code can no longer be
// redeemed), keeping the per-run Shopify fan-out naturally bounded even
// without the cap.
//
// WHICH CONVERSATION: the session may hold several threads (migration 0018).
// The email was drafted from the session's history as of the send, so the
// sweep marks the thread that was most recently active at send time — never
// every thread of the session. 'converted' then stays sticky (persistTurn
// keeps it, the abandon flip only touches 'active').
//
// Best-effort like every cron step: no DB / no Shopify / a failed lookup skips
// quietly ("unknown" is never treated as "not redeemed" — the send stays
// unmatched and is retried next run while its code is still redeemable).

import { getSql } from "./db";
import { wasDiscountCodeRedeemed } from "./shopify-orders";
import { wasCodeSeenOnIngestedOrder } from "./mo-orders-store";
import { isShopifyConfigured } from "./shopify";
import { reportError } from "./observability";
import { parseIntEnv } from "./env-num";

/** Codes checked per run (env CONVERSION_SWEEP_MAX_CODES, 0 disables). */
export function conversionSweepMaxCodes(): number {
  return parseIntEnv("CONVERSION_SWEEP_MAX_CODES", 25, 0);
}

/** How long past its expiry a code stays in the sweep set. Redemption can
 * only happen while the discount is live; the grace covers clock skew and a
 * redemption on the expiry day itself. */
const EXPIRED_CODE_GRACE_DAYS = 7;

export interface ConversionSweepResult {
  /** Sends whose code was checked against Shopify this run. */
  checked: number;
  /** Sends newly marked shopify_order_matched (code redeemed). */
  matched: number;
  /** Conversations flipped to status='converted'. */
  convertedConversations: number;
  /** Checks where Shopify couldn't answer (retried next run). */
  unknown: number;
  /** False when Shopify or the DB is unconfigured (sweep skipped). */
  ran: boolean;
}

const EMPTY: ConversionSweepResult = {
  checked: 0,
  matched: 0,
  convertedConversations: 0,
  unknown: 0,
  ran: false,
};

/**
 * Run one bounded sweep: oldest unmatched, still-redeemable coded sends first
 * (oldest-first so nothing starves behind a steady stream of new sends).
 * Never throws.
 */
export async function runConversionSweep(
  maxCodes: number = conversionSweepMaxCodes()
): Promise<ConversionSweepResult> {
  const sql = getSql();
  if (!sql || !isShopifyConfigured() || maxCodes <= 0) return { ...EMPTY };

  try {
    const graceCutoff = new Date(
      Date.now() - EXPIRED_CODE_GRACE_DAYS * 86_400_000
    ).toISOString();
    const candidates = (await sql`
      SELECT ms.id, ms.discount_code, ms.sent_at, ec.session_id
        FROM marketing_sends ms
        JOIN email_captures ec ON ec.id = ms.email_capture_id
       WHERE ms.status = 'sent'
         AND ms.discount_code IS NOT NULL
         AND ms.shopify_order_matched = false
         AND (ms.discount_expires_at IS NULL OR ms.discount_expires_at > ${graceCutoff})
       ORDER BY ms.sent_at ASC NULLS LAST, ms.id ASC
       LIMIT ${maxCodes}
    `) as Array<{
      id: number;
      discount_code: string;
      sent_at: string | Date | null;
      session_id: string | null;
    }>;

    const result: ConversionSweepResult = { ...EMPTY, ran: true };
    for (const row of candidates) {
      result.checked++;
      // Short-circuit via the orders-webhook ingest (migration 0042): a code
      // already seen on an ingested order is definitively redeemed — no
      // Shopify round-trip. A miss means "ask Shopify" (mo_orders only fills
      // once the orders webhooks are registered; it is not a census).
      const code = String(row.discount_code);
      const redeemed = (await wasCodeSeenOnIngestedOrder(code))
        ? true
        : await wasDiscountCodeRedeemed(code);
      if (redeemed === null) {
        result.unknown++;
        continue; // unknown ≠ not redeemed — retry next run
      }
      if (!redeemed) continue; // definitively not (yet) redeemed — retry while live

      await sql`
        UPDATE marketing_sends
           SET shopify_order_matched = true, updated_at = now()
         WHERE id = ${row.id}
      `;
      result.matched++;

      // The thread the email was about: this session's most recently active
      // conversation as of the send (fallback: most recent overall, for a
      // send with no sent_at). May be gone (retention) — then nothing flips.
      if (row.session_id) {
        const sentAt =
          row.sent_at instanceof Date ? row.sent_at.toISOString() : row.sent_at;
        const flipped = (await sql`
          WITH target AS (
            SELECT c.id FROM conversations c
             WHERE c.session_id = ${row.session_id}
               AND (${sentAt}::timestamptz IS NULL OR c.created_at <= ${sentAt}::timestamptz)
             ORDER BY c.last_activity_at DESC, c.id DESC
             LIMIT 1
          ), upd AS (
            UPDATE conversations SET status = 'converted', updated_at = now()
             WHERE id IN (SELECT id FROM target) AND status <> 'converted'
            RETURNING 1
          )
          SELECT count(*)::int AS n FROM upd
        `) as Array<{ n: number }>;
        result.convertedConversations += Number(flipped[0]?.n ?? 0);
      }
    }
    return result;
  } catch (err) {
    reportError(err, { route: "lib/conversion-sweep", phase: "runConversionSweep" });
    return { ...EMPTY };
  }
}
