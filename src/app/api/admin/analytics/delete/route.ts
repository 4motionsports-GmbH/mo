// POST /api/admin/analytics/delete  { id }
//
// Delete a stored "Komplettanalyse" report (removes it from the side panel). The
// report is derived analytics text with no FK, so this is a simple row delete.
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { deleteAnalyticsReport } from "@/lib/analytics-report-store";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";

export const maxDuration = 30;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let id: number;
  try {
    const body = (await req.json()) as { id?: unknown };
    id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return adminJsonError("bad_request", "Valid report id required", 400);
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  if (!isDbConfigured()) {
    return adminJsonError("unavailable", "No database configured", 503);
  }

  try {
    await recordAdminAccess({ action: "analytics.report.delete", detail: { id } }, req);
    const ok = await deleteAnalyticsReport(id);
    if (!ok) {
      return adminJsonError("not_found", "Report nicht gefunden.", 404);
    }
    return adminJson({ deleted: true });
  } catch (err) {
    reportError(err, { route: "api/admin/analytics/delete" });
    return adminJsonError("internal_error", "Löschen fehlgeschlagen.", 500);
  }
}
