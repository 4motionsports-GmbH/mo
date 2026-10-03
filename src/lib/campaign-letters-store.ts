// campaign_letters (migration 0074) — the letter recipients of a campaign and
// their review state. Separate from campaign_contacts (whose every query
// assumes the e-mail consent). Rules in campaign-letter-core.mjs; the send
// path in campaign-letters.ts → physical-mail.submitLetter.
//
// Status flow: pending → drafted (AI or typed text) → approved (a person
// released THIS letter) → sending (claimed by a send step) → sent | failed;
// skipped (by hand) and excluded (left the audience: objection, consent now
// given, audience changed) on the side. The posted letter's progress
// (printed, posted, undeliverable) is physical_letters.status — joined, never
// copied.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { matchAudience, AUDIENCE_MAX_MEMBERS } from "./audience-store";
import type { Campaign } from "./campaigns-store";
import { DEFAULT_LETTER_COST_CENTS } from "./campaign-letter-core.mjs";

export type CampaignLetterStatus =
  | "pending"
  | "drafted"
  | "approved"
  | "sending"
  | "sent"
  | "skipped"
  | "excluded"
  | "failed";

export interface CampaignLetterItem {
  id: number;
  campaignId: number;
  customerId: number;
  status: CampaignLetterStatus;
  excludedReason: string | null;
  subject: string | null;
  body: string | null;
  edited: boolean;
  adminNote: string | null;
  draftedAt: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  pageCount: number | null;
  error: string | null;
  updatedAt: string | null;
  // The person, read fresh.
  email: string;
  firstName: string | null;
  lastName: string | null;
  language: "de" | "en";
  consentSubscribed: boolean;
  postalObjectionAt: string | null;
  postalAddress: Record<string, unknown> | null;
  postalAddressSource: string | null;
  postalAddressInvalidAt: string | null;
  lastLetterAt: string | null;
  // The posted letter (physical_letters), when there is one.
  letterStatus: string | null;
  costCents: number | null;
}

export interface CampaignLetterCounts {
  pending: number;
  drafted: number;
  approved: number;
  sending: number;
  sent: number;
  skipped: number;
  excluded: number;
  failed: number;
  /** Open letters whose person has no usable purchase address yet. */
  addressMissing: number;
  /** Open letters whose purchase address „Adressen holen“ would fetch or refresh now (checked at most daily). */
  addressFetchable: number;
  /** Postage of this campaign's posted letters (reported or assumed), cents. */
  spentCents: number;
}

const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);

