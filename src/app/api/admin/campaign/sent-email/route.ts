// POST /api/admin/campaign/sent-email  { sendId }
//
// Return the RETAINED content of one campaign send record (campaign_sends,
// migration 0038) as text/html for the "Gesendet" viewer: system sends return
// the exact branded HTML that was delivered; copy-path records (no HTML was
// ever shipped) return the copied text in a minimal readable page. Sends
// recorded before 0038 retained nothing — 404 with a clear message. READ-ONLY.
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJsonError } from "@/lib/admin-api";
import { getCampaignSendContent } from "@/lib/campaign-store";
import { escapeHtml } from "@/lib/html-escape";
import { reportError } from "@/lib/observability";

export const maxDuration = 10;

/** Minimal readable page for text-only (copy-path) records. */
function textAsHtml(subject: string | null, text: string): string {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${escapeHtml(
    subject ?? "Gesendete E-Mail"
  )}</title></head><body style="margin:0;padding:24px;background:#f4f4f4;font-family:Helvetica,Arial,sans-serif;">
<div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e0e0e0;border-radius:8px;padding:24px;">
<p style="margin:0 0 16px;color:#757575;font-size:13px;">Kopier-Versand — es wurde kein HTML verschickt; unten der kopierte Text.</p>
<pre style="margin:0;white-space:pre-wrap;word-wrap:break-word;font-family:inherit;font-size:15px;line-height:1.6;color:#212121;">${escapeHtml(
    text
  )}</pre></div></body></html>`;
}

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let sendId: number;
  try {
    const json = (await req.json()) as { sendId?: unknown };
    sendId = Number(json.sendId);
    if (!Number.isInteger(sendId) || sendId <= 0) {
      return adminJsonError("bad_request", "sendId required", 400);
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    const send = await getCampaignSendContent(sendId);
    if (!send) return adminJsonError("not_found", "Send-Eintrag nicht gefunden.", 404);

    const html =
      send.bodyHtml ?? (send.bodyText != null ? textAsHtml(send.subject, send.bodyText) : null);
    if (html == null) {
      return adminJsonError(
        "no_content",
        "Für diesen Versand wurde kein Inhalt gespeichert (vor Einführung der Speicherung gesendet).",
        404
      );
    }
    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (err) {
    reportError(err, { route: "api/admin/campaign/sent-email" });
    return adminJsonError("internal_error", "Inhalt konnte nicht geladen werden.", 500);
  }
}
