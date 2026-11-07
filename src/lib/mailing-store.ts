// Rundmail (bulk mail) — the I/O of its content, its frozen release and its
// batches (tables campaign_mailings + campaign_mailing_batches, migration
// 0081). The rules are pure and tested (mailing-core.mjs, mailing-checks.mjs);
// the runner that sends is mailing-send.ts; docs/CAMPAIGNS.md §9.
//
// Invariants this file guarantees in SQL (not only in the UI):
//   * the content can only change while NOT frozen (frozen_at IS NULL);
//   * a release freezes exactly the content version that was test-sent
//     (content_version = test_version = the version the operator released);
//   * a recipient is claimed for exactly ONE batch, atomically
//     (FOR UPDATE SKIP LOCKED in the same statement that creates the batch),
//     so two runners can never send the same person twice;
//   * a batch is settled in ONE transaction: its send rows, the recipients'
//     status and the batch status change together.
//
// Fail-soft like every store (null / empty / false on errors, reported); the
// runner treats an unknown outcome as „not sent yet“ only where that is safe.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { normalizeEmail } from "./email-capture-store";
import { normalizeMailTemplateDoc } from "./mail-template-doc.mjs";
import { parseMailingRate, type MailingRateKey } from "./mailing-core.mjs";

export type MailingDoc = ReturnType<typeof normalizeMailTemplateDoc>;

export interface MailingMerges {
  body: Array<{ fallback: string }>;
  greetings: Array<{ text: string; fallback: string }>;
  subject: Array<{ fallback: string }>;
}

export interface Mailing {
  campaignId: number;
  subject: string;
  preheader: string | null;
  doc: MailingDoc;
  language: "de" | "en";
  sourceTemplateId: number | null;
  rate: MailingRateKey;
  engagedFirst: boolean;
  contentVersion: number;
  testVersion: number | null;
  testSentAt: string | null;
  testSentTo: number | null;
  frozenVersion: number | null;
  frozenAt: string | null;
  frozenSubject: string | null;
  frozenHash: string | null;
  frozenFrom: string | null;
  frozenReplyTo: string | null;
  links: Array<{ url: string }>;
  merges: MailingMerges;
  materializedAt: string | null;
  finishedAt: string | null;
  nextBatchAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  updatedAt: string | null;
}

/** The frozen HTML / text — loaded only by the runner and the viewer (big). */
export interface MailingFrozenBodies {
  html: string;
  text: string;
}

const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);

function parseMerges(v: unknown): MailingMerges {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const arr = (x: unknown) => (Array.isArray(x) ? x : []);
  return {
    body: arr(o.body).map((m) => ({ fallback: String((m as { fallback?: unknown })?.fallback ?? "") })),
    greetings: arr(o.greetings).map((g) => ({
      text: String((g as { text?: unknown })?.text ?? ""),
      fallback: String((g as { fallback?: unknown })?.fallback ?? ""),
    })),
    subject: arr(o.subject).map((m) => ({ fallback: String((m as { fallback?: unknown })?.fallback ?? "") })),
  };
}

function parseLinks(v: unknown): Array<{ url: string }> {
  return (Array.isArray(v) ? v : [])
    .map((l) => ({ url: String((l as { url?: unknown })?.url ?? "") }))
    .filter((l) => /^https?:\/\//.test(l.url));
}

function mapMailing(r: Record<string, unknown>): Mailing {
  return {
    campaignId: Number(r.campaign_id),
    subject: String(r.subject ?? ""),
    preheader: (r.preheader as string | null) ?? null,
    doc: normalizeMailTemplateDoc(r.doc),
    language: r.language === "en" ? "en" : "de",
    sourceTemplateId: r.source_template_id == null ? null : Number(r.source_template_id),
    rate: parseMailingRate(r.rate),
    engagedFirst: r.engaged_first !== false,
    contentVersion: Number(r.content_version ?? 1),
    testVersion: r.test_version == null ? null : Number(r.test_version),
    testSentAt: iso(r.test_sent_at),
    testSentTo: r.test_sent_to == null ? null : Number(r.test_sent_to),
    frozenVersion: r.frozen_version == null ? null : Number(r.frozen_version),
    frozenAt: iso(r.frozen_at),
    frozenSubject: (r.frozen_subject as string | null) ?? null,
    frozenHash: (r.frozen_hash as string | null) ?? null,
    frozenFrom: (r.frozen_from as string | null) ?? null,
    frozenReplyTo: (r.frozen_reply_to as string | null) ?? null,
    links: parseLinks(r.links),
    merges: parseMerges(r.merges),
    materializedAt: iso(r.materialized_at),
    finishedAt: iso(r.finished_at),
    nextBatchAt: iso(r.next_batch_at),
    lastError: (r.last_error as string | null) ?? null,
    lastErrorAt: iso(r.last_error_at),
    updatedAt: iso(r.updated_at),
  };
}

function isMissingTable(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  return e?.code === "42P01" || e?.cause?.code === "42P01";
}

// ── content ──────────────────────────────────────────────────────────────────

/** A Rundmail's content and state (without the frozen bodies), or null. Never throws. */
export async function getMailing(campaignId: number, sql: Sql | null = getSql()): Promise<Mailing | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT campaign_id, subject, preheader, doc, language, source_template_id, rate, engaged_first,
             content_version, test_version, test_sent_at, test_sent_to, frozen_version, frozen_at,
             frozen_subject, frozen_hash, frozen_from, frozen_reply_to, links, merges,
             materialized_at, finished_at, next_batch_at, last_error, last_error_at, updated_at
        FROM campaign_mailings WHERE campaign_id = ${campaignId}
    `) as Array<Record<string, unknown>>;
    return rows[0] ? mapMailing(rows[0]) : null;
  } catch (err) {
    if (!isMissingTable(err)) reportError(err, { route: "lib/mailing-store", phase: "get" });
    return null;
  }
}

/** The frozen HTML and text of a released Rundmail, or null. Never throws. */
export async function getMailingFrozenBodies(campaignId: number, sql: Sql | null = getSql()): Promise<MailingFrozenBodies | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT frozen_html, frozen_text FROM campaign_mailings
       WHERE campaign_id = ${campaignId} AND frozen_at IS NOT NULL
    `) as Array<{ frozen_html: string | null; frozen_text: string | null }>;
    const r = rows[0];
    return r && r.frozen_html && r.frozen_text != null ? { html: r.frozen_html, text: r.frozen_text } : null;
  } catch (err) {
    reportError(err, { route: "lib/mailing-store", phase: "frozenBodies" });
    return null;
  }
}

