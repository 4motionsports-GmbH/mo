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
import {
  buildRollupPrompt,
  parseInsightsReferences,
  parseInsightsRefsPayload,
} from "./conversation-analysis-core.mjs";

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
      references: [],
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
      references: [],
    };
  }

  try {
    // ── Pass 1: the narrative report ─────────────────────────────────────────
    // References are deliberately NOT part of this call: on large windows the
    // report alone can approach the output ceiling, and anything appended after
    // it (a refs block) is the first thing truncation destroys. Seen in
    // production — the report ran long, got cut mid-sentence, and no refs block
    // was ever emitted. The refs therefore get their own bounded pass below.
    const summariesBlock =
      `Zeitraum: ${from} bis ${to}\n` +
      `Anzahl analysierter Gespräche: ${analyses.length}\n\n` +
      `## Zusammenfassungen (verdichtet, mit [Kategorie · Qualität])\n\n` +
      `${buildRollupPrompt(analyses)}`;

    const { text, usage, finishReason } = await generateText({
      model: anthropic(INSIGHTS_MODEL),
      // Well above the instructed ~700-word length so the report always ends
      // cleanly even when the model overshoots (observed: 400 summaries pushed
      // it past 3000 and it was cut mid-sentence — reported via finishReason).
      maxOutputTokens: 4500,
      system:
        "Du bist Analyst bei motion sports (Fitness- und Kraftsportgeräte). Du " +
        "erhältst KURZ-ZUSAMMENFASSUNGEN vieler Beratungsgespräche (bereits " +
        "verdichtet) zwischen Kunden und dem Chatbot 'Mo', jeweils mit ihrer " +
        "Gesprächs-ID (z. B. [#1234]) sowie Kategorie und Qualitätssignal. " +
        "Erstelle daraus EINEN kompakten, umsetzbaren " +
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
        "Sei faktenbasiert und priorisiere nach Häufigkeit/Wirkung. Erfinde " +
        "nichts, was nicht aus den Zusammenfassungen hervorgeht. Nenne im " +
        "Report-Text KEINE Gesprächs-IDs (keine [#…]-Verweise — die Belege " +
        "werden separat erfasst).\n\n" +
        "WICHTIG — Länge: Der GESAMTE Report muss unter ca. 700 Wörtern bleiben " +
        "und vollständig enden. Lieber die 3–5 wichtigsten Punkte pro Abschnitt " +
        "sauber ausführen als viele anreißen.",
      prompt: `${summariesBlock}\n\nErstelle jetzt den Insights-Report.`,
    });

    if (finishReason === "length") {
      reportError(new Error("insights report truncated at maxOutputTokens"), {
        route: "lib/conversation-insights",
        phase: "report-truncated",
      });
    }

    // Strip any ```json:refs block the model may still have appended (belt and
    // braces — the block must never render); its refs serve as a fallback.
    const validIds = new Set(analyses.map((a) => a.id));
    const { markdown, references: inlineRefs } = parseInsightsReferences(text, validIds);

    // ── Pass 2: references only (JSON out, nothing else) ─────────────────────
    // A dedicated bounded pass cannot be starved by report length. Failure here
    // must never cost the narrative, so it is fenced in its own try/catch.
    let references = inlineRefs;
    let refsInputTokens = 0;
    let refsOutputTokens = 0;
    try {
      const refsRes = await generateText({
        model: anthropic(INSIGHTS_MODEL),
        // Exhaustive listing: up to MAX_REFS_PER_SECTION (40) refs × 4 sections
        // at ~30 tokens each needs real room. Haiku output is cheap and the
        // route budget (maxDuration) is sized for it.
        maxOutputTokens: 8000,
        system:
          "Du bist Analyst bei motion sports. Du erhältst (a) KURZ-" +
          "ZUSAMMENFASSUNGEN von Beratungsgesprächen, jede mit ihrer Gesprächs-ID " +
          "(z. B. [#1234]), und (b) einen fertigen Insights-Report mit vier " +
          "Abschnitten. Deine EINZIGE Aufgabe: Belege liefern — welche Gespräche " +
          "stützen welchen Report-Abschnitt.\n\n" +
          "Antworte AUSSCHLIESSLICH mit diesem JSON (kein Markdown, kein Text " +
          "davor oder danach):\n" +
          '{ "references": [ { "section": "top_themen", "conversationId": 1234, ' +
          '"reason": "Ein kurzer deutscher Satz, warum dieses Gespräch das Muster belegt." } ] }\n\n' +
          "Regeln:\n" +
          "- \"section\" ist GENAU einer dieser Schlüssel: top_themen (Abschnitt 1), " +
          "stockend (Abschnitt 2), beduerfnisse (Abschnitt 3), vorschlaege (Abschnitt 4).\n" +
          "- Sei VOLLSTÄNDIG: Referenziere JEDES Gespräch, dessen Zusammenfassung " +
          "ein Muster des jeweiligen Abschnitts belegt — nicht nur eine Auswahl. " +
          "Die relevantesten zuerst, maximal 40 pro Abschnitt. Ein Gespräch darf " +
          "in mehreren Abschnitten erscheinen, wenn es mehrere Muster belegt.\n" +
          "- Gib für JEDEN der vier Abschnitte Referenzen an, sofern es Belege gibt.\n" +
          "- \"conversationId\" MUSS eine der [#…]-IDs aus den gelieferten " +
          "Zusammenfassungen sein — erfinde NIEMALS IDs.\n" +
          "- \"reason\" ist EIN kurzer deutscher Satz (max. ~15 Wörter), gestützt " +
          "auf die jeweilige Zusammenfassung.",
        prompt:
          `${summariesBlock}\n\n## Insights-Report\n\n${markdown}\n\n` +
          "Gib jetzt NUR das references-JSON aus.",
      });
      if (refsRes.finishReason === "length") {
        reportError(new Error("insights refs pass truncated at maxOutputTokens"), {
          route: "lib/conversation-insights",
          phase: "refs-truncated",
        });
      }
      refsInputTokens = refsRes.usage?.inputTokens ?? 0;
      refsOutputTokens = refsRes.usage?.outputTokens ?? 0;
      const passRefs = parseInsightsRefsPayload(refsRes.text, validIds);
      if (passRefs.length > 0) references = passRefs;
    } catch (refsErr) {
      reportError(refsErr, { route: "lib/conversation-insights", phase: "refs-pass" });
    }

    // References failing is tolerated (the narrative always survives) but must
    // not be silent — surface it so it is debuggable in observability.
    if (references.length === 0) {
      reportError(new Error("insights references empty after both passes"), {
        route: "lib/conversation-insights",
        phase: "parse-refs",
      });
    }

    const body = markdown.trim() || "_Keine klaren Muster erkennbar._";
    const inputTokens = (usage?.inputTokens ?? 0) + refsInputTokens;
    const outputTokens = (usage?.outputTokens ?? 0) + refsOutputTokens;

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
      references,
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
      references,
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
      references: [],
    };
  }
}
