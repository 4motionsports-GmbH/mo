// Manual control over a person's marketing opt-out — "Abmelden" and
// "Abmeldung aufheben" in Kunden and Kampagne (decisions in the pure
// marketing-optout-core.mjs).
//
// Opting out reuses the ONE unsubscribe primitive (`unsubscribeByEmail`, the
// same the mail link and the bounce webhook use) with reason 'manual', then
// takes the Kampagne contact out of the queue at once instead of at the next
// sync. Lifting is the exact inverse of what an unsubscribe changed:
//   - the block-list row is removed (only for a liftable reason),
//   - the chat consent capture gets its DOI back when it HAD been confirmed
//     (unsubscribe only resets the status; doi_confirmed_at survives),
//   - the 30-day KPI attribution on Kampagne sends made by that unsubscribe is
//     cleared, so an accidental click doesn't count as an Abmeldung,
//   - a Kampagne contact returns to its queue state (drafted when a draft
//     exists, else pending).
// Neither direction sends any e-mail. Consent from Shopify is not touched: a
// contact unsubscribed on the Shopify side is re-subscribed there.

import { getSql, type Sql } from "./db";
import { normalizeEmail, unsubscribeByEmail } from "./email-capture-store";
import { syncCustomerConsent } from "./customer-store";
import { optOutState } from "./marketing-optout-core.mjs";
import { reportError } from "./observability";

export interface OptOutState {
  blocked: boolean;
  /** suppression_list.reason: unsubscribe | manual | bounce | complaint | erasure | null */
  reason: string | null;
  /** German label for the reason. */
  label: string | null;
  since: string | null;
  canLift: boolean;
  liftBlockedWhy: string | null;
}

export type LiftResult =
  | { ok: true; state: OptOutState; restoredContacts: number }
  | { ok: false; reason: "not_blocked" | "not_allowed" | "unavailable"; message: string };

function iso(v: unknown): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The opt-out state of one address (null = database unavailable). */
export async function getOptOutState(
  email: string,
  sql: Sql | null = getSql()
): Promise<OptOutState | null> {
  if (!sql) return null;
  const e = normalizeEmail(email);
  try {
    const [suppression, capture] = (await sql.transaction([
      sql`SELECT reason, added_at FROM suppression_list WHERE email = ${e}`,
      sql`SELECT max(unsubscribed_at) AS unsubscribed_at FROM email_captures WHERE email = ${e}`,
    ])) as Array<Array<Record<string, unknown>>>;
    const row = suppression[0];
    return optOutState(
      row ? { reason: (row.reason as string | null) ?? null, addedAt: iso(row.added_at) } : null,
      iso(capture[0]?.unsubscribed_at)
    ) as OptOutState;
  } catch (err) {
    reportError(err, { route: "lib/marketing-optout", phase: "getOptOutState" });
    return null;
  }
}

/**
 * Opt the address out on the operator's word (e.g. the person asked by phone).
 * Same effect as the mail link, reason 'manual'; the Kampagne contact leaves
 * the queue immediately. Returns the new state, or null on failure.
 */
export async function optOutManually(
  email: string,
  sql: Sql | null = getSql()
): Promise<OptOutState | null> {
  if (!sql) return null;
  const e = normalizeEmail(email);
  try {
    if (!(await unsubscribeByEmail(e, "manual", sql))) return null;
    await sql`
      UPDATE campaign_contacts SET status = 'suppressed'
       WHERE email = ${e} AND is_test = false AND status <> 'suppressed'
    `;
    await syncCustomerConsent(e, sql);
    return await getOptOutState(e, sql);
  } catch (err) {
    reportError(err, { route: "lib/marketing-optout", phase: "optOutManually" });
    return null;
  }
}

/** Lift a liftable opt-out — the exact inverse of the unsubscribe (see top). */
export async function liftOptOut(email: string, sql: Sql | null = getSql()): Promise<LiftResult> {
  const unavailable = {
    ok: false as const,
    reason: "unavailable" as const,
    message: "Datenbank nicht erreichbar — es wurde nichts geändert.",
  };
  if (!sql) return unavailable;
  const e = normalizeEmail(email);
  const state = await getOptOutState(e, sql);
  if (!state) return unavailable;
  if (!state.blocked) {
    return {
      ok: false,
      reason: "not_blocked",
      message:
        "Die Adresse ist bei uns nicht gesperrt. Ist der Kontakt trotzdem unterdrückt, kommt die Abmeldung aus Shopify — dort die E-Mail-Werbung wieder aktivieren und synchronisieren.",
    };
  }
  if (!state.canLift) {
    return { ok: false, reason: "not_allowed", message: state.liftBlockedWhy ?? "Diese Sperre bleibt bestehen." };
  }
  try {
    const since = state.since;
    const results = (await sql.transaction([
      sql`
        DELETE FROM suppression_list
         WHERE email = ${e}
           AND (reason IS NULL OR reason IN ('unsubscribe', 'manual'))
      `,
      sql`
        UPDATE email_captures
           SET unsubscribed_at = NULL,
               marketing_doi_status = CASE
                 WHEN marketing_consent AND doi_confirmed_at IS NOT NULL THEN 'confirmed'
                 ELSE 'none'
               END
         WHERE email = ${e} AND unsubscribed_at IS NOT NULL
      `,
      sql`
        UPDATE campaign_sends SET unsubscribed_at = NULL
         WHERE email = ${e}
           AND unsubscribed_at IS NOT NULL
           AND ${since}::timestamptz IS NOT NULL
           AND unsubscribed_at >= ${since}::timestamptz - interval '1 minute'
      `,
      sql`
        UPDATE campaign_contacts cc
           SET status = CASE
                 WHEN EXISTS (SELECT 1 FROM campaign_drafts d WHERE d.contact_id = cc.id) THEN 'drafted'
                 ELSE 'pending'
               END
         WHERE cc.email = ${e} AND cc.status = 'suppressed' AND cc.is_test = false
        RETURNING cc.id
      `,
    ])) as Array<Array<Record<string, unknown>>>;
    await syncCustomerConsent(e, sql);
    const after = await getOptOutState(e, sql);
    return {
      ok: true,
      state: after ?? { ...state, blocked: false, canLift: false },
      restoredContacts: results[3]?.length ?? 0,
    };
  } catch (err) {
    reportError(err, { route: "lib/marketing-optout", phase: "liftOptOut" });
    return unavailable;
  }
}
