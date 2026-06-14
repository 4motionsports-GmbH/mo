// /api/account/conversations/[id] — operate on ONE of the signed-in customer's
// past conversations. Every method is scoped to the resolved customer id, so a
// conversation the caller doesn't own is indistinguishable from a missing one
// (404 — no enumeration leak).
//
//   GET    — fetch the transcript (readable user/assistant turns).
//   PATCH  — rename the title       (body: { title }).
//   DELETE — HARD-delete this transcript (messages + chat ai_usage cascade).
//
// DELETE semantics (see docs/CUSTOMER_ACCOUNT.md §9): deleting ONE chat removes
// that transcript only. The durable "current understanding" profile is a
// SEPARATE aggregate under a different lawful basis — a future profile
// regeneration no longer sees this conversation, but profile text already
// derived persists until regenerated or the customer is erased (the distinct
// full "delete my data" path, POST /api/account/erase).
//
// Gated by the CA-1 signed-in resolver; anonymous / email-only fail closed.

import { preflightResponse } from "@/lib/security";
import { errorResponse, reportError } from "@/lib/observability";
import { requireSignedInCustomer } from "@/lib/account-guard";
import {
  getCustomerConversationTranscript,
  renameCustomerConversation,
  deleteCustomerConversation,
} from "@/lib/account-history";
import { sanitizeTitleInput } from "@/lib/conversation-title.mjs";

export const runtime = "nodejs";
export const maxDuration = 15;

const METHODS = "GET, PATCH, DELETE, OPTIONS";

export async function OPTIONS(req: Request) {
  return preflightResponse(req, METHODS);
}

function json(body: unknown, headers: Record<string, string>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

function parseId(raw: string): number | null {
  // Conversation ids are positive integers; reject anything else up front so a
  // bogus path segment is a clean 404, never a DB error.
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireSignedInCustomer(req, METHODS);
  if (!guard.ok) return guard.response;

  try {
    const conversationId = parseId((await ctx.params).id);
    if (conversationId == null) {
      return errorResponse("bad_request", "Ungültige Konversations-ID", 400, guard.headers);
    }
    const transcript = await getCustomerConversationTranscript(guard.customerId, conversationId);
    if (!transcript) {
      return errorResponse("bad_request", "Konversation nicht gefunden", 404, guard.headers);
    }
    return json({ conversation: transcript }, guard.headers);
  } catch (err) {
    reportError(err, { route: "api/account/conversations/[id]", phase: "GET" });
    return errorResponse("internal_error", "Unexpected server error", 500, guard.headers);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireSignedInCustomer(req, METHODS);
  if (!guard.ok) return guard.response;

  try {
    const conversationId = parseId((await ctx.params).id);
    if (conversationId == null) {
      return errorResponse("bad_request", "Ungültige Konversations-ID", 400, guard.headers);
    }

    let payload: { title?: unknown };
    try {
      payload = (await req.json()) as { title?: unknown };
    } catch {
      return errorResponse("bad_request", "Ungültiger JSON-Body", 400, guard.headers);
    }

    const sanitized = sanitizeTitleInput(payload.title);
    if (!sanitized.ok) {
      return errorResponse("bad_request", "Titel darf nicht leer sein", 400, guard.headers);
    }

    const renamed = await renameCustomerConversation(
      guard.customerId,
      conversationId,
      sanitized.title
    );
    if (!renamed) {
      return errorResponse("bad_request", "Konversation nicht gefunden", 404, guard.headers);
    }
    return json({ ok: true, conversationId, title: sanitized.title }, guard.headers);
  } catch (err) {
    reportError(err, { route: "api/account/conversations/[id]", phase: "PATCH" });
    return errorResponse("internal_error", "Unexpected server error", 500, guard.headers);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireSignedInCustomer(req, METHODS);
  if (!guard.ok) return guard.response;

  try {
    const conversationId = parseId((await ctx.params).id);
    if (conversationId == null) {
      return errorResponse("bad_request", "Ungültige Konversations-ID", 400, guard.headers);
    }
    const deleted = await deleteCustomerConversation(guard.customerId, conversationId);
    if (!deleted) {
      return errorResponse("bad_request", "Konversation nicht gefunden", 404, guard.headers);
    }
    return json({ ok: true, conversationId, deleted: true }, guard.headers);
  } catch (err) {
    reportError(err, { route: "api/account/conversations/[id]", phase: "DELETE" });
    return errorResponse("internal_error", "Unexpected server error", 500, guard.headers);
  }
}
