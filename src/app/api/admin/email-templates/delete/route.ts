// POST /api/admin/email-templates/delete — delete one email design template.
// Assignments referencing it cascade away (migration 0048), so the affected
// email types fall back to the built-in default design.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { deleteEmailTemplate } from "@/lib/email-theme-store";
import { reportError } from "@/lib/observability";

export const maxDuration = 15;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let id: number;
  try {
    const body = (await req.json()) as { id?: unknown };
    if (typeof body.id !== "number" || !Number.isInteger(body.id) || body.id <= 0) {
      return adminJsonError("bad_request", "Ungültige Vorlagen-ID.", 400);
    }
    id = body.id;
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  if (!isDbConfigured()) {
    return adminJsonError("unavailable", "No database configured", 503);
  }

  try {
    await recordAdminAccess({ action: "email_template.delete", detail: { id } }, req);
    const result = await deleteEmailTemplate(id);
    if (!result.ok) {
      if (result.error === "not_found") {
        return adminJsonError("not_found", "Vorlage nicht gefunden.", 404);
      }
      if (result.error === "db_unconfigured") {
        return adminJsonError("unavailable", "No database configured", 503);
      }
      return adminJsonError("internal_error", "Löschen fehlgeschlagen.", 500);
    }
    return adminJson({ ok: true });
  } catch (err) {
    reportError(err, { route: "api/admin/email-templates/delete" });
    return adminJsonError("internal_error", "Löschen fehlgeschlagen.", 500);
  }
}
