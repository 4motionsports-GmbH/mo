// POST /api/admin/inbox/decide  { id, decision, note?, snoozeDays?, action? } → { item }
//
// The operator's decision on an Eingang item: erledigt, verworfen (with a
// reason), zurueckgestellt (3 / 7 / 30 days) or wieder_offen.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { decideInboxItem, type InboxDecision } from "@/lib/inbox-store";

const DECISIONS = ["erledigt", "verworfen", "zurueckgestellt", "wieder_offen"];

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  let body: { id?: unknown; decision?: unknown; note?: unknown; snoozeDays?: unknown; action?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return adminJsonError("bad_request", "id required", 400);
  if (!DECISIONS.includes(String(body.decision))) return adminJsonError("bad_request", "Unbekannte Entscheidung.", 400);
  const res = await decideInboxItem(id, body.decision as InboxDecision, {
    note: typeof body.note === "string" ? body.note : null,
    action: typeof body.action === "string" ? body.action.slice(0, 40) : null,
    snoozeDays: Number.isInteger(body.snoozeDays) ? Number(body.snoozeDays) : undefined,
  });
  if (!res.ok) {
    return res.reason === "not_found"
      ? adminJsonError("not_found", "Eintrag nicht gefunden.", 404)
      : adminJsonError("internal_error", "Die Entscheidung konnte nicht gespeichert werden.", 500);
  }
  return adminJson({ item: res.item });
}
