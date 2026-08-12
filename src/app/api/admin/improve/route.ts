// GET /api/admin/improve — the stored improvement-run list for the Verbesserung
// tab's side panel (no heavy payloads; suggestions ride on the [id] detail).
//
// Auth: the proxy gates /api/admin/*; guardAdminGet re-asserts the session cookie.

import { guardAdminGet, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { listImprovementRuns } from "@/lib/improvement-store";
import { reportError } from "@/lib/observability";

export const maxDuration = 15;

export async function GET() {
  const blocked = await guardAdminGet();
  if (blocked) return blocked;

  if (!isDbConfigured()) {
    return adminJson({ runs: [] });
  }
  try {
    const runs = await listImprovementRuns();
    return adminJson({ runs });
  } catch (err) {
    reportError(err, { route: "api/admin/improve:list" });
    return adminJsonError("internal_error", "Liste konnte nicht geladen werden.", 500);
  }
}
