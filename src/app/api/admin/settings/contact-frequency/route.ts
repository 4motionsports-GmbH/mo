// POST /api/admin/settings/contact-frequency  { maxMails, windowDays }
//   → { ok: true, settings: { maxMails, windowDays } }
//
// Einstellungen → „Kontakthäufigkeit“: the threshold of the soft
// contact-frequency warning (lib/contact-frequency.mjs, admin_settings from
// migration 0078). maxMails 0–50, windowDays 0–365, whole numbers; 0 in either
// field switches the warning off. The warning never blocks a send — it asks
// once on the Kampagne desk and in Kunden → Marketing. Audit-logged
// (settings.contact_frequency).
//
// Auth + CSRF via guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { setContactFrequencySettings } from "@/lib/admin-settings-store";
import { validateContactFrequencyInput } from "@/lib/contact-frequency.mjs";
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
  const parsed = validateContactFrequencyInput(body);
  if (!parsed.ok) return adminJsonError("bad_request", parsed.message, 400);

  try {
    const result = await setContactFrequencySettings(parsed.settings);
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
      { action: "settings.contact_frequency", detail: { maxMails: result.settings.maxMails, windowDays: result.settings.windowDays } },
      req
    );
    return adminJson({ ok: true, settings: result.settings });
  } catch (err) {
    reportError(err, { route: "api/admin/settings/contact-frequency" });
    return adminJsonError("internal_error", "Die Einstellung konnte nicht gespeichert werden.", 500);
  }
}
