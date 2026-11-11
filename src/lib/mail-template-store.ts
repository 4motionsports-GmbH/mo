// E-mail templates („Vorlagen“) — the I/O half (table mail_templates,
// migration 0081). The format and its rules: mail-template-doc.mjs (tested);
// how a template becomes the design of Mo's personal mails:
// mail-template-design.ts; docs/EMAIL_TEMPLATES.md.
//
// Every document is normalised on its way in AND out (normalizeMailTemplateDoc),
// so whatever is stored — an old version, a hand-edited row — renders through
// the same safe vocabulary. `version` counts saves: the release fingerprint of
// a planned campaign mail includes it, so a template changed after
// „Einplanen“ holds those mails for a new review.
//
// Fail-soft like every store: no database → empty lists / null; the send path
// reads through a short cache and falls back to the classic design when a
// template cannot be read (never a broken send).

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import {
  MAIL_TEMPLATE_LIMITS,
  docBlockCount,
  docHasHero,
  docSupportsPersonal,
  normalizeMailTemplateDoc,
} from "./mail-template-doc.mjs";

export type MailTemplateDoc = ReturnType<typeof normalizeMailTemplateDoc>;

export interface MailTemplate {
  id: number;
  name: string;
  description: string | null;
  doc: MailTemplateDoc;
  version: number;
  archivedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** What lists and pickers need (no document). */
export interface MailTemplateMeta {
  id: number;
  name: string;
  description: string | null;
  version: number;
  archivedAt: string | null;
  updatedAt: string | null;
  /** Has „Mos persönlicher Text“ → selectable as the design of Kampagne / Marketing mails. */
  supportsPersonal: boolean;
  hasHero: boolean;
  /** Every block, the ones inside the columns of a section included (the footer too). */
  blockCount: number;
}

const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);

