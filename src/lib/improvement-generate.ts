// The improvement engine ("Verbesserung" tab) — the server-only stepper that
// drives one improvement run from 'running' to 'complete', ONE bounded model
// call per /step request (the same shape as the Komplettanalyse stepper, so no
// request approaches maxDuration).
//
// A run reads three things and produces two:
//   reads  — a COMPLETED Komplettanalyse (its stored `sections`),
//            Mo's current self-snapshot (lib/mo-self-snapshot.ts) and
//            the prior suggestions + the measured KPI movement since the last
//            run (lib/improvement-core.mjs baseline/delta maths);
//   writes — an honest "Wirkungs-Check" of previously accepted/implemented
//            measures, and up to MAX_SUGGESTIONS_PER_RUN new, evidence-based
//            suggestions in two lanes (Online-Shop / Mo selbst).
//
// Human-in-the-loop boundary (docs/IMPROVEMENT_LOOP.md): the engine only ever
// PROPOSES. Nothing here mutates Mo's prompt, the directives, the catalog or
// any store content — adoption is an explicit admin action on the suggestion.

import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { recordAiUsage } from "./ai-usage-store";
import { reportError } from "./observability";
import { getAnalyticsReport } from "./analytics-report-store";
import { buildMoSelfSnapshot } from "./mo-self-snapshot";
import {
  createImprovementRun,
  getImprovementRun,
  updateImprovementRun,
  insertSuggestions,
  listPriorSuggestions,
  listMeasuresForEffectCheck,
  getPreviousCompletedRun,
  type ImprovementRunDetail,
} from "./improvement-store";
import { mergeUsage } from "./analytics-report-core.mjs";
import {
  EFFECT_MODEL,
  SUGGEST_MODEL,
  SHOP_CATEGORIES,
  MO_CATEGORIES,
  MAX_SUGGESTIONS_PER_RUN,
  MAX_DIRECTIVE_CHARS,
  computeKpiBaseline,
  computeBaselineDelta,
  renderDeltaMd,
  renderReportExtract,
  buildEffectPrompt,
  buildSuggestPrompt,
  parseSuggestionsResponse,
  dedupeSuggestions,
  nextRunPhase,
} from "./improvement-core.mjs";

export interface StartRunResult {
  ok: boolean;
  runId?: number;
  error?: "not_found" | "not_complete" | "db_error";
}

/**
 * Create a run over a COMPLETED report and decide its first phase. No model
 * call happens here — the client drives /step until done.
 */
export async function startImprovementRun(reportId: number): Promise<StartRunResult> {
  const report = await getAnalyticsReport(reportId);
  if (!report) return { ok: false, error: "not_found" };
  if (report.status !== "complete" || !report.sections) {
    return { ok: false, error: "not_complete" };
  }

  const [snapshot, previous, measures] = await Promise.all([
    buildMoSelfSnapshot(),
    getPreviousCompletedRun(),
    listMeasuresForEffectCheck(0),
  ]);

  const baseline = computeKpiBaseline(report.sections);
  const delta = previous ? computeBaselineDelta(previous.baseline, baseline) : null;
  // The Wirkungs-Check needs BOTH a measured movement and measures to assess;
  // otherwise the run starts straight at the suggestions pass.
  const phase = delta && measures.length > 0 ? "wirkung" : "vorschlaege";

  const runId = await createImprovementRun({
    reportId,
    reportTitle: report.title,
    rangeFrom: report.from,
    rangeTo: report.to,
    promptHash: snapshot.hash,
    baseline,
    delta: delta as unknown as Record<string, unknown> | null,
    phase,
  });
  if (runId == null) return { ok: false, error: "db_error" };
  return { ok: true, runId };
}

export interface RunStepResult {
  ok: boolean;
  status?: string;
  phase?: string;
  costEur?: number;
  done: boolean;
  error?: string;
}

/** Advance the run by one bounded model call. Never throws. */
export async function stepImprovementRun(id: number): Promise<RunStepResult> {
  const run = await getImprovementRun(id);
  if (!run) return { ok: false, done: true, error: "not_found" };
  if (run.status !== "running") {
    return { ok: true, status: run.status, phase: run.phase, costEur: run.costEur, done: true };
  }

  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("Anthropic-Key nicht konfiguriert.");
    }
    if (run.phase === "wirkung") {
      await stepEffectCheck(run);
    } else {
      await stepSuggestions(run);
    }
  } catch (err) {
    reportError(err, { route: "lib/improvement-generate", phase: run.phase });
    const message = err instanceof Error ? err.message : String(err);
    await updateImprovementRun(id, { status: "failed", error: message.slice(0, 500) });
    return { ok: true, status: "failed", phase: run.phase, done: true, error: message };
  }

  const after = await getImprovementRun(id);
  if (!after) return { ok: false, done: true, error: "not_found" };
  return {
    ok: true,
    status: after.status,
    phase: after.phase,
    costEur: after.costEur,
    done: after.status !== "running",
  };
}

