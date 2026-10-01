// The Eingang store (inbox_items, 0067) — I/O.
//
// Items are created by the signals job (lib/inbox-signals.ts, nightly + on
// events) and by system events (Shopify data requests, sync alerts). The
// operator lists, decides (erledigt / zurückstellen / verwerfen) and acts on
// them; nothing here sends. docs/CUSTOMER_PLATFORM_PLAN.md §11.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";

export type InboxStatus = "offen" | "zurueckgestellt" | "erledigt" | "verworfen";

export interface InboxItemInput {
  kind: string;
  customerId: number | null;
  priority: number;
  title: string;
  reason: string;
  evidence?: Record<string, unknown>;
  dedupeKey: string;
  expiresAt?: string | null;
}

export interface InboxSuggestion {
  warum: string;
  aktion: string;
  kanal: "email" | "brief" | "antwort" | "kampagne" | "intern" | "keine";
  betreff?: string | null;
  text?: string | null;
  rabatt?: { prozent: number; begruendung: string } | null;
  produkte?: string[];
  generatedAt?: string;
  model?: string;
}

export interface InboxItem {
  id: number;
  kind: string;
  customerId: number | null;
  status: InboxStatus;
  priority: number;
  title: string;
  reason: string;
  evidence: Record<string, unknown>;
  suggestion: InboxSuggestion | null;
  suggestedAt: string | null;
  snoozedUntil: string | null;
  decidedAt: string | null;
  decision: string | null;
  decisionNote: string | null;
  outcome: Record<string, unknown> | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Joined for the list: the customer's display name / e-mail. */
  customerName: string | null;
  customerEmail: string | null;
}

const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);

function mapItem(r: Record<string, unknown>): InboxItem {
  return {
    id: Number(r.id),
    kind: String(r.kind),
    customerId: r.customer_id == null ? null : Number(r.customer_id),
    status: String(r.status) as InboxStatus,
    priority: Number(r.priority ?? 0),
    title: String(r.title),
    reason: String(r.reason),
    evidence: (r.evidence as Record<string, unknown>) ?? {},
    suggestion: (r.suggestion as InboxSuggestion | null) ?? null,
    suggestedAt: iso(r.suggested_at),
    snoozedUntil: iso(r.snoozed_until),
    decidedAt: iso(r.decided_at),
    decision: (r.decision as string | null) ?? null,
    decisionNote: (r.decision_note as string | null) ?? null,
    outcome: (r.outcome as Record<string, unknown> | null) ?? null,
    expiresAt: iso(r.expires_at),
    createdAt: iso(r.created_at) ?? new Date().toISOString(),
    updatedAt: iso(r.updated_at) ?? new Date().toISOString(),
    customerName: (r.customer_name as string | null) ?? null,
    customerEmail: (r.customer_email as string | null) ?? null,
  };
}

/**
 * Create (or refresh) items. An existing OPEN item with the same dedupe key
 * gets the fresh reason/evidence/priority; a decided one is left alone, so a
 * dismissed item does not come back in the same window. Returns the number of
 * new items. Never throws.
 */
export async function upsertInboxItems(items: InboxItemInput[], sql: Sql | null = getSql()): Promise<number> {
  if (!sql || items.length === 0) return 0;
  try {
    const payload = items.map((i) => ({
      kind: i.kind,
      customer_id: i.customerId,
      priority: Math.round(i.priority),
      title: i.title.slice(0, 200),
      reason: i.reason.slice(0, 1000),
      evidence: i.evidence ?? {},
      dedupe_key: i.dedupeKey.slice(0, 200),
      expires_at: i.expiresAt ?? null,
    }));
    const rows = (await sql`
      INSERT INTO inbox_items (kind, customer_id, priority, title, reason, evidence, dedupe_key, expires_at)
      SELECT x.kind, x.customer_id, x.priority, x.title, x.reason, COALESCE(x.evidence, '{}'::jsonb), x.dedupe_key, x.expires_at
        FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS x(
          kind text, customer_id bigint, priority int, title text, reason text, evidence jsonb,
          dedupe_key text, expires_at timestamptz)
       WHERE x.customer_id IS NULL OR EXISTS (SELECT 1 FROM customers c WHERE c.id = x.customer_id)
      ON CONFLICT (dedupe_key) DO UPDATE
        SET priority = EXCLUDED.priority,
            title = EXCLUDED.title,
            reason = EXCLUDED.reason,
            evidence = EXCLUDED.evidence,
            expires_at = EXCLUDED.expires_at,
            updated_at = now()
        WHERE inbox_items.status = 'offen'
      RETURNING (xmax = 0) AS inserted
    `) as Array<{ inserted: boolean }>;
    return rows.filter((r) => r.inserted).length;
  } catch (err) {
    reportError(err, { route: "lib/inbox-store", phase: "upsertInboxItems" });
    return 0;
  }
}

