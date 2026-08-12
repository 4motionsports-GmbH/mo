// POST /api/admin/improve/suggestion  { suggestionId, status, note? }
//
// Drive a suggestion's operator lifecycle: open → accepted → implemented /
// dismissed (any transition between the four states is allowed — the operator
// owns the backlog; the states feed the NEXT run's Wirkungs-Check, so keeping
// them truthful matters more than enforcing an order).
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { updateSuggestionStatus, type SuggestionStatus } from "@/lib/improvement-store";
import { SUGGESTION_STATUSES } from "@/lib/improvement-core.mjs";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";

export const maxDuration = 15;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let suggestionId: number;
  let status: SuggestionStatus;
  let note: string | null;
  try {
    const body = (await req.json()) as {
      suggestionId?: unknown;
      status?: unknown;
      note?: unknown;
    };
    suggestionId = Number(body.suggestionId);
    if (!Number.isInteger(suggestionId) || suggestionId <= 0) {
      return adminJsonError("bad_request", "Valid suggestionId required", 400);
    }
    if (typeof body.status !== "string" || !SUGGESTION_STATUSES.includes(body.status)) {
      return adminJsonError("bad_request", "Valid status required", 400);
    }
    status = body.status as SuggestionStatus;
    note =
      typeof body.note === "string" && body.note.trim()
        ? body.note.trim().slice(0, 500)
        : null;
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  if (!isDbConfigured()) {
    return adminJsonError("unavailable", "No database configured", 503);
  }

  try {
    await recordAdminAccess(
      { action: "improvement.suggestion.status", detail: { suggestionId, status } },
      req
    );
    const suggestion = await updateSuggestionStatus(suggestionId, status, note);
    if (!suggestion) {
      return adminJsonError("not_found", "Vorschlag nicht gefunden.", 404);
    }
    return adminJson({ suggestion });
  } catch (err) {
    reportError(err, { route: "api/admin/improve/suggestion" });
    return adminJsonError("internal_error", "Status-Änderung fehlgeschlagen.", 500);
  }
}
