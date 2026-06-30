// GET /api/admin/analytics/<id> — one report's full detail (incl. the `sections`
// payload + options + usage). The Analyse tab fetches this when a report is
// selected, so switching reports is a single cheap query instead of re-rendering
// the whole /admin server tree.
//
// Auth: the proxy gates /api/admin/*; guardAdminGet re-asserts the session cookie.

import { guardAdminGet, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { getAnalyticsReport } from "@/lib/analytics-report-store";
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
      return adminJsonError("bad_request", "Valid report id required", 400);
    }
    const report = await getAnalyticsReport(id);
    if (!report) {
      return adminJsonError("not_found", "Report nicht gefunden.", 404);
    }
    return adminJson({ report });
  } catch (err) {
    reportError(err, { route: "api/admin/analytics/[id]:get" });
    return adminJsonError("internal_error", "Report konnte nicht geladen werden.", 500);
  }
}