/** Assumed postage per letter until Pingen reports the price. */
export function letterCostCents(): number {
  const n = Number.parseInt(process.env.PINGEN_LETTER_COST_CENTS ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LETTER_COST_CENTS;
}

function mapItem(r: Record<string, unknown>): CampaignLetterItem {
  return {
    id: Number(r.id),
    campaignId: Number(r.campaign_id),
    customerId: Number(r.customer_id),
    status: r.status as CampaignLetterStatus,
    excludedReason: (r.excluded_reason as string | null) ?? null,
    subject: (r.subject as string | null) ?? null,
    body: (r.body as string | null) ?? null,
    edited: r.edited === true,
    adminNote: (r.admin_note as string | null) ?? null,
    draftedAt: iso(r.drafted_at),
    approvedAt: iso(r.approved_at),
    sentAt: iso(r.sent_at),
    pageCount: r.page_count == null ? null : Number(r.page_count),
    error: (r.error as string | null) ?? null,
    updatedAt: iso(r.updated_at),
    email: String(r.email ?? ""),
    firstName: (r.first_name as string | null) ?? null,
    lastName: (r.last_name as string | null) ?? null,
    language: r.lang === "en" ? "en" : "de",
    consentSubscribed: r.email_consent_state === "subscribed",
    postalObjectionAt: iso(r.postal_objection_at),
    postalAddress: (r.postal_address as Record<string, unknown> | null) ?? null,
    postalAddressSource: (r.postal_address_source as string | null) ?? null,
    postalAddressInvalidAt: iso(r.postal_address_invalid_at),
    lastLetterAt: iso(r.last_letter_at),
    letterStatus: (r.letter_status as string | null) ?? null,
    costCents: r.cost_cents == null ? null : Number(r.cost_cents),
  };
}

export interface LetterRefreshResult {
  ok: boolean;
  matched: number;
  added: number;
  excluded: number;
  reopened: number;
}

/**
 * Materialise / refresh a campaign's letter recipients (letter_mode ≠ aus).
 * Mirrors the e-mail refresh: new matches come in for a dynamic audience
 * always, for a fixed one only on the first letter materialisation; an open
 * letter whose person objected, or (ohne_einwilligung) now has the e-mail
 * consent, leaves as excluded; for a dynamic audience an open letter that no
 * longer matches leaves too. A failed match changes nothing. Never throws.
 */
export async function refreshCampaignLetters(
  campaign: Campaign,
  sql: Sql | null = getSql()
): Promise<LetterRefreshResult> {
  const empty = { ok: false, matched: 0, added: 0, excluded: 0, reopened: 0 };
  if (!sql || campaign.kind === "einzel" || campaign.letterMode === "aus") return { ...empty, ok: true };
  const match = await matchAudience(
    campaign.audience,
    { limit: AUDIENCE_MAX_MEMBERS, letterMode: campaign.letterMode },
    sql
  );
  if (!match.ok) return empty;
  const ids = match.members.map((m) => m.customerId);
  const result: LetterRefreshResult = { ok: true, matched: match.total, added: 0, excluded: 0, reopened: 0 };
  try {
    const existing = (await sql`
      SELECT count(*)::int AS n FROM campaign_letters WHERE campaign_id = ${campaign.id}
    `) as Array<{ n: number }>;
    const allowNew = campaign.audienceMode === "dynamisch" || Number(existing[0]?.n ?? 0) === 0;
    if (allowNew && ids.length > 0) {
      const added = (await sql`
        WITH ins AS (
          INSERT INTO campaign_letters (campaign_id, customer_id, cycle)
          SELECT ${campaign.id}, x, 0 FROM unnest(${ids}::bigint[]) AS x
          ON CONFLICT (campaign_id, customer_id, cycle) DO NOTHING
          RETURNING 1
        )
        SELECT count(*)::int AS n FROM ins
      `) as Array<{ n: number }>;
      result.added = Number(added[0]?.n ?? 0);
    }
    // Back in the audience after leaving it (dynamic) — open again.
    if (ids.length > 0) {
      const reopened = (await sql`
        WITH upd AS (
          UPDATE campaign_letters
             SET status = CASE WHEN body IS NOT NULL AND btrim(body) <> '' THEN 'drafted' ELSE 'pending' END,
                 excluded_reason = NULL, updated_at = now()
           WHERE campaign_id = ${campaign.id}
             AND status = 'excluded'
             AND customer_id = ANY(${ids}::bigint[])
          RETURNING 1
        )
        SELECT count(*)::int AS n FROM upd
      `) as Array<{ n: number }>;
      result.reopened = Number(reopened[0]?.n ?? 0);
    }
    // Gates that apply whatever the audience mode: an objection, or (only
    // letters to people without consent) a consent given since.
    const gated = (await sql`
      WITH upd AS (
        UPDATE campaign_letters l
           SET status = 'excluded',
               excluded_reason = CASE WHEN c.postal_objection_at IS NOT NULL THEN 'widerspruch' ELSE 'einwilligung' END,
               updated_at = now()
          FROM customers c
         WHERE c.id = l.customer_id
           AND l.campaign_id = ${campaign.id}
           AND l.status IN ('pending', 'drafted', 'approved', 'failed')
           AND (c.postal_objection_at IS NOT NULL
                OR (${campaign.letterMode} = 'ohne_einwilligung' AND c.email_consent_state = 'subscribed'))
        RETURNING 1
      )
      SELECT count(*)::int AS n FROM upd
    `) as Array<{ n: number }>;
    result.excluded += Number(gated[0]?.n ?? 0);
    if (campaign.audienceMode === "dynamisch") {
      const left = (await sql`
        WITH upd AS (
          UPDATE campaign_letters
             SET status = 'excluded', excluded_reason = 'zielgruppe', updated_at = now()
           WHERE campaign_id = ${campaign.id}
             AND status IN ('pending', 'drafted', 'failed')
             AND NOT (customer_id = ANY(${ids}::bigint[]))
          RETURNING 1
        )
        SELECT count(*)::int AS n FROM upd
      `) as Array<{ n: number }>;
      result.excluded += Number(left[0]?.n ?? 0);
    }
    return result;
  } catch (err) {
    reportError(err, { route: "lib/campaign-letters-store", phase: "refresh" });
    return { ...result, ok: false };
  }
}

/** The campaign's letters with the person read fresh, newest activity first. */
export async function listCampaignLetters(
  campaignId: number,
  opts: { limit?: number; ids?: number[] } = {},
  sql: Sql | null = getSql()
): Promise<CampaignLetterItem[]> {
  if (!sql) return [];
  const limit = Math.max(1, Math.min(opts.limit ?? 1000, 5000));
  const ids = opts.ids && opts.ids.length > 0 ? opts.ids : null;
  try {
    const rows = (await sql`
      SELECT l.*, c.email, c.first_name, c.last_name, c.email_consent_state, c.postal_objection_at,
             c.postal_address, c.postal_address_source, c.postal_address_invalid_at,
             CASE WHEN c.language_override IN ('de', 'en') THEN c.language_override
                  WHEN lower(COALESCE(c.locale, '')) LIKE 'en%' THEN 'en'
                  ELSE 'de' END AS lang,
             pl.status AS letter_status, pl.cost_cents,
             (SELECT max(p.created_at) FROM physical_letters p
               WHERE p.customer_id = l.customer_id
                 AND p.status NOT IN ('failed', 'cancelled')
                 AND (l.physical_letter_id IS NULL OR p.id <> l.physical_letter_id)) AS last_letter_at
        FROM campaign_letters l
        JOIN customers c ON c.id = l.customer_id
        LEFT JOIN physical_letters pl ON pl.id = l.physical_letter_id
       WHERE l.campaign_id = ${campaignId}
         AND (${ids}::bigint[] IS NULL OR l.id = ANY(${ids}::bigint[]))
       ORDER BY CASE l.status
                  WHEN 'approved' THEN 0 WHEN 'drafted' THEN 1 WHEN 'pending' THEN 2 WHEN 'failed' THEN 3
                  WHEN 'sending' THEN 4 WHEN 'sent' THEN 5 WHEN 'skipped' THEN 6 ELSE 7 END,
                l.updated_at DESC, l.id DESC
       LIMIT ${limit}
    `) as Array<Record<string, unknown>>;
    return rows.map(mapItem);
  } catch (err) {
    reportError(err, { route: "lib/campaign-letters-store", phase: "list" });
    return [];
  }
}

/** One letter with its person (for a send step or the preview). */
export async function getCampaignLetter(id: number, sql: Sql | null = getSql()): Promise<CampaignLetterItem | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`SELECT campaign_id FROM campaign_letters WHERE id = ${id}`) as Array<{ campaign_id: number }>;
    if (!rows[0]) return null;
    const items = await listCampaignLetters(Number(rows[0].campaign_id), { ids: [id], limit: 1 }, sql);
    return items[0] ?? null;
  } catch (err) {
    reportError(err, { route: "lib/campaign-letters-store", phase: "get" });
    return null;
  }
}

