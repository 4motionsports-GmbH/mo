// TOP QUESTIONS per persona — the on-demand, token-costing KPI summarisation.
//
// On request (a button in the admin UI, NEVER on page load) this samples recent
// user messages from one persona group and asks Anthropic to distil the common
// themes/questions into a short German bullet list. The result is cached in
// kpi_persona_question_summaries with a timestamp so the cached version backs
// every subsequent page render until the operator explicitly regenerates it.
//
// Provider: Anthropic via @ai-sdk/anthropic, matching the marketing-draft path.
// Defensive: a missing API key or any model error degrades to a clear message
// (and is cached) so the button always returns something sensible.
//
// Cluster A only: we read pseudonymous user messages and store derived analytics
// text keyed by persona label. No email, no session_id is persisted here.

import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { getSql, type Sql } from "./db";
import { ARCHETYPE_META } from "./persona";
import type { PersonaArchetype } from "./types";
import { reportError } from "./observability";
import { recordAiUsage } from "./ai-usage-store";

// Same model family as the other backend LLM calls — one voice across the app.
const SUMMARY_MODEL = "claude-sonnet-4-5-20250929";

// How many recent user messages to feed the model. Bounded so a single run stays
// cheap (a few cents) and well under the context limit.
const SAMPLE_LIMIT = 80;
// Per-message character cap so one long paste can't dominate the sample.
const MESSAGE_CHAR_CAP = 600;

export interface TopQuestionsSummary {
  personaLabel: string;
  summaryMd: string;
  sampleSize: number;
  model: string | null;
  generatedAt: string;
  /** True when this was served from cache (not freshly generated). */
  cached: boolean;
}

function personaDisplayLabel(label: string): string {
  const meta = ARCHETYPE_META[label as PersonaArchetype];
  return meta ? meta.label : label;
}

function mapRow(r: Record<string, unknown>, cached: boolean): TopQuestionsSummary {
  return {
    personaLabel: String(r.persona_label),
    summaryMd: String(r.summary_md ?? ""),
    sampleSize: Number(r.sample_size ?? 0),
    model: (r.model as string | null) ?? null,
    generatedAt:
      r.generated_at instanceof Date
        ? r.generated_at.toISOString()
        : String(r.generated_at ?? new Date().toISOString()),
    cached,
  };
}

