// Data layer for the operator-managed email design templates ("Vorlagen",
// migration 0048) and their per-email-type assignment — maintained in the
// admin "Einstellungen" tab, consumed by every branded-shell send/preview path
// (summary, DOI, marketing, campaign) via getCachedThemeForKind.
//
// Design constraints:
//   - CONTENT-NEUTRAL: a template only carries shell design tokens
//     (email-theme.mjs). It can never alter prose, legal copy, product data or
//     the unsubscribe slot — those stay with their composers.
//   - FAIL-SOFT ON THE SEND PATH: theme resolution must never block or break a
//     send. No DB, a read failure, or a missing assignment all resolve to null
//     → the shell renders the built-in default design (today's look).
//   - Send-path reads are TTL-cached (one small join, but sends can burst);
//     admin mutations invalidate the cache so same-instance edits go live at
//     once — same pattern as directives-store.
//
// Like every store: degrades gracefully — no DB configured → empty lists /
// no-ops, and a read failure never breaks a send.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import type { EmailTheme } from "./email-theme-context";
import {
  DEFAULT_EMAIL_THEME,
  EMAIL_THEME_KINDS,
  MAX_EMAIL_TEMPLATES,
  parseEmailButtonShape,
  parseEmailFontKey,
  parseEmailThemeKind,
  parseHexColor,
} from "./email-theme.mjs";

export interface EmailTemplateRecord {
  id: number;
  name: string;
  description: string | null;
  theme: EmailTheme;
  createdAt: string;
  updatedAt: string;
}

/** kind → assigned template id (only kinds that HAVE an assignment appear). */
export type EmailTemplateAssignments = Partial<Record<string, number>>;

export type EmailTemplateMutationError =
  | "invalid_input"
  | "too_many_templates"
  | "not_found"
  | "db_unconfigured"
  | "db_error";

export interface EmailTemplateMutationResult {
  ok: boolean;
  template?: EmailTemplateRecord;
  error?: EmailTemplateMutationError;
}

interface TemplateRow {
  id: number;
  name: string;
  description: string | null;
  accent_color: string;
  band_background: string;
  band_text_color: string;
  outer_background: string;
  font_family: string;
  button_shape: string;
  logo_url: string | null;
  show_social: boolean;
  created_at: string;
  updated_at: string;
}

// Row values re-validate through the same parsers as API input — a manually
// edited DB row can degrade a single token to its default, never ship an
// unvetted string into inline CSS.
function themeFromRow(r: TemplateRow): EmailTheme {
  return {
    accentColor: parseHexColor(r.accent_color) ?? DEFAULT_EMAIL_THEME.accentColor,
    bandBackground: parseHexColor(r.band_background) ?? DEFAULT_EMAIL_THEME.bandBackground,
    bandTextColor: parseHexColor(r.band_text_color) ?? DEFAULT_EMAIL_THEME.bandTextColor,
    outerBackground:
      parseHexColor(r.outer_background) ?? DEFAULT_EMAIL_THEME.outerBackground,
    fontFamily: parseEmailFontKey(r.font_family) ?? DEFAULT_EMAIL_THEME.fontFamily,
    buttonShape: parseEmailButtonShape(r.button_shape) ?? DEFAULT_EMAIL_THEME.buttonShape,
    logoUrl: typeof r.logo_url === "string" && r.logo_url.trim() ? r.logo_url : null,
    showSocial: Boolean(r.show_social),
  };
}