/** Create the content row of a new Rundmail (idempotent). */
export async function createMailing(
  campaignId: number,
  input: { doc: unknown; subject?: string; preheader?: string | null; sourceTemplateId?: number | null },
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    await sql`
      INSERT INTO campaign_mailings (campaign_id, subject, preheader, doc, source_template_id)
      VALUES (${campaignId}, ${input.subject ?? ""}, ${input.preheader ?? null},
              ${JSON.stringify(normalizeMailTemplateDoc(input.doc))}::jsonb, ${input.sourceTemplateId ?? null})
      ON CONFLICT (campaign_id) DO NOTHING
    `;
    return true;
  } catch (err) {
    reportError(err, { route: "lib/mailing-store", phase: "create" });
    return false;
  }
}

export type SaveMailingResult =
  | { ok: true; mailing: Mailing }
  | { ok: false; reason: "no_db" | "frozen" | "conflict" | "not_found" | "failed" };

/**
 * Save the content. Every save bumps content_version (a test mail of an older
 * version no longer counts). Refused once the Rundmail is released (frozen) —
 * and when `expectedVersion` is stale (another tab saved in between).
 */
export async function saveMailingContent(
  campaignId: number,
  input: {
    subject: string;
    preheader: string | null;
    doc: unknown;
    language: "de" | "en";
    rate: MailingRateKey;
    engagedFirst: boolean;
  },
  expectedVersion: number | null,
  sql: Sql | null = getSql()
): Promise<SaveMailingResult> {
  if (!sql) return { ok: false, reason: "no_db" };
  try {
    const rows = (await sql`
      UPDATE campaign_mailings SET
        subject = ${input.subject},
        preheader = ${input.preheader},
        doc = ${JSON.stringify(normalizeMailTemplateDoc(input.doc))}::jsonb,
        language = ${input.language},
        rate = ${input.rate},
        engaged_first = ${input.engagedFirst},
        content_version = content_version + 1,
        updated_at = now()
       WHERE campaign_id = ${campaignId}
         AND frozen_at IS NULL
         AND (${expectedVersion}::int IS NULL OR content_version = ${expectedVersion}::int)
      RETURNING campaign_id
    `) as Array<unknown>;
    if (rows.length > 0) {
      const mailing = await getMailing(campaignId, sql);
      return mailing ? { ok: true, mailing } : { ok: false, reason: "failed" };
    }
    const current = await getMailing(campaignId, sql);
    if (!current) return { ok: false, reason: "not_found" };
    return { ok: false, reason: current.frozenAt ? "frozen" : "conflict" };
  } catch (err) {
    reportError(err, { route: "lib/mailing-store", phase: "save" });
    return { ok: false, reason: "failed" };
  }
}

/**
 * Pace of the send and the order of recipients — not content, so no new
 * test mail is needed; fixed once released.
 */
export async function saveMailingPacing(
  campaignId: number,
  rate: MailingRateKey,
  engagedFirst: boolean,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = (await sql`
      UPDATE campaign_mailings SET rate = ${rate}, engaged_first = ${engagedFirst}, updated_at = now()
       WHERE campaign_id = ${campaignId} AND frozen_at IS NULL
      RETURNING campaign_id
    `) as Array<unknown>;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/mailing-store", phase: "pacing" });
    return false;
  }
}

/** Remember the version a test mail showed (only while that version is current). */
export async function recordMailingTest(
  campaignId: number,
  version: number,
  addresses: number,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = (await sql`
      UPDATE campaign_mailings
         SET test_version = ${version}, test_sent_at = now(), test_sent_to = ${addresses}, updated_at = now()
       WHERE campaign_id = ${campaignId} AND content_version = ${version} AND frozen_at IS NULL
      RETURNING campaign_id
    `) as Array<unknown>;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/mailing-store", phase: "recordTest" });
    return false;
  }
}

