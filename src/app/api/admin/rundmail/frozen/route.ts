// POST /api/admin/rundmail/frozen  { campaignId } → text/html (inert)
//
// „Versendete Mail ansehen“: the content a released Rundmail sends — the
// frozen HTML with a sample recipient filled in (first name „Alex“, links
// pointing at the frozen targets), every recipient link inert
// (adminEmailHtml). Read-only.

import { guardAdminPost, adminEmailHtml, adminJsonError } from "@/lib/admin-api";
import { reportError } from "@/lib/observability";
import { getMailing, getMailingFrozenBodies } from "@/lib/mailing-store";
import { personalizeFrozen } from "@/lib/mailing-core.mjs";

export const maxDuration = 15;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  let campaignId: number;
  try {
    campaignId = Number(((await req.json()) as { campaignId?: unknown }).campaignId);
  } catch {
    return adminJsonError("bad_request", "Ungültige Anfrage (kein JSON).", 400);
  }
  if (!Number.isInteger(campaignId) || campaignId <= 0) return adminJsonError("bad_request", "campaignId fehlt.", 400);
  try {
    const [mailing, bodies] = await Promise.all([getMailing(campaignId), getMailingFrozenBodies(campaignId)]);
    if (!mailing || !bodies) return adminJsonError("not_found", "Diese Rundmail ist noch nicht freigegeben.", 404);
    const html = personalizeFrozen(
      bodies.html,
      {
        unsubscribeUrl: "#",
        erasureUrl: "#",
        trackUrl: (n: number) => mailing.links[n]?.url ?? "#",
        firstName: "Alex",
        merges: mailing.merges.body,
        greetings: mailing.merges.greetings,
      },
      "html"
    );
    return adminEmailHtml(html);
  } catch (err) {
    reportError(err, { route: "api/admin/rundmail/frozen" });
    return adminJsonError("internal_error", "Ansicht fehlgeschlagen.", 500);
  }
}
