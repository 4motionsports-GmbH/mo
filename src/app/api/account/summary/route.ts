// GET /api/account/summary?conversationKey=<key> — the signed-in (tier-3)
// "Zusammenfassung herunterladen" download.
//
// Produces a downloadable summary of ONE of the signed-in customer's threads in
// the SAME content/structure/product-rendering as the transactional summary EMAIL
// (S5): AI prose → chosen products → "Zur Kasse" → divider → "Vielleicht auch
// interessant:" alternatives. It does NOT re-implement that layout — it calls the
// very same assembler the email uses (buildSummaryDocument), then renders the
// structured pieces to PDF (buildSummaryPdf), so the download and the email can
// never drift apart in content.
//
// FORMAT: PDF (10E-1, replacing the 10B-1 HTML). Rendered with the repo's
// dependency-free hand-written PDF stack (lib/pdf-core, shared with the physical-
// letter PDF) — no headless browser / PDF dependency on Vercel. The widget fetches
// this XHR (it carries the guard headers), then saves the bytes as a Blob behind
// the "Zusammenfassung herunterladen" button.
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
import { buildSummaryPdf } from "@/lib/summary-pdf.mjs";

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
  return `motionsports-zusammenfassung-${slug || "beratung"}.pdf`;
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

    const { summary, chosen, cartUrl, alternatives } = await buildSummaryDocument({
      conversation,
      usage: {
        callSite: "summary_download",
        conversationId: conversation.conversationId,
      },
    });

    // Render the SAME content to PDF (lib/summary-pdf reuses the shared, dependency-
    // free pdf-core). Any model call already ran + was recorded in buildSummaryDocument.
    const pdf = buildSummaryPdf({ summary, chosen, cartUrl, alternatives });

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${downloadFilename(conversationKey)}"`,
        "Content-Length": String(pdf.length),
        "Cache-Control": "no-store",
        ...guard.headers,
      },
    });
  } catch (err) {
    reportError(err, { route: "api/account/summary", phase: "GET" });
    return errorResponse("internal_error", "Unexpected server error", 500, guard.headers);
  }
}
