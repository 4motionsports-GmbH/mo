// E-Mails im Eingang (I/O). Every incoming mail of a known customer opens or
// refreshes their item „E-Mail beantworten“ (inbound webhook, „Zuordnen“ /
// „Als Interessent anlegen“, contact form, and the hourly catch-up); the item
// shows the conversation, an AI summary and a reply draft — a service reply,
// never advertising — and a reply from the Eingang or the Korrespondenz tab
// closes it. Rules: lib/inbox-mail-core.mjs. Nothing here sends.

import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { getSql, type Sql } from "./db";
import { anthropicOptionsFor, modelFor } from "./ai-models.mjs";
import { recordAiUsage } from "./ai-usage-store";
import { reportError } from "./observability";
import { randomUUID } from "node:crypto";
import { findOrCreateProspect, getCustomerById } from "./customer-store";
import { insertReceivedMessage } from "./email-messages-store";
import { customerProfileForPrompt } from "./customer-profile";
import { listCustomerOrders } from "./customer-orders-store";
import { effectiveEmailLanguage } from "./campaign-language.mjs";
import { replySubject } from "./email-inbound-core.mjs";
import { listUnseenInboundMails, saveInboxSuggestion, upsertMailItem, type InboxItem, type InboxSuggestion } from "./inbox-store";
import {
  MAIL_INTENTS,
  buildMailReplyPrompt,
  contactFormMessage,
  htmlToText,
  mailSnippet,
  sanitizeMailDraft,
  splitName,
  stripQuoted,
} from "./inbox-mail-core.mjs";

const MODEL = modelFor("writer");
const THREAD_LIMIT = 12;

/**
 * An incoming mail of a known customer reached Mo: open or join their item.
 * The list snippet is rebuilt from the stored text without the quoted
 * history. Fail-soft; returns the item id.
 */
export async function noteInboundMail(
  mail: { customerId: number; emailMessageId: number; subject: string | null; snippet: string | null; occurredAt?: string | null; source?: string },
  sql: Sql | null = getSql()
): Promise<number | null> {
  let snippet = mail.snippet;
  if (sql) {
    try {
      const rows = (await sql`
        SELECT body_text, body_html FROM email_messages WHERE id = ${mail.emailMessageId}
      `) as Array<{ body_text: string | null; body_html: string | null }>;
      if (rows[0]) snippet = mailSnippet(rows[0].body_text, rows[0].body_html, mail.snippet);
    } catch (err) {
      reportError(err, { route: "lib/inbox-mail", phase: "noteInboundMail" });
    }
  }
  return upsertMailItem({ ...mail, snippet, occurredAt: mail.occurredAt ?? new Date().toISOString() }, sql);
}

/**
 * A contact-form request (/api/contact) into Mo: the sender becomes (or is
 * found as) a customer — a prospect when new, without any consent — the
 * request is stored as a received message (provider 'kontaktformular') and
 * opens the Eingang item. The team notification mail is sent as before.
 * Fail-soft: returns the item id or null.
 */
export async function storeContactRequest(
  p: { reasonLabel: string; name: string; email: string; organization?: string | null; phone?: string | null; message: string; products?: string[] },
  sql: Sql | null = getSql()
): Promise<number | null> {
  try {
    const { firstName, lastName } = splitName(p.name);
    const customerId = await findOrCreateProspect({ email: p.email, firstName, lastName }, sql);
    if (customerId == null) return null;
    const msg = contactFormMessage(p);
    const id = `kontakt-${randomUUID()}@motionsports.de`;
    const stored = await insertReceivedMessage(
      {
        customerId,
        messageId: id,
        inReplyTo: null,
        references: [],
        threadId: id,
        fromAddress: p.email.trim().toLowerCase(),
        toAddress: process.env.CONTACT_TO_EMAIL?.trim() || "kontaktformular",
        subject: msg.subject,
        bodyText: msg.bodyText,
        bodyHtml: null,
        snippet: msg.snippet,
        attachments: [],
        providerEmailId: null,
        occurredAt: new Date().toISOString(),
        provider: "kontaktformular",
      },
      sql
    );
    if (!stored.inserted) return null;
    return await upsertMailItem(
      { customerId, emailMessageId: stored.id, subject: msg.subject, snippet: msg.snippet, occurredAt: new Date().toISOString(), source: "kontaktformular" },
      sql
    );
  } catch (err) {
    reportError(err, { route: "lib/inbox-mail", phase: "storeContactRequest" });
    return null;
  }
}

/** The hourly safety net: items for mails the live hook missed. Returns the number noted. */
export async function catchUpMailItems(limit = 200, sql: Sql | null = getSql()): Promise<number> {
  const unseen = await listUnseenInboundMails(limit, sql);
  let noted = 0;
  for (const m of unseen) {
    if ((await noteInboundMail(m, sql)) != null) noted++;
  }
  return noted;
}

export interface MailThreadMessage {
  id: number;
  direction: "sent" | "received";
  subject: string | null;
  fromAddress: string;
  occurredAt: string | null;
  /** The readable text (quoted history removed for received mails). */
  text: string;
  attachmentCount: number;
  /** Part of this item (a mail still to be answered). */
  isNew: boolean;
}