// ── release ──────────────────────────────────────────────────────────────────

export interface FrozenMailing {
  version: number;
  subject: string;
  html: string;
  text: string;
  hash: string;
  from: string;
  replyTo: string | null;
  links: Array<{ url: string }>;
  merges: MailingMerges;
}

/**
 * Freeze the released content and start the campaign (status aktiv, the
 * start = `startsAt`) — ONE statement (a data-modifying CTE), so either both
 * happen or neither. Refused unless the campaign is still a draft and the
 * version is the current AND the test-sent one. Returns false when a guard
 * did not hold (the caller reloads and reports).
 */
export async function freezeAndStartMailing(
  campaignId: number,
  frozen: FrozenMailing,
  startsAt: string,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = (await sql`
      WITH m AS (
        UPDATE campaign_mailings SET
          frozen_version = ${frozen.version},
          frozen_at = now(),
          frozen_subject = ${frozen.subject},
          frozen_html = ${frozen.html},
          frozen_text = ${frozen.text},
          frozen_hash = ${frozen.hash},
          frozen_from = ${frozen.from},
          frozen_reply_to = ${frozen.replyTo},
          links = ${JSON.stringify(frozen.links)}::jsonb,
          merges = ${JSON.stringify(frozen.merges)}::jsonb,
          materialized_at = NULL,
          finished_at = NULL,
          next_batch_at = NULL,
          last_error = NULL,
          last_error_at = NULL,
          updated_at = now()
         WHERE campaign_id = ${campaignId}
           AND frozen_at IS NULL
           AND content_version = ${frozen.version}
           AND test_version = ${frozen.version}
           AND EXISTS (SELECT 1 FROM campaigns c WHERE c.id = ${campaignId} AND c.kind = 'rundmail' AND c.status = 'entwurf')
        RETURNING campaign_id
      )
      UPDATE campaigns
         SET status = 'aktiv', starts_at = ${startsAt}::timestamptz,
             started_at = COALESCE(started_at, now()), ended_at = NULL, updated_at = now()
       WHERE id IN (SELECT campaign_id FROM m)
      RETURNING id
    `) as Array<unknown>;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/mailing-store", phase: "freeze" });
    return false;
  }
}

/**
 * Take back a release that has not started sending (a planned Rundmail):
 * campaign → entwurf, content unfrozen, recipients that were matched early
 * removed. Refused once any recipient was claimed or sent. One transaction;
 * every later statement acts only when the first one moved the campaign.
 */
export async function unfreezeMailing(campaignId: number, sql: Sql | null = getSql()): Promise<boolean> {
  if (!sql) return false;
  try {
    const [moved] = await sql.transaction([
      sql`
        UPDATE campaigns SET status = 'entwurf', started_at = NULL, audience_mode = 'dynamisch',
               audience_refreshed_at = NULL, updated_at = now()
         WHERE id = ${campaignId} AND kind = 'rundmail' AND status IN ('aktiv', 'pausiert')
           AND NOT EXISTS (
             SELECT 1 FROM campaign_contacts cc
              WHERE cc.campaign_id = ${campaignId} AND cc.status IN ('sending', 'sent')
           )
           AND NOT EXISTS (SELECT 1 FROM campaign_mailing_batches b WHERE b.campaign_id = ${campaignId})
        RETURNING id
      `,
      sql`
        UPDATE campaign_mailings SET
          frozen_version = NULL, frozen_at = NULL, frozen_subject = NULL, frozen_html = NULL,
          frozen_text = NULL, frozen_hash = NULL, frozen_from = NULL, frozen_reply_to = NULL,
          links = '[]'::jsonb, merges = '{}'::jsonb, materialized_at = NULL, finished_at = NULL,
          next_batch_at = NULL, last_error = NULL, last_error_at = NULL, updated_at = now()
         WHERE campaign_id = ${campaignId}
           AND EXISTS (SELECT 1 FROM campaigns c WHERE c.id = ${campaignId} AND c.status = 'entwurf')
      `,
      sql`
        DELETE FROM campaign_contacts
         WHERE campaign_id = ${campaignId} AND status IN ('pending', 'excluded', 'suppressed')
           AND EXISTS (SELECT 1 FROM campaigns c WHERE c.id = ${campaignId} AND c.status = 'entwurf')
      `,
    ]);
    return (moved as unknown[]).length > 0;
  } catch (err) {
    reportError(err, { route: "lib/mailing-store", phase: "unfreeze" });
    return false;
  }
}

/** Pause / resume a released Rundmail (the runner only claims while aktiv). */
export async function setMailingPaused(campaignId: number, paused: boolean, sql: Sql | null = getSql()): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = (await sql`
      UPDATE campaigns
         SET status = ${paused ? "pausiert" : "aktiv"}, updated_at = now()
       WHERE id = ${campaignId} AND kind = 'rundmail'
         AND status = ${paused ? "aktiv" : "pausiert"}
         AND EXISTS (SELECT 1 FROM campaign_mailings m WHERE m.campaign_id = ${campaignId} AND m.frozen_at IS NOT NULL)
      RETURNING id
    `) as Array<unknown>;
    if (rows.length > 0 && !paused) {
      await sql`UPDATE campaign_mailings SET last_error = NULL, last_error_at = NULL, next_batch_at = NULL WHERE campaign_id = ${campaignId}`;
    }
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/mailing-store", phase: "pause" });
    return false;
  }
}

