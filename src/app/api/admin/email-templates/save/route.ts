// POST /api/admin/email-templates/save — create (no id) or update (id) one
// email design template. Body: { id?, name, description?, ...theme tokens }.
// Theme tokens are validated through email-theme.mjs (closed vocabularies +
// hex-only colors) so nothing unvetted can reach the inline email CSS.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { recordAdminAccess } from "@/lib/admin-access-log";
import {
  createEmailTemplate,
  updateEmailTemplate,
} from "@/lib/email-theme-store";
import {
  normalizeTemplateDescription,
  normalizeTemplateName,
  parseEmailThemeInput,
} from "@/lib/email-theme.mjs";
import { reportError } from "@/lib/observability";

export const maxDuration = 15;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let id: number | null = null;
  let name: string;
  let description: string | null;
  let theme;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (body.id != null) {
      if (typeof body.id !== "number" || !Number.isInteger(body.id) || body.id <= 0) {
        return adminJsonError("bad_request", "Ungültige Vorlagen-ID.", 400);
      }
      id = body.id;
    }
    const normalizedName = normalizeTemplateName(body.name);
    if (!normalizedName) {
      return adminJsonError("bad_request", "Bitte einen Namen angeben (max. 80 Zeichen).", 400);
    }
    name = normalizedName;
    const normalizedDescription = normalizeTemplateDescription(body.description);
    if (normalizedDescription === undefined) {
      return adminJsonError("bad_request", "Beschreibung ist zu lang (max. 200 Zeichen).", 400);
    }
    description = normalizedDescription;
    const parsed = parseEmailThemeInput(body);
    if (parsed.errors.length > 0) {
      return adminJsonError(
        "bad_request",
        `Ungültige Design-Werte: ${parsed.errors.join(", ")}`,
        400
      );
    }
    theme = parsed.theme;
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  if (!isDbConfigured()) {
    return adminJsonError("unavailable", "No database configured", 503);
  }

  try {
    await recordAdminAccess(
      { action: id == null ? "email_template.create" : "email_template.update", detail: { id } },
      req
    );
    const result =
      id == null
        ? await createEmailTemplate({ name, description, theme })
        : await updateEmailTemplate(id, { name, description, theme });
    if (!result.ok || !result.template) {
      if (result.error === "not_found") {
        return adminJsonError("not_found", "Vorlage nicht gefunden.", 404);
      }
      if (result.error === "too_many_templates") {
        return adminJsonError(
          "bad_request",
          "Maximale Anzahl an Vorlagen erreicht — bitte zuerst eine löschen.",
          400
        );
      }
      if (result.error === "db_unconfigured") {
        return adminJsonError("unavailable", "No database configured", 503);
      }
      return adminJsonError("internal_error", "Speichern fehlgeschlagen.", 500);
    }
    return adminJson({ template: result.template });
  } catch (err) {
    reportError(err, { route: "api/admin/email-templates/save" });
    return adminJsonError("internal_error", "Speichern fehlgeschlagen.", 500);
  }
}
