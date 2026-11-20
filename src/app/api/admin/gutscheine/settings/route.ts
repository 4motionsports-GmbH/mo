// GET  /api/admin/gutscheine/settings → { settings }
// POST /api/admin/gutscheine/settings
//   { salesEnabled, aiSuggestions, photoUploads, reviewPrintWithPhoto } → { ok: true, settings }
//
// Gutscheine → „Einrichtung“: the operator settings of the Geschenkgutscheine
// (gift-voucher-settings.mjs; admin_settings key 'gift_vouchers' from
// migration 0078 — no migration of its own): „Verkauf im Shop“,
// „KI-Textvorschläge“, „Eigene Fotos“, „Druck mit eigenem Foto prüfen“.
// Every switch must be a boolean (German 400 otherwise). Takes effect within
// a minute (the settings cache of each instance). Audit-logged
// (settings.gift_vouchers, the four switches).

import { guardAdminGet, guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";
import { getGiftVoucherSettings, setGiftVoucherSettings } from "@/lib/gift-voucher-store";
import { validateGiftVoucherSettingsInput } from "@/lib/gift-voucher-settings.mjs";

export async function GET() {
  const blocked = await guardAdminGet();
  if (blocked) return blocked;
  // Without a database (or a row) the defaults apply.
  return adminJson({ settings: await getGiftVoucherSettings() });
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
  const parsed = validateGiftVoucherSettingsInput(body);
  if (!parsed.ok) return adminJsonError("bad_request", parsed.message, 400);

  try {
    const result = await setGiftVoucherSettings(parsed.settings);
    if (!result.ok) {
      if (result.reason === "missing_table") {
        return adminJsonError("migration_missing", "Migration 0078 fehlt — bitte zuerst ausführen.", 503);
      }
      if (result.reason === "no_db") {
        return adminJsonError("no_database", "Keine Datenbank konfiguriert — die Einstellung kann nicht gespeichert werden.", 503);
      }
      return adminJsonError("internal_error", "Die Einstellung konnte nicht gespeichert werden.", 500);
    }
    await recordAdminAccess({ action: "settings.gift_vouchers", detail: { ...result.settings } }, req);
    return adminJson({ ok: true, settings: result.settings });
  } catch (err) {
    reportError(err, { route: "api/admin/gutscheine/settings" });
    return adminJsonError("internal_error", "Die Einstellung konnte nicht gespeichert werden.", 500);
  }
}
