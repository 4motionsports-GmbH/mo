// POST /api/admin/improve/adopt  { suggestionId }
//
// Adopt an engine suggestion's ready-made directive text as a LIVE team
// directive (mo_directives, injected into Mo's system prompt). This is the one
// place a suggestion touches Mo's behaviour — and it is an explicit,
// authenticated operator click, never automatic (docs/IMPROVEMENT_LOOP.md).
// The suggestion is marked 'implemented' with a provenance note; the directive
// keeps the suggestion FK for the reverse link.
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { getSuggestion, updateSuggestionStatus } from "@/lib/improvement-store";
import { createDirective } from "@/lib/directives-store";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";

export const maxDuration = 15;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let suggestionId: number;
  try {
    const body = (await req.json()) as { suggestionId?: unknown };
    suggestionId = Number(body.suggestionId);
    if (!Number.isInteger(suggestionId) || suggestionId <= 0) {
      return adminJsonError("bad_request", "Valid suggestionId required", 400);
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  if (!isDbConfigured()) {
    return adminJsonError("unavailable", "No database configured", 503);
  }

  try {
    const suggestion = await getSuggestion(suggestionId);
    if (!suggestion) {
      return adminJsonError("not_found", "Vorschlag nicht gefunden.", 404);
    }
    if (!suggestion.directiveText) {
      return adminJsonError(
        "bad_request",
        "Dieser Vorschlag enthält keinen übernehmbaren Anweisungstext.",
        400
      );
    }

    await recordAdminAccess(
      { action: "improvement.suggestion.adopt", detail: { suggestionId } },
      req
    );

    const result = await createDirective({
      content: suggestion.directiveText,
      source: "suggestion",
      suggestionId,
    });
    if (!result.ok || !result.directive) {
      if (result.error === "too_many_active") {
        return adminJsonError(
          "bad_request",
          "Maximale Anzahl aktiver Anweisungen erreicht — bitte zuerst eine deaktivieren.",
          400
        );
      }
      return adminJsonError("internal_error", "Anweisung konnte nicht angelegt werden.", 500);
    }

    const updated = await updateSuggestionStatus(
      suggestionId,
      "implemented",
      `Als Anweisung #${result.directive.id} übernommen.`
    );

    return adminJson({ directive: result.directive, suggestion: updated });
  } catch (err) {
    reportError(err, { route: "api/admin/improve/adopt" });
    return adminJsonError("internal_error", "Übernahme fehlgeschlagen.", 500);
  }
}
