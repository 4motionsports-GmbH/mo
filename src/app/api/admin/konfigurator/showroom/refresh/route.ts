// POST /api/admin/konfigurator/showroom/refresh  → { ok: true, result: { ok, count, error }, showroom }
//
// „Jetzt aktualisieren“ on the card „Showroom“ (Konfigurator → „Sortiment“):
// reads the showroom products from the live theme now (showroom-store
// refreshShowroomFromTheme — the Admin API scope read_themes is required; a
// failure keeps the last good list and is shown on the card). The catalog sync
// cron does the same daily. Audit-logged (showroom.refresh). Auth + CSRF via
// guardAdminPost.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { refreshShowroomFromTheme, showroomCardData } from "@/lib/showroom-store";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";

export const maxDuration = 60;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  if (!isDbConfigured()) {
    return adminJsonError("no_database", "Keine Datenbank konfiguriert — der Showroom kann nicht gespeichert werden.", 503);
  }
  try {
    const result = await refreshShowroomFromTheme({ background: false });
    await recordAdminAccess(
      { action: "showroom.refresh", detail: { ok: result.ok, count: result.count, skipped: result.skipped ?? null } },
      req
    );
    return adminJson({
      ok: true,
      result: {
        ok: result.ok,
        count: result.count,
        error: result.skipped === "disabled" ? "Die Theme-Quelle ist ausgeschaltet (SHOWROOM_THEME_FILE=off) — es gilt nur die Liste." : result.error,
      },
      showroom: await showroomCardData(result.state),
    });
  } catch (err) {
    reportError(err, { route: "api/admin/konfigurator/showroom/refresh" });
    return adminJsonError("internal_error", "Der Showroom konnte nicht aktualisiert werden.", 500);
  }
}