export async function getCampaignLetterCounts(
  campaignId: number,
  sql: Sql | null = getSql()
): Promise<CampaignLetterCounts> {
  const empty: CampaignLetterCounts = {
    pending: 0, drafted: 0, approved: 0, sending: 0, sent: 0, skipped: 0, excluded: 0, failed: 0,
    addressMissing: 0, addressFetchable: 0, spentCents: 0,
  };
  if (!sql) return empty;
  try {
    const [rows, spent] = (await Promise.all([
      sql`
        SELECT count(*) FILTER (WHERE l.status = 'pending')::int  AS pending,
               count(*) FILTER (WHERE l.status = 'drafted')::int  AS drafted,
               count(*) FILTER (WHERE l.status = 'approved')::int AS approved,
               count(*) FILTER (WHERE l.status = 'sending')::int  AS sending,
               count(*) FILTER (WHERE l.status = 'sent')::int     AS sent,
               count(*) FILTER (WHERE l.status = 'skipped')::int  AS skipped,
               count(*) FILTER (WHERE l.status = 'excluded')::int AS excluded,
               count(*) FILTER (WHERE l.status = 'failed')::int   AS failed,
               count(*) FILTER (WHERE l.status IN ('pending', 'drafted', 'approved', 'failed')
                                  AND (c.postal_address IS NULL
                                       OR c.postal_address_source IS DISTINCT FROM 'purchase'))::int AS address_missing,
               count(*) FILTER (WHERE l.status IN ('pending', 'drafted', 'approved', 'failed')
                                  AND (c.postal_address IS NULL
                                       OR c.postal_address_source IS DISTINCT FROM 'purchase'
                                       OR c.postal_address_order_id IS DISTINCT FROM lo.shopify_order_id)
                                  AND (c.postal_address_checked_at IS NULL
                                       OR c.postal_address_checked_at < now() - interval '1 day'))::int AS address_fetchable
          FROM campaign_letters l
          JOIN customers c ON c.id = l.customer_id
          LEFT JOIN LATERAL (
            SELECT o.shopify_order_id
              FROM customer_orders o
             WHERE o.customer_id = c.id
               AND o.cancelled_at IS NULL
               AND upper(COALESCE(o.financial_status, '')) IN ('PAID', 'PARTIALLY_REFUNDED')
             ORDER BY o.processed_at DESC, o.id DESC
             LIMIT 1
          ) lo ON true
         WHERE l.campaign_id = ${campaignId}
      `,
      sql`
        SELECT COALESCE(sum(COALESCE(cost_cents, ${letterCostCents()})), 0)::int AS cents
          FROM physical_letters
         WHERE campaign_id = ${campaignId} AND status NOT IN ('failed', 'cancelled')
      `,
    ])) as [Array<Record<string, unknown>>, Array<{ cents: number }>];
    const r = rows[0] ?? {};
    const n = (k: string) => Number(r[k] ?? 0);
    return {
      pending: n("pending"), drafted: n("drafted"), approved: n("approved"), sending: n("sending"),
      sent: n("sent"), skipped: n("skipped"), excluded: n("excluded"), failed: n("failed"),
      addressMissing: n("address_missing"),
      addressFetchable: n("address_fetchable"),
      spentCents: Number(spent[0]?.cents ?? 0),
    };
  } catch (err) {
    reportError(err, { route: "lib/campaign-letters-store", phase: "counts" });
    return empty;
  }
}

