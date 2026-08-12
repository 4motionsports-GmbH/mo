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

import { generateText, generateObject, NoObjectGeneratedError } from "ai";
import { z } from "zod";
import { anthropic } from "@ai-sdk/anthropic";
import { recordAiUsage } from "./ai-usage-store";
import { reportError } from "./observability";
import { getAnalyticsReport } from "./analytics-report-store";
import { buildMoSelfSnapshot } from "./mo-self-snapshot";
import {
  createImprovementRun,
  getImprovementRun,
  updateImprovementRun,
  claimRunStep,
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
  MAX_SUGGESTIONS_PER_LANE,
  MAX_DIRECTIVE_CHARS,
  computeKpiBaseline,
  computeBaselineDelta,
  renderDeltaMd,
  renderReportExtract,
  buildEffectPrompt,
  buildSuggestPrompt,
  normalizeSuggestionsPayload,
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
  // otherwise the run starts straight at the first suggestions pass.
  const phase = delta && measures.length > 0 ? "wirkung" : "vorschlaege_shop";

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
  /** True when another /step is already live on this run — poll, don't work. */
  busy?: boolean;
  error?: string;
}

/** Advance the run by one bounded model call. Never throws. */
export async function stepImprovementRun(id: number): Promise<RunStepResult> {
  const run = await getImprovementRun(id);
  if (!run) return { ok: false, done: true, error: "not_found" };
  if (run.status !== "running") {
    return { ok: true, status: run.status, phase: run.phase, costEur: run.costEur, done: true };
  }

  // Retry-safety (migration 0045): a client whose request was aborted locally
  // (e.g. Chrome net::ERR_NETWORK_CHANGED) retries — while the original
  // function may still be mid-model-call. The atomic claim makes the retry a
  // cheap "busy" poll instead of a duplicate model call.
  // 'error' (e.g. migration 0045 not applied yet, transient DB failure) falls
  // through fail-open — that is exactly the pre-claim behavior, so the loop
  // can never get stuck on an unclaimable run.
  const claim = await claimRunStep(id);
  if (claim === "busy") {
    return { ok: true, status: run.status, phase: run.phase, costEur: run.costEur, done: false, busy: true };
  }

  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("Anthropic-Key nicht konfiguriert.");
    }
    if (run.phase === "wirkung") {
      await stepEffectCheck(run);
    } else if (run.phase === "vorschlaege_mo") {
      await stepSuggestLane(run, "mo");
    } else {
      // Covers "vorschlaege_shop" AND the legacy single-pass phase value
      // "vorschlaege" (runs created before the per-lane split — they resume
      // here and continue through the mo pass).
      await stepSuggestLane(run, "shop");
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

// ── Phases: Vorschläge (one SHORT pass per lane) ─────────────────────────────
// Split deliberately: one monolithic pass over both lanes produced a single
// long model call that outlived the serverless function budget in production
// (the function was killed mid-call and the browser saw a dropped connection).
// Per lane the output is roughly halved and the shop pass also skips the big
// self-snapshot input, so each step finishes comfortably inside maxDuration.

const COMMON_RULES =
  "Qualitäts-Regeln (KRITISCH):\n" +
  "- NUR was die Daten belegen. Jeder Vorschlag zitiert seine Evidenz (Kennzahl, Kategorie, " +
  "Persona-Befund) — nichts erfinden, keine Allgemeinplätze („mehr Marketing machen“).\n" +
  "- KEINE Wiederholungen: Vorschläge, die inhaltlich schon in der Liste der bisherigen " +
  "Vorschläge stehen (egal mit welchem Status, auch verworfene), NICHT erneut bringen.\n" +
  "- Konkret und umsetzbar: `proposal` beschreibt die Änderung so genau, dass ein Mensch sie " +
  "direkt umsetzen kann.\n" +
  "- Kompakt: `rationale` unter ~600 Zeichen, `proposal` unter ~800 Zeichen — dicht statt " +
  "ausschweifend.\n" +
  "- `expected_effect`: welche Kennzahl sich messbar bewegen soll (die Grundlage des " +
  "nächsten Wirkungs-Checks).\n" +
  "- Priorisiere: wenige Vorschläge mit hoher Wirkung schlagen viele kleine. Maximal " +
  MAX_SUGGESTIONS_PER_LANE + ".\n\n" +
  "WICHTIG: Du schlägst nur VOR. Nichts wird automatisch geändert — ein Mensch prüft und " +
  "entscheidet jede Maßnahme.";

// Output schema for the structured suggestion passes (generateObject, like the
// marketing/campaign drafts). Anthropic fills a forced tool call whose input
// matches this schema — valid JSON by construction; the free-text-JSON path
// broke in production (literal newlines in strings / truncation →
// "invalid_json"). Only the essential fields are strict; everything else is
// tolerated loose and hardened by normalizeSuggestionsPayload afterwards.
const laneOutputSchema = z.object({
  vorschlaege: z
    .array(
      z.object({
        lane: z.enum(["shop", "mo"]).describe("Bahn dieses Vorschlags"),
        category: z.string().describe("Kategorie-Schlüssel der Bahn"),
        title: z.string().describe("Prägnanter deutscher Titel"),
        rationale: z
          .string()
          .describe("WARUM — mit Evidenz aus dem Bericht (Markdown, unter ~600 Zeichen)"),
        proposal: z
          .string()
          .describe("WAS genau ändern — konkret umsetzbar (Markdown, unter ~800 Zeichen)"),
        directive: z
          .string()
          .nullable()
          .describe("Nur Bahn 'mo', Kategorie 'anweisung': fertiger Anweisungstext; sonst null"),
        expected_effect: z
          .string()
          .nullable()
          .describe("Welche Kennzahl sich wie messbar bewegen soll"),
        impact: z.enum(["hoch", "mittel", "niedrig"]),
        effort: z.enum(["hoch", "mittel", "niedrig"]),
        evidence: z.array(z.string()).describe("Kurze Belege aus dem Bericht"),
      })
    )
    .describe(`Die besten Vorschläge, maximal ${MAX_SUGGESTIONS_PER_LANE}`),
});

function shopSystemPrompt(): string {
  const cats = Object.entries(SHOP_CATEGORIES)
    .map(([k, v]) => `\`${k}\` (${v})`)
    .join(", ");
  return (
    "Du bist der Verbesserungs-Analyst von motion sports (Fitness- und Kraftsportgeräte, " +
    "Online-Shop mit KI-Berater 'Mo'). Du erhältst den verdichteten Analysebericht eines " +
    "Zeitraums, die bisherigen Vorschläge mit Status und ggf. die Kennzahlen-Veränderung samt " +
    "Wirkungs-Check.\n\n" +
    "Erarbeite daraus die WENIGEN besten Verbesserungsvorschläge für den ONLINE-SHOP selbst " +
    "(lane `shop`). Kategorien: " + cats + ". `directive` ist in dieser Bahn immer null.\n\n" +
    COMMON_RULES
  );
}

function moSystemPrompt(): string {
  const cats = Object.entries(MO_CATEGORIES)
    .map(([k, v]) => `\`${k}\` (${v})`)
    .join(", ");
  return (
    "Du bist der Verbesserungs-Analyst von motion sports (Fitness- und Kraftsportgeräte). " +
    "Der Shop setzt den KI-Berater 'Mo' ein. Du erhältst den verdichteten Analysebericht eines " +
    "Zeitraums, Mos AKTUELLE Konfiguration (System-Prompt, Tools, Personas, Wissen, " +
    "Team-Anweisungen) — sein „Selbstbild“ —, die bisherigen Vorschläge mit Status und ggf. " +
    "die Kennzahlen-Veränderung samt Wirkungs-Check.\n\n" +
    "Erarbeite daraus die WENIGEN besten Verbesserungsvorschläge für MO SELBST (lane `mo` — " +
    "sein Prompt, Wissen, Verhalten, Tools). Kategorien: " + cats + ".\n\n" +
    COMMON_RULES + "\n\n" +
    "Zusatz-Regeln für Mo-Vorschläge:\n" +
    "- Kategorie `anweisung`: liefere in `directive` den fertigen deutschen Anweisungstext " +
    "(max. " + MAX_DIRECTIVE_CHARS + " Zeichen), so wie er 1:1 in Mos System-Prompt übernommen " +
    "werden kann — als Verhaltensregel formuliert, an Mo gerichtet („Wenn …, dann …“). Eine " +
    "directive darf NIE rechtliche Zusagen, Medizin-Beratung, Preisnachlässe oder Versprechen " +
    "enthalten, die der Shop nicht hält. Für alle anderen Kategorien: `directive` = null.\n" +
    "- Kategorie `prompt_kern`: beschreibe die Änderung als konkreten Textvorschlag für den " +
    "Kern-Prompt (der per Code/Git geändert wird) — welcher Abschnitt, welcher neue Wortlaut."
  );
}

async function stepSuggestLane(run: ImprovementRunDetail, lane: "shop" | "mo"): Promise<void> {
  const isMoLane = lane === "mo";
  const [snapshot, prior, reportMd] = await Promise.all([
    isMoLane ? buildMoSelfSnapshot() : Promise.resolve(null),
    listPriorSuggestions(),
    loadReportExtract(run),
  ]);

  const prompt = buildSuggestPrompt({
    reportTitle: run.reportTitle,
    rangeFrom: run.rangeFrom,
    rangeTo: run.rangeTo,
    reportMd,
    selfSnapshot: snapshot?.text ?? null,
    priorSuggestions: prior,
    deltaMd: run.delta ? renderDeltaMd(run.delta) : null,
    effectCheckMd: run.effectCheckMd,
  });

  let object: z.infer<typeof laneOutputSchema>;
  let usage: { inputTokens?: number; outputTokens?: number } | undefined;
  try {
    ({ object, usage } = await generateObject({
      model: anthropic(SUGGEST_MODEL),
      schema: laneOutputSchema,
      maxOutputTokens: 4000,
      system: isMoLane ? moSystemPrompt() : shopSystemPrompt(),
      prompt,
    }));
  } catch (err) {
    // Structured generation failed terminally (schema mismatch after the
    // SDK's own repair attempts, or output truncated at the token cap). Record
    // what was spent, fail the run with a clear German message — the operator
    // deletes and restarts. Anything else (network, 5xx) bubbles to the
    // stepper's catch as before.
    if (NoObjectGeneratedError.isInstance(err)) {
      reportError(err, { route: "lib/improvement-generate", phase: `vorschlaege_${lane}` });
      const u = err.usage;
      await recordAiUsage({
        callSite: "improvement",
        model: SUGGEST_MODEL,
        inputTokens: u?.inputTokens ?? 0,
        outputTokens: u?.outputTokens ?? 0,
      });
      await updateImprovementRun(run.id, {
        status: "failed",
        error: `Vorschläge (${lane}): KI-Antwort nicht lesbar — bitte Lauf löschen und neu starten.`,
        usage: mergeUsage(run.usage, SUGGEST_MODEL, u?.inputTokens ?? 0, u?.outputTokens ?? 0),
      });
      return;
    }
    throw err;
  }

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

  const parsed = normalizeSuggestionsPayload(object, { lane, max: MAX_SUGGESTIONS_PER_LANE });
  if (!parsed.ok) {
    await updateImprovementRun(run.id, {
      status: "failed",
      error: `Vorschläge (${lane}) nicht lesbar (${parsed.reason}).`,
      usage: mergedUsage,
    });
    return;
  }

  // Hard dedup against every non-dismissed prior suggestion AND anything the
  // earlier lane pass of THIS run already inserted — the prompt also forbids
  // repeats, this is the guard. A dismissed idea MAY return (the model was
  // told not to, but if it insists with new evidence the operator decides).
  const existingFps = [
    ...prior.filter((p) => p.status !== "dismissed").map((p) => p.fingerprint),
    ...run.suggestions.map((s) => s.fingerprint),
  ];
  const fresh = dedupeSuggestions(parsed.suggestions, existingFps);
  await insertSuggestions(run.id, fresh);

  if (isMoLane) {
    await updateImprovementRun(run.id, {
      status: "complete",
      phase: "done",
      usage: mergedUsage,
      completed: true,
    });
  } else {
    await updateImprovementRun(run.id, {
      phase: "vorschlaege_mo",
      usage: mergedUsage,
    });
  }
}