/**
 * Cancel the rest of a Rundmail: every recipient not yet sent becomes
 * skipped ('abgebrochen'), the campaign ends. A batch in flight finishes
 * (its recipients are 'sending' and settle normally).
 */
export async function cancelMailing(campaignId: number, sql: Sql | null = getSql()): Promise<number | null> {
  if (!sql) return null;
  try {
    const [skipped] = await sql.transaction([
      sql`
        UPDATE campaign_contacts
           SET status = 'skipped', excluded_reason = 'abgebrochen', skipped_at = now()
         WHERE campaign_id = ${campaignId} AND status = 'pending'
        RETURNING id
      `,
      sql`
        UPDATE campaigns SET status = 'beendet', ended_at = now(), updated_at = now()
         WHERE id = ${campaignId} AND kind = 'rundmail' AND status IN ('aktiv', 'pausiert')
      `,
      sql`UPDATE campaign_mailings SET finished_at = COALESCE(finished_at, now()) WHERE campaign_id = ${campaignId}`,
    ]);
    return (skipped as unknown[]).length;
  } catch (err) {
    reportError(err, { route: "lib/mailing-store", phase: "cancel" });
    return null;
  }
}

// ── runner state ─────────────────────────────────────────────────────────────

/** Released Rundmails that may send now (live, frozen, not finished). */
export async function listDueMailings(
  onlyCampaignId: number | null,
  sql: Sql | null = getSql()
): Promise<number[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT c.id
        FROM campaigns c
        JOIN campaign_mailings m ON m.campaign_id = c.id
       WHERE c.kind = 'rundmail' AND c.status = 'aktiv'
         AND (c.starts_at IS NULL OR c.starts_at <= now())
         AND (c.ends_at IS NULL OR c.ends_at > now())
         AND m.frozen_at IS NOT NULL AND m.finished_at IS NULL
         AND (${onlyCampaignId}::bigint IS NULL OR c.id = ${onlyCampaignId}::bigint)
       ORDER BY c.priority DESC, c.starts_at NULLS FIRST, c.id
    `) as Array<{ id: number }>;
    return rows.map((r) => Number(r.id));
  } catch (err) {
    if (!isMissingTable(err)) reportError(err, { route: "lib/mailing-store", phase: "listDue" });
    return [];
  }
}

/** One runner per Rundmail at a time: take the lease (seconds) or false. */
export async function acquireMailingLease(campaignId: number, seconds: number, sql: Sql | null = getSql()): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = (await sql`
      UPDATE campaign_mailings SET lease_until = now() + make_interval(secs => ${seconds})
       WHERE campaign_id = ${campaignId} AND (lease_until IS NULL OR lease_until < now())
      RETURNING campaign_id
    `) as Array<unknown>;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/mailing-store", phase: "lease" });
    return false;
  }
}

export async function releaseMailingLease(campaignId: number, sql: Sql | null = getSql()): Promise<void> {
  if (!sql) return;
  try {
    await sql`UPDATE campaign_mailings SET lease_until = NULL WHERE campaign_id = ${campaignId}`;
  } catch (err) {
    reportError(err, { route: "lib/mailing-store", phase: "releaseLease" });
  }
}

/** Remember when the next batch may go (rate pacing across runs) and the last error. */
export async function setMailingRunState(
  campaignId: number,
  state: { nextBatchAt?: string | null; error?: string | null },
  sql: Sql | null = getSql()
): Promise<void> {
  if (!sql) return;
  const hasNext = state.nextBatchAt !== undefined;
  const hasError = state.error !== undefined;
  try {
    await sql`
      UPDATE campaign_mailings SET
        next_batch_at = CASE WHEN ${hasNext} THEN ${state.nextBatchAt ?? null}::timestamptz ELSE next_batch_at END,
        last_error = CASE WHEN ${hasError} THEN ${state.error ?? null} ELSE last_error END,
        last_error_at = CASE WHEN ${hasError} THEN (CASE WHEN ${state.error ?? null}::text IS NULL THEN NULL ELSE now() END) ELSE last_error_at END
       WHERE campaign_id = ${campaignId}
    `;
  } catch (err) {
    reportError(err, { route: "lib/mailing-store", phase: "runState" });
  }
}

/** The audience is matched (fresh, at the first batch) — from now on it is fixed. */
export async function markMailingMaterialized(campaignId: number, sql: Sql | null = getSql()): Promise<void> {
  if (!sql) return;
  try {
    await sql.transaction([
      sql`UPDATE campaign_mailings SET materialized_at = now() WHERE campaign_id = ${campaignId}`,
      sql`UPDATE campaigns SET audience_mode = 'fest', updated_at = now() WHERE id = ${campaignId}`,
    ]);
  } catch (err) {
    reportError(err, { route: "lib/mailing-store", phase: "materialized" });
  }
}

/** Nothing pending or in flight any more → finished; the campaign ends. */
export async function finishMailingIfDone(campaignId: number, sql: Sql | null = getSql()): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = (await sql`
      UPDATE campaign_mailings SET finished_at = now(), next_batch_at = NULL
       WHERE campaign_id = ${campaignId} AND finished_at IS NULL AND materialized_at IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM campaign_contacts cc
            WHERE cc.campaign_id = ${campaignId} AND cc.status IN ('pending', 'sending')
         )
         AND NOT EXISTS (
           SELECT 1 FROM campaign_mailing_batches b WHERE b.campaign_id = ${campaignId} AND b.status = 'offen'
         )
      RETURNING campaign_id
    `) as Array<unknown>;
    if (rows.length === 0) return false;
    await sql`
      UPDATE campaigns SET status = 'beendet', ended_at = now(), updated_at = now()
       WHERE id = ${campaignId} AND status = 'aktiv'
    `;
    return true;
  } catch (err) {
    reportError(err, { route: "lib/mailing-store", phase: "finish" });
    return false;
  }
}

// ── batches ──────────────────────────────────────────────────────────────────

export interface MailingBatch {
  id: number;
  campaignId: number;
  contactIds: number[];
  tokens: string[];
  attempts: number;
  createdAt: string | null;
  attemptedAt: string | null;
}

function mapBatch(r: Record<string, unknown>): MailingBatch {
  return {
    id: Number(r.id),
    campaignId: Number(r.campaign_id),
    contactIds: ((r.contact_ids as unknown[]) ?? []).map(Number),
    tokens: ((r.tokens as unknown[]) ?? []).map(String),
    attempts: Number(r.attempts ?? 0),
    createdAt: iso(r.created_at),
    attemptedAt: iso(r.attempted_at),
  };
}

/**
 * Claim the next `size` pending recipients and create their batch — ONE
 * statement, so a recipient is in at most one batch. Engaged recipients
 * first (recent clicks, recent orders): early positive signals help the
 * inbox placement of the rest. Tokens are 32 random hex characters
 * (gen_random_uuid) — the tracked links' /api/r/<token>.
 */
export async function claimMailingBatch(
  campaignId: number,
  size: number,
  engagedFirst: boolean,
  sql: Sql | null = getSql()
): Promise<MailingBatch | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      WITH picked AS (
        SELECT cc.id
          FROM campaign_contacts cc
          LEFT JOIN customer_facts f ON f.customer_id = cc.customer_id
         WHERE cc.campaign_id = ${campaignId} AND cc.status = 'pending' AND cc.is_test = false
         ORDER BY CASE WHEN ${engagedFirst} THEN f.last_click_at END DESC NULLS LAST,
                  CASE WHEN ${engagedFirst} THEN cc.last_order_at END DESC NULLS LAST,
                  cc.id
         LIMIT ${size}
         FOR UPDATE OF cc SKIP LOCKED
      ),
      claimed AS (
        UPDATE campaign_contacts c
           SET status = 'sending', claimed_at = now()
          FROM picked
         WHERE c.id = picked.id AND c.status = 'pending'
        RETURNING c.id
      ),
      tok AS (
        SELECT id, replace(gen_random_uuid()::text, '-', '') AS token FROM claimed
      )
      INSERT INTO campaign_mailing_batches (campaign_id, contact_ids, tokens)
      SELECT ${campaignId}, array_agg(id ORDER BY id), array_agg(token ORDER BY id)
        FROM tok
      HAVING count(*) > 0
      RETURNING id, campaign_id, contact_ids, tokens, attempts, created_at, attempted_at
    `) as Array<Record<string, unknown>>;
    return rows[0] ? mapBatch(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/mailing-store", phase: "claim" });
    return null;
  }
}

