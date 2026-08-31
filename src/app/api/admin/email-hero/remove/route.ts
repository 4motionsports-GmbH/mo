// POST /api/admin/email-hero/remove — clear the custom hero of one draft; the
// email falls back to the default hero asset. Body: { kind, id }. The blob
// file itself is kept (audit trail: the sent-email record may reference it).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { parseEmailHeroKind, setEmailHero } from "@/lib/email-hero-store";
import { reportError } from "@/lib/observability";

export const maxDuration = 15;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let kind, id: number;
  try {
    const body = (await req.json()) as { kind?: unknown; id?: unknown };
    kind = parseEmailHeroKind(body.kind);
    if (!kind || typeof body.id !== "number" || !Number.isInteger(body.id) || body.id <= 0) {
      return adminJsonError("bad_request", "kind und id erforderlich.", 400);
    }
    id = body.id;
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  if (!isDbConfigured()) {
    return adminJsonError("unavailable", "No database configured", 503);
  }

  try {
    await recordAdminAccess({ action: "email_hero.remove", detail: { kind, id } }, req);
    const result = await setEmailHero(kind, id, null, null);
    if (!result.ok) {
      return result.notFound
        ? adminJsonError("not_found", "Entwurf nicht gefunden.", 404)
        : adminJsonError("internal_error", "Entfernen fehlgeschlagen.", 500);
    }
    return adminJson({ ok: true });
  } catch (err) {
    reportError(err, { route: "api/admin/email-hero/remove" });
    return adminJsonError("internal_error", "Entfernen fehlgeschlagen.", 500);
  }
}