function mapRow(r: TemplateRow): EmailTemplateRecord {
  return {
    id: Number(r.id),
    name: r.name,
    description: r.description ?? null,
    theme: themeFromRow(r),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

// ── Admin reads ───────────────────────────────────────────────────────────────

/** All templates, oldest first (stable UI ordering). */
export async function listEmailTemplates(
  sql: Sql | null = getSql()
): Promise<EmailTemplateRecord[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT id, name, description, accent_color, band_background,
             band_text_color, outer_background, font_family, button_shape,
             logo_url, show_social, created_at, updated_at
        FROM email_templates
       ORDER BY created_at ASC, id ASC
    `) as TemplateRow[];
    return rows.map(mapRow);
  } catch (err) {
    reportError(err, { route: "lib/email-theme-store", phase: "list" });
    return [];
  }
}

/** The per-kind assignment map (kinds without a row = default design). */
export async function listEmailTemplateAssignments(
  sql: Sql | null = getSql()
): Promise<EmailTemplateAssignments> {
  if (!sql) return {};
  try {
    const rows = (await sql`
      SELECT email_kind, template_id FROM email_template_assignments
    `) as Array<{ email_kind: string; template_id: number }>;
    const map: EmailTemplateAssignments = {};
    for (const r of rows) {
      if (parseEmailThemeKind(r.email_kind)) map[r.email_kind] = Number(r.template_id);
    }
    return map;
  } catch (err) {
    reportError(err, { route: "lib/email-theme-store", phase: "assignments" });
    return {};
  }
}

// ── Send-path read (cached) ───────────────────────────────────────────────────

// One join loads every assigned theme at once; sends of all kinds share the
// cache. 5-minute staleness after an admin edit is invisible; admin mutations
// invalidate so same-instance edits go live at once.
let themeCache: { at: number; byKind: Map<string, EmailTheme> } | null = null;
const THEME_TTL_MS = 5 * 60 * 1000;

async function loadAssignedThemes(
  sql: Sql | null = getSql()
): Promise<Map<string, EmailTheme>> {
  const byKind = new Map<string, EmailTheme>();
  if (!sql) return byKind;
  try {
    const rows = (await sql`
      SELECT a.email_kind AS assigned_kind, t.*
        FROM email_template_assignments a
        JOIN email_templates t ON t.id = a.template_id
    `) as Array<TemplateRow & { assigned_kind: string }>;
    for (const r of rows) {
      if (parseEmailThemeKind(r.assigned_kind)) byKind.set(r.assigned_kind, themeFromRow(r));
    }
  } catch (err) {
    reportError(err, { route: "lib/email-theme-store", phase: "loadAssignedThemes" });
  }
  return byKind;
}

/**
 * The theme assigned to an email kind, or null → render the built-in default
 * design. NEVER throws — theme resolution must never block a send.
 */
export async function getCachedThemeForKind(kind: string): Promise<EmailTheme | null> {
  if (!parseEmailThemeKind(kind)) return null;
  if (!themeCache || Date.now() - themeCache.at >= THEME_TTL_MS) {
    themeCache = { at: Date.now(), byKind: await loadAssignedThemes() };
  }
  return themeCache.byKind.get(kind) ?? null;
}

/** Drop the send-path cache (called after every admin mutation). */
export function invalidateEmailThemeCache(): void {
  themeCache = null;
}

// ── Admin mutations ───────────────────────────────────────────────────────────

export interface EmailTemplateInput {
  name: string;
  description: string | null;
  theme: EmailTheme;
}

export async function createEmailTemplate(
  input: EmailTemplateInput,
  sql: Sql | null = getSql()
): Promise<EmailTemplateMutationResult> {
  if (!sql) return { ok: false, error: "db_unconfigured" };
  try {
    const count = (await sql`
      SELECT count(*)::int AS n FROM email_templates
    `) as Array<{ n: number }>;
    if (Number(count[0]?.n ?? 0) >= MAX_EMAIL_TEMPLATES) {
      return { ok: false, error: "too_many_templates" };
    }
    const t = input.theme;
    const rows = (await sql`
      INSERT INTO email_templates
        (name, description, accent_color, band_background, band_text_color,
         outer_background, font_family, button_shape, logo_url, show_social)
      VALUES (${input.name}, ${input.description}, ${t.accentColor},
              ${t.bandBackground}, ${t.bandTextColor}, ${t.outerBackground},
              ${t.fontFamily}, ${t.buttonShape}, ${t.logoUrl}, ${t.showSocial})
      RETURNING id, name, description, accent_color, band_background,
                band_text_color, outer_background, font_family, button_shape,
                logo_url, show_social, created_at, updated_at
    `) as TemplateRow[];
    invalidateEmailThemeCache();
    return { ok: true, template: mapRow(rows[0]) };
  } catch (err) {
    reportError(err, { route: "lib/email-theme-store", phase: "create" });
    return { ok: false, error: "db_error" };
  }
}

export async function updateEmailTemplate(
  id: number,
  input: EmailTemplateInput,
  sql: Sql | null = getSql()
): Promise<EmailTemplateMutationResult> {
  if (!sql) return { ok: false, error: "db_unconfigured" };
  try {
    const t = input.theme;
    const rows = (await sql`
      UPDATE email_templates
         SET name = ${input.name},
             description = ${input.description},
             accent_color = ${t.accentColor},
             band_background = ${t.bandBackground},
             band_text_color = ${t.bandTextColor},
             outer_background = ${t.outerBackground},
             font_family = ${t.fontFamily},
             button_shape = ${t.buttonShape},
             logo_url = ${t.logoUrl},
             show_social = ${t.showSocial},
             updated_at = now()
       WHERE id = ${id}
      RETURNING id, name, description, accent_color, band_background,
                band_text_color, outer_background, font_family, button_shape,
                logo_url, show_social, created_at, updated_at
    `) as TemplateRow[];
    if (rows.length === 0) return { ok: false, error: "not_found" };
    invalidateEmailThemeCache();
    return { ok: true, template: mapRow(rows[0]) };
  } catch (err) {
    reportError(err, { route: "lib/email-theme-store", phase: "update" });
    return { ok: false, error: "db_error" };
  }
}

/** Delete a template; its assignments cascade away (→ default design). */
export async function deleteEmailTemplate(
  id: number,
  sql: Sql | null = getSql()
): Promise<{ ok: boolean; error?: EmailTemplateMutationError }> {
  if (!sql) return { ok: false, error: "db_unconfigured" };
  try {
    const rows = (await sql`
      DELETE FROM email_templates WHERE id = ${id} RETURNING id
    `) as Array<{ id: number }>;
    if (rows.length === 0) return { ok: false, error: "not_found" };
    invalidateEmailThemeCache();
    return { ok: true };
  } catch (err) {
    reportError(err, { route: "lib/email-theme-store", phase: "delete" });
    return { ok: false, error: "db_error" };
  }
}

/**
 * Assign a template to an email kind (upsert), or clear the assignment
 * (templateId null → the kind renders the built-in default design).
 */
export async function setEmailTemplateAssignment(
  kind: string,
  templateId: number | null,
  sql: Sql | null = getSql()
): Promise<{ ok: boolean; error?: EmailTemplateMutationError }> {
  if (!sql) return { ok: false, error: "db_unconfigured" };
  if (!parseEmailThemeKind(kind)) return { ok: false, error: "invalid_input" };
  try {
    if (templateId == null) {
      await sql`DELETE FROM email_template_assignments WHERE email_kind = ${kind}`;
      invalidateEmailThemeCache();
      return { ok: true };
    }
    const exists = (await sql`
      SELECT id FROM email_templates WHERE id = ${templateId}
    `) as Array<{ id: number }>;
    if (exists.length === 0) return { ok: false, error: "not_found" };
    await sql`
      INSERT INTO email_template_assignments (email_kind, template_id)
      VALUES (${kind}, ${templateId})
      ON CONFLICT (email_kind)
      DO UPDATE SET template_id = EXCLUDED.template_id, updated_at = now()
    `;
    invalidateEmailThemeCache();
    return { ok: true };
  } catch (err) {
    reportError(err, { route: "lib/email-theme-store", phase: "assign" });
    return { ok: false, error: "db_error" };
  }
}

// Re-export so send paths need a single import for "resolve + kinds".
export { EMAIL_THEME_KINDS };
