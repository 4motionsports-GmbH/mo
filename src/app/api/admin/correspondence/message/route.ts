// POST /api/admin/correspondence/message  { id }
//
// Lazy body expand for the Korrespondenz panel (§5): the thread list is a cheap
// metadata query that never ships bodies. When an operator expands a message we
// return its stored body + attachments; if both bodies are absent (a received
// row whose body wasn't fetched at webhook time) AND we hold a provider_email_id,
// we fetch the full message from Resend ON DEMAND and persist it so the next
// expand is a cheap DB read. No marketing/consent gate is touched — this is read.
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import {
  getMessageById,
  saveFetchedBody,
  type AttachmentMeta,
} from "@/lib/email-messages-store";
import { normalizeInboundMessage } from "@/lib/email-inbound-core.mjs";
import { reportError } from "@/lib/observability";
import { Resend } from "resend";

export const maxDuration = 30;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let id: number;
  try {
    const body = (await req.json()) as { id?: unknown };
    id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return adminJsonError("bad_request", "id required", 400);
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    const message = await getMessageById(id);
    if (!message) return adminJsonError("not_found", "Message not found.", 404);

    // Stored body present → return it. No provider round-trip.
    if (message.bodyText || message.bodyHtml) {
      return adminJson({
        bodyText: message.bodyText,
        bodyHtml: message.bodyHtml,
        attachments: message.attachments,
      });
    }

    // No stored body — fetch lazily by provider_email_id (the spike's design:
    // keep large bodies out of the webhook, fetch on demand only when expanded).
    if (message.providerEmailId) {
      const fetched = await fetchFullMessage(message.providerEmailId);
      if (fetched) {
        const normalized = normalizeInboundMessage(fetched);
        await saveFetchedBody(
          id,
          normalized.bodyText,
          normalized.bodyHtml,
          normalized.attachments as AttachmentMeta[]
        );
        return adminJson({
          bodyText: normalized.bodyText,
          bodyHtml: normalized.bodyHtml,
          attachments: normalized.attachments,
        });
      }
    }

    // Nothing stored and nothing fetchable — be honest (empty body).
    return adminJson({ bodyText: null, bodyHtml: null, attachments: message.attachments });
  } catch (err) {
    reportError(err, { route: "api/admin/correspondence/message" });
    return adminJsonError("internal_error", "Could not load the message.", 500);
  }
}

/** Fetch the full inbound message by provider id; null on any failure so the
 * caller degrades to an empty body rather than erroring. */
async function fetchFullMessage(emailId: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.receiving.get(emailId);
    if (error) {
      reportError(error, { route: "api/admin/correspondence/message", phase: "receiving.get" });
      return null;
    }
    return data;
  } catch (err) {
    reportError(err, { route: "api/admin/correspondence/message", phase: "receiving.get" });
    return null;
  }
}
