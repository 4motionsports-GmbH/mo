// POST /api/admin/correspondence/email-preview  { body }
//
// Render the correspondence composer's CURRENT text to the exact minimal HTML
// the send route ships (shared renderCorrespondenceEmail) and return it as
// text/html — so the operator can check the email before sending. READ-ONLY:
// nothing is sent or recorded; deliberately NO customer lookup (the preview
// depends only on the typed text).
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJsonError } from "@/lib/admin-api";
import { renderCorrespondenceEmail } from "@/lib/correspondence-email";
import { reportError } from "@/lib/observability";

export const maxDuration = 15;

const MAX_BODY = 20_000; // same bound as the send route

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let body: string;
  try {
    const json = (await req.json()) as { body?: unknown };
    body = typeof json.body === "string" ? json.body : "";
    if (!body.trim()) {
      return adminJsonError("bad_request", "Nachrichtentext darf nicht leer sein.", 400);
    }
    body = body.slice(0, MAX_BODY);
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    const { html } = renderCorrespondenceEmail(body);
    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (err) {
    reportError(err, { route: "api/admin/correspondence/email-preview" });
    return adminJsonError("internal_error", "Vorschau fehlgeschlagen.", 500);
  }
}
