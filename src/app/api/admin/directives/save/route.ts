// POST /api/admin/directives/save  { id?, content }
//
// Create (no id) or edit (id) a team directive — the "secured input field" of
// the improvement loop: server-authenticated, length-capped, active-count-
// capped, and every change appended to the mo_directive_versions history. The
// chat picks the change up within the directive cache TTL (≤ 5 min).
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { createDirective, updateDirectiveContent } from "@/lib/directives-store";
import { MAX_DIRECTIVE_CHARS } from "@/lib/improvement-core.mjs";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";

export const maxDuration = 15;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let id: number | null;
  let content: string;
  try {
    const body = (await req.json()) as { id?: unknown; content?: unknown };
    id = body.id == null ? null : Number(body.id);
    if (id != null && (!Number.isInteger(id) || id <= 0)) {
      return adminJsonError("bad_request", "Valid id required", 400);
    }
    if (typeof body.content !== "string" || !body.content.trim()) {
      return adminJsonError("bad_request", "content required", 400);
    }
    content = body.content;
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  if (!isDbConfigured()) {
    return adminJsonError("unavailable", "No database configured", 503);
  }

  try {
    await recordAdminAccess(
      { action: id == null ? "directive.create" : "directive.update", detail: { id } },
      req
    );
    const result =
      id == null
        ? await createDirective({ content, source: "operator" })
        : await updateDirectiveContent(id, content);
    if (!result.ok || !result.directive) {
      if (result.error === "invalid_content") {
        return adminJsonError(
          "bad_request",
          `Anweisungstext fehlt oder ist länger als ${MAX_DIRECTIVE_CHARS} Zeichen.`,
          400
        );
      }
      if (result.error === "too_many_active") {
        return adminJsonError(
          "bad_request",
          "Maximale Anzahl aktiver Anweisungen erreicht — bitte zuerst eine deaktivieren.",
          400
        );
      }
      if (result.error === "not_found") {
        return adminJsonError("not_found", "Anweisung nicht gefunden.", 404);
      }
      return adminJsonError("internal_error", "Speichern fehlgeschlagen.", 500);
    }
    return adminJson({ directive: result.directive });
  } catch (err) {
    reportError(err, { route: "api/admin/directives/save" });
    return adminJsonError("internal_error", "Speichern fehlgeschlagen.", 500);
  }
}