async function loadReportExtract(run: ImprovementRunDetail): Promise<string> {
  if (run.reportId != null) {
    const report = await getAnalyticsReport(run.reportId);
    if (report?.sections) return renderReportExtract(report.sections);
  }
  return "_(Der zugrunde liegende Bericht ist nicht mehr vorhanden.)_";
}

// ── Phase: Wirkungs-Check ─────────────────────────────────────────────────────

async function stepEffectCheck(run: ImprovementRunDetail): Promise<void> {
  const [measures, reportExtract] = await Promise.all([
    listMeasuresForEffectCheck(run.id),
    loadReportExtract(run),
  ]);
  const deltaMd = renderDeltaMd(run.delta);

  const { text, usage } = await generateText({
    model: anthropic(EFFECT_MODEL),
    maxOutputTokens: 900,
    system:
      "Du bist der Verbesserungs-Analyst von motion sports (Fitness- und Kraftsportgeräte, " +
      "Online-Shop mit KI-Berater 'Mo'). Deine Aufgabe: ehrlich prüfen, ob die zuletzt " +
      "beschlossenen Verbesserungsmaßnahmen WIRKEN. Du erhältst die gemessene Veränderung " +
      "der Kennzahlen zwischen zwei Analysezeiträumen und die Liste der Maßnahmen.\n\n" +
      "Schreibe einen kompakten „Wirkungs-Check“ auf Deutsch (Markdown, keine Einleitung, " +
      "max. ~300 Wörter): je Maßnahme (oder sinnvoll gruppiert) eine ehrliche Einschätzung — " +
      "**wirkt**, **wirkt bisher nicht** oder **nicht messbar** — mit Bezug auf die konkrete " +
      "Kennzahl.\n\n" +
      "Ehrlichkeits-Regeln (KRITISCH):\n" +
      "- Behaupte NIE Kausalität — eine Bewegung „passt zur Maßnahme“, mehr nicht.\n" +
      "- Kleine Stichproben und kurze Zeiträume ausdrücklich einordnen.\n" +
      "- Eine Maßnahme ohne passende Kennzahl ist „nicht messbar“ — nichts erfinden.",
    prompt: buildEffectPrompt({ deltaMd, priorSuggestions: measures, reportExtract }),
  });

  await recordAiUsage({
    callSite: "improvement",
    model: EFFECT_MODEL,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
  });

  await updateImprovementRun(run.id, {
    phase: nextRunPhase("wirkung"),
    effectCheckMd: text.trim() || null,
    usage: mergeUsage(run.usage, EFFECT_MODEL, usage?.inputTokens ?? 0, usage?.outputTokens ?? 0),
  });
}

// ── Phase: Vorschläge ─────────────────────────────────────────────────────────

