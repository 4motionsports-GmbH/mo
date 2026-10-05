// AI suggestions for Eingang items (writer tier) — „was ist der beste nächste
// Schritt?“ per item: why it matters, the action, the channel, an optional
// subject/text, an optional discount with a reason, and products. The model
// is told what is NOT allowed (no e-mail advertising without consent, no
// letter after an objection) and the answer is re-checked here before it is
// stored — a suggestion can never widen what the gates allow. Nothing is
// sent or minted. docs/archive/CUSTOMER_PLATFORM_PLAN.md §11.4.

import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { getSql, type Sql } from "./db";
import { anthropicOptionsFor, modelFor } from "./ai-models.mjs";
import { recordAiUsage } from "./ai-usage-store";
import { reportError } from "./observability";
import { getCustomerById } from "./customer-store";
import { getCustomerFigures } from "./customer-list-store";
import { customerProfileForPrompt } from "./customer-profile";
import { getInboxItem, saveInboxSuggestion, type InboxSuggestion } from "./inbox-store";
import { SIGNAL_KINDS } from "./customer-signals.mjs";
import { SEGMENT_LABELS } from "./admin-customer-filter.mjs";
import { MAIL_ITEM_KIND } from "./inbox-mail-core.mjs";
import { generateMailReplyDraft } from "./inbox-mail";

const MODEL = modelFor("writer");
const MAX_DISCOUNT = 15;

const schema = z.object({
  warum: z.string(),
  aktion: z.string(),
  kanal: z.enum(["email", "brief", "antwort", "kampagne", "intern", "keine"]),
  betreff: z.string().nullable(),
  text: z.string().nullable(),
  rabatt: z.object({ prozent: z.number(), begruendung: z.string() }).nullable(),
  produkte: z.array(z.string()),
});

export type SuggestResult = { ok: true; suggestion: InboxSuggestion } | { ok: false; message: string };

