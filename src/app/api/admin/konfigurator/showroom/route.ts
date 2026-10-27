// POST /api/admin/konfigurator/showroom  { handles: string[] }  → { ok: true, showroom }
//
// Konfigurator → „Sortiment“ → card „Showroom“: the manual fallback list of
// products on display in the showroom (≤ 60 handles, CatalogProductPicker).
// It is joined with the list read from the live theme (showroom-core.mjs,
// admin_settings key 'showroom' — no migration) and applies on its own while
// the theme cannot be read (scope read_themes missing, parse error).
// Audit-logged (settings.showroom). Auth + CSRF via guardAdminPost.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { saveManualShowroomHandles, showroomCardData } from "@/lib/showroom-store";
import { showroomView, validateManualShowroomInput } from "@/lib/showroom-core.mjs";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  if (!isDbConfigured()) {
    return adminJsonError("no_database", "Keine Datenbank konfiguriert — die Liste kann nicht gespeichert werden.", 503);
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return adminJsonError("bad_request", "Ungültige Anfrage (kein JSON).", 400);
  }
  const parsed = validateManualShowroomInput(body);
  if (!parsed.ok) return adminJsonError("bad_request", parsed.message, 400);
  try {
    const result = await saveManualShowroomHandles(parsed.handles);
    if (!result.ok) {
      if (result.reason === "missing_table") {
        return adminJsonError("migration_missing", "Migration 0078 fehlt — bitte zuerst ausführen.", 503);
      }
      return adminJsonError("internal_error", "Die Showroom-Liste konnte nicht gespeichert werden.", 500);
    }
    await recordAdminAccess(
      {
        action: "settings.showroom",
        detail: { manualProducts: result.state.manualHandles.length, known: showroomView(result.state).known },
      },
      req
    );
    return adminJson({ ok: true, showroom: await showroomCardData(result.state) });
  } catch (err) {
    reportError(err, { route: "api/admin/konfigurator/showroom" });
    return adminJsonError("internal_error", "Die Showroom-Liste konnte nicht gespeichert werden.", 500);
  }
}