function suggestionSystemPrompt(): string {
  const shopCats = Object.entries(SHOP_CATEGORIES)
    .map(([k, v]) => `\`${k}\` (${v})`)
    .join(", ");
  const moCats = Object.entries(MO_CATEGORIES)
    .map(([k, v]) => `\`${k}\` (${v})`)
    .join(", ");
  return (
    "Du bist der Verbesserungs-Analyst von motion sports (Fitness- und Kraftsportgeräte). " +
    "Der Shop setzt den KI-Berater 'Mo' ein. Du erhältst: (1) den verdichteten Analysebericht " +
    "eines Zeitraums, (2) Mos AKTUELLE Konfiguration (System-Prompt, Tools, Personas, Wissen, " +
    "Team-Anweisungen) — sein „Selbstbild“, (3) die bisherigen Vorschläge mit Status und ggf. " +
    "(4) die Kennzahlen-Veränderung samt Wirkungs-Check.\n\n" +
    "Erarbeite daraus die WENIGEN besten Verbesserungsvorschläge in zwei Bahnen:\n" +
    "- `shop` — der Online-Shop selbst. Kategorien: " + shopCats + ".\n" +
    "- `mo` — Mo selbst (sein Prompt, Wissen, Verhalten, Tools). Kategorien: " + moCats + ".\n\n" +
    "Qualitäts-Regeln (KRITISCH):\n" +
    "- NUR was die Daten belegen. Jeder Vorschlag zitiert seine Evidenz (Kennzahl, Kategorie, " +
    "Persona-Befund) — nichts erfinden, keine Allgemeinplätze („mehr Marketing machen“).\n" +
    "- KEINE Wiederholungen: Vorschläge, die inhaltlich schon in der Liste der bisherigen " +
    "Vorschläge stehen (egal mit welchem Status, auch verworfene), NICHT erneut bringen.\n" +
    "- Konkret und umsetzbar: `proposal` beschreibt die Änderung so genau, dass ein Mensch sie " +
    "direkt umsetzen kann.\n" +
    "- Für `mo`-Vorschläge der Kategorie `anweisung`: liefere in `directive` den fertigen " +
    "deutschen Anweisungstext (max. " + MAX_DIRECTIVE_CHARS + " Zeichen), so wie er 1:1 in Mos " +
    "System-Prompt übernommen werden kann — als Verhaltensregel formuliert, an Mo gerichtet " +
    "(„Wenn …, dann …“). Eine directive darf NIE rechtliche Zusagen, Medizin-Beratung, " +
    "Preisnachlässe oder Versprechen enthalten, die der Shop nicht hält. Für alle anderen " +
    "Kategorien: `directive` = null.\n" +
    "- Für Kategorie `prompt_kern`: beschreibe die Änderung als konkreten Textvorschlag für den " +
    "Kern-Prompt (der per Code/Git geändert wird) — welcher Abschnitt, welcher neue Wortlaut.\n" +
    "- `expected_effect`: welche Kennzahl sich messbar bewegen soll (die Grundlage des " +
    "nächsten Wirkungs-Checks).\n" +
    "- Priorisiere: wenige Vorschläge mit hoher Wirkung schlagen viele kleine. Maximal " +
    MAX_SUGGESTIONS_PER_RUN + ".\n\n" +
    "WICHTIG: Du schlägst nur VOR. Nichts wird automatisch geändert — ein Mensch prüft und " +
    "entscheidet jede Maßnahme.\n\n" +
    "Antworte AUSSCHLIESSLICH mit EINEM JSON-Objekt (keine Code-Fences, kein Text davor/danach):\n" +
    "{\n" +
    '  "vorschlaege": [\n' +
    "    {\n" +
    '      "lane": "shop" | "mo",\n' +
    '      "category": "<Kategorie-Schlüssel der Bahn>",\n' +
    '      "title": "<prägnanter deutscher Titel>",\n' +
    '      "rationale": "<WARUM — mit Evidenz aus dem Bericht, Markdown>",\n' +
    '      "proposal": "<WAS genau ändern — konkret umsetzbar, Markdown>",\n' +
    '      "directive": "<fertiger Anweisungstext>" | null,\n' +
    '      "expected_effect": "<welche Kennzahl sich wie bewegen soll>",\n' +
    '      "impact": "hoch" | "mittel" | "niedrig",\n' +
    '      "effort": "hoch" | "mittel" | "niedrig",\n' +
    '      "evidence": ["<kurzer Beleg>", …]\n' +
    "    }\n" +
    "  ]\n" +
    "}"
  );
}

async function stepSuggestions(run: ImprovementRunDetail): Promise<void> {
  const [snapshot, prior, reportMd] = await Promise.all([
    buildMoSelfSnapshot(),
    listPriorSuggestions(),
    loadReportExtract(run),
  ]);

  const { text, usage } = await generateText({
    model: anthropic(SUGGEST_MODEL),
    maxOutputTokens: 4000,
    system: suggestionSystemPrompt(),
    prompt: buildSuggestPrompt({
      reportTitle: run.reportTitle,
      rangeFrom: run.rangeFrom,
      rangeTo: run.rangeTo,
      reportMd,
      selfSnapshot: snapshot.text,
      priorSuggestions: prior,
      deltaMd: run.delta ? renderDeltaMd(run.delta) : null,
      effectCheckMd: run.effectCheckMd,
    }),
  });

  await recordAiUsage({
    callSite: "improvement",
    model: SUGGEST_MODEL,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
  });

  const mergedUsage = mergeUsage(
    run.usage,
    SUGGEST_MODEL,
    usage?.inputTokens ?? 0,
    usage?.outputTokens ?? 0
  );

  const parsed = parseSuggestionsResponse(text);
  if (!parsed.ok) {
    await updateImprovementRun(run.id, {
      status: "failed",
      error: `Vorschläge nicht lesbar (${parsed.reason}).`,
      usage: mergedUsage,
    });
    return;
  }

  // Hard dedup against every non-dismissed prior suggestion — the prompt also
  // forbids repeats, this is the guard. A dismissed idea MAY return (the model
  // was told not to, but if it insists with new evidence the operator decides).
  const priorActiveFps = prior.filter((p) => p.status !== "dismissed").map((p) => p.fingerprint);
  const fresh = dedupeSuggestions(parsed.suggestions, priorActiveFps);

  await insertSuggestions(run.id, fresh);
  await updateImprovementRun(run.id, {
    status: "complete",
    phase: "done",
    usage: mergedUsage,
    completed: true,
  });
}
