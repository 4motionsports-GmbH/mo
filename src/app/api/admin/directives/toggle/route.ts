// POST /api/admin/directives/toggle  { id, active }
//
// Activate / deactivate a team directive. Deactivating never deletes — the row
// and its full version history remain, so an instruction can be brought back
// exactly as it was. Activation re-checks the active-count cap.
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { setDirectiveActive } from "@/lib/directives-store";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";

export const maxDuration = 15;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let id: number;
  let active: boolean;
  try {
    const body = (await req.json()) as { id?: unknown; active?: unknown };
    id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return adminJsonError("bad_request", "Valid id required", 400);
    }
    if (typeof body.active !== "boolean") {
      return adminJsonError("bad_request", "active (boolean) required", 400);
    }
    active = body.active;
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  if (!isDbConfigured()) {
    return adminJsonError("unavailable", "No database configured", 503);
  }

  try {
    await recordAdminAccess({ action: "directive.toggle", detail: { id, active } }, req);
    const result = await setDirectiveActive(id, active);
    if (!result.ok || !result.directive) {
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
      return adminJsonError("internal_error", "Umschalten fehlgeschlagen.", 500);
    }
    return adminJson({ directive: result.directive });
  } catch (err) {
    reportError(err, { route: "api/admin/directives/toggle" });
    return adminJsonError("internal_error", "Umschalten fehlgeschlagen.", 500);
  }
}
