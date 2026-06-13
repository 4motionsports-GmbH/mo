// "Current understanding" customer profile — an on-demand Anthropic pass.
//
// Takes EVERYTHING we know about one customer (all linked conversation
// transcripts, their persona labels, the cached Shopify purchase history) and
// regenerates ONE concise, coherent German summary: needs, preferences, level,
// what they already own. Deliberately a fresh regeneration each time —
// per-session profiles can contradict each other (people change their minds
// between visits), so we never merge them mechanically; the model resolves
// contradictions in favour of the newer session.
//
// Provider: Anthropic via @ai-sdk/anthropic + the Vercel AI SDK — the same
// wiring as the chat route and the marketing draft. Model: Claude Opus 4.8,
// Anthropic's current most capable Opus-tier model — this runs rarely (an
// explicit admin button) on dense, contradiction-laden input, so quality
// beats cost here. NO silent fallback: this is an explicit admin action, so
// a missing key / model error surfaces to the dashboard instead of caching a
// fabricated profile.
//
// Data minimisation: the email address is NOT sent to the model — transcripts,
// personas, and purchases carry all the signal the summary needs.

import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import type { CustomerSession } from "./customer-store";
import type { OrderHistory } from "./shopify-orders";
import { ARCHETYPE_META } from "./persona";
import type { PersonaArchetype } from "./types";
import { recordAiUsage } from "./ai-usage-store";

const PROFILE_MODEL = "claude-opus-4-8";

// USD per million tokens for PROFILE_MODEL (Anthropic pricing, checked
// 2026-06-11). Surfaced in the dashboard so the operator sees what each
// regeneration costs. Update alongside PROFILE_MODEL.
const INPUT_USD_PER_MTOK = 5;
const OUTPUT_USD_PER_MTOK = 25;

// Keep the prompt bounded: a customer with many long sessions must not turn
// into an unbounded mega-prompt. Newest sessions matter most, so when
// trimming, older transcripts are dropped first.
const MAX_SESSIONS_IN_PROMPT = 12;
const MAX_TRANSCRIPT_CHARS_PER_SESSION = 6000;

export interface ProfileUsage {
  inputTokens: number;
  outputTokens: number;
  /** Rough cost of this regeneration in USD (input+output at list price). */
  approxCostUsd: number;
}

export interface GenerateProfileInput {
  sessions: CustomerSession[];
  purchases: OrderHistory | null;
}

export type GenerateProfileResult =
  | { ok: true; summary: string; usage: ProfileUsage }
  | { ok: false; reason: "unconfigured" | "no_data" | "model_error"; message: string };

function personaDisplay(label: string | null): string {
  if (!label) return "unbekannt";
  const meta = ARCHETYPE_META[label as PersonaArchetype];
  return meta ? meta.label : label;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "unbekanntes Datum";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "unbekanntes Datum" : d.toLocaleDateString("de-DE");
}

function sessionBlock(s: CustomerSession, index: number, total: number): string {
  const transcript = s.transcript
    .map((m) => `${m.role === "user" ? "Kunde" : "Berater"}: ${m.content.trim()}`)
    .join("\n");
  const clipped =
    transcript.length > MAX_TRANSCRIPT_CHARS_PER_SESSION
      ? transcript.slice(0, MAX_TRANSCRIPT_CHARS_PER_SESSION) + "\n[… gekürzt]"
      : transcript;
  return (
    `### Session ${index + 1} von ${total} — ${fmtDate(s.createdAt)} · ` +
    `Persona: ${personaDisplay(s.personaLabel)}\n` +
    (clipped || "(kein lesbares Transkript)")
  );
}

function purchasesBlock(purchases: OrderHistory | null): string {
  if (!purchases) {
    return "(keine Kaufhistorie geladen — Käufe sind UNBEKANNT, nicht 'keine')";
  }
  if (purchases.orders.length === 0) {
    return "(Shopify abgefragt: keine Bestellungen unter dieser E-Mail gefunden)";
  }
  return purchases.orders
    .map((o) => {
      const items = o.items
        .map((i) => `${i.quantity}× ${i.title ?? i.handle ?? "Unbekannter Artikel"}`)
        .join(", ");
      const total = o.totalAmount ? ` — ${o.totalAmount} ${o.currencyCode ?? ""}`.trimEnd() : "";
      return `- ${o.name} (${fmtDate(o.createdAt)}): ${items || "(keine Positionen)"}${total}`;
    })
    .join("\n");
}

