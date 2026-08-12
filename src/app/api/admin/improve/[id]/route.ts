// GET /api/admin/improve/<id> — one improvement run's full detail (baseline,
// delta, Wirkungs-Check, suggestions). The Verbesserung tab fetches this when a
// run is selected.
//
// Auth: the proxy gates /api/admin/*; guardAdminGet re-asserts the session cookie.

import { guardAdminGet, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { getImprovementRun } from "@/lib/improvement-store";
import { reportError } from "@/lib/observability";

export const maxDuration = 15;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = await guardAdminGet();
  if (blocked) return blocked;

  if (!isDbConfigured()) {
    return adminJsonError("unavailable", "No database configured", 503);
  }
  try {
    const { id: idParam } = await ctx.params;
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) {
      return adminJsonError("bad_request", "Valid run id required", 400);
    }
    const run = await getImprovementRun(id);
    if (!run) {
      return adminJsonError("not_found", "Lauf nicht gefunden.", 404);
    }
    return adminJson({ run });
  } catch (err) {
    reportError(err, { route: "api/admin/improve/[id]:get" });
    return adminJsonError("internal_error", "Lauf konnte nicht geladen werden.", 500);
  }
}
