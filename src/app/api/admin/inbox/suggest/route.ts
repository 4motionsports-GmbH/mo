// POST /api/admin/inbox/suggest  { id } → { suggestion }
//
// „Vorschlag erzeugen“ for one Eingang item (writer tier, lib/inbox-suggest).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { generateInboxSuggestion } from "@/lib/inbox-suggest";

export const maxDuration = 60;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  let id: number;
  try {
    id = Number(((await req.json()) as { id?: unknown }).id);
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }
  if (!Number.isInteger(id) || id <= 0) return adminJsonError("bad_request", "id required", 400);
  const res = await generateInboxSuggestion(id);
  if (!res.ok) return adminJsonError("suggest_failed", res.message, 422);
  return adminJson({ suggestion: res.suggestion });
}
