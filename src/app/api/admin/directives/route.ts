// GET /api/admin/directives — Mo's team-directive layer (all rows, active and
// inactive) for the Verbesserung tab's Anweisungen card. Version history per
// directive rides on /api/admin/directives/versions.
//
// Auth: the proxy gates /api/admin/*; guardAdminGet re-asserts the session cookie.

import { guardAdminGet, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { listDirectives } from "@/lib/directives-store";
import { MAX_ACTIVE_DIRECTIVES, MAX_DIRECTIVE_CHARS } from "@/lib/improvement-core.mjs";
import { reportError } from "@/lib/observability";

export const maxDuration = 15;

export async function GET() {
  const blocked = await guardAdminGet();
  if (blocked) return blocked;

  if (!isDbConfigured()) {
    return adminJson({
      directives: [],
      limits: { maxActive: MAX_ACTIVE_DIRECTIVES, maxChars: MAX_DIRECTIVE_CHARS },
    });
  }
  try {
    const directives = await listDirectives();
    return adminJson({
      directives,
      limits: { maxActive: MAX_ACTIVE_DIRECTIVES, maxChars: MAX_DIRECTIVE_CHARS },
    });
  } catch (err) {
    reportError(err, { route: "api/admin/directives:list" });
    return adminJsonError("internal_error", "Anweisungen konnten nicht geladen werden.", 500);
  }
}
