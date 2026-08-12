// POST /api/admin/improve/delete  { id }
//
// Delete a stored improvement run. Its suggestions CASCADE with it — deleting a
// run is the "discard this whole batch" action; individual suggestions are
// dismissed (kept as history), not deleted. A directive adopted from one of the
// run's suggestions survives (mo_directives.suggestion_id → SET NULL).
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { deleteImprovementRun } from "@/lib/improvement-store";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";

export const maxDuration = 15;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let id: number;
  try {
    const body = (await req.json()) as { id?: unknown };
    id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return adminJsonError("bad_request", "Valid run id required", 400);
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  if (!isDbConfigured()) {
    return adminJsonError("unavailable", "No database configured", 503);
  }

  try {
    await recordAdminAccess({ action: "improvement.run.delete", detail: { id } }, req);
    const ok = await deleteImprovementRun(id);
    if (!ok) {
      return adminJsonError("internal_error", "Lauf konnte nicht gelöscht werden.", 500);
    }
    return adminJson({ ok: true });
  } catch (err) {
    reportError(err, { route: "api/admin/improve/delete" });
    return adminJsonError("internal_error", "Löschen fehlgeschlagen.", 500);
  }
}
