// Data layer for Mo's live team-directive layer (migration 0044,
// docs/IMPROVEMENT_LOOP.md): short operator-approved instructions injected into
// the chat system prompt (system-prompt-core renderTeamDirectives), maintained
// in the admin "Verbesserung" tab.
//
// Design constraints:
//   - HUMAN-IN-THE-LOOP: rows only ever change through the authenticated admin
//     routes. The improvement engine can PROPOSE a directive text; adoption is
//     always an explicit operator click.
//   - BOUNDED: at most MAX_ACTIVE_DIRECTIVES active rows, each at most
//     MAX_DIRECTIVE_CHARS — the prompt section cannot grow unbounded.
//   - VERSIONED: every mutation appends to mo_directive_versions (append-only),
//     so the full history of what Mo was told is auditable ("all past system
//     prompts" for the editable layer; the core prompt is versioned by git).
//   - Chat-path reads are TTL-cached like the published Q&A: a per-turn query
//     is not free, a 5-minute staleness after an edit is invisible. Admin
//     mutations invalidate the cache so same-instance edits go live at once.
//
// Like every store: degrades gracefully — no DB configured → empty lists /
// no-ops, and a read failure never breaks the chat.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { MAX_ACTIVE_DIRECTIVES, MAX_DIRECTIVE_CHARS } from "./improvement-core.mjs";

