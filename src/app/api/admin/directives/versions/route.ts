// GET /api/admin/directives/versions?id=<directiveId> — the append-only change
// history of one directive (the "alle bisherigen Fassungen" view). Newest first.
//
// Auth: the proxy gates /api/admin/*; guardAdminGet re-asserts the session cookie.

import { guardAdminGet, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { listDirectiveVersions } from "@/lib/directives-store";
import { reportError } from "@/lib/observability";

export const maxDuration = 15;

export async function GET(req: Request) {
  const blocked = await guardAdminGet();
  if (blocked) return blocked;

  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return adminJsonError("bad_request", "Valid id required", 400);
  }

  if (!isDbConfigured()) {
    return adminJson({ versions: [] });
  }
  try {
    const versions = await listDirectiveVersions(id);
    return adminJson({ versions });
  } catch (err) {
    reportError(err, { route: "api/admin/directives/versions" });
    return adminJsonError("internal_error", "Verlauf konnte nicht geladen werden.", 500);
  }
}
