// GET  /api/admin/settings/designer → { ok: true, settings, defaults }
// POST /api/admin/settings/designer  { model, effort, freedom, proactive, images?, houseStyle }
//   → { ok: true, settings }
//
// Einstellungen → „KI-Gestalter“: how the AI designer of the template and
// Rundmail editor works for the whole team (lib/mail-template-designer-settings.mjs,
// admin_settings key "mail_designer" from migration 0078 — no new migration):
//   model      "claude-fable-5-2" | "claude-opus-5-5" (default) | "claude-sonnet-5-5"
//   effort     "low" | "medium" | "high" (default) | "xhigh" | "max"  („Denktiefe“)
//   freedom    "genau" | "ausgewogen" (default) | "frei"               („Gestaltungsfreiheit“)
//   proactive  boolean (default true)        („Mo-Funktionen von sich aus einbauen“)
//   images     boolean (default true)        („Bilder mit KI erzeugen“ — generate_image)
//   houseStyle string ≤ 2000 characters      („Hausstil“, part of every run's system prompt)
// Every field is required on save — `images` may be missing (a page loaded
// before the switch existed: on). The KI-Gestalter panel may override model,
// effort, freedom, proactive and images for one conversation (the assist
// request's `settings`); the house style always comes from here. Audit-logged
// (settings.designer — the choices and the house style's length, not its text).
//
// Auth via guardAdminGet / guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminGet, guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { getDesignerSettings, setDesignerSettings } from "@/lib/admin-settings-store";
import { DEFAULT_DESIGNER_SETTINGS, validateDesignerSettingsInput } from "@/lib/mail-template-designer-settings.mjs";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";

export async function GET() {
  const blocked = await guardAdminGet();
  if (blocked) return blocked;
  try {
    const settings = await getDesignerSettings();
    return adminJson({ ok: true, settings, defaults: DEFAULT_DESIGNER_SETTINGS });
  } catch (err) {
    reportError(err, { route: "api/admin/settings/designer", phase: "get" });
    return adminJsonError("internal_error", "Die Einstellungen konnten nicht geladen werden.", 500);
  }
}

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  if (!isDbConfigured()) {
    return adminJsonError("no_database", "Keine Datenbank konfiguriert — die Einstellung kann nicht gespeichert werden.", 503);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return adminJsonError("bad_request", "Ungültige Anfrage (kein JSON).", 400);
  }
  const parsed = validateDesignerSettingsInput(body);
  if (!parsed.ok) return adminJsonError("bad_request", Object.values(parsed.errors)[0] ?? "Ungültige Eingabe.", 400);

  try {
    const result = await setDesignerSettings(parsed.value);
    if (!result.ok) {
      if (result.reason === "missing_table") {
        return adminJsonError("migration_missing", "Migration 0078 fehlt — bitte zuerst ausführen.", 503);
      }
      if (result.reason === "no_db") {
        return adminJsonError("no_database", "Keine Datenbank konfiguriert — die Einstellung kann nicht gespeichert werden.", 503);
      }
      return adminJsonError("internal_error", "Die Einstellung konnte nicht gespeichert werden.", 500);
    }
    const s = result.settings;
    await recordAdminAccess(
      {
        action: "settings.designer",
        detail: { model: s.model, effort: s.effort, freedom: s.freedom, proactive: s.proactive, images: s.images, houseStyleChars: s.houseStyle.length },
      },
      req
    );
    return adminJson({ ok: true, settings: s });
  } catch (err) {
    reportError(err, { route: "api/admin/settings/designer" });
    return adminJsonError("internal_error", "Die Einstellung konnte nicht gespeichert werden.", 500);
  }
}
