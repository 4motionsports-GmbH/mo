// POST /api/admin/analytics/step  { id }
//
// Advance ONE report by one bounded chunk of its generation phase state-machine
// (lib/analytics-report-generate). The client calls this repeatedly until the
// returned `done` is true, showing live progress. Each call does a small,
// time-bounded amount of model work so it stays under maxDuration even for a big
// interval — the "process a batch, report what remains, run again" pattern.
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { stepReport } from "@/lib/analytics-report-generate";
import { reportError } from "@/lib/observability";

// One step may run a handful of model calls (e.g. a batch of Haiku analyses, or a
// single Opus customer profile) — give it the headroom the profile route has.
export const maxDuration = 60;

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
    const result = await stepReport(id);
    if (!result.ok) {
      return adminJsonError("not_found", "Report nicht gefunden.", 404);
    }
    return adminJson({
      status: result.status,
      phase: result.phase,
      progress: result.progress,
      costEur: result.costEur,
      done: result.done,
      error: result.error,
    });
  } catch (err) {
    reportError(err, { route: "api/admin/analytics/step" });
    return adminJsonError("internal_error", "Schritt fehlgeschlagen.", 500);
  }
}