/** One item (system events). Never throws. */
export async function createInboxItem(item: InboxItemInput, sql: Sql | null = getSql()): Promise<void> {
  await upsertInboxItems([item], sql);
}

export interface InboxListFilter {
  status?: "offen" | "zurueckgestellt" | "erledigt" | "alle";
  kind?: string | null;
  customerId?: number | null;
  limit?: number;
}

/** Items for the Eingang (open first by priority) or one customer. */
export async function listInboxItems(filter: InboxListFilter = {}, sql: Sql | null = getSql()): Promise<InboxItem[]> {
  if (!sql) return [];
  const status = filter.status ?? "offen";
  const limit = Math.max(1, Math.min(filter.limit ?? 200, 500));
  try {
    const rows = (await sql`
      SELECT i.*,
             COALESCE(NULLIF(btrim(concat_ws(' ', c.first_name, c.last_name)), ''),
                      NULLIF(btrim(c.shopify_account_summary->>'displayName'), '')) AS customer_name,
             c.email AS customer_email
        FROM inbox_items i
        LEFT JOIN customers c ON c.id = i.customer_id
       WHERE (${status} = 'alle'
              OR (${status} = 'offen' AND i.status = 'offen')
              OR (${status} = 'zurueckgestellt' AND i.status = 'zurueckgestellt')
              OR (${status} = 'erledigt' AND i.status IN ('erledigt', 'verworfen')))
         AND (${filter.kind ?? null}::text IS NULL OR i.kind = ${filter.kind ?? null})
         AND (${filter.customerId ?? null}::bigint IS NULL OR i.customer_id = ${filter.customerId ?? null})
       ORDER BY CASE WHEN i.status = 'offen' THEN 0 ELSE 1 END, i.priority DESC, i.created_at DESC
       LIMIT ${limit}
    `) as Array<Record<string, unknown>>;
    return rows.map(mapItem);
  } catch (err) {
    reportError(err, { route: "lib/inbox-store", phase: "listInboxItems" });
    return [];
  }
}

