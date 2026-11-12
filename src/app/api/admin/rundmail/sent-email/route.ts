// POST /api/admin/rundmail/sent-email  { contactId } → text/html (inert)
//
// „Mail ansehen“: the Rundmail exactly as ONE recipient got it. A Rundmail
// send stores no body (campaign_sends.body_html/body_text stay NULL — the
// content is frozen once in campaign_mailings), so the frozen HTML is
// personalised again with this person's first name (personalizeFrozen, the
// function that built the sent mail). Links point at their frozen targets
// (no tracked redirect — viewing records no click), the unsubscribe and
// erasure links are inert, and adminEmailHtml neutralises every recipient
// action. Only for a recipient who was sent the Rundmail. Used by the
// Rundmail's recipient detail and Kunden → Marketing → Kampagnen. Read-only.

import { guardAdminPost, adminEmailHtml, adminJsonError } from "@/lib/admin-api";
import { reportError } from "@/lib/observability";
import { getMailing, getMailingFrozenBodies } from "@/lib/mailing-store";
import { personalizeFrozen } from "@/lib/mailing-core.mjs";
import { getRundmailRecipientMail } from "@/lib/rundmail-analytics-store";

export const maxDuration = 15;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  let contactId: number;
  try {
    contactId = Number(((await req.json()) as { contactId?: unknown }).contactId);
  } catch {
    return adminJsonError("bad_request", "Ungültige Anfrage (kein JSON).", 400);
  }
  if (!Number.isInteger(contactId) || contactId <= 0) return adminJsonError("bad_request", "contactId fehlt.", 400);
  try {
    const recipient = await getRundmailRecipientMail(contactId);
    if (!recipient) return adminJsonError("not_found", "Diese Person hat die Rundmail nicht bekommen.", 404);
    const [mailing, bodies] = await Promise.all([
      getMailing(recipient.campaignId),
      getMailingFrozenBodies(recipient.campaignId),
    ]);
    if (!mailing || !bodies) return adminJsonError("not_found", "Der versendete Inhalt dieser Rundmail ist nicht mehr gespeichert.", 404);
    const html = personalizeFrozen(
      bodies.html,
      {
        unsubscribeUrl: "#",
        erasureUrl: "#",
        trackUrl: (n: number) => mailing.links[n]?.url ?? "#",
        firstName: recipient.firstName,
        merges: mailing.merges.body,
        greetings: mailing.merges.greetings,
      },
      "html"
    );
    return adminEmailHtml(html);
  } catch (err) {
    reportError(err, { route: "api/admin/rundmail/sent-email" });
    return adminJsonError("internal_error", "Ansicht fehlgeschlagen.", 500);
  }
}