function mapTemplate(r: Record<string, unknown>): MailTemplate {
  return {
    id: Number(r.id),
    name: String(r.name ?? ""),
    description: (r.description as string | null) ?? null,
    doc: normalizeMailTemplateDoc(r.doc),
    version: Number(r.version ?? 1),
    archivedAt: iso(r.archived_at),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export function templateMeta(t: MailTemplate): MailTemplateMeta {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    version: t.version,
    archivedAt: t.archivedAt,
    updatedAt: t.updatedAt,
    supportsPersonal: docSupportsPersonal(t.doc),
    hasHero: docHasHero(t.doc),
    blockCount: docBlockCount(t.doc),
  };
}

function isMissingTable(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  return e?.code === "42P01" || e?.cause?.code === "42P01";
}

/** A template name: 3–80 characters. */
export function cleanTemplateName(v: unknown): string | null {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return s.length >= 3 && s.length <= MAIL_TEMPLATE_LIMITS.nameChars ? s : null;
}

/** An optional description (≤ 300 characters); undefined = invalid. */
export function cleanTemplateDescription(v: unknown): string | null | undefined {
  if (v == null || v === "") return null;
  if (typeof v !== "string") return undefined;
  const s = v.replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length <= MAIL_TEMPLATE_LIMITS.descriptionChars ? s : undefined;
}

// ── reads ────────────────────────────────────────────────────────────────────

/** Every template, newest first. Never throws. */
export async function listMailTemplates(
  opts: { includeArchived?: boolean } = {},
  sql: Sql | null = getSql()
): Promise<MailTemplate[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT id, name, description, doc, version, archived_at, created_at, updated_at
        FROM mail_templates
       WHERE ${opts.includeArchived === true} OR archived_at IS NULL
       ORDER BY archived_at IS NOT NULL, updated_at DESC, id DESC
       LIMIT 200
    `) as Array<Record<string, unknown>>;
    return rows.map(mapTemplate);
  } catch (err) {
    if (!isMissingTable(err)) reportError(err, { route: "lib/mail-template-store", phase: "list" });
    return [];
  }
}

/** The metadata of every template (for pickers). Never throws. */
export async function listMailTemplateMeta(
  opts: { includeArchived?: boolean } = {},
  sql: Sql | null = getSql()
): Promise<MailTemplateMeta[]> {
  return (await listMailTemplates(opts, sql)).map(templateMeta);
}

/** One template, or null. Never throws. */
export async function getMailTemplate(id: number, sql: Sql | null = getSql()): Promise<MailTemplate | null> {
  if (!sql || !Number.isInteger(id) || id <= 0) return null;
  try {
    const rows = (await sql`
      SELECT id, name, description, doc, version, archived_at, created_at, updated_at
        FROM mail_templates WHERE id = ${id}
    `) as Array<Record<string, unknown>>;
    return rows[0] ? mapTemplate(rows[0]) : null;
  } catch (err) {
    if (!isMissingTable(err)) reportError(err, { route: "lib/mail-template-store", phase: "get" });
    return null;
  }
}

// The send path reads templates through a short cache: a burst of sends must
// not query the same row thousands of times. Saves invalidate the entry on
// this instance; other instances see a change within the TTL.
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map<number, { at: number; template: MailTemplate | null }>();

/** One template through the short send-path cache. Never throws. */
export async function getCachedMailTemplate(id: number): Promise<MailTemplate | null> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.template;
  const template = await getMailTemplate(id);
  cache.set(id, { at: Date.now(), template });
  return template;
}

function invalidate(id: number) {
  cache.delete(id);
}

// ── writes ───────────────────────────────────────────────────────────────────

export type TemplateWriteResult =
  | { ok: true; template: MailTemplate }
  | { ok: false; reason: "no_db" | "missing_table" | "not_found" | "conflict" | "failed" };

/** Create a template (the document is normalised). */
export async function createMailTemplate(
  input: { name: string; description: string | null; doc: unknown },
  sql: Sql | null = getSql()
): Promise<TemplateWriteResult> {
  if (!sql) return { ok: false, reason: "no_db" };
  const doc = normalizeMailTemplateDoc(input.doc);
  try {
    const rows = (await sql`
      INSERT INTO mail_templates (name, description, doc)
      VALUES (${input.name}, ${input.description}, ${JSON.stringify(doc)}::jsonb)
      RETURNING id, name, description, doc, version, archived_at, created_at, updated_at
    `) as Array<Record<string, unknown>>;
    return rows[0] ? { ok: true, template: mapTemplate(rows[0]) } : { ok: false, reason: "failed" };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, reason: "missing_table" };
    reportError(err, { route: "lib/mail-template-store", phase: "create" });
    return { ok: false, reason: "failed" };
  }
}

/**
 * Save a template. `expectedVersion` (the version the editor loaded) guards
 * against two tabs overwriting each other: a stale save is refused
 * (`conflict`). Every save increments the version.
 */
export async function updateMailTemplate(
  id: number,
  patch: { name?: string; description?: string | null; doc?: unknown },
  expectedVersion: number | null,
  sql: Sql | null = getSql()
): Promise<TemplateWriteResult> {
  if (!sql) return { ok: false, reason: "no_db" };
  const hasName = patch.name !== undefined;
  const hasDescription = patch.description !== undefined;
  const hasDoc = patch.doc !== undefined;
  const doc = hasDoc ? JSON.stringify(normalizeMailTemplateDoc(patch.doc)) : null;
  try {
    const rows = (await sql`
      UPDATE mail_templates SET
        name        = CASE WHEN ${hasName} THEN ${patch.name ?? ""} ELSE name END,
        description = CASE WHEN ${hasDescription} THEN ${patch.description ?? null} ELSE description END,
        doc         = CASE WHEN ${hasDoc} THEN ${doc}::jsonb ELSE doc END,
        version     = version + 1,
        updated_at  = now()
       WHERE id = ${id}
         AND (${expectedVersion}::int IS NULL OR version = ${expectedVersion}::int)
      RETURNING id, name, description, doc, version, archived_at, created_at, updated_at
    `) as Array<Record<string, unknown>>;
    invalidate(id);
    if (rows[0]) return { ok: true, template: mapTemplate(rows[0]) };
    const exists = await getMailTemplate(id, sql);
    return { ok: false, reason: exists ? "conflict" : "not_found" };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, reason: "missing_table" };
    reportError(err, { route: "lib/mail-template-store", phase: "update" });
    return { ok: false, reason: "failed" };
  }
}

/** Archive (hide) or restore a template. Archived templates still render for whoever uses them. */
export async function setMailTemplateArchived(
  id: number,
  archived: boolean,
  sql: Sql | null = getSql()
): Promise<TemplateWriteResult> {
  if (!sql) return { ok: false, reason: "no_db" };
  try {
    const rows = (await sql`
      UPDATE mail_templates
         SET archived_at = CASE WHEN ${archived} THEN COALESCE(archived_at, now()) ELSE NULL END,
             updated_at = now()
       WHERE id = ${id}
      RETURNING id, name, description, doc, version, archived_at, created_at, updated_at
    `) as Array<Record<string, unknown>>;
    invalidate(id);
    return rows[0] ? { ok: true, template: mapTemplate(rows[0]) } : { ok: false, reason: "not_found" };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, reason: "missing_table" };
    reportError(err, { route: "lib/mail-template-store", phase: "archive" });
    return { ok: false, reason: "failed" };
  }
}

/**
 * Where a template is in use as a design: the mail types selected in
 * Einstellungen and the campaigns that chose it. Never throws.
 */
export async function templateUsage(
  id: number,
  sql: Sql | null = getSql()
): Promise<{ kinds: string[]; campaigns: Array<{ id: number; name: string; status: string }> }> {
  if (!sql) return { kinds: [], campaigns: [] };
  const key = `vorlage-${id}`;
  try {
    const [kinds, campaigns] = await Promise.all([
      sql`SELECT email_kind FROM email_design_selections WHERE design_key = ${key} ORDER BY email_kind`,
      sql`SELECT id, name, status FROM campaigns WHERE design_key = ${key} AND status <> 'archiviert' ORDER BY id DESC LIMIT 50`,
    ]);
    return {
      kinds: (kinds as Array<{ email_kind: string }>).map((r) => String(r.email_kind)),
      campaigns: (campaigns as Array<Record<string, unknown>>).map((r) => ({
        id: Number(r.id),
        name: String(r.name),
        status: String(r.status),
      })),
    };
  } catch (err) {
    reportError(err, { route: "lib/mail-template-store", phase: "usage" });
    return { kinds: [], campaigns: [] };
  }
}
