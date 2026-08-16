// POST /api/admin/improve/adopt  { suggestionId, content? }
//
// Adopt an engine suggestion's ready-made directive text as a LIVE team
// directive (mo_directives, injected into Mo's system prompt). This is the one
// place a suggestion touches Mo's behaviour — and it is an explicit,
// authenticated operator click, never automatic (docs/IMPROVEMENT_LOOP.md).
// `content` carries the operator's EDITED version of the text (the card lets
// them adjust it before adopting); absent → the suggestion's original text.
// The suggestion is marked 'implemented' with a provenance note; the directive
// keeps the suggestion FK for the reverse link.
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { getSuggestion, updateSuggestionStatus } from "@/lib/improvement-store";
import { createDirective } from "@/lib/directives-store";
import { MAX_DIRECTIVE_CHARS } from "@/lib/improvement-core.mjs";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";

export const maxDuration = 15;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let suggestionId: number;
  let contentOverride: string | null;
  try {
    const body = (await req.json()) as { suggestionId?: unknown; content?: unknown };
    suggestionId = Number(body.suggestionId);
    if (!Number.isInteger(suggestionId) || suggestionId <= 0) {
      return adminJsonError("bad_request", "Valid suggestionId required", 400);
    }
    if (body.content != null && typeof body.content !== "string") {
      return adminJsonError("bad_request", "content must be a string", 400);
    }
    contentOverride =
      typeof body.content === "string" && body.content.trim() ? body.content : null;
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

    const edited = contentOverride != null && contentOverride.trim() !== suggestion.directiveText;
    const result = await createDirective({
      content: contentOverride ?? suggestion.directiveText,
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
      if (result.error === "invalid_content") {
        return adminJsonError(
          "bad_request",
          `Anweisungstext fehlt oder ist länger als ${MAX_DIRECTIVE_CHARS} Zeichen.`,
          400
        );
      }
      return adminJsonError("internal_error", "Anweisung konnte nicht angelegt werden.", 500);
    }

    const updated = await updateSuggestionStatus(
      suggestionId,
      "implemented",
      `Als Anweisung #${result.directive.id} übernommen${edited ? " (Text angepasst)" : ""}.`
    );

    return adminJson({ directive: result.directive, suggestion: updated });
  } catch (err) {
    reportError(err, { route: "api/admin/improve/adopt" });
    return adminJsonError("internal_error", "Übernahme fehlgeschlagen.", 500);
  }
}
