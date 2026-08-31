// POST /api/admin/email-templates/assign — assign a design template to one
// email type, or clear the assignment (templateId null → built-in default).
// Body: { kind: 'summary'|'doi'|'marketing'|'campaign', templateId: number|null }.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { setEmailTemplateAssignment } from "@/lib/email-theme-store";
import { parseEmailThemeKind } from "@/lib/email-theme.mjs";
import { reportError } from "@/lib/observability";

export const maxDuration = 15;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let kind: string;
  let templateId: number | null;
  try {
    const body = (await req.json()) as { kind?: unknown; templateId?: unknown };
    const parsedKind = parseEmailThemeKind(body.kind);
    if (!parsedKind) {
      return adminJsonError("bad_request", "Unbekannter E-Mail-Typ.", 400);
    }
    kind = parsedKind;
    if (body.templateId == null) {
      templateId = null;
    } else if (
      typeof body.templateId === "number" &&
      Number.isInteger(body.templateId) &&
      body.templateId > 0
    ) {
      templateId = body.templateId;
    } else {
      return adminJsonError("bad_request", "Ungültige Vorlagen-ID.", 400);
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  if (!isDbConfigured()) {
    return adminJsonError("unavailable", "No database configured", 503);
  }

  try {
    await recordAdminAccess(
      { action: "email_template.assign", detail: { kind, templateId } },
      req
    );
    const result = await setEmailTemplateAssignment(kind, templateId);
    if (!result.ok) {
      if (result.error === "not_found") {
        return adminJsonError("not_found", "Vorlage nicht gefunden.", 404);
      }
      if (result.error === "db_unconfigured") {
        return adminJsonError("unavailable", "No database configured", 503);
      }
      return adminJsonError("internal_error", "Zuordnung fehlgeschlagen.", 500);
    }
    return adminJson({ ok: true });
  } catch (err) {
    reportError(err, { route: "api/admin/email-templates/assign" });
    return adminJsonError("internal_error", "Zuordnung fehlgeschlagen.", 500);
  }
}