/**
 * The customer's latest correspondence for the item (oldest first): the
 * mails of the item plus the conversation around them. Never throws.
 */
export async function loadMailThread(
  customerId: number,
  itemMessageIds: number[],
  sql: Sql | null = getSql()
): Promise<MailThreadMessage[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT id, direction, subject, from_address, body_text, body_html, snippet, attachments, occurred_at
        FROM email_messages
       WHERE customer_id = ${customerId}
       ORDER BY occurred_at DESC, id DESC
       LIMIT ${THREAD_LIMIT}
    `) as Array<Record<string, unknown>>;
    return rows.reverse().map((r) => {
      const raw = (r.body_text as string | null) || htmlToText(r.body_html as string | null) || (r.snippet as string | null) || "";
      const direction = r.direction === "received" ? "received" : "sent";
      return {
        id: Number(r.id),
        direction,
        subject: (r.subject as string | null) ?? null,
        fromAddress: String(r.from_address ?? ""),
        occurredAt: r.occurred_at ? new Date(String(r.occurred_at)).toISOString() : null,
        text: direction === "received" ? stripQuoted(raw) || raw.trim() : raw.trim(),
        attachmentCount: Array.isArray(r.attachments) ? r.attachments.length : 0,
        isNew: itemMessageIds.includes(Number(r.id)),
      };
    });
  } catch (err) {
    reportError(err, { route: "lib/inbox-mail", phase: "loadMailThread" });
    return [];
  }
}

export function itemMessageIds(item: Pick<InboxItem, "evidence">): number[] {
  const ids = (item.evidence as { messageIds?: unknown }).messageIds;
  return Array.isArray(ids) ? ids.map(Number).filter(Number.isFinite) : [];
}

const schema = z.object({
  zusammenfassung: z.string(),
  anliegen: z.enum(MAIL_INTENTS as [string, ...string[]]),
  dringlichkeit: z.enum(["niedrig", "mittel", "hoch"]),
  naechster_schritt: z.string(),
  betreff: z.string().nullable(),
  text: z.string(),
  offene_punkte: z.array(z.string()),
});

/** Summary + reply draft for a mail item, stored as its suggestion. Never throws. */
export async function generateMailReplyDraft(
  item: InboxItem,
  sql: Sql | null = getSql()
): Promise<{ ok: true; suggestion: InboxSuggestion } | { ok: false; message: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, message: "Kein KI-Schlüssel konfiguriert." };
  if (item.customerId == null) return { ok: false, message: "Die E-Mail ist keinem Kunden zugeordnet." };
  try {
    const [customer, thread, orders] = await Promise.all([
      getCustomerById(item.customerId),
      loadMailThread(item.customerId, itemMessageIds(item), sql),
      listCustomerOrders(item.customerId, { limit: 3 }, sql),
    ]);
    if (!customer) return { ok: false, message: "Kunde nicht gefunden." };
    const lastReceived = [...thread].reverse().find((m) => m.direction === "received");
    if (!lastReceived) return { ok: false, message: "Keine E-Mail der Person gefunden." };

    const { system, prompt } = buildMailReplyPrompt({
      customerName: [customer.firstName, customer.lastName].filter(Boolean).join(" ") || customer.shopifyAccountSummary?.displayName || null,
      language: effectiveEmailLanguage({ override: customer.languageOverride, locale: customer.locale }),
      messages: thread.map((m) => ({ direction: m.direction, at: m.occurredAt, subject: m.subject, text: m.text })),
      // No order numbers or amounts (docs/ANWALTSDOSSIER.md §7.1).
      orders: orders.orders.map((o) => ({
        at: o.processedAt,
        status: o.cancelledAt ? "storniert" : [o.financialStatus, o.fulfillmentStatus].filter(Boolean).join(", ") || null,
        items: o.lineItems.map((li) => `${li.quantity ?? 1}× ${li.title ?? "Artikel"}`),
      })),
      profile: customer.profileObjectionAt ? null : customerProfileForPrompt(customer),
    });
    const { object, usage } = await generateObject({
      model: anthropic(MODEL),
      providerOptions: anthropicOptionsFor("writer"),
      schema,
      system,
      prompt,
    });
    await recordAiUsage({
      callSite: "inbox_mail_reply",
      model: MODEL,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    });
    const clean = sanitizeMailDraft(object, { fallbackSubject: replySubject(lastReceived.subject ?? "") || "Ihre Nachricht" });
    const suggestion: InboxSuggestion = {
      ...clean,
      kanal: "antwort",
      generatedAt: new Date().toISOString(),
      model: MODEL,
    };
    await saveInboxSuggestion(item.id, suggestion, sql);
    return { ok: true, suggestion };
  } catch (err) {
    reportError(err, { route: "lib/inbox-mail", phase: "generateMailReplyDraft" });
    return { ok: false, message: "Die KI konnte gerade keinen Entwurf schreiben." };
  }
}