/** Open letters whose person still lacks a purchase address (address fill). */
export async function listLetterCustomersNeedingAddress(
  campaignId: number,
  limit: number,
  sql: Sql | null = getSql()
): Promise<number[]> {
  if (!sql) return [];
  try {
    // No purchase address yet, or one from an order that is no longer the
    // latest completed one (moved since?) — each re-checked at most daily.
    const rows = (await sql`
      SELECT l.customer_id
        FROM campaign_letters l
        JOIN customers c ON c.id = l.customer_id
        LEFT JOIN LATERAL (
          SELECT o.shopify_order_id
            FROM customer_orders o
           WHERE o.customer_id = c.id
             AND o.cancelled_at IS NULL
             AND upper(COALESCE(o.financial_status, '')) IN ('PAID', 'PARTIALLY_REFUNDED')
           ORDER BY o.processed_at DESC, o.id DESC
           LIMIT 1
        ) lo ON true
       WHERE l.campaign_id = ${campaignId}
         AND l.status IN ('pending', 'drafted', 'approved', 'failed')
         AND (c.postal_address IS NULL
              OR c.postal_address_source IS DISTINCT FROM 'purchase'
              OR c.postal_address_order_id IS DISTINCT FROM lo.shopify_order_id)
         AND (c.postal_address_checked_at IS NULL OR c.postal_address_checked_at < now() - interval '1 day')
       ORDER BY l.id
       LIMIT ${Math.max(1, Math.min(limit, 500))}
    `) as Array<{ customer_id: number }>;
    return rows.map((r) => Number(r.customer_id));
  } catch (err) {
    reportError(err, { route: "lib/campaign-letters-store", phase: "needAddress" });
    return [];
  }
}

