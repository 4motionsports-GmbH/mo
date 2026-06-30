// GET /api/admin/analytics — the stored-report list for the Analyse tab's side
// panel. Lightweight (no `sections` payload); the embedded client island fetches
// this to refresh the sidebar after a report is created / completed / deleted,
// instead of a heavy full-dashboard re-render.
//
// Auth: the proxy gates /api/admin/*; guardAdminGet re-asserts the session cookie.

import { guardAdminGet, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { listAnalyticsReports } from "@/lib/analytics-report-store";
import { reportError } from "@/lib/observability";

export const maxDuration = 15;

export async function GET() {
  const blocked = await guardAdminGet();
  if (blocked) return blocked;

  if (!isDbConfigured()) {
    return adminJson({ reports: [] });
  }
  try {
    const reports = await listAnalyticsReports();
    return adminJson({ reports });
  } catch (err) {
    reportError(err, { route: "api/admin/analytics:list" });
    return adminJsonError("internal_error", "Liste konnte nicht geladen werden.", 500);
  }
}