/**
 * Regenerate the customer's "current understanding" summary. Never throws —
 * returns a discriminated result so the admin route can answer with the real
 * reason (no key, nothing to summarise, model failure).
 */
export async function generateCustomerProfile(
  input: GenerateProfileInput
): Promise<GenerateProfileResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      ok: false,
      reason: "unconfigured",
      message: "ANTHROPIC_API_KEY ist nicht gesetzt — Profil kann nicht generiert werden.",
    };
  }

  const sessions = input.sessions.filter((s) => s.transcript.length > 0);
  if (sessions.length === 0 && !input.purchases?.orders?.length) {
    return {
      ok: false,
      reason: "no_data",
      message: "Keine verknüpften Gespräche oder Käufe — nichts zu verdichten.",
    };
  }

  // Newest sessions carry the freshest signal; drop the oldest beyond the cap.
  const kept = sessions.slice(-MAX_SESSIONS_IN_PROMPT);
  const blocks = kept.map((s, i) => sessionBlock(s, i, kept.length)).join("\n\n");

  try {
    const result = await generateText({
      model: anthropic(PROFILE_MODEL),
      maxOutputTokens: 1500,
      system:
        "Du bist Analyst bei motion sports (Fitness- und Kraftsportgeräte). Du " +
        "verdichtest die Chat-Sessions und die Kaufhistorie EINES Kunden zu einem " +
        "aktuellen Kundenverständnis für das Beratungs-/Marketing-Team.\n\n" +
        "Regeln:\n" +
        "- Schreibe auf Deutsch, prägnant, faktenbasiert — keine Floskeln, nichts erfinden.\n" +
        "- Erstelle EIN kohärentes Gesamtbild, KEINE Aneinanderreihung der Sessions. " +
        "Bei Widersprüchen zwischen Sessions gilt die neuere Aussage; erwähne den " +
        "Sinneswandel nur, wenn er beratungsrelevant ist.\n" +
        "- Unterscheide klar zwischen GEKAUFT (Kaufhistorie), GEWÜNSCHT (im Chat " +
        "geäußert) und UNBEKANNT.\n" +
        "- Gliedere in kurze Abschnitte: Bedarf & Ziele · Niveau & Kontext · " +
        "Vorlieben & Budget-Signale · Besitzt bereits (Käufe) · Offene Punkte / " +
        "nächste sinnvolle Schritte.\n" +
        "- Maximal ~250 Wörter.",
      prompt:
        `## Chat-Sessions (chronologisch, älteste zuerst)\n\n` +
        `${blocks || "(keine Gespräche verknüpft)"}\n\n` +
        `## Kaufhistorie (Shopify)\n\n${purchasesBlock(input.purchases)}\n\n` +
        `Erstelle jetzt das aktuelle Kundenverständnis.`,
    });

    const summary = result.text?.trim();
    if (!summary) {
      return { ok: false, reason: "model_error", message: "Das Modell lieferte keinen Text." };
    }

    const inputTokens = result.usage?.inputTokens ?? 0;
    const outputTokens = result.usage?.outputTokens ?? 0;
    // Cost KPI (dashboard/admin side). The per-run cost shown in the dashboard
    // is computed separately below; this feeds the aggregate spend tracking.
    await recordAiUsage({
      callSite: "customer_profile",
      model: PROFILE_MODEL,
      inputTokens,
      outputTokens,
    });
    return {
      ok: true,
      summary,
      usage: {
        inputTokens,
        outputTokens,
        approxCostUsd:
          (inputTokens * INPUT_USD_PER_MTOK + outputTokens * OUTPUT_USD_PER_MTOK) / 1_000_000,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "model_error", message };
  }
}