/** Pending letters (no text yet), oldest first. */
export async function listLettersNeedingDraft(
  campaignId: number,
  limit: number,
  sql: Sql | null = getSql()
): Promise<number[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT id FROM campaign_letters
       WHERE campaign_id = ${campaignId} AND status = 'pending'
       ORDER BY id
       LIMIT ${Math.max(1, Math.min(limit, 100))}
    `) as Array<{ id: number }>;
    return rows.map((r) => Number(r.id));
  } catch (err) {
    reportError(err, { route: "lib/campaign-letters-store", phase: "needDraft" });
    return [];
  }
}

/** Store a letter text (AI draft or the operator's edit). An approved letter goes back to review. */
export async function saveCampaignLetterText(
  id: number,
  input: { subject: string; body: string; edited: boolean },
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = await sql`
      UPDATE campaign_letters
         SET subject = ${input.subject}, body = ${input.body},
             edited = CASE WHEN ${input.edited} THEN true ELSE false END,
             status = 'drafted', drafted_at = now(), approved_at = NULL, error = NULL, updated_at = now()
       WHERE id = ${id} AND status IN ('pending', 'drafted', 'approved', 'failed')
      RETURNING id
    `;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/campaign-letters-store", phase: "saveText" });
    return false;
  }
}

/** A person releases THIS letter (drafted → approved). */
export async function approveCampaignLetter(id: number, sql: Sql | null = getSql()): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = await sql`
      UPDATE campaign_letters SET status = 'approved', approved_at = now(), updated_at = now()
       WHERE id = ${id} AND status = 'drafted'
         AND subject IS NOT NULL AND btrim(subject) <> '' AND body IS NOT NULL AND btrim(body) <> ''
      RETURNING id
    `;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/campaign-letters-store", phase: "approve" });
    return false;
  }
}

export async function unapproveCampaignLetter(id: number, sql: Sql | null = getSql()): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = await sql`
      UPDATE campaign_letters SET status = 'drafted', approved_at = NULL, updated_at = now()
       WHERE id = ${id} AND status = 'approved'
      RETURNING id
    `;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/campaign-letters-store", phase: "unapprove" });
    return false;
  }
}

export async function skipCampaignLetter(id: number, skip: boolean, sql: Sql | null = getSql()): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = skip
      ? await sql`
          UPDATE campaign_letters SET status = 'skipped', approved_at = NULL, updated_at = now()
           WHERE id = ${id} AND status IN ('pending', 'drafted', 'approved', 'failed')
          RETURNING id
        `
      : await sql`
          UPDATE campaign_letters
             SET status = CASE WHEN body IS NOT NULL AND btrim(body) <> '' THEN 'drafted' ELSE 'pending' END,
                 updated_at = now()
           WHERE id = ${id} AND status = 'skipped'
          RETURNING id
        `;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/campaign-letters-store", phase: "skip" });
    return false;
  }
}

/** Claim up to `limit` approved letters for one send step (approved → sending), oldest approval first. */
export async function claimApprovedLetters(
  campaignId: number,
  limit: number,
  sql: Sql | null = getSql()
): Promise<number[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      UPDATE campaign_letters SET status = 'sending', updated_at = now()
       WHERE id IN (
         SELECT id FROM campaign_letters
          WHERE campaign_id = ${campaignId} AND status = 'approved'
          ORDER BY approved_at, id
          LIMIT ${Math.max(1, Math.min(limit, 25))}
          FOR UPDATE SKIP LOCKED
       )
      RETURNING id
    `) as Array<{ id: number }>;
    return rows.map((r) => Number(r.id));
  } catch (err) {
    reportError(err, { route: "lib/campaign-letters-store", phase: "claim" });
    return [];
  }
}

export async function markCampaignLetterSent(
  id: number,
  input: { physicalLetterId: number; pageCount: number | null },
  sql: Sql | null = getSql()
): Promise<void> {
  if (!sql) return;
  try {
    await sql`
      UPDATE campaign_letters
         SET status = 'sent', sent_at = now(), physical_letter_id = ${input.physicalLetterId},
             page_count = ${input.pageCount}, error = NULL, updated_at = now()
       WHERE id = ${id}
    `;
  } catch (err) {
    reportError(err, { route: "lib/campaign-letters-store", phase: "markSent" });
  }
}