export interface MoDirective {
  id: number;
  content: string;
  active: boolean;
  source: "operator" | "suggestion";
  suggestionId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface MoDirectiveVersion {
  id: number;
  directiveId: number;
  content: string;
  active: boolean;
  action: "created" | "updated" | "activated" | "deactivated";
  createdAt: string;
}

export type DirectiveMutationError =
  | "invalid_content"
  | "too_many_active"
  | "not_found"
  | "db_unconfigured"
  | "db_error";

export interface DirectiveMutationResult {
  ok: boolean;
  directive?: MoDirective;
  error?: DirectiveMutationError;
}

interface DirectiveRow {
  id: number;
  content: string;
  active: boolean;
  source: string;
  suggestion_id: number | null;
  created_at: string;
  updated_at: string;
}

function mapRow(r: DirectiveRow): MoDirective {
  return {
    id: Number(r.id),
    content: r.content,
    active: Boolean(r.active),
    source: r.source === "suggestion" ? "suggestion" : "operator",
    suggestionId: r.suggestion_id == null ? null : Number(r.suggestion_id),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function normalizeContent(content: unknown): string | null {
  if (typeof content !== "string") return null;
  const t = content.replace(/\s+/g, " ").trim();
  if (!t || t.length > MAX_DIRECTIVE_CHARS) return null;
  return t;
}

// ── Admin reads ───────────────────────────────────────────────────────────────

/** All directives, oldest first (the stable prompt ordering), active or not. */
export async function listDirectives(sql: Sql | null = getSql()): Promise<MoDirective[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT id, content, active, source, suggestion_id, created_at, updated_at
        FROM mo_directives
       ORDER BY created_at ASC, id ASC
    `) as DirectiveRow[];
    return rows.map(mapRow);
  } catch (err) {
    reportError(err, { route: "lib/directives-store", phase: "list" });
    return [];
  }
}

/** Append-only history of one directive, newest first. */
export async function listDirectiveVersions(
  directiveId: number,
  sql: Sql | null = getSql()
): Promise<MoDirectiveVersion[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT id, directive_id, content, active, action, created_at
        FROM mo_directive_versions
       WHERE directive_id = ${directiveId}
       ORDER BY created_at DESC, id DESC
       LIMIT 100
    `) as Array<{
      id: number;
      directive_id: number;
      content: string;
      active: boolean;
      action: string;
      created_at: string;
    }>;
    return rows.map((r) => ({
      id: Number(r.id),
      directiveId: Number(r.directive_id),
      content: r.content,
      active: Boolean(r.active),
      action: (["created", "updated", "activated", "deactivated"].includes(r.action)
        ? r.action
        : "updated") as MoDirectiveVersion["action"],
      createdAt: String(r.created_at),
    }));
  } catch (err) {
    reportError(err, { route: "lib/directives-store", phase: "versions" });
    return [];
  }
}

// ── Chat-path read (cached) ───────────────────────────────────────────────────

/** ACTIVE directives, oldest first, capped — the exact prompt input. */
export async function listActiveDirectives(
  sql: Sql | null = getSql()
): Promise<Array<{ content: string }>> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT content
        FROM mo_directives
       WHERE active
       ORDER BY created_at ASC, id ASC
       LIMIT ${MAX_ACTIVE_DIRECTIVES}
    `) as Array<{ content: string }>;
    return rows
      .filter((r) => typeof r.content === "string" && r.content.trim())
      .map((r) => ({ content: r.content }));
  } catch (err) {
    reportError(err, { route: "lib/directives-store", phase: "active" });
    return [];
  }
}

// In-memory TTL cache for the chat hot path — same rationale and shape as
// qa-store's getCachedGeneralQa (read every turn, changes only on an explicit
// admin action). Never throws; on failure the chat gets the last known list.
let directivesCache: { at: number; entries: Array<{ content: string }> } | null = null;
const DIRECTIVES_TTL_MS = 5 * 60 * 1000;

export async function getCachedActiveDirectives(): Promise<Array<{ content: string }>> {
  if (directivesCache && Date.now() - directivesCache.at < DIRECTIVES_TTL_MS) {
    return directivesCache.entries;
  }
  const entries = await listActiveDirectives();
  directivesCache = { at: Date.now(), entries };
  return entries;
}

/** Drop the chat-path cache (called after every admin mutation). */
export function invalidateDirectivesCache(): void {
  directivesCache = null;
}

// ── Admin mutations (each appends a version row) ──────────────────────────────

async function countActive(sql: Sql): Promise<number> {
  const rows = (await sql`
    SELECT count(*)::int AS n FROM mo_directives WHERE active
  `) as Array<{ n: number }>;
  return Number(rows[0]?.n ?? 0);
}

export async function createDirective(
  input: { content: string; source?: "operator" | "suggestion"; suggestionId?: number | null },
  sql: Sql | null = getSql()
): Promise<DirectiveMutationResult> {
  if (!sql) return { ok: false, error: "db_unconfigured" };
  const content = normalizeContent(input.content);
  if (!content) return { ok: false, error: "invalid_content" };
  try {
    if ((await countActive(sql)) >= MAX_ACTIVE_DIRECTIVES) {
      return { ok: false, error: "too_many_active" };
    }
    const rows = (await sql`
      INSERT INTO mo_directives (content, active, source, suggestion_id)
      VALUES (${content}, TRUE, ${input.source === "suggestion" ? "suggestion" : "operator"},
              ${input.suggestionId ?? null})
      RETURNING id, content, active, source, suggestion_id, created_at, updated_at
    `) as DirectiveRow[];
    const directive = mapRow(rows[0]);
    await sql`
      INSERT INTO mo_directive_versions (directive_id, content, active, action)
      VALUES (${directive.id}, ${content}, TRUE, 'created')
    `;
    invalidateDirectivesCache();
    return { ok: true, directive };
  } catch (err) {
    reportError(err, { route: "lib/directives-store", phase: "create" });
    return { ok: false, error: "db_error" };
  }
}

export async function updateDirectiveContent(
  id: number,
  content: string,
  sql: Sql | null = getSql()
): Promise<DirectiveMutationResult> {
  if (!sql) return { ok: false, error: "db_unconfigured" };
  const normalized = normalizeContent(content);
  if (!normalized) return { ok: false, error: "invalid_content" };
  try {
    const rows = (await sql`
      UPDATE mo_directives
         SET content = ${normalized}, updated_at = now()
       WHERE id = ${id}
      RETURNING id, content, active, source, suggestion_id, created_at, updated_at
    `) as DirectiveRow[];
    if (rows.length === 0) return { ok: false, error: "not_found" };
    const directive = mapRow(rows[0]);
    await sql`
      INSERT INTO mo_directive_versions (directive_id, content, active, action)
      VALUES (${directive.id}, ${normalized}, ${directive.active}, 'updated')
    `;
    invalidateDirectivesCache();
    return { ok: true, directive };
  } catch (err) {
    reportError(err, { route: "lib/directives-store", phase: "update" });
    return { ok: false, error: "db_error" };
  }
}

export async function setDirectiveActive(
  id: number,
  active: boolean,
  sql: Sql | null = getSql()
): Promise<DirectiveMutationResult> {
  if (!sql) return { ok: false, error: "db_unconfigured" };
  try {
    if (active && (await countActive(sql)) >= MAX_ACTIVE_DIRECTIVES) {
      return { ok: false, error: "too_many_active" };
    }
    const rows = (await sql`
      UPDATE mo_directives
         SET active = ${active}, updated_at = now()
       WHERE id = ${id} AND active <> ${active}
      RETURNING id, content, active, source, suggestion_id, created_at, updated_at
    `) as DirectiveRow[];
    if (rows.length === 0) {
      // Either unknown id or already in the requested state — report the row.
      const existing = (await sql`
        SELECT id, content, active, source, suggestion_id, created_at, updated_at
          FROM mo_directives WHERE id = ${id}
      `) as DirectiveRow[];
      if (existing.length === 0) return { ok: false, error: "not_found" };
      return { ok: true, directive: mapRow(existing[0]) };
    }
    const directive = mapRow(rows[0]);
    await sql`
      INSERT INTO mo_directive_versions (directive_id, content, active, action)
      VALUES (${directive.id}, ${directive.content}, ${active},
              ${active ? "activated" : "deactivated"})
    `;
    invalidateDirectivesCache();
    return { ok: true, directive };
  } catch (err) {
    reportError(err, { route: "lib/directives-store", phase: "toggle" });
    return { ok: false, error: "db_error" };
  }
}