export async function getInboxItem(id: number, sql: Sql | null = getSql()): Promise<InboxItem | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT i.*,
             COALESCE(NULLIF(btrim(concat_ws(' ', c.first_name, c.last_name)), ''),
                      NULLIF(btrim(c.shopify_account_summary->>'displayName'), '')) AS customer_name,
             c.email AS customer_email
        FROM inbox_items i LEFT JOIN customers c ON c.id = i.customer_id
       WHERE i.id = ${id}
    `) as Array<Record<string, unknown>>;
    return rows[0] ? mapItem(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/inbox-store", phase: "getInboxItem" });
    return null;
  }
}

export type InboxDecision = "erledigt" | "verworfen" | "zurueckgestellt" | "wieder_offen";

export type DecideInboxResult = { ok: true; item: InboxItem } | { ok: false; reason: "not_found" | "db" };

/** Record the operator's decision. Snoozing needs `snoozeDays`. Never throws. */
export async function decideInboxItem(
  id: number,
  decision: InboxDecision,
  opts: { note?: string | null; action?: string | null; snoozeDays?: number } = {},
  sql: Sql | null = getSql()
): Promise<DecideInboxResult> {
  if (!sql) return { ok: false, reason: "db" };
  try {
    const status: InboxStatus =
      decision === "wieder_offen" ? "offen" : decision === "zurueckgestellt" ? "zurueckgestellt" : decision;
    const snoozeUntil =
      decision === "zurueckgestellt"
        ? new Date(Date.now() + Math.max(1, Math.min(opts.snoozeDays ?? 3, 90)) * 86_400_000).toISOString()
        : null;
    const rows = (await sql`
      UPDATE inbox_items
         SET status = ${status},
             snoozed_until = ${snoozeUntil},
             decided_at = CASE WHEN ${status} IN ('erledigt', 'verworfen') THEN now() ELSE NULL END,
             decision = CASE WHEN ${status} IN ('erledigt', 'verworfen') THEN COALESCE(${opts.action ?? null}, ${status}) ELSE NULL END,
             decision_note = ${opts.note?.slice(0, 500) ?? null},
             updated_at = now()
       WHERE id = ${id}
      RETURNING id
    `) as Array<{ id: number }>;
    if (!rows[0]) return { ok: false, reason: "not_found" };
    const item = await getInboxItem(id, sql);
    return item ? { ok: true, item } : { ok: false, reason: "db" };
  } catch (err) {
    reportError(err, { route: "lib/inbox-store", phase: "decideInboxItem" });
    return { ok: false, reason: "db" };
  }
}

/** Store an AI suggestion on an item. */
export async function saveInboxSuggestion(
  id: number,
  suggestion: InboxSuggestion,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = await sql`
      UPDATE inbox_items SET suggestion = ${JSON.stringify(suggestion)}::jsonb, suggested_at = now(), updated_at = now()
       WHERE id = ${id} RETURNING id
    `;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/inbox-store", phase: "saveInboxSuggestion" });
    return false;
  }
}

export interface InboxCounts {
  open: number;
  highPriority: number;
  snoozed: number;
  byKind: Record<string, number>;
}

/**
 * Snoozed items whose time is up become open again. Called by the Eingang
 * screen before it lists and by the hourly inbox cron — never on the read
 * path of the sidebar badge. Returns the number reopened; never throws.
 */
export async function reopenDueSnoozed(sql: Sql | null = getSql()): Promise<number> {
  if (!sql) return 0;
  try {
    const rows = await sql`
      UPDATE inbox_items SET status = 'offen', snoozed_until = NULL, updated_at = now()
       WHERE status = 'zurueckgestellt' AND snoozed_until IS NOT NULL AND snoozed_until <= now()
      RETURNING id
    `;
    return rows.length;
  } catch (err) {
    reportError(err, { route: "lib/inbox-store", phase: "reopenDueSnoozed" });
    return 0;
  }
}

/** Counts for the sidebar badge and the Eingang tabs. Read-only: a snooze that is due counts as open. */
export async function getInboxCounts(sql: Sql | null = getSql()): Promise<InboxCounts> {
  const empty: InboxCounts = { open: 0, highPriority: 0, snoozed: 0, byKind: {} };
  if (!sql) return empty;
  try {
    const rows = (await sql`
      SELECT kind,
             CASE WHEN status = 'zurueckgestellt' AND (snoozed_until IS NULL OR snoozed_until > now())
                  THEN 'zurueckgestellt' ELSE 'offen' END AS status,
             count(*)::int AS n, count(*) FILTER (WHERE priority >= 80)::int AS high
        FROM inbox_items
       WHERE status IN ('offen', 'zurueckgestellt')
       GROUP BY 1, 2
    `) as Array<{ kind: string; status: string; n: number; high: number }>;
    const out: InboxCounts = { open: 0, highPriority: 0, snoozed: 0, byKind: {} };
    for (const r of rows) {
      if (r.status === "offen") {
        out.open += Number(r.n);
        out.highPriority += Number(r.high);
        out.byKind[r.kind] = (out.byKind[r.kind] ?? 0) + Number(r.n);
      } else {
        out.snoozed += Number(r.n);
      }
    }
    return out;
  } catch (err) {
    reportError(err, { route: "lib/inbox-store", phase: "getInboxCounts" });
    return empty;
  }
}

/** Close open items whose condition expired (expires_at passed). */
export async function expireInboxItems(sql: Sql | null = getSql()): Promise<number> {
  if (!sql) return 0;
  try {
    const rows = await sql`
      UPDATE inbox_items SET status = 'erledigt', decision = 'abgelaufen', decided_at = now(), updated_at = now()
       WHERE status IN ('offen', 'zurueckgestellt') AND expires_at IS NOT NULL AND expires_at < now()
      RETURNING id
    `;
    return rows.length;
  } catch (err) {
    reportError(err, { route: "lib/inbox-store", phase: "expireInboxItems" });
    return 0;
  }
}

/** Close open items of given kinds whose dedupe key is no longer produced by the rules. */
export async function closeStaleInboxItems(
  kinds: string[],
  stillValidKeys: string[],
  sql: Sql | null = getSql()
): Promise<number> {
  if (!sql || kinds.length === 0) return 0;
  try {
    const rows = await sql`
      UPDATE inbox_items SET status = 'erledigt', decision = 'erledigt_von_selbst', decided_at = now(), updated_at = now()
       WHERE status IN ('offen', 'zurueckgestellt')
         AND kind = ANY(${kinds}::text[])
         AND NOT (dedupe_key = ANY(${stillValidKeys}::text[]))
      RETURNING id
    `;
    return rows.length;
  } catch (err) {
    reportError(err, { route: "lib/inbox-store", phase: "closeStaleInboxItems" });
    return 0;
  }
}

/** KPIs → Eingang: per kind in the range — created, accepted, dismissed, and the 14-day outcome. */
export interface InboxKindKpi {
  kind: string;
  created: number;
  acted: number;
  dismissed: number;
  closedBySelf: number;
  withOutcome: number;
  ordersAfterActed: number;
  ordersAfterDismissed: number;
  revenueAfterActedCents: number;
  topDismissReason: string | null;
}

export interface InboxKpis {
  kinds: InboxKindKpi[];
  totalCreated: number;
  totalActed: number;
  suggestionsMade: number;
}

export async function getInboxKpis(range: { from: string; to: string }, sql: Sql | null = getSql()): Promise<InboxKpis | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT kind,
             count(*)::int AS created,
             -- "acted" = an operator decision; items that closed themselves or expired are not.
             count(*) FILTER (WHERE status = 'erledigt'
                                AND COALESCE(decision, '') NOT IN ('abgelaufen', 'erledigt_von_selbst'))::int AS acted,
             count(*) FILTER (WHERE status = 'verworfen')::int AS dismissed,
             count(*) FILTER (WHERE decision IN ('abgelaufen', 'erledigt_von_selbst'))::int AS closed_by_self,
             count(*) FILTER (WHERE outcome IS NOT NULL)::int AS with_outcome,
             count(*) FILTER (WHERE status = 'erledigt'
                                AND COALESCE(decision, '') NOT IN ('abgelaufen', 'erledigt_von_selbst')
                                AND (outcome->>'orders')::int > 0)::int AS orders_acted,
             count(*) FILTER (WHERE status = 'verworfen' AND (outcome->>'orders')::int > 0)::int AS orders_dismissed,
             COALESCE(sum((outcome->>'revenueCents')::bigint)
                        FILTER (WHERE status = 'erledigt'
                                  AND COALESCE(decision, '') NOT IN ('abgelaufen', 'erledigt_von_selbst')), 0)::bigint AS revenue_acted,
             count(*) FILTER (WHERE suggestion IS NOT NULL)::int AS suggested,
             mode() WITHIN GROUP (ORDER BY decision_note) FILTER (WHERE status = 'verworfen') AS top_reason
        FROM inbox_items
       WHERE created_at >= ${range.from}::date
         AND created_at < (${range.to}::date + 1)
       GROUP BY kind
       ORDER BY created DESC
    `) as Array<Record<string, unknown>>;
    const kinds = rows.map((r) => ({
      kind: String(r.kind),
      created: Number(r.created ?? 0),
      acted: Number(r.acted ?? 0),
      dismissed: Number(r.dismissed ?? 0),
      closedBySelf: Number(r.closed_by_self ?? 0),
      withOutcome: Number(r.with_outcome ?? 0),
      ordersAfterActed: Number(r.orders_acted ?? 0),
      ordersAfterDismissed: Number(r.orders_dismissed ?? 0),
      revenueAfterActedCents: Number(r.revenue_acted ?? 0),
      topDismissReason: (r.top_reason as string | null) ?? null,
    }));
    return {
      kinds,
      totalCreated: kinds.reduce((s, k) => s + k.created, 0),
      totalActed: kinds.reduce((s, k) => s + k.acted, 0),
      suggestionsMade: rows.reduce((s, r) => s + Number(r.suggested ?? 0), 0),
    };
  } catch (err) {
    reportError(err, { route: "lib/inbox-store", phase: "getInboxKpis" });
    return null;
  }
}
