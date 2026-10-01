// Merge two customer rows into one person (I/O for lib/customer-fk-plan.mjs).
//
// Happens when Shopify reports an e-mail change onto an address that an
// Interessent (chat-only row) already uses, and on the bulk import when a
// Shopify customer and an e-mail-only row turn out to be the same person.
// Everything that points at the dropped row moves to the survivor in ONE
// transaction (the plan is enforced by customer-fk-plan.test.mjs); profile,
// drafts and other per-person fields fill the survivor's gaps; the dropped
// row's consent is then replayed through the consent resolver, so the newer
// decision wins. See docs/CUSTOMER_PLATFORM_PLAN.md §6.1.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { applyConsentAct } from "./consent-store";
import type { ConsentSource } from "./consent-core.mjs";

export interface MergeResult {
  ok: boolean;
  keepId: number;
  dropId: number;
  reason?: string;
}

/**
 * Merge `dropId` into `keepId`. With `newEmail`, the survivor takes that
 * address (it usually belongs to the dropped row). Never throws.
 */
export async function mergeCustomers(
  keepId: number,
  dropId: number,
  opts: { newEmail?: string | null; note?: string } = {},
  sql: Sql | null = getSql()
): Promise<MergeResult> {
  if (!sql) return { ok: false, keepId, dropId, reason: "no_db" };
  if (keepId === dropId) return { ok: false, keepId, dropId, reason: "same_row" };
  try {
    const rows = (await sql`
      SELECT id, email, email_consent_state, email_consent_level, email_consent_at, email_consent_source
        FROM customers WHERE id = ANY(${[keepId, dropId]}::bigint[])
    `) as Array<Record<string, unknown>>;
    const keep = rows.find((r) => Number(r.id) === keepId);
    const drop = rows.find((r) => Number(r.id) === dropId);
    if (!keep || !drop) return { ok: false, keepId, dropId, reason: "not_found" };
    const newEmail = opts.newEmail?.trim().toLowerCase() || null;

    await sql.transaction([
      sql`UPDATE conversations SET customer_id = ${keepId} WHERE customer_id = ${dropId}`,
      sql`UPDATE email_captures SET customer_id = ${keepId} WHERE customer_id = ${dropId}`,
      sql`UPDATE marketing_sends SET customer_id = ${keepId} WHERE customer_id = ${dropId}`,
      sql`UPDATE bundle_offers SET customer_id = ${keepId} WHERE customer_id = ${dropId}`,
      sql`DELETE FROM customer_oauth_tokens
           WHERE customer_id = ${dropId}
             AND EXISTS (SELECT 1 FROM customer_oauth_tokens t WHERE t.customer_id = ${keepId})`,
      sql`UPDATE customer_oauth_tokens SET customer_id = ${keepId} WHERE customer_id = ${dropId}`,
      sql`UPDATE customer_session_links SET customer_id = ${keepId} WHERE customer_id = ${dropId}`,
      sql`UPDATE email_messages SET customer_id = ${keepId} WHERE customer_id = ${dropId}`,
      sql`UPDATE physical_letters SET customer_id = ${keepId} WHERE customer_id = ${dropId}`,
      // A person is in a campaign once per cycle: the survivor's place wins.
      sql`DELETE FROM campaign_contacts d
           WHERE d.customer_id = ${dropId}
             AND EXISTS (SELECT 1 FROM campaign_contacts k
                          WHERE k.customer_id = ${keepId}
                            AND k.campaign_id IS NOT DISTINCT FROM d.campaign_id
                            AND k.cycle IS NOT DISTINCT FROM d.cycle)`,
      sql`UPDATE campaign_contacts SET customer_id = ${keepId} WHERE customer_id = ${dropId}`,
      sql`UPDATE campaign_sends SET customer_id = ${keepId} WHERE customer_id = ${dropId}`,
      sql`UPDATE customer_orders SET customer_id = ${keepId} WHERE customer_id = ${dropId}`,
      sql`DELETE FROM customer_facts WHERE customer_id = ${dropId}`,
      sql`UPDATE consent_events SET customer_id = ${keepId} WHERE customer_id = ${dropId}`,
      sql`UPDATE shopify_outbox SET customer_id = ${keepId} WHERE customer_id = ${dropId}`,
      sql`UPDATE inbox_items SET customer_id = ${keepId} WHERE customer_id = ${dropId}`,
      // The survivor keeps its values and fills its gaps from the dropped row.
      sql`
        UPDATE customers k SET
          first_seen_at           = LEAST(k.first_seen_at, d.first_seen_at),
          last_seen_at            = GREATEST(k.last_seen_at, d.last_seen_at),
          source                  = CASE WHEN d.first_seen_at < k.first_seen_at THEN d.source ELSE k.source END,
          identity_tier           = GREATEST(k.identity_tier, d.identity_tier),
          transactional_consent   = k.transactional_consent OR d.transactional_consent,
          first_name              = COALESCE(k.first_name, d.first_name),
          last_name               = COALESCE(k.last_name, d.last_name),
          language_override       = COALESCE(k.language_override, d.language_override),
          profile_summary         = COALESCE(k.profile_summary, d.profile_summary),
          profile_summary_updated_at = COALESCE(k.profile_summary_updated_at, d.profile_summary_updated_at),
          profile_data            = COALESCE(k.profile_data, d.profile_data),
          profile_depth           = COALESCE(k.profile_depth, d.profile_depth),
          persona_label           = COALESCE(k.persona_label, d.persona_label),
          profile_checked_at      = NULL,
          profile_objection_at    = COALESCE(k.profile_objection_at, d.profile_objection_at),
          postal_objection_at     = COALESCE(k.postal_objection_at, d.postal_objection_at),
          admin_instructions      = COALESCE(k.admin_instructions, d.admin_instructions),
          letter_draft_subject    = COALESCE(k.letter_draft_subject, d.letter_draft_subject),
          letter_draft_body       = COALESCE(k.letter_draft_body, d.letter_draft_body),
          postal_address          = COALESCE(k.postal_address, d.postal_address),
          postal_address_source   = COALESCE(k.postal_address_source, d.postal_address_source),
          shopify_account_summary = COALESCE(k.shopify_account_summary, d.shopify_account_summary),
          facts_dirty_at          = now()
        FROM customers d
        WHERE k.id = ${keepId} AND d.id = ${dropId}
      `,
      sql`DELETE FROM customers WHERE id = ${dropId}`,
      sql`
        UPDATE customers SET email = ${newEmail}
         WHERE id = ${keepId} AND ${newEmail}::text IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM customers o WHERE o.email = ${newEmail} AND o.id <> ${keepId})
      `,
      sql`UPDATE email_captures SET customer_id = ${keepId}
           WHERE ${newEmail}::text IS NOT NULL AND email = ${newEmail}`,
    ]);

    // The dropped row's consent is one more act: the resolver lets the newer win.
    const dropState = String(drop.email_consent_state ?? "not_subscribed");
    if (dropState !== "not_subscribed") {
      await applyConsentAct({
        customerId: keepId,
        incoming: {
          state: dropState as "subscribed" | "pending" | "unsubscribed",
          level: (drop.email_consent_level as "confirmed_opt_in" | "single_opt_in" | "unknown" | null) ?? null,
          at: drop.email_consent_at ? new Date(String(drop.email_consent_at)).toISOString() : null,
          source: (drop.email_consent_source as ConsentSource | null) ?? "mo",
        },
        originRef: `merge:${dropId}`,
        note: opts.note ?? "Zusammengeführt",
      }, sql);
    }
    return { ok: true, keepId, dropId };
  } catch (err) {
    reportError(err, { route: "lib/customer-merge-store", phase: "mergeCustomers" });
    return { ok: false, keepId, dropId, reason: "db_error" };
  }
}
