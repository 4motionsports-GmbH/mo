// POST /api/admin/improve/run
//   { reportId?: number | null, preset?: "report" | "7d" | "14d" | "30d" | "90d" | "custom",
//     from?: "YYYY-MM-DD", to?: "YYYY-MM-DD", importRecommendations?: boolean }
//
// Create a new improvement run (v2, docs/IMPROVEMENT_LOOP.md) and return its
// id. The run is built on the business snapshot of its period: a completed
// Komplettanalyse's period ("report", the default when a report is given) or
// full days up to yesterday. `reportId` adds the report's conversation
// insights; for a decision report its open recommendations are imported
// unless `importRecommendations` is false. The old body `{ reportId }` still
// works. Like the report create route this does NO model work itself — the
// row is created 'running' and the client drives it via /api/admin/improve/step.
// An EXPLICIT, operator-initiated action — the loop never runs by itself.
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { startImprovementRun, type StartRunInput } from "@/lib/improvement-generate";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";

export const maxDuration = 30;

const PRESETS = new Set(["report", "7d", "14d", "30d", "90d", "custom"]);
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let input: StartRunInput;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const reportId = body.reportId == null ? null : Number(body.reportId);
    if (reportId !== null && (!Number.isInteger(reportId) || reportId <= 0)) {
      return adminJsonError("bad_request", "Valid reportId required", 400);
    }
    const preset = typeof body.preset === "string" ? body.preset : null;
    if (preset !== null && !PRESETS.has(preset)) return adminJsonError("bad_request", "Unknown preset", 400);
    if (preset === "report" && reportId === null) return adminJsonError("bad_request", "preset report needs a reportId", 400);
    const from = typeof body.from === "string" && YMD.test(body.from) ? body.from : null;
    const to = typeof body.to === "string" && YMD.test(body.to) ? body.to : null;
    if (preset === "custom" && (!from || !to)) return adminJsonError("bad_request", "custom needs from and to", 400);
    input = { reportId, preset, from, to, importRecommendations: body.importRecommendations !== false };
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  if (!isDbConfigured()) {
    return adminJsonError("unavailable", "No database configured", 503);
  }

  try {
    await recordAdminAccess(
      { action: "improvement.run.create", detail: { reportId: input.reportId ?? null, preset: input.preset ?? null } },
      req
    );
    const result = await startImprovementRun(input);
    if (!result.ok) {
      if (result.error === "not_found") return adminJsonError("not_found", "Bericht nicht gefunden.", 404);
      if (result.error === "not_complete") {
        return adminJsonError("bad_request", "Nur ein fertiger Bericht kann einbezogen werden.", 400);
      }
      if (result.error === "bad_period") {
        return adminJsonError("bad_request", "Der Zeitraum ist ungültig — er muss vor heute enden.", 400);
      }
      return adminJsonError("internal_error", "Lauf konnte nicht angelegt werden.", 500);
    }
    return adminJson({ id: result.runId });
  } catch (err) {
    reportError(err, { route: "api/admin/improve/run" });
    return adminJsonError("internal_error", "Lauf-Erstellung fehlgeschlagen.", 500);
  }
}
