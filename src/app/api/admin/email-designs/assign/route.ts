// POST /api/admin/email-designs/assign — select which registered design one
// email type uses. Body: { kind: 'summary'|'doi'|'marketing'|'campaign',
// designKey: string|null } — null or 'classic' clears the selection (the kind
// renders the built-in classic design).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { setEmailDesignSelection } from "@/lib/email-design-store";
import { parseEmailThemeKind } from "@/lib/email-theme.mjs";
import { reportError } from "@/lib/observability";

export const maxDuration = 15;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let kind: string;
  let designKey: string | null;
  try {
    const body = (await req.json()) as { kind?: unknown; designKey?: unknown };
    const parsedKind = parseEmailThemeKind(body.kind);
    if (!parsedKind) {
      return adminJsonError("bad_request", "Unbekannter E-Mail-Typ.", 400);
    }
    kind = parsedKind;
    if (body.designKey == null) {
      designKey = null;
    } else if (typeof body.designKey === "string" && body.designKey.trim()) {
      designKey = body.designKey.trim();
    } else {
      return adminJsonError("bad_request", "Ungültiger Design-Schlüssel.", 400);
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  if (!isDbConfigured()) {
    return adminJsonError("unavailable", "No database configured", 503);
  }

  try {
    await recordAdminAccess(
      { action: "email_design.assign", detail: { kind, designKey } },
      req
    );
    const result = await setEmailDesignSelection(kind, designKey);
    if (!result.ok) {
      if (result.error === "unknown_design") {
        return adminJsonError("not_found", "Design nicht gefunden.", 404);
      }
      if (result.error === "unsupported_kind") {
        return adminJsonError(
          "bad_request",
          "Dieses Design unterstützt den gewählten E-Mail-Typ nicht.",
          400
        );
      }
      if (result.error === "db_unconfigured") {
        return adminJsonError("unavailable", "No database configured", 503);
      }
      return adminJsonError("internal_error", "Zuordnung fehlgeschlagen.", 500);
    }
    return adminJson({ ok: true });
  } catch (err) {
    reportError(err, { route: "api/admin/email-designs/assign" });
    return adminJsonError("internal_error", "Zuordnung fehlgeschlagen.", 500);
  }
}
