// POST /api/admin/campaign/contacts  { query }
//
// Global contact search for the review UI: case-insensitive substring match
// over ALL campaign contacts (email + name), ANY status — not just the drafted
// queue — so the admin can look a specific person up and pull them into the
// queue (generate a draft / restore a skip) or see that they were already
// sent/suppressed. Read-only.
//
// Auth + CSRF via guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { searchCampaignContacts } from "@/lib/campaign-store";
import { reportError } from "@/lib/observability";

export const maxDuration = 10;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let query: string;
  try {
    const body = (await req.json()) as { query?: unknown };
    query = String(body.query ?? "").trim();
    if (!query) return adminJsonError("bad_request", "query required", 400);
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    const hits = await searchCampaignContacts(query);
    return adminJson({
      contacts: hits.map((h) => ({
        id: h.contact.id,
        email: h.contact.email,
        firstName: h.contact.firstName,
        lastName: h.contact.lastName,
        status: h.contact.status,
        optInLevel: h.contact.optInLevel ?? "UNKNOWN",
        language: h.contact.language,
        hasDraft: h.hasDraft,
      })),
    });
  } catch (err) {
    reportError(err, { route: "api/admin/campaign/contacts" });
    return adminJsonError("internal_error", "Contact search failed.", 500);
  }
}
