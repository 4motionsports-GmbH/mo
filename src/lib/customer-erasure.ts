// "Delete everything about this person" — THE one erasure path (Art. 17 GDPR).
//
// Every way a person can ask to be forgotten ends here:
//   * the "Meine Daten löschen" button in the Mo widget (signed-in customer,
//     POST /api/account/erase → account-history.eraseSignedInCustomer),
//   * the "Daten löschen" link in every marketing/Kampagne mail footer
//     (/api/erase-data, signed email token),
//   * the operator's "Kunde vollständig löschen" (Kunden detail + Kampagne
//     card, POST /api/admin/customers/erase).
//
// What it does per table is the contract in customer-erasure-core.mjs
// (ERASURE_PLAN) — a test fails when a migration adds personal data that the
// plan doesn't cover. In short: the customer, every chat on every device, all
// consent records, marketing and Kampagne mails, the Kampagne contact,
// correspondence, letters, feedback, sign-in state and the stored hero images
// are DELETED; aggregate records (order revenue, Shopify bundle products,
// knowledge-base Q&A, analytics reports) lose every link to the person; the
// address stays on the suppression list with reason 'erasure' so it is never
// mailed or re-imported from Shopify again.
//
// All database steps run in ONE transaction (all-or-nothing). Blob images are
// removed afterwards (fail-soft — an orphaned image is unreachable once no row
// points at it, but we still try to delete it).
//
// ONE deletion with Shopify (docs/CUSTOMER_PLATFORM_PLAN.md §8): an erasure
// started in Mo writes an erasure tombstone for the Shopify id (no import,
// reconciliation or webhook brings the person back) and enqueues the Shopify
// side — consent off at once, then Shopify's own data erasure
// (customerRequestDataErasure, SHOPIFY_ERASURE_SYNC). An erasure Shopify
// started (customers/redact, customers/delete webhooks → trigger "shopify")
// runs the same deletion here without asking Shopify again.

import { del } from "@vercel/blob";
import { getSql, type Sql } from "./db";
import { normalizeEmail } from "./email-capture-store";
import { heroBlobPathnameFromUrl } from "./email-hero-blob.mjs";
import { reportError } from "./observability";
import { enqueueShopifyErasure, runOutboxInline } from "./shopify-outbox";

export interface ErasureResult {
  /** A customer record existed and was deleted. */
  customerDeleted: boolean;
  deletedConversations: number;
  deletedCampaignContacts: number;
  deletedHeroImages: number;
  /** The Shopify side was enqueued (consent off + data erasure request). */
  shopifyErasureEnqueued: boolean;
}

export interface ErasureTarget {
  /** The customer to erase (Kunden, widget). */
  customerId?: number | null;
  /** An address to erase (mail link, Kampagne-only contact). */
  email?: string | null;
  /** A Kampagne contact to erase (Kampagne card); its customer goes with it. */
  campaignContactId?: number | null;
  /** A Shopify customer id to erase (customers/redact, customers/delete). */
  shopifyCustomerId?: string | null;
  /**
   * Who started it: "mo" (widget, mail link, admin — Shopify is asked to
   * erase too) or "shopify" (a Shopify webhook — Shopify is already erasing).
   */
  trigger?: "mo" | "shopify";
}

function isRealEmail(e: string | null | undefined): e is string {
  return typeof e === "string" && e.includes("@") && !e.startsWith("shopify:");
}

/**
 * Erase a person completely. Returns null only when no DB is configured or the
 * transaction failed (callers answer honestly with an error, never with a
 * claimed erasure). Idempotent: erasing someone already gone just re-asserts
 * the suppression entry.
 */