/** Generate + store the suggestion for one item. Never throws. */
export async function generateInboxSuggestion(itemId: number, sql: Sql | null = getSql()): Promise<SuggestResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, message: "Kein KI-Schlüssel konfiguriert." };
  try {
    const item = await getInboxItem(itemId, sql);
    if (!item) return { ok: false, message: "Eintrag nicht gefunden." };
    if (item.customerId == null) return { ok: false, message: "Für Systemeinträge gibt es keinen Vorschlag." };
    // An incoming mail gets a summary and a reply draft instead.
    if (item.kind === MAIL_ITEM_KIND) return await generateMailReplyDraft(item, sql);
    const [customer, figures] = await Promise.all([getCustomerById(item.customerId), getCustomerFigures(item.customerId)]);
    if (!customer) return { ok: false, message: "Kunde nicht gefunden." };

    const mailAllowed = customer.emailConsentState === "subscribed" && !figures?.blocked;
    const letterAllowed = !customer.postalObjectionAt && customer.postalAddress != null;
    const profile = customer.profileObjectionAt ? null : customerProfileForPrompt(customer);
    const meta = SIGNAL_KINDS[item.kind as keyof typeof SIGNAL_KINDS];
    const facts = figures
      ? [
          `Bestellungen: ${figures.ordersCount}, Umsatz ${Math.round(figures.totalSpentCents / 100)} €`,
          figures.lastOrderAt ? `letzter Kauf: ${figures.lastOrderAt.slice(0, 10)}` : "noch kein Kauf",
          figures.lifecycleSegment ? `Lebenszyklus: ${SEGMENT_LABELS[figures.lifecycleSegment as keyof typeof SEGMENT_LABELS] ?? figures.lifecycleSegment}` : null,
          figures.valueTier ? `Wertstufe: ${figures.valueTier}` : null,
          figures.churnRisk ? `Abwanderungsrisiko: ${figures.churnRisk}` : null,
          `Gespräche mit Mo: ${figures.conversationsCount}`,
          `Kampagnen-Mails bisher: ${figures.emailsSentCount}`,
          figures.boughtCategories.length ? `gekaufte Kategorien: ${figures.boughtCategories.slice(0, 6).join(", ")}` : null,
        ]
          .filter(Boolean)
          .join("\n")
      : "(noch keine berechneten Kennzahlen)";

    const { object, usage } = await generateObject({
      model: anthropic(MODEL),
      providerOptions: anthropicOptionsFor("writer"),
      schema,
      system:
        "Du unterstützt das Team von motion sports (Fitness- und Kraftsportgeräte) im Eingang: Für EINEN " +
        "Anlass schlägst du den besten nächsten Schritt vor — konkret, kurz, auf Deutsch, ohne Floskeln.\n\n" +
        "Regeln:\n" +
        `- E-Mail-Werbung ist für diese Person ${mailAllowed ? "ERLAUBT" : "NICHT erlaubt (keine Einwilligung oder gesperrt) — kanal darf dann nicht 'email' oder 'kampagne' sein"}.\n` +
        `- Ein Werbebrief ist ${letterAllowed ? "möglich" : "NICHT möglich (Widerspruch oder keine Postadresse)"}.\n` +
        "- Eine Antwort auf eine E-Mail der Person (kanal 'antwort') ist immer erlaubt, aber ohne Werbung.\n" +
        `- Rabatt nur, wenn er begründet ist (z. B. Preis war Thema, Abwanderung), höchstens ${MAX_DISCOUNT} %; sonst rabatt null. Für Dank an Top-Kunden nie Rabatt.\n` +
        "- produkte: nur Produkt-Handles aus den Fakten (gekauft, besprochen); keine erfundenen.\n" +
        "- text: bei 'antwort' ein Antwortentwurf, bei 'email' eine kurze Skizze für den KI-Texter (3–5 Sätze), sonst null.\n" +
        "- warum: zwei Sätze, warum das jetzt zählt.",
      prompt:
        `## Anlass: ${meta?.label ?? item.kind}\n${item.reason}\n\n` +
        `## Belege\n${JSON.stringify(item.evidence).slice(0, 1500)}\n\n` +
        `## Kennzahlen\n${facts}\n\n` +
        `## Kundenverständnis\n${profile ?? "(kein Profil)"}\n\n` +
        "Schlage den nächsten Schritt vor.",
    });
    await recordAiUsage({
      callSite: "inbox_suggestion",
      model: MODEL,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    });

    // Re-check: the suggestion may never widen what the gates allow.
    let kanal = object.kanal;
    if (!mailAllowed && (kanal === "email" || kanal === "kampagne")) kanal = letterAllowed ? "brief" : "intern";
    if (!letterAllowed && kanal === "brief") kanal = mailAllowed ? "email" : "intern";
    const rabatt =
      object.rabatt && object.rabatt.prozent > 0 && item.kind !== "top_kunde"
        ? { prozent: Math.min(MAX_DISCOUNT, Math.round(object.rabatt.prozent)), begruendung: object.rabatt.begruendung.slice(0, 300) }
        : null;
    const suggestion: InboxSuggestion = {
      warum: object.warum.slice(0, 600),
      aktion: object.aktion.slice(0, 300),
      kanal,
      betreff: object.betreff?.slice(0, 200) ?? null,
      text: object.text?.slice(0, 3000) ?? null,
      rabatt,
      produkte: object.produkte.filter((p) => /^[a-z0-9][a-z0-9_-]{0,200}$/.test(p)).slice(0, 5),
      generatedAt: new Date().toISOString(),
      model: MODEL,
    };
    await saveInboxSuggestion(item.id, suggestion, sql);
    return { ok: true, suggestion };
  } catch (err) {
    reportError(err, { route: "lib/inbox-suggest", phase: "generate" });
    return { ok: false, message: "Die KI konnte gerade keinen Vorschlag machen." };
  }
}

/**
 * The nightly / hourly batch: suggestions for the highest-priority open
 * customer items without one, up to INBOX_AI_DAILY_LIMIT per day (0 = off).
 * Returns the number written.
 */
export async function suggestForInboxItems(
  opts: { limit: number; deadlineMs?: number },
  sql: Sql | null = getSql()
): Promise<number> {
  if (!sql || opts.limit <= 0 || !process.env.ANTHROPIC_API_KEY) return 0;
  try {
    const used = (await sql`
      SELECT count(*)::int AS n FROM inbox_items
       WHERE suggested_at >= date_trunc('day', now() AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'Europe/Berlin'
    `) as Array<{ n: number }>;
    const left = Math.max(0, opts.limit - Number(used[0]?.n ?? 0));
    if (left === 0) return 0;
    const rows = (await sql`
      SELECT id FROM inbox_items
       WHERE status = 'offen' AND customer_id IS NOT NULL AND suggestion IS NULL
       ORDER BY priority DESC, created_at DESC
       LIMIT ${left}
    `) as Array<{ id: number }>;
    let done = 0;
    for (const r of rows) {
      if (opts.deadlineMs && Date.now() > opts.deadlineMs) break;
      const res = await generateInboxSuggestion(Number(r.id), sql);
      if (res.ok) done++;
    }
    return done;
  } catch (err) {
    reportError(err, { route: "lib/inbox-suggest", phase: "batch" });
    return 0;
  }
}