/** Return the cached summary for a persona, or null when none exists / no DB. */
export async function getCachedTopQuestions(
  personaLabel: string,
  sql: Sql | null = getSql()
): Promise<TopQuestionsSummary | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT persona_label, summary_md, sample_size, model, generated_at
        FROM kpi_persona_question_summaries
       WHERE persona_label = ${personaLabel}
    `) as Array<Record<string, unknown>>;
    return rows[0] ? mapRow(rows[0], true) : null;
  } catch (err) {
    reportError(err, { route: "lib/kpi-top-questions", phase: "getCached" });
    return null;
  }
}

/** Load cached summaries for several personas at once (keyed by persona label). */
export async function getCachedTopQuestionsMap(
  sql: Sql | null = getSql()
): Promise<Map<string, TopQuestionsSummary>> {
  const out = new Map<string, TopQuestionsSummary>();
  if (!sql) return out;
  try {
    const rows = (await sql`
      SELECT persona_label, summary_md, sample_size, model, generated_at
        FROM kpi_persona_question_summaries
    `) as Array<Record<string, unknown>>;
    for (const r of rows) {
      const s = mapRow(r, true);
      out.set(s.personaLabel, s);
    }
  } catch (err) {
    reportError(err, { route: "lib/kpi-top-questions", phase: "getCachedMap" });
  }
  return out;
}

async function sampleUserMessages(personaLabel: string, sql: Sql): Promise<string[]> {
  const rows = (await sql`
    SELECT m.content
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
     WHERE COALESCE(c.persona_label, 'unknown') = ${personaLabel}
       AND m.role = 'user'
       AND m.tool_name IS NULL
       AND m.content IS NOT NULL
       AND length(btrim(m.content)) > 0
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT ${SAMPLE_LIMIT}
  `) as Array<{ content: string }>;
  return rows.map((r) => String(r.content).trim().slice(0, MESSAGE_CHAR_CAP));
}

async function upsertSummary(
  summary: TopQuestionsSummary,
  sql: Sql
): Promise<void> {
  await sql`
    INSERT INTO kpi_persona_question_summaries
      (persona_label, summary_md, sample_size, model, generated_at)
    VALUES
      (${summary.personaLabel}, ${summary.summaryMd}, ${summary.sampleSize},
       ${summary.model}, now())
    ON CONFLICT (persona_label) DO UPDATE SET
      summary_md = EXCLUDED.summary_md,
      sample_size = EXCLUDED.sample_size,
      model = EXCLUDED.model,
      generated_at = now()
  `;
}

/**
 * Generate (and cache) the top-questions summary for a persona group. Runs the
 * Anthropic pass over a fresh sample of user messages. Never throws — on any
 * failure it caches and returns a clear German message so the UI stays sane.
 */
export async function generateTopQuestions(
  personaLabel: string,
  sql: Sql | null = getSql()
): Promise<TopQuestionsSummary | null> {
  if (!sql) return null;

  let sample: string[] = [];
  try {
    sample = await sampleUserMessages(personaLabel, sql);
  } catch (err) {
    reportError(err, { route: "lib/kpi-top-questions", phase: "sample" });
    return null;
  }

  const display = personaDisplayLabel(personaLabel);

  if (sample.length === 0) {
    const summary: TopQuestionsSummary = {
      personaLabel,
      summaryMd: "_Noch keine Nutzernachrichten für diese Persona-Gruppe._",
      sampleSize: 0,
      model: null,
      generatedAt: new Date().toISOString(),
      cached: false,
    };
    try {
      await upsertSummary(summary, sql);
    } catch (err) {
      reportError(err, { route: "lib/kpi-top-questions", phase: "upsertEmpty" });
    }
    return summary;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      personaLabel,
      summaryMd:
        "_Anthropic API-Key nicht konfiguriert — die Themen-Zusammenfassung kann nicht erstellt werden._",
      sampleSize: sample.length,
      model: null,
      generatedAt: new Date().toISOString(),
      cached: false,
    };
  }

  let summaryMd: string;
  try {
    const numbered = sample.map((m, i) => `${i + 1}. ${m}`).join("\n");
    const { text, usage } = await generateText({
      model: anthropic(SUMMARY_MODEL),
      system:
        "Du bist Analyst für motion sports (Fitness- und Kraftsportgeräte). Du " +
        "erhältst echte Nutzernachrichten aus dem Beratungs-Chat einer bestimmten " +
        "Kundengruppe (Persona). Fasse die häufigsten Themen, Fragen und Anliegen " +
        "dieser Gruppe sachlich auf Deutsch zusammen. Antworte als kurze " +
        "Stichpunktliste (Markdown, '- '), maximal 8 Punkte, jeweils ein " +
        "prägnanter Satz. Keine Einleitung, kein Fazit, keine erfundenen Inhalte.",
      prompt:
        `Persona-Gruppe: ${display}\n\n` +
        `Nutzernachrichten (Stichprobe, ${sample.length}):\n${numbered}\n\n` +
        "Was sind die häufigsten Themen und Fragen dieser Gruppe?",
    });
    summaryMd = text.trim() || "_Keine klaren Themen erkennbar._";
    // Cost KPI (dashboard/admin side).
    await recordAiUsage({
      callSite: "top_questions",
      model: SUMMARY_MODEL,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    });
  } catch (err) {
    reportError(err, { route: "lib/kpi-top-questions", phase: "generate" });
    return {
      personaLabel,
      summaryMd: "_Zusammenfassung fehlgeschlagen — bitte später erneut versuchen._",
      sampleSize: sample.length,
      model: SUMMARY_MODEL,
      generatedAt: new Date().toISOString(),
      cached: false,
    };
  }

  const summary: TopQuestionsSummary = {
    personaLabel,
    summaryMd,
    sampleSize: sample.length,
    model: SUMMARY_MODEL,
    generatedAt: new Date().toISOString(),
    cached: false,
  };
  try {
    await upsertSummary(summary, sql);
  } catch (err) {
    reportError(err, { route: "lib/kpi-top-questions", phase: "upsert" });
  }
  return summary;
}