/**
 * A letter that could not go out. `backTo` 'drafted' when a gate refused it
 * before anything was submitted (it goes back to review with the reason);
 * 'failed' when the submission itself failed.
 */
export async function markCampaignLetterRefused(
  id: number,
  input: { error: string; backTo: "drafted" | "failed"; physicalLetterId?: number | null },
  sql: Sql | null = getSql()
): Promise<void> {
  if (!sql) return;
  try {
    await sql`
      UPDATE campaign_letters
         SET status = ${input.backTo}, approved_at = NULL, error = ${input.error.slice(0, 500)},
             physical_letter_id = COALESCE(${input.physicalLetterId ?? null}::bigint, physical_letter_id),
             updated_at = now()
       WHERE id = ${id}
    `;
  } catch (err) {
    reportError(err, { route: "lib/campaign-letters-store", phase: "markRefused" });
  }
}

/**
 * Letters stuck in 'sending' (a step that died): without a posted letter they
 * go back to approved — nothing was posted for them; with one, they follow it
 * (submitted to Pingen → sent, failed → failed). A posted letter that never
 * reached Pingen stays in 'sending' — a retry could print twice.
 */
export async function recoverStuckLetters(minutes = 15, sql: Sql | null = getSql()): Promise<number> {
  if (!sql) return 0;
  try {
    const rows = await sql`
      UPDATE campaign_letters SET status = 'approved', updated_at = now()
       WHERE status = 'sending' AND physical_letter_id IS NULL
         AND updated_at < now() - make_interval(mins => ${minutes})
      RETURNING id
    `;
    const settled = await sql`
      UPDATE campaign_letters l
         SET status = CASE WHEN p.status IN ('failed', 'cancelled') THEN 'failed' ELSE 'sent' END,
             sent_at = CASE WHEN p.status IN ('failed', 'cancelled') THEN l.sent_at ELSE COALESCE(p.submitted_at, p.created_at) END,
             error = CASE WHEN p.status IN ('failed', 'cancelled') THEN COALESCE(p.error, 'Pingen hat den Brief abgelehnt.') ELSE NULL END,
             updated_at = now()
        FROM physical_letters p
       WHERE l.status = 'sending'
         AND p.id = l.physical_letter_id
         AND l.updated_at < now() - make_interval(mins => ${minutes})
         AND (p.provider_letter_id IS NOT NULL OR p.status IN ('failed', 'cancelled'))
      RETURNING l.id
    `;
    return rows.length + settled.length;
  } catch (err) {
    reportError(err, { route: "lib/campaign-letters-store", phase: "recoverStuck" });
    return 0;
  }
}

/**
 * Attach the physical_letters row BEFORE submitting it to Pingen: a step that
 * dies after this point leaves the letter in 'sending' WITH its row, so the
 * recovery never re-claims it (a second submission would print twice).
 */
export async function attachPhysicalLetter(
  id: number,
  physicalLetterId: number,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = await sql`
      UPDATE campaign_letters SET physical_letter_id = ${physicalLetterId}, updated_at = now()
       WHERE id = ${id} AND status = 'sending'
      RETURNING id
    `;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/campaign-letters-store", phase: "attach" });
    return false;
  }
}

/** A gate that will not change by itself (objection, consent now given): the letter leaves the queue. */
export async function excludeCampaignLetter(
  id: number,
  reason: "widerspruch" | "einwilligung",
  sql: Sql | null = getSql()
): Promise<void> {
  if (!sql) return;
  try {
    await sql`
      UPDATE campaign_letters
         SET status = 'excluded', excluded_reason = ${reason}, approved_at = NULL, updated_at = now()
       WHERE id = ${id} AND status IN ('pending', 'drafted', 'approved', 'sending', 'failed')
    `;
  } catch (err) {
    reportError(err, { route: "lib/campaign-letters-store", phase: "exclude" });
  }
}
