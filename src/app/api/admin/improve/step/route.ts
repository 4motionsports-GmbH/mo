// POST /api/admin/improve/step  { id }
//
// Advance ONE improvement run by exactly one bounded model call
// (lib/improvement-generate): first the optional Wirkungs-Check, then the
// suggestions pass. The client calls this until `done` — the same stepping
// pattern as the Komplettanalyse, so no request approaches maxDuration.
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { stepImprovementRun } from "@/lib/improvement-generate";
import { reportError } from "@/lib/observability";

// The suggestions pass is ONE Sonnet call, but with a big input (report extract
// + Mo's full self-snapshot) and structured output — give it more headroom than
// the report step's batched Haiku calls.
export const maxDuration = 90;

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
      error: result.error,
    });
  } catch (err) {
    reportError(err, { route: "api/admin/improve/step" });
    return adminJsonError("internal_error", "Schritt fehlgeschlagen.", 500);
  }
}
