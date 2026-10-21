// POST /api/admin/konfigurator/settings  { enabled, tag, extraProductIds, focus, notes }
//   → { ok: true, settings }
//
// Konfigurator → „Mo im Konfigurator“: the Home-Gym-Konfigurator's operator
// settings (configurator-core.mjs; admin_settings key 'configurator' from
// migration 0078 — no new migration). enabled = Mo uses the configurator
// answers and tools (off: a configurator chat becomes a normal chat); tag =
// the Shopify product tag of the curated assortment; extraProductIds = handles
// added by hand; focus = prefer | only; notes = the team's hints for Mo
// (≤ 1500 characters). Audit-logged (settings.configurator).
//
// Auth + CSRF via guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { setConfiguratorSettings } from "@/lib/configurator-store";
import { validateConfiguratorSettingsInput } from "@/lib/configurator-core.mjs";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";

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
  const parsed = validateConfiguratorSettingsInput(body);
  if (!parsed.ok) return adminJsonError("bad_request", parsed.message, 400);

  try {
    const result = await setConfiguratorSettings(parsed.settings);
    if (!result.ok) {
      if (result.reason === "missing_table") {
        return adminJsonError("migration_missing", "Migration 0078 fehlt — bitte zuerst ausführen.", 503);
      }
      if (result.reason === "no_db") {
        return adminJsonError("no_database", "Keine Datenbank konfiguriert — die Einstellung kann nicht gespeichert werden.", 503);
      }
      return adminJsonError("internal_error", "Die Einstellung konnte nicht gespeichert werden.", 500);
    }
    await recordAdminAccess(
      {
        action: "settings.configurator",
        detail: {
          enabled: result.settings.enabled,
          tag: result.settings.tag,
          focus: result.settings.focus,
          extraProducts: result.settings.extraProductIds.length,
          notesChars: result.settings.notes.length,
        },
      },
      req
    );
    return adminJson({ ok: true, settings: result.settings });
  } catch (err) {
    reportError(err, { route: "api/admin/konfigurator/settings" });
    return adminJsonError("internal_error", "Die Einstellung konnte nicht gespeichert werden.", 500);
  }
}
