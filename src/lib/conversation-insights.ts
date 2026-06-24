// Aggregate insights rollup — the "refinement engine" for the conversation
// inspector. On demand (a button, or a daily cron) it produces a human-readable
// report over a date range: top themes/questions, where consultations stall or
// fail, common unmet needs, and concrete "consider refining X" suggestions FOR A
// HUMAN to act on.
//
// TOKEN EFFICIENCY: the model is fed the already-CACHED per-conversation
// SUMMARIES + categories (Part 2), NOT raw transcripts. Summarising summaries is
// far cheaper and scales — the cost grows with the NUMBER of conversations, not
// their length. The rollup is cached by date range (conversation_insights) and
// regenerated on demand.
//
// Model: Claude Haiku 4.5 (same cheap model as the per-conversation analysis) —
// this is back-office synthesis, not consultation.
//
// EXPLICIT BOUNDARY (out of scope, by design): this NEVER rewrites Mo's prompt or
// behaviour. Mo gives legally + product-sensitive advice; refinement stays
// HUMAN-IN-THE-LOOP — the insights inform a human who decides any prompt change.
// The boundary note is appended to every report so it is never lost.

import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { recordAiUsage } from "./ai-usage-store";
import { reportError } from "./observability";
import {
  loadAnalysesForRollup,
  saveInsights,
  getCachedInsights,
  type InsightsRollup,
} from "./admin-conversations";
import { buildRollupPrompt } from "./conversation-analysis-core.mjs";

/** Cheap Haiku-class model — summarising summaries, not consultation. */
export const INSIGHTS_MODEL = "claude-haiku-4-5";

// Bound the rollup input so a huge analysed set stays a cheap single pass.
const MAX_ANALYSES = 400;

/** Always-present footer stating the human-in-the-loop refinement boundary. */
const BOUNDARY_NOTE =
  "\n\n---\n\n_**Grenze (bewusst):** Diese Insights sind Entscheidungsgrundlage für " +
  "einen Menschen. Mo passt seinen Prompt bzw. sein Verhalten NICHT automatisch an — " +
  "Mo gibt rechtlich und produktseitig sensible Beratung, deshalb bleibt jede " +
  "Verfeinerung human-in-the-loop: ein Mensch entscheidet über Prompt-Änderungen._";

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Generate (and cache) the insights rollup for a [from, to] window. Never throws;
 * on a missing key / model error it returns a clear German message (not cached, so
 * a retry is cheap). Reads CACHED summaries only — never transcripts.
 */
export async function generateConversationInsights(
  from: string,
  to: string
): Promise<InsightsRollup> {
  const analyses = await loadAnalysesForRollup(from, to, MAX_ANALYSES);

  if (analyses.length === 0) {
    return {
      from,
      to,
      summaryMd:
        "_Noch keine analysierten Gespräche in diesem Zeitraum. Analysiere zuerst " +
        "einzelne Gespräche (oder nutze die Sammelaktion), dann kann hier ein " +
        "Insights-Report über die Zusammenfassungen entstehen._",
      analyzedCount: 0,
      model: null,
      costEur: 0,
      generatedAt: nowIso(),
      cached: false,
    };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      from,
      to,
      summaryMd:
        "_Anthropic API-Key nicht konfiguriert — der Insights-Report kann nicht " +
        "erstellt werden._",
      analyzedCount: analyses.length,
      model: null,
      costEur: 0,
      generatedAt: nowIso(),
      cached: false,
    };
  }

  try {
    const { text, usage } = await generateText({
      model: anthropic(INSIGHTS_MODEL),
      maxOutputTokens: 1300,
      system:
        "Du bist Analyst bei motion sports (Fitness- und Kraftsportgeräte). Du " +
        "erhältst KURZ-ZUSAMMENFASSUNGEN vieler Beratungsgespräche (bereits " +
        "verdichtet) zwischen Kunden und dem Chatbot 'Mo', jeweils mit Kategorie " +
        "und Qualitätssignal. Erstelle daraus EINEN kompakten, umsetzbaren " +
        "Insights-Report auf Deutsch (Markdown) für das Produkt-/Beratungsteam.\n\n" +
        "Gliederung (mit Markdown-Überschriften):\n" +
        "1. **Top-Themen & Fragen** — worüber Kund:innen am häufigsten sprechen.\n" +
        "2. **Wo Beratungen stocken oder scheitern** — wiederkehrende Abbrüche, " +
        "Missverständnisse, offene Enden.\n" +
        "3. **Häufige unerfüllte Bedürfnisse** — was Kund:innen wollten, aber nicht " +
        "bekamen.\n" +
        "4. **Vorschläge zur Verfeinerung (für einen Menschen)** — konkrete, " +
        "umsetzbare Hinweise, z. B. 'X im Prompt/Verhalten von Mo verfeinern'. " +
        "Formuliere sie als EMPFEHLUNGEN, nicht als automatische Änderungen.\n\n" +
        "Sei faktenbasiert, knapp und priorisiere nach Häufigkeit/Wirkung. Erfinde " +
        "nichts, was nicht aus den Zusammenfassungen hervorgeht.",
      prompt:
        `Zeitraum: ${from} bis ${to}\n` +
        `Anzahl analysierter Gespräche: ${analyses.length}\n\n` +
        `## Zusammenfassungen (verdichtet, mit [Kategorie · Qualität])\n\n` +
        `${buildRollupPrompt(analyses)}\n\n` +
        "Erstelle jetzt den Insights-Report.",
    });

    const body = text.trim() || "_Keine klaren Muster erkennbar._";
    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;

    await recordAiUsage({
      callSite: "conversation_insights",
      model: INSIGHTS_MODEL,
      inputTokens,
      outputTokens,
    });

    const summaryMd = body + BOUNDARY_NOTE;
    const saved = await saveInsights({
      from,
      to,
      summaryMd,
      analyzedCount: analyses.length,
      model: INSIGHTS_MODEL,
      inputTokens,
      outputTokens,
    });

    // Re-read the freshly-saved row so the displayed cost is priced by the SAME
    // JS pricing path as a later cache read (one source of truth). Fall back to a
    // zero-cost shape if the save/read failed (the report text is still returned).
    const stored = saved ? await getCachedInsights(from, to) : null;
    if (stored) return { ...stored, cached: false, generatedAt: nowIso() };

    return {
      from,
      to,
      summaryMd,
      analyzedCount: analyses.length,
      model: INSIGHTS_MODEL,
      costEur: 0,
      generatedAt: nowIso(),
      cached: false,
    };
  } catch (err) {
    reportError(err, { route: "lib/conversation-insights", phase: "generate" });
    return {
      from,
      to,
      summaryMd: "_Insights-Report fehlgeschlagen — bitte später erneut versuchen._",
      analyzedCount: analyses.length,
      model: INSIGHTS_MODEL,
      costEur: 0,
      generatedAt: nowIso(),
      cached: false,
    };
  }
}