export async function erasePerson(
  target: ErasureTarget,
  sql: Sql | null = getSql()
): Promise<ErasureResult | null> {
  if (!sql) return null;
  const trigger = target.trigger ?? "mo";
  try {
    // ── 1. Resolve who this is ──────────────────────────────────────────────
    let customerId = target.customerId ?? null;
    const emails = new Set<string>();
    if (target.email) {
      const e = normalizeEmail(target.email);
      if (isRealEmail(e)) emails.add(e);
    }
    if (target.campaignContactId != null) {
      const rows = (await sql`
        SELECT email, customer_id FROM campaign_contacts WHERE id = ${target.campaignContactId}
      `) as Array<Record<string, unknown>>;
      if (rows[0]) {
        if (isRealEmail(String(rows[0].email))) emails.add(String(rows[0].email));
        if (customerId == null && rows[0].customer_id != null) customerId = Number(rows[0].customer_id);
      }
    }
    if (customerId == null && target.shopifyCustomerId) {
      const rows = (await sql`
        SELECT id FROM customers WHERE shopify_customer_id = ${target.shopifyCustomerId}
      `) as Array<Record<string, unknown>>;
      if (rows[0]) customerId = Number(rows[0].id);
    }
    if (customerId == null && emails.size > 0) {
      const rows = (await sql`
        SELECT id FROM customers WHERE email = ANY(${[...emails]}::text[]) LIMIT 1
      `) as Array<Record<string, unknown>>;
      if (rows[0]) customerId = Number(rows[0].id);
    }
    let shopifyCustomerId: string | null = target.shopifyCustomerId ?? null;
    if (customerId != null) {
      const rows = (await sql`
        SELECT email, shopify_customer_id FROM customers WHERE id = ${customerId}
      `) as Array<Record<string, unknown>>;
      if (rows[0]) {
        if (isRealEmail(String(rows[0].email))) emails.add(String(rows[0].email));
        shopifyCustomerId = (rows[0].shopify_customer_id as string | null) ?? shopifyCustomerId;
      } else {
        customerId = null;
      }
    }
    // -1 never matches an id, so one query shape serves "no customer" too.
    const cid = customerId ?? -1;
    const contactRows = (await sql`
      SELECT id, email FROM campaign_contacts
       WHERE customer_id = ${cid} OR email = ANY(${[...emails]}::text[])
          OR id = ${target.campaignContactId ?? -1}
    `) as Array<Record<string, unknown>>;
    for (const r of contactRows) if (isRealEmail(String(r.email))) emails.add(String(r.email));
    const emailList = [...emails];
    const contactIds = contactRows.map((r) => Number(r.id));

    const convRows = (await sql`
      SELECT id, session_id, conversation_key FROM conversations
       WHERE customer_id = ${cid}
          OR session_id IN (SELECT session_id FROM email_captures
                             WHERE email = ANY(${emailList}::text[]) AND session_id IS NOT NULL)
          OR session_id IN (SELECT session_id FROM customer_session_links WHERE customer_id = ${cid})
    `) as Array<Record<string, unknown>>;
    const sessionRows = (await sql`
      SELECT session_id FROM email_captures
       WHERE email = ANY(${emailList}::text[]) AND session_id IS NOT NULL
      UNION
      SELECT session_id FROM customer_session_links WHERE customer_id = ${cid}
    `) as Array<Record<string, unknown>>;
    const convIds = convRows.map((r) => Number(r.id));
    const sessionIds = [
      ...new Set(
        [...convRows.map((r) => r.session_id), ...sessionRows.map((r) => r.session_id)]
          .filter((s): s is string => typeof s === "string" && s.length > 0)
      ),
    ];
    // feedback.conversation_id is free text (session id, key or numeric id).
    const feedbackKeys = [
      ...sessionIds,
      ...convRows.map((r) => (r.conversation_key as string | null) ?? "").filter(Boolean),
      ...convIds.map(String),
    ];

    // Hero images of the person's drafts and sends (deleted from Blob after
    // the transaction).
    const heroRows = (await sql`
      SELECT hero_image_url AS a, hero_image_mobile_url AS b FROM marketing_sends
       WHERE customer_id = ${cid}
          OR email_capture_id IN (SELECT id FROM email_captures WHERE email = ANY(${emailList}::text[]))
      UNION ALL
      SELECT hero_image_url, hero_image_mobile_url FROM campaign_drafts
       WHERE contact_id = ANY(${contactIds}::bigint[])
      UNION ALL
      SELECT hero_image_url, NULL FROM campaign_sends
       WHERE contact_id = ANY(${contactIds}::bigint[]) OR email = ANY(${emailList}::text[])
    `) as Array<Record<string, unknown>>;
    const heroPaths = [
      ...new Set(
        heroRows
          .flatMap((r) => [r.a, r.b])
          .map((u) => heroBlobPathnameFromUrl(u))
          .filter((p): p is string => Boolean(p))
      ),
    ];

    // ── 2. Delete / anonymise, all-or-nothing ───────────────────────────────
    const reportMarker = JSON.stringify([{ customerId: cid }]);
    const queries = [
      // Aggregate order facts stay for the revenue KPIs; the link goes.
      sql`UPDATE mo_orders SET session_id = NULL, attribution_token = NULL, updated_at = now()
           WHERE session_id = ANY(${sessionIds}::text[])`,
      sql`DELETE FROM mo_attribution_tokens WHERE session_id = ANY(${sessionIds}::text[])`,
      sql`DELETE FROM kpi_events WHERE session_id = ANY(${sessionIds}::text[])`,
      sql`DELETE FROM customer_auth_pending WHERE session_id = ANY(${sessionIds}::text[])`,
      sql`DELETE FROM feedback
           WHERE email = ANY(${emailList}::text[])
              OR session_id = ANY(${sessionIds}::text[])
              OR conversation_id = ANY(${feedbackKeys}::text[])`,
      sql`DELETE FROM customer_merge_conflicts
           WHERE email_row_customer_id = ${cid} OR shopify_row_customer_id = ${cid}
              OR resolved_customer_id = ${cid}
              OR email_row_email = ANY(${emailList}::text[])
              OR shopify_email = ANY(${emailList}::text[])
              OR session_id = ANY(${sessionIds}::text[])
              OR shopify_customer_id = ${shopifyCustomerId ?? ""}`,
      // Stored Komplettanalyse reports: drop the person's profile section.
      sql`UPDATE analytics_reports
             SET sections = jsonb_set(sections, '{profiles}', COALESCE(
                   (SELECT jsonb_agg(p) FROM jsonb_array_elements(sections->'profiles') p
                     WHERE p->>'customerId' IS DISTINCT FROM ${String(cid)}), '[]'::jsonb))
           WHERE jsonb_typeof(sections->'profiles') = 'array'
             AND sections->'profiles' @> ${reportMarker}::jsonb`,
      sql`UPDATE analytics_reports
             SET progress = jsonb_set(progress, '{scratch,profiles}', COALESCE(
                   (SELECT jsonb_agg(p) FROM jsonb_array_elements(progress->'scratch'->'profiles') p
                     WHERE p->>'customerId' IS DISTINCT FROM ${String(cid)}), '[]'::jsonb))
           WHERE jsonb_typeof(progress->'scratch'->'profiles') = 'array'
             AND progress->'scratch'->'profiles' @> ${reportMarker}::jsonb`,
      // Shopify bundle products stay (shop products); the person link goes.
      sql`UPDATE bundle_offers SET customer_id = NULL, campaign_contact_id = NULL
           WHERE customer_id = ${cid} OR campaign_contact_id = ANY(${contactIds}::bigint[])`,
      sql`DELETE FROM ai_usage WHERE campaign_contact_id = ANY(${contactIds}::bigint[])`,
      sql`DELETE FROM campaign_sends
           WHERE contact_id = ANY(${contactIds}::bigint[]) OR email = ANY(${emailList}::text[])
              OR customer_id = ${cid}`,
      // campaign_drafts cascade with the contact.
      sql`DELETE FROM campaign_contacts WHERE id = ANY(${contactIds}::bigint[])`,
      sql`DELETE FROM email_messages m
           WHERE m.customer_id = ${cid}
              OR EXISTS (SELECT 1 FROM unnest(${emailList}::text[]) e
                          WHERE strpos(lower(m.to_address), e) > 0
                             OR strpos(lower(m.from_address), e) > 0)`,
      sql`DELETE FROM physical_letters WHERE customer_id = ${cid}`,
      sql`DELETE FROM marketing_sends
           WHERE customer_id = ${cid}
              OR email_capture_id IN (SELECT id FROM email_captures WHERE email = ANY(${emailList}::text[]))`,
      // messages + chat ai_usage cascade; qa_entries keep their text, lose the link.
      sql`WITH del AS (DELETE FROM conversations WHERE id = ANY(${convIds}::bigint[]) RETURNING 1)
          SELECT count(*)::int AS n, 'conversations' AS what FROM del`,
      // Never mail or re-import this address again (added_at = the erasure
      // time: only a NEWER consent act can ever lift it, consent-core.mjs).
      sql`INSERT INTO suppression_list (email, reason)
          SELECT e, 'erasure' FROM unnest(${emailList}::text[]) e
          ON CONFLICT (email) DO UPDATE SET reason = 'erasure', added_at = now()`,
      // ... and never re-create the Shopify identity from an import or webhook
      // before Shopify has redacted it.
      sql`INSERT INTO erasure_tombstones (shopify_customer_id, shopify_confirmed_at)
          SELECT ${shopifyCustomerId}::text, CASE WHEN ${trigger}::text = 'shopify' THEN now() ELSE NULL END
           WHERE ${shopifyCustomerId}::text IS NOT NULL
          ON CONFLICT (shopify_customer_id) DO UPDATE
            SET erased_at = now(),
                shopify_confirmed_at = COALESCE(EXCLUDED.shopify_confirmed_at, erasure_tombstones.shopify_confirmed_at)`,
      // Mirrored orders not (yet) linked to the row go too.
      sql`DELETE FROM customer_orders WHERE ${shopifyCustomerId}::text IS NOT NULL
           AND shopify_customer_id = ${shopifyCustomerId}`,
      // Open Shopify writes for the person are moot (a pending create carries the e-mail).
      sql`DELETE FROM shopify_outbox WHERE customer_id = ${cid} AND status <> 'done'`,
      sql`DELETE FROM email_captures WHERE email = ANY(${emailList}::text[])`,
      // OAuth tokens, session links, orders, facts, consent history, Eingang
      // items and campaign places cascade with the customer row.
      sql`WITH del AS (DELETE FROM customers WHERE id = ${cid} RETURNING 1)
          SELECT count(*)::int AS n, 'customers' AS what FROM del`,
    ];
    const results = (await sql.transaction(queries)) as Array<Array<Record<string, unknown>>>;
    const counted = (what: string) =>
      Number(results.flat().find((r) => r && r.what === what)?.n ?? 0);
    const deletedConversations = counted("conversations");
    const customerDeleted = counted("customers") > 0;

    // ── Shopify side: consent off + data erasure, only when Mo started it ───
    let shopifyErasureEnqueued = false;
    if (trigger === "mo" && shopifyCustomerId) {
      const ids = await enqueueShopifyErasure(shopifyCustomerId, sql);
      shopifyErasureEnqueued = ids.length > 0;
      await runOutboxInline(ids);
    }

    // ── 3. Stored hero images ───────────────────────────────────────────────
    let deletedHeroImages = 0;
    if (heroPaths.length > 0 && process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        await del(heroPaths);
        deletedHeroImages = heroPaths.length;
      } catch (err) {
        reportError(err, { route: "lib/customer-erasure", phase: "blob" });
      }
    }

    return {
      customerDeleted,
      deletedConversations,
      deletedCampaignContacts: contactIds.length,
      deletedHeroImages,
      shopifyErasureEnqueued,
    };
  } catch (err) {
    reportError(err, { route: "lib/customer-erasure", phase: "erase" });
    return null;
  }
}
