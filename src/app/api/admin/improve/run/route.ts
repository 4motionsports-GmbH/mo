// POST /api/admin/improve/run  { reportId }
//
// Create a new improvement run over a COMPLETED Komplettanalyse and return its
// id. Like the report create route this does NO model work itself — the row is
// created 'running' at its first phase and the client drives it to completion
// via /api/admin/improve/step. An EXPLICIT, operator-initiated action — the
// improvement loop never runs by itself.
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { startImprovementRun } from "@/lib/improvement-generate";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";

export const maxDuration = 30;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let reportId: number;
  try {
    const body = (await req.json()) as { reportId?: unknown };
    reportId = Number(body.reportId);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      return adminJsonError("bad_request", "Valid reportId required", 400);
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  if (!isDbConfigured()) {
    return adminJsonError("unavailable", "No database configured", 503);
  }

  try {
    await recordAdminAccess(
      { action: "improvement.run.create", detail: { reportId } },
      req
    );
    const result = await startImprovementRun(reportId);
    if (!result.ok) {
      if (result.error === "not_found") {
        return adminJsonError("not_found", "Bericht nicht gefunden.", 404);
      }
      if (result.error === "not_complete") {
        return adminJsonError(
          "bad_request",
          "Nur ein fertiger Bericht kann analysiert werden.",
          400
        );
      }
      return adminJsonError("internal_error", "Lauf konnte nicht angelegt werden.", 500);
    }
    return adminJson({ id: result.runId });
  } catch (err) {
    reportError(err, { route: "api/admin/improve/run" });
    return adminJsonError("internal_error", "Lauf-Erstellung fehlgeschlagen.", 500);
  }
}
