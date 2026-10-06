// POST /api/admin/improve/step  { id }
//
// Advance ONE improvement run by exactly one bounded unit of work
// (lib/improvement-generate): collect the business snapshot, measure the
// adopted changes (time-boxed), or one strategist (Opus 5.5) pass — the
// Wirkungs-Check, then the two suggestion passes. The client calls this until
// `done` — the stepping pattern of the Komplettanalyse, so no request
// approaches maxDuration.
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { stepImprovementRun } from "@/lib/improvement-generate";
import { reportError } from "@/lib/observability";

// A strategist pass streams one Opus call that is aborted after 240 s
// (IMPROVEMENT_STRATEGIST_TIMEOUT_MS, improvement-decision.mjs — keep
// IMPROVEMENT_STEP_MAX_DURATION_S there in sync with this value) and is
// retried on the next step one rung lower on the effort ladder; the
// measurement step stops fetching window snapshots after 120 s. The full
// Fluid-compute headroom keeps the platform from killing a function mid-call.
export const maxDuration = 300;

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
    const result = await stepImprovementRun(id);
    if (!result.ok) {
      return adminJsonError("not_found", "Lauf nicht gefunden.", 404);
    }
    return adminJson({
      status: result.status,
      phase: result.phase,
      costEur: result.costEur,
      done: result.done,
      busy: result.busy,
      error: result.error,
      progress: result.progress ?? null,
    });
  } catch (err) {
    reportError(err, { route: "api/admin/improve/step" });
    return adminJsonError("internal_error", "Schritt fehlgeschlagen.", 500);
  }
}
