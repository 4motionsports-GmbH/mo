// POST /api/admin/marketing/email-preview  { sendId, subject?, body? }
//
// Render the CURRENT marketing draft (the on-screen subject/body, falling back
// to the stored draft) to the full branded email HTML and return it as
// text/html, so the admin sees exactly what the recipient's mail client will
// render — the marketing sibling of the campaign email-preview route.
// READ-ONLY: nothing is claimed, minted, sent or recorded, and every send gate
// stays with the send route. The discount line shows the MO-XXXX placeholder
// with the projected expiry; the real MS5- code is minted only at send time.
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJsonError } from "@/lib/admin-api";
import { renderMarketingEmailPreview } from "@/lib/marketing-email";
import { reportError } from "@/lib/observability";

export const maxDuration = 15;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let sendId: number;
  let subject: string | undefined;
  let body: string | undefined;
  try {
    const json = (await req.json()) as {
      sendId?: unknown;
      subject?: unknown;
      body?: unknown;
    };
    sendId = Number(json.sendId);
    if (!Number.isInteger(sendId) || sendId <= 0) {
      return adminJsonError("bad_request", "sendId required", 400);
    }
    subject = typeof json.subject === "string" ? json.subject : undefined;
    body = typeof json.body === "string" ? json.body : undefined;
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    const result = await renderMarketingEmailPreview(sendId, { subject, body });
    if (!result.ok) {
      return adminJsonError(result.reason, result.message, 404);
    }
    return new Response(result.html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (err) {
    reportError(err, { route: "api/admin/marketing/email-preview" });
    return adminJsonError("internal_error", "Vorschau fehlgeschlagen.", 500);
  }
}