/** Open batches of a Rundmail (a run that died mid-batch left them). */
export async function listOpenBatches(campaignId: number, sql: Sql | null = getSql()): Promise<MailingBatch[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT id, campaign_id, contact_ids, tokens, attempts, created_at, attempted_at
        FROM campaign_mailing_batches
       WHERE campaign_id = ${campaignId} AND status = 'offen'
       ORDER BY id
    `) as Array<Record<string, unknown>>;
    return rows.map(mapBatch);
  } catch (err) {
    reportError(err, { route: "lib/mailing-store", phase: "openBatches" });
    return [];
  }
}

/** Recipients still 'sending' without an open batch (a run died between claim and batch — impossible by construction, but never leave them hanging). */
export async function releaseOrphanClaims(campaignId: number, sql: Sql | null = getSql()): Promise<number> {
  if (!sql) return 0;
  try {
    const rows = (await sql`
      UPDATE campaign_contacts cc SET status = 'pending', claimed_at = NULL
       WHERE cc.campaign_id = ${campaignId} AND cc.status = 'sending'
         AND cc.claimed_at < now() - interval '2 minutes'
         AND NOT EXISTS (
           SELECT 1 FROM campaign_mailing_batches b
            WHERE b.campaign_id = ${campaignId} AND b.status = 'offen' AND cc.id = ANY(b.contact_ids)
         )
         AND NOT EXISTS (SELECT 1 FROM campaign_sends s WHERE s.contact_id = cc.id)
      RETURNING cc.id
    `) as Array<unknown>;
    return rows.length;
  } catch (err) {
    reportError(err, { route: "lib/mailing-store", phase: "orphans" });
    return 0;
  }
}

/** What the gates and the payload need per recipient of a batch, read fresh. */
export interface BatchRecipient {
  contactId: number;
  customerId: number | null;
  /** The CURRENT address (a Shopify e-mail change may have merged people). */
  email: string;
  firstName: string | null;
  consentState: string | null;
  consentLevel: string | null;
  suppressed: boolean;
  lastSendAt: string | null;
  /** Already sent this Rundmail to the same address (another recipient row). */
  alreadySentHere: boolean;
}

export async function loadBatchRecipients(
  campaignId: number,
  contactIds: number[],
  sql: Sql | null = getSql()
): Promise<BatchRecipient[] | null> {
  if (!sql) return null;
  if (contactIds.length === 0) return [];
  try {
    const rows = (await sql`
      SELECT cc.id, cc.customer_id,
             lower(trim(COALESCE(c.email, cc.email))) AS email,
             COALESCE(c.first_name, cc.first_name) AS first_name,
             c.email_consent_state, c.email_consent_level,
             EXISTS (SELECT 1 FROM suppression_list sl WHERE sl.email = lower(trim(COALESCE(c.email, cc.email)))) AS suppressed,
             (SELECT max(t.sent_at) FROM (
                SELECT cs.sent_at FROM campaign_sends cs
                 WHERE cs.email = lower(trim(COALESCE(c.email, cc.email))) AND cs.is_test = false
                UNION ALL
                SELECT ms.sent_at FROM marketing_sends ms
                  JOIN email_captures ec ON ec.id = ms.email_capture_id
                 WHERE ec.email = lower(trim(COALESCE(c.email, cc.email))) AND ms.status = 'sent'
             ) t) AS last_send_at,
             EXISTS (SELECT 1 FROM campaign_sends s2
                      WHERE s2.campaign_id = ${campaignId} AND s2.is_test = false
                        AND s2.email = lower(trim(COALESCE(c.email, cc.email)))) AS already_sent_here
        FROM campaign_contacts cc
        LEFT JOIN customers c ON c.id = cc.customer_id
       WHERE cc.id = ANY(${contactIds}::bigint[]) AND cc.campaign_id = ${campaignId}
    `) as Array<Record<string, unknown>>;
    const byId = new Map(rows.map((r) => [Number(r.id), r]));
    // Keep the batch order (the idempotent retry must build the same payload).
    return contactIds
      .map((id) => byId.get(id))
      .filter((r): r is Record<string, unknown> => Boolean(r))
      .map((r) => ({
        contactId: Number(r.id),
        customerId: r.customer_id == null ? null : Number(r.customer_id),
        email: String(r.email ?? ""),
        firstName: (r.first_name as string | null) ?? null,
        consentState: (r.email_consent_state as string | null) ?? null,
        consentLevel: (r.email_consent_level as string | null) ?? null,
        suppressed: r.suppressed === true,
        lastSendAt: iso(r.last_send_at),
        alreadySentHere: r.already_sent_here === true,
      }));
  } catch (err) {
    reportError(err, { route: "lib/mailing-store", phase: "loadRecipients" });
    return null;
  }
}

export interface BatchSettlement {
  sent: Array<{ contactId: number; email: string; subject: string; token: string; providerEmailId: string | null }>;
  /** Not sent: status 'suppressed' (consent / block) or 'skipped' (anything else). */
  notSent: Array<{ contactId: number; status: "suppressed" | "skipped"; reason: string }>;
}

/**
 * Settle a batch in ONE transaction: the immutable send rows (campaign and
 * person from the recipient row — a recipient erased meanwhile gets none),
 * the recipients' status, the batch status.
 */
export async function settleBatch(
  batch: MailingBatch,
  s: BatchSettlement,
  meta: { bodyHash: string; designKey: string; language: "de" | "en" },
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  const sentIds = s.sent.map((x) => x.contactId);
  const emails = s.sent.map((x) => normalizeEmail(x.email));
  const subjects = s.sent.map((x) => x.subject);
  const tokens = s.sent.map((x) => x.token);
  const providerIds = s.sent.map((x) => x.providerEmailId ?? "");
  const suppressedIds = s.notSent.filter((x) => x.status === "suppressed").map((x) => x.contactId);
  const suppressedReasons = s.notSent.filter((x) => x.status === "suppressed").map((x) => x.reason);
  const skippedIds = s.notSent.filter((x) => x.status === "skipped").map((x) => x.contactId);
  const skippedReasons = s.notSent.filter((x) => x.status === "skipped").map((x) => x.reason);
  try {
    await sql.transaction([
      sql`
        INSERT INTO campaign_sends
          (contact_id, campaign_id, customer_id, email, subject, body_hash, body_text, body_html, sent_via,
           redirect_token, design_key, language, provider_email_id, is_test, sent_at, created_at)
        SELECT u.contact_id, cc.campaign_id, cc.customer_id, u.email, u.subject, ${meta.bodyHash}, NULL, NULL, 'email',
               u.token, ${meta.designKey}, ${meta.language}, NULLIF(u.provider_id, ''), false, now(), now()
          FROM unnest(${sentIds}::bigint[], ${emails}::text[], ${subjects}::text[], ${tokens}::text[], ${providerIds}::text[])
               AS u(contact_id, email, subject, token, provider_id)
          JOIN campaign_contacts cc ON cc.id = u.contact_id
        ON CONFLICT DO NOTHING
      `,
      sql`
        UPDATE campaign_contacts SET status = 'sent', sent_at = now()
         WHERE id = ANY(${sentIds}::bigint[]) AND status = 'sending'
      `,
      sql`
        UPDATE campaign_contacts cc SET status = 'suppressed', excluded_reason = u.reason
          FROM unnest(${suppressedIds}::bigint[], ${suppressedReasons}::text[]) AS u(id, reason)
         WHERE cc.id = u.id AND cc.status = 'sending'
      `,
      sql`
        UPDATE campaign_contacts cc SET status = 'skipped', excluded_reason = u.reason, skipped_at = now()
          FROM unnest(${skippedIds}::bigint[], ${skippedReasons}::text[]) AS u(id, reason)
         WHERE cc.id = u.id AND cc.status = 'sending'
      `,
      sql`
        UPDATE campaign_mailing_batches SET status = 'gesendet', sent_at = now(), error = NULL
         WHERE id = ${batch.id}
      `,
    ]);
    return true;
  } catch (err) {
    reportError(err, { route: "lib/mailing-store", phase: "settle", batchId: batch.id });
    return false;
  }
}

/** Nothing was sent (Resend refused the request): recipients back to pending, the batch closed. */
export async function releaseBatch(batch: MailingBatch, error: string, sql: Sql | null = getSql()): Promise<void> {
  if (!sql) return;
  try {
    await sql.transaction([
      sql`
        UPDATE campaign_contacts SET status = 'pending', claimed_at = NULL
         WHERE id = ANY(${batch.contactIds}::bigint[]) AND status = 'sending'
      `,
      sql`UPDATE campaign_mailing_batches SET status = 'fehler', error = ${error.slice(0, 500)} WHERE id = ${batch.id}`,
    ]);
  } catch (err) {
    reportError(err, { route: "lib/mailing-store", phase: "releaseBatch" });
  }
}

/** One more attempt failed with an unclear outcome — retried later with the SAME key. */
export async function noteBatchAttempt(batchId: number, error: string, sql: Sql | null = getSql()): Promise<void> {
  if (!sql) return;
  try {
    await sql`
      UPDATE campaign_mailing_batches
         SET attempts = attempts + 1, attempted_at = now(), error = ${error.slice(0, 500)}
       WHERE id = ${batchId}
    `;
  } catch (err) {
    reportError(err, { route: "lib/mailing-store", phase: "noteAttempt" });
  }
}

/**
 * The outcome can no longer be known (Resend saw the key with another
 * payload, or retries ran out): never resent automatically — the recipients
 * become 'skipped' ('versand_unklar') and are listed for the operator.
 */
export async function markBatchUnclear(batch: MailingBatch, error: string, sql: Sql | null = getSql()): Promise<void> {
  if (!sql) return;
  try {
    await sql.transaction([
      sql`
        UPDATE campaign_contacts SET status = 'skipped', excluded_reason = 'versand_unklar', skipped_at = now()
         WHERE id = ANY(${batch.contactIds}::bigint[]) AND status = 'sending'
      `,
      sql`UPDATE campaign_mailing_batches SET status = 'unklar', error = ${error.slice(0, 500)} WHERE id = ${batch.id}`,
    ]);
  } catch (err) {
    reportError(err, { route: "lib/mailing-store", phase: "unclear" });
  }
}

/**
 * Retention (runRetention, the campaign window): settled batch rows (contact
 * ids + redirect tokens of a past send) leave with the sends they belong to.
 * An open batch is never touched. Missing table (before 0081) → 0.
 */
export async function purgeSettledMailingBatches(cutoffIso: string, sql: Sql | null = getSql()): Promise<number> {
  if (!sql) return 0;
  try {
    const rows = (await sql`
      WITH del AS (
        DELETE FROM campaign_mailing_batches
         WHERE status <> 'offen' AND created_at < ${cutoffIso}::timestamptz
        RETURNING 1
      )
      SELECT count(*)::int AS n FROM del
    `) as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  } catch (err) {
    if (!isMissingTable(err)) reportError(err, { route: "lib/mailing-store", phase: "purgeBatches" });
    return 0;
  }
}

// ── figures ──────────────────────────────────────────────────────────────────

export interface MailingStats {
  total: number;
  pending: number;
  sending: number;
  sent: number;
  suppressed: number;
  skipped: number;
  failed: number;
  excluded: number;
  skippedByReason: Record<string, number>;
  delivered: number;
  bounced: number;
  bouncedHard: number;
  complained: number;
  clicked: number;
  unsubscribed: number;
  /** Clicks per tracked link index (all clicks, and distinct recipients). */
  linkClicks: Array<{ index: number; clicks: number; recipients: number }>;
  unclearBatches: number;
  lastSentAt: string | null;
}

const FAILED_REASONS = ["versand_fehler", "versand_unklar", "ungueltige_adresse"];

/** Progress, delivery and clicks of one Rundmail. Never throws (zeros). */
export async function getMailingStats(campaignId: number, sql: Sql | null = getSql()): Promise<MailingStats> {
  const empty: MailingStats = {
    total: 0, pending: 0, sending: 0, sent: 0, suppressed: 0, skipped: 0, failed: 0, excluded: 0,
    skippedByReason: {}, delivered: 0, bounced: 0, bouncedHard: 0, complained: 0, clicked: 0,
    unsubscribed: 0, linkClicks: [], unclearBatches: 0, lastSentAt: null,
  };
  if (!sql) return empty;
  try {
    const [statusRows, reasonRows, sendRows, linkRows, batchRows] = await Promise.all([
      sql`
        SELECT status, count(*)::int AS n FROM campaign_contacts
         WHERE campaign_id = ${campaignId} AND is_test = false GROUP BY status
      `,
      sql`
        SELECT COALESCE(excluded_reason, 'sonstiges') AS reason, count(*)::int AS n FROM campaign_contacts
         WHERE campaign_id = ${campaignId} AND is_test = false AND status IN ('skipped', 'suppressed')
         GROUP BY 1
      `,
      sql`
        SELECT count(*) FILTER (WHERE delivered_at IS NOT NULL)::int AS delivered,
               count(*) FILTER (WHERE bounced_at IS NOT NULL)::int AS bounced,
               count(*) FILTER (WHERE bounced_at IS NOT NULL AND bounce_type = 'hard')::int AS bounced_hard,
               count(*) FILTER (WHERE complained_at IS NOT NULL)::int AS complained,
               count(*) FILTER (WHERE clicked_at IS NOT NULL)::int AS clicked,
               count(*) FILTER (WHERE unsubscribed_at IS NOT NULL)::int AS unsubscribed,
               max(sent_at) AS last_sent_at
          FROM campaign_sends WHERE campaign_id = ${campaignId} AND is_test = false
      `,
      sql`
        SELECT (e.data->>'link')::int AS idx, count(*)::int AS clicks, count(DISTINCT e.data->>'sendId')::int AS recipients
          FROM kpi_events e
         WHERE e.event = 'campaign_email_clicked'
           AND e.data->>'campaignId' = ${String(campaignId)}
           AND e.data ? 'link'
         GROUP BY 1 ORDER BY 1
      `,
      sql`SELECT count(*)::int AS n FROM campaign_mailing_batches WHERE campaign_id = ${campaignId} AND status = 'unklar'`,
    ]);
    const byStatus = new Map((statusRows as Array<{ status: string; n: number }>).map((r) => [r.status, Number(r.n)]));
    const skippedByReason: Record<string, number> = {};
    for (const r of reasonRows as Array<{ reason: string; n: number }>) skippedByReason[r.reason] = Number(r.n);
    const failed = FAILED_REASONS.reduce((n, k) => n + (skippedByReason[k] ?? 0), 0);
    const send = (sendRows as Array<Record<string, unknown>>)[0] ?? {};
    const n = (k: string) => byStatus.get(k) ?? 0;
    return {
      total: n("pending") + n("sending") + n("sent") + n("suppressed") + n("skipped"),
      pending: n("pending"),
      sending: n("sending"),
      sent: n("sent"),
      suppressed: n("suppressed"),
      skipped: Math.max(0, n("skipped") - failed),
      failed,
      excluded: n("excluded"),
      skippedByReason,
      delivered: Number(send.delivered ?? 0),
      bounced: Number(send.bounced ?? 0),
      bouncedHard: Number(send.bounced_hard ?? 0),
      complained: Number(send.complained ?? 0),
      clicked: Number(send.clicked ?? 0),
      unsubscribed: Number(send.unsubscribed ?? 0),
      linkClicks: (linkRows as Array<Record<string, unknown>>)
        .filter((r) => Number.isInteger(Number(r.idx)))
        .map((r) => ({ index: Number(r.idx), clicks: Number(r.clicks), recipients: Number(r.recipients) })),
      unclearBatches: Number((batchRows as Array<{ n: number }>)[0]?.n ?? 0),
      lastSentAt: iso(send.last_sent_at),
    };
  } catch (err) {
    if (!isMissingTable(err)) reportError(err, { route: "lib/mailing-store", phase: "stats" });
    return empty;
  }
}

/** The tracked link target of a Rundmail send (redirect route), or null. */
export async function mailingLinkTarget(campaignId: number, index: number, sql: Sql | null = getSql()): Promise<string | null> {
  if (!sql || !Number.isInteger(index) || index < 0 || index > 999) return null;
  try {
    const rows = (await sql`
      SELECT links -> ${index}::int ->> 'url' AS url FROM campaign_mailings WHERE campaign_id = ${campaignId}
    `) as Array<{ url: string | null }>;
    const url = rows[0]?.url ?? null;
    return url && /^https?:\/\//.test(url) ? url : null;
  } catch (err) {
    reportError(err, { route: "lib/mailing-store", phase: "linkTarget" });
    return null;
  }
}
