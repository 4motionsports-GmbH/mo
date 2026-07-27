// POST /api/admin/campaign/email-preview  { contactId, subject?, body? }
//
// Render the CURRENT campaign draft (the on-screen subject/body, falling back
// to the stored draft) to the full branded email HTML and return it as
// text/html, so the admin sees exactly what the recipient's mail client will
// render — the campaign sibling of the letter-preview route. READ-ONLY:
// nothing is claimed, minted, sent or recorded, and every send gate stays with
// the send route. The discount line shows the MO-XXXX placeholder with the
// projected expiry; the real MK- code is minted only at send time.
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJsonError } from "@/lib/admin-api";
import { renderCampaignEmailPreview } from "@/lib/campaign-email";
import { reportError } from "@/lib/observability";

export const maxDuration = 15;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let contactId: number;
  let subject: string | undefined;
  let body: string | undefined;
  try {
    const json = (await req.json()) as {
      contactId?: unknown;
      subject?: unknown;
      body?: unknown;
    };
    contactId = Number(json.contactId);
    if (!Number.isInteger(contactId) || contactId <= 0) {
      return adminJsonError("bad_request", "contactId required", 400);
    }
    subject = typeof json.subject === "string" ? json.subject : undefined;
    body = typeof json.body === "string" ? json.body : undefined;
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    const result = await renderCampaignEmailPreview(contactId, { subject, body });
    if (!result.ok) {
      return adminJsonError(result.reason, result.message, 404);
    }
    return new Response(result.html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (err) {
    reportError(err, { route: "api/admin/campaign/email-preview" });
    return adminJsonError("internal_error", "Vorschau fehlgeschlagen.", 500);
  }
}
