// POST /api/admin/qa/restore  { id }
//
// "Wiederherstellen": bring a dismissed entry back into the queue — with an
// answer it returns as 'answered', otherwise as 'open'. Refused with 409 when
// an ACTIVE entry with the same (fingerprinted) question already exists,
// because two active copies of one question would fight over the de-dup rule
// and over the metafield merge.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { restoreQaEntry } from "@/lib/qa-store";
import { isDbConfigured } from "@/lib/db";

export const maxDuration = 15;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  if (!isDbConfigured()) {
    return adminJsonError("unavailable", "No database configured", 503);
  }

  let id: number;
  try {
    const body = (await req.json()) as { id?: unknown };
    id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return adminJsonError("bad_request", "id required", 400);
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  await recordAdminAccess({ action: "qa.restore", detail: { id } }, req);

  const result = await restoreQaEntry(id);
  if (result.status === "duplicate") {
    return adminJsonError(
      "duplicate_question",
      "Dieselbe Frage existiert bereits aktiv in der Warteschlange — bitte dort weiterbearbeiten (dieser Eintrag bleibt verworfen).",
      409
    );
  }
  if (result.status === "not_found") {
    return adminJsonError("not_found", "Kein verworfener Eintrag mit dieser ID.", 404);
  }
  return adminJson({ entry: result.entry });
}
