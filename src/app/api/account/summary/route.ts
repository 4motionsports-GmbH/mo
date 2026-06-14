// GET /api/account/summary?conversationKey=<key> — the signed-in (tier-3)
// "Zusammenfassung herunterladen" download.
//
// Produces a downloadable summary of ONE of the signed-in customer's threads in
// the SAME style/structure/product-rendering as the transactional summary EMAIL
// (S5): AI prose → chosen products → "Zur Kasse" → divider → "Vielleicht auch
// interessant:" alternatives. It does NOT re-implement that layout — it calls
// the very same renderer the email uses (buildSummaryDocument /
// renderBrandedEmail), so the download and the email can never drift apart.
//
// FORMAT: styled HTML (the branded email shell), returned as a file attachment.
// HTML is chosen deliberately — it reuses the email template byte-for-byte with
// no extra dependency; a PDF would require a new headless-render pipeline and a
// second layout. The widget fetches this XHR (it carries the guard headers), then
// saves the HTML body as a Blob behind the "Zusammenfassung herunterladen" button.
//
// Gated by the CA-1 signed-in resolver (origin + secret + a LIVE access token);
// the thread must belong to the caller (conversation_key + customer_id), so an
// anonymous/tier-2/foreign request fails closed (401 / 404). If the summary
// makes a model call, its token usage is recorded against the conversation as
// the `summary_download` S6 cost metric.

import { preflightResponse } from "@/lib/security";
import { errorResponse, reportError } from "@/lib/observability";
import { requireSignedInCustomer } from "@/lib/account-guard";
import { loadCustomerConversationForSummary } from "@/lib/account-history";
import { buildSummaryDocument } from "@/lib/summary-email";

export const runtime = "nodejs";
// The summary may make one Anthropic call — give it the same headroom the
// capture-email summary send has.
export const maxDuration = 30;

const METHODS = "GET, OPTIONS";

export async function OPTIONS(req: Request) {
  return preflightResponse(req, METHODS);
}

/** Safe, descriptive download filename derived from the (opaque) thread key. */
function downloadFilename(conversationKey: string): string {
  const slug = conversationKey.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
  return `motionsports-zusammenfassung-${slug || "beratung"}.html`;
}

export async function GET(req: Request) {
  const guard = await requireSignedInCustomer(req, METHODS);
  if (!guard.ok) return guard.response;

  try {
    const conversationKey = (
      new URL(req.url).searchParams.get("conversationKey") ?? ""
    ).trim();
    if (!conversationKey) {
      return errorResponse("bad_request", "conversationKey fehlt", 400, guard.headers);
    }

    // Scoped to the caller (conversation_key + customer_id) — a thread the
    // customer doesn't own is a clean 404, same as a missing one.
    const conversation = await loadCustomerConversationForSummary(
      guard.customerId,
      conversationKey
    );
    if (!conversation) {
      return errorResponse("bad_request", "Konversation nicht gefunden", 404, guard.headers);
    }

    const { html } = await buildSummaryDocument({
      conversation,
      usage: {
        callSite: "summary_download",
        conversationId: conversation.conversationId,
      },
    });

    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="${downloadFilename(conversationKey)}"`,
        "Cache-Control": "no-store",
        ...guard.headers,
      },
    });
  } catch (err) {
    reportError(err, { route: "api/account/summary", phase: "GET" });
    return errorResponse("internal_error", "Unexpected server error", 500, guard.headers);
  }
}
