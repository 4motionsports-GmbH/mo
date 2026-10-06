// GET /api/admin/improve/backlog — the open and planned suggestions of every
// improvement run (newest first, at most 200) for the Verbesserung's backlog
// view and its lane × priority overview. Read-only.
//
// Auth: the proxy gates /api/admin/*; guardAdminGet re-asserts the session cookie.

import { guardAdminGet, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { listBacklog } from "@/lib/improvement-store";
import { reportError } from "@/lib/observability";

export const maxDuration = 15;

export async function GET() {
  const blocked = await guardAdminGet();
  if (blocked) return blocked;

  if (!isDbConfigured()) return adminJson({ suggestions: [] });
  try {
    return adminJson({ suggestions: await listBacklog() });
  } catch (err) {
    reportError(err, { route: "api/admin/improve/backlog" });
    return adminJsonError("internal_error", "Backlog konnte nicht geladen werden.", 500);
  }
}
