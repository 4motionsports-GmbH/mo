// Per-conversation AI analysis — an on-demand, CACHED Haiku pass for the admin
// conversation inspector ("Analysieren" button). ONE model call over the readable
// transcript of a single conversation produces a short smart summary, a category,
// tags and a quality signal. The result is cached on the conversation row
// (lib/admin-conversations.saveConversationAnalysis); re-opening shows it for free.
//
// Provider: Anthropic via @ai-sdk/anthropic + the Vercel AI SDK — the same wiring
// as the chat route, the marketing draft and the customer profile. Model: Claude
// Haiku 4.5 — this is back-office categorisation + a short summary, which does NOT
// need the top consultation model; the cheap model keeps the cost negligible at
// scale. NO silent fallback: an explicit admin action, so a missing key / model
// error surfaces to the dashboard instead of caching a fabricated analysis.
//
// Cluster A only: reads the pseudonymous transcript; records token usage linked to
// the conversation FK so it cascade-deletes with the conversation on retention /
// erasure. No email, no identity is sent to the model.

import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { recordAiUsage } from "./ai-usage-store";
import {
  parseAnalysisResponse,
  ANALYSIS_CATEGORIES,
  ANALYSIS_QUALITIES,
} from "./conversation-analysis-core.mjs";
import type { AdminTranscriptTurn } from "./admin-conversations";

/** Cheap Haiku-class model — back-office analysis, not the consultation model. */
export const ANALYSIS_MODEL = "claude-haiku-4-5";

// USD per million tokens for ANALYSIS_MODEL (Anthropic pricing, checked
// 2026-06). Surfaced in the dashboard so the operator sees what each run costs.
// Keep in sync with ANALYSIS_MODEL and lib/ai-pricing.mjs.
const INPUT_USD_PER_MTOK = 1;
const OUTPUT_USD_PER_MTOK = 5;

// Keep the prompt bounded: a very long chat must not become an unbounded prompt.
const MAX_TURNS = 60;
const MAX_TRANSCRIPT_CHARS = 12000;

export interface AnalysisResult {
  summary: string;
  category: string;
  tags: string[];
  quality: string;
}

export interface AnalysisUsage {
  inputTokens: number;
  outputTokens: number;
  /** Rough cost of this run in USD (input+output at list price). */
  approxCostUsd: number;
}

export type GenerateAnalysisResult =
  | { ok: true; analysis: AnalysisResult; usage: AnalysisUsage }
  | { ok: false; reason: "unconfigured" | "no_data" | "model_error"; message: string };

function renderTranscript(turns: AdminTranscriptTurn[]): string {
  const kept = turns.slice(-MAX_TURNS);
  const text = kept
    .map((t) => `${t.role === "user" ? "Kunde" : "Berater"}: ${t.content.trim()}`)
    .join("\n");
  return text.length > MAX_TRANSCRIPT_CHARS
    ? text.slice(-MAX_TRANSCRIPT_CHARS) + "\n[… Anfang gekürzt]"
    : text;
}

/**
 * Analyse ONE conversation. Never throws — returns a discriminated result so the
 * admin route can answer with the real reason (no key, nothing to analyse, model
 * failure). Records token usage against the conversation FK on success.
 */
export async function generateConversationAnalysis(input: {
  conversationId: number;
  transcript: AdminTranscriptTurn[];
}): Promise<GenerateAnalysisResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      ok: false,
      reason: "unconfigured",
      message: "ANTHROPIC_API_KEY ist nicht gesetzt — Analyse nicht möglich.",
    };
  }

  const turns = input.transcript.filter((t) => t.content.trim().length > 0);
  if (turns.length === 0) {
    return {
      ok: false,
      reason: "no_data",
      message: "Kein lesbares Transkript — nichts zu analysieren.",
    };
  }

  try {
    const result = await generateText({
      model: anthropic(ANALYSIS_MODEL),
      maxOutputTokens: 600,
      system:
        "Du bist Analyst bei motion sports (Fitness- und Kraftsportgeräte). Du " +
        "analysierst EIN Beratungsgespräch zwischen einem Kunden und dem Chatbot " +
        "'Mo' für das interne Qualitäts- und Produktteam.\n\n" +
        "Antworte AUSSCHLIESSLICH mit EINEM JSON-Objekt — keine Code-Fences, kein " +
        "Text davor oder danach. Felder:\n" +
        '- "summary": 2–3 prägnante deutsche Sätze: Worum ging es, was wollte der ' +
        "Kunde, wie endete es. Faktenbasiert, nichts erfinden.\n" +
        `- "category": GENAU EINER von: ${ANALYSIS_CATEGORIES.join(", ")}.\n` +
        '- "tags": 1–5 kurze deutsche Schlagwörter (Themen/Produkte).\n' +
        `- "quality": GENAU EINER von: ${ANALYSIS_QUALITIES.join(", ")} ` +
        "(hat Mo gut geholfen / war der Kunde zufrieden / blieb ein Bedarf offen / " +
        "ist der Kunde abgesprungen / unklar).",
      prompt:
        `## Gespräch (chronologisch)\n\n${renderTranscript(turns)}\n\n` +
        "Analysiere dieses Gespräch jetzt und gib NUR das JSON-Objekt zurück.",
    });

    const parsed = parseAnalysisResponse(result.text ?? "");
    if (!parsed || !parsed.summary) {
      return {
        ok: false,
        reason: "model_error",
        message: "Das Modell lieferte keine verwertbare Analyse.",
      };
    }

    const inputTokens = result.usage?.inputTokens ?? 0;
    const outputTokens = result.usage?.outputTokens ?? 0;
    // Cost KPI (dashboard/admin side) — linked to the conversation so it
    // cascade-deletes with it on retention / erasure (like chat usage).
    await recordAiUsage({
      callSite: "conversation_analysis",
      model: ANALYSIS_MODEL,
      inputTokens,
      outputTokens,
      conversationId: input.conversationId,
    });

    return {
      ok: true,
      analysis: parsed,
      usage: {
        inputTokens,
        outputTokens,
        approxCostUsd:
          (inputTokens * INPUT_USD_PER_MTOK + outputTokens * OUTPUT_USD_PER_MTOK) /
          1_000_000,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "model_error", message };
  }
}
