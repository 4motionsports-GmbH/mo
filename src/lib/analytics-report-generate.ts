// "Komplettanalyse" generation orchestrator — the server-only stepper that drives
// one report from 'running' to 'complete' by advancing its phase state-machine
// ONE BOUNDED CHUNK per call. The client (the report page) calls /api/admin/
// analytics/step repeatedly until status != 'running', showing live progress.
// This is the same "process a batch, report what remains, run again" shape the
// bulk conversation analysis uses, so a big interval with hundreds of
// conversations never blocks a single request past maxDuration.
//
// It deliberately RE-USES the app's existing AI passes rather than re-implementing
// them: the per-conversation analysis (conversation-analysis), the aggregate
// insights rollup (conversation-insights — which ALSO writes the shared
// conversation_insights cache, so the Gespräche report panel is filled in by a
// report run), the customer "current understanding" profile (customer-profile),
// and the rollup data-loaders (admin-conversations / conversation-analysis-core).
// The range-scoped persona top-questions and the aggregate customer-knowledge
// synthesis are run here directly so their token usage can be captured into the
// report's own per-model cost (each ALSO records into ai_usage for the global
// cost KPI, like every other backend LLM call).
//
// The decision layer (2026-10-06): `snapshot` collects the business snapshot
// (lib/business-snapshot — pure DB, the KPI getters) and the comparison with
// the previously stored report; `decisions` and `plan` are the two strategist
// passes (Opus 5.5, effort high — lib/strategist-call), one model call per
// step, each bounded by an abort timeout below the route's maxDuration. A pass
// that times out stays in its phase and is retried on the next step with less
// thinking (STRATEGIST_EFFORTS); once the ladder is exhausted the report is
// finished without that part and says so. Every step claims the report first
// (migration 0077) so a retried request never starts a second Opus call.

import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { anthropicOptionsFor, maxOutputTokensFor } from "./ai-models.mjs";
import { recordAiUsage } from "./ai-usage-store";
import { reportError } from "./observability";
import {
  getAnalyticsReport,
  updateAnalyticsReport,
  claimReportStep,
  releaseReportStep,
  getPreviousCompletedReport,
  getReportKpis,
  getRangePersonaInsights,
  getPersonaLabelsInRange,
  getActiveCustomerIdsInRange,
  loadAppendixRows,
  getRangeSpend,
  getReportCustomerBase,
  getReportCampaigns,
  sampleUserMessagesForPersona,
  type AnalyticsReportDetail,
  type ReportProgress,
  type ReportSections,
  type ReportUsage,
  type ReportProfileSection,
  type ReportComparison,
  type ReportDecision,
} from "./analytics-report-store";
import { getBusinessSnapshot, type BusinessSnapshot } from "./business-snapshot";
import { runStrategistObject } from "./strategist-call";
import { callTimeoutWithinStep } from "./object-stream.mjs";
import {
  assembleDecision,
  buildDecisionsPrompt,
  buildPlanPrompt,
  buildReportComparison,
  normalizeDecisions,
  normalizePlan,
  settleInFlightAttempt,
  strategistEffortForAttempt,
  DECISIONS_ANSWER_TOKENS,
  PLAN_ANSWER_TOKENS,
  REPORT_SECTIONS_VERSION,
  STEP_MAX_DURATION_S,
  STRATEGIST_TIMEOUT_MS,
} from "./analytics-report-synthesis-core.mjs";
import { decisionsSchema, planSchema } from "./analytics-report-synthesis-schemas.mjs";
import {
  getAdminConversationDetail,
  saveConversationAnalysis,
  loadUnanalyzedIds,
  countUnanalyzedInRange,
  loadAnalysesForRollup,
  getConversationStats,
} from "./admin-conversations";
import { generateConversationAnalysis, ANALYSIS_MODEL } from "./conversation-analysis";
import { generateConversationInsights } from "./conversation-insights";
import { regenerateCustomerProfile } from "./customer-profile";
import { getCustomerById } from "./customer-store";
import { CATEGORY_LABELS } from "./conversation-analysis-core.mjs";
import {
  mergeUsage,
  nextPhase,
  PERSONA_MODEL,
  SYNTHESIS_MODEL,
  PROFILE_MODEL,
  STRATEGIST_MODEL,
} from "./analytics-report-core.mjs";

// Per-step work budgets — sized so a single /step stays well under maxDuration.
const ANALYZE_BATCH = 12; // cheap Haiku passes
const PERSONA_BATCH = 2; // Sonnet top-questions
const PROFILE_BATCH = 1; // Opus per-customer profile (slow → one per step)

// Bounds on the heavier inputs/outputs so a huge interval stays sane.
const SYNTHESIS_SUMMARIES = 150;
const PERSONA_SAMPLE = 80;
const APPENDIX_HARD_CAP = 800;

interface ReportScratch {
  // Index signature so a ReportScratch is structurally a progress `scratch`
  // (Record<string, unknown>); the named fields keep their precise types.
  [key: string]: unknown;
  notes?: string[];
  insightsMd?: string;
  personaQueue?: string[];
  personaTopQ?: Record<string, string>;
  customerKnowledgeMd?: string;
  customerQueue?: number[];
  profiles?: ReportProfileSection[];
  snapshot?: BusinessSnapshot;
  comparison?: ReportComparison | null;
  decisions?: unknown;
  plan?: unknown;
  strategist?: StrategistScratch;
}

/** How the strategist passes went (attempts walk down the effort ladder). */
interface StrategistScratch {
  decisionsAttempts: number;
  planAttempts: number;
  decisionsEffort: string | null;
  planEffort: string | null;
  notes: string[];
  /**
   * Written before the Opus call, cleared by every write after it. Still set
   * on the next step = that step was killed (settleInFlightAttempt).
   */
  inFlight?: { pass: "decisions" | "plan"; attempt: number; startedAt: string } | null;
}

export interface StepResult {
  ok: boolean;
  status?: string;
  phase?: string;
  progress?: ReportProgress;
  costEur?: number;
  done: boolean;
  /** Another /step is live on this report — poll, don't work. */
  busy?: boolean;
  error?: string;
}

function getScratch(p: ReportProgress): ReportScratch {
  return (p.scratch ?? {}) as ReportScratch;
}

function pushNote(notes: string[] | undefined, msg: string): string[] {
  const arr = Array.isArray(notes) ? [...notes] : [];
  if (!arr.includes(msg)) arr.push(msg);
  return arr;
}

function customerDisplayName(c: {
  email: string;
  shopifyAccountSummary?: { displayName?: string | null; firstName?: string | null } | null;
}): string {
  return (
    c.shopifyAccountSummary?.displayName?.trim() ||
    c.shopifyAccountSummary?.firstName?.trim() ||
    c.email
  );
}

/** The progress counters without the (large) scratch work area — what the client needs. */
function leanProgress(p: ReportProgress): ReportProgress {
  return { ...p, scratch: undefined };
}

/**
 * Advance the report by one bounded chunk. Never throws: a fatal error marks the
 * report 'failed' with a message; per-item failures inside a phase are counted
 * and skipped. Returns the fresh post-step state so the client can keep stepping.
 */
export async function stepReport(id: number): Promise<StepResult> {
  const stepStartedAt = Date.now();
  const report = await getAnalyticsReport(id);
  if (!report) return { ok: false, done: true, error: "not_found" };
  if (report.status !== "running") {
    return {
      ok: true,
      status: report.status,
      phase: report.phase,
      progress: leanProgress(report.progress),
      costEur: report.costEur,
      done: true,
    };
  }

  // Retry-safety (migration 0077): a request the browser dropped is retried
  // while the first function may still be inside a minutes-long Opus call —
  // the claim turns the retry into a cheap "busy" poll. 'error' (migration not
  // applied, DB hiccup) proceeds without a claim, as before.
  const claim = await claimReportStep(id);
  if (claim === "busy") {
    return {
      ok: true,
      status: report.status,
      phase: report.phase,
      progress: leanProgress(report.progress),
      costEur: report.costEur,
      done: false,
      busy: true,
    };
  }

  let busy = false;
  try {
    switch (report.phase) {
      case "analyze":
        await stepAnalyze(report);
        break;
      case "insights":
        await stepInsights(report);
        break;
      case "personas":
        await stepPersonas(report);
        break;
      case "customer_synthesis":
        await stepSynthesis(report);
        break;
      case "customer_profiles":
        await stepProfiles(report);
        break;
      case "snapshot":
        await stepSnapshot(report);
        break;
      case "decisions":
        busy = (await stepStrategist(report, "decisions", stepStartedAt)) === "busy";
        break;
      case "plan":
        busy = (await stepStrategist(report, "plan", stepStartedAt)) === "busy";
        break;
      case "assemble":
        await stepAssemble(report);
        break;
      default:
        await stepAssemble(report);
        break;
    }
  } catch (err) {
    reportError(err, { route: "lib/analytics-report-generate", phase: report.phase });
    const message = err instanceof Error ? err.message : String(err);
    await updateAnalyticsReport(id, { status: "failed", error: message.slice(0, 500) });
    return { ok: true, status: "failed", phase: report.phase, done: true, error: message };
  } finally {
    if (claim === "claimed") await releaseReportStep(id);
  }

  const after = await getAnalyticsReport(id);
  if (!after) return { ok: false, done: true, error: "not_found" };
  return {
    ok: true,
    status: after.status,
    phase: after.phase,
    progress: leanProgress(after.progress),
    costEur: after.costEur,
    done: after.status !== "running",
    ...(busy ? { busy: true } : {}),
  };
}

// ── Phase: analyze every conversation in the interval ─────────────────────────

async function stepAnalyze(report: AnalyticsReportDetail): Promise<void> {
  const { from, to, options } = report;
  const progress = report.progress;
  const scratch = getScratch(progress);

  const budgetLeft = options.maxAnalyze - progress.analyzed;
  const advance = async (extraNote?: string) => {
    const remaining = await countUnanalyzedInRange(from, to);
    const notes = extraNote ? pushNote(scratch.notes, extraNote) : scratch.notes;
    await updateAnalyticsReport(report.id, {
      phase: nextPhase("analyze", options),
      progress: { ...progress, analyzeRemaining: remaining, scratch: { ...scratch, notes } },
    });
  };

  if (budgetLeft <= 0) {
    const remaining = await countUnanalyzedInRange(from, to);
    await advance(
      remaining > 0
        ? `Analyse auf ${options.maxAnalyze} Gespräche begrenzt — ${remaining} nicht analysiert.`
        : undefined
    );
    return;
  }

  const ids = await loadUnanalyzedIds(from, to, Math.min(ANALYZE_BATCH, budgetLeft));
  if (ids.length === 0) {
    await advance();
    return;
  }

  let usage: ReportUsage = report.usage;
  let analyzed = progress.analyzed;
  let failed = progress.analyzeFailed;
  let unconfigured = false;

  for (const cid of ids) {
    const detail = await getAdminConversationDetail(cid);
    if (!detail || detail.transcript.length === 0) continue;
    const res = await generateConversationAnalysis({ conversationId: cid, transcript: detail.transcript });
    if (res.ok) {
      await saveConversationAnalysis(cid, res.analysis, ANALYSIS_MODEL, res.usage);
      usage = mergeUsage(usage, ANALYSIS_MODEL, res.usage.inputTokens, res.usage.outputTokens);
      analyzed += 1;
    } else {
      failed += 1;
      if (res.reason === "unconfigured") {
        unconfigured = true;
        break;
      }
    }
  }

  const remaining = await countUnanalyzedInRange(from, to);
  const budgetExhausted = analyzed >= options.maxAnalyze;
  const baseProgress = { ...progress, analyzed, analyzeFailed: failed, analyzeRemaining: remaining };

  if (unconfigured || remaining === 0 || budgetExhausted) {
    let notes = scratch.notes;
    if (unconfigured) notes = pushNote(notes, "Anthropic-Key fehlt — Gesprächsanalyse übersprungen.");
    else if (budgetExhausted && remaining > 0)
      notes = pushNote(notes, `Analyse auf ${options.maxAnalyze} Gespräche begrenzt — ${remaining} nicht analysiert.`);
    await updateAnalyticsReport(report.id, {
      phase: nextPhase("analyze", options),
      progress: { ...baseProgress, scratch: { ...scratch, notes } },
      usage,
    });
  } else {
    await updateAnalyticsReport(report.id, {
      phase: "analyze",
      progress: { ...baseProgress, scratch },
      usage,
    });
  }
}

// ── Phase: aggregate insights rollup over the cached summaries ─────────────────

async function stepInsights(report: AnalyticsReportDetail): Promise<void> {
  const { from, to, options } = report;
  const progress = report.progress;
  const scratch = getScratch(progress);

  // Delegate to the Gespräche insights rollup instead of a private inline pass:
  // one generation produces one shared artifact — it lands in the report AND in
  // the conversation_insights cache (with the curated "Belege"), so the
  // inspector's report panel for this window is already filled in afterwards.
  // The rollup handles the empty/unconfigured/error cases itself (clear German
  // notices, never throws) and records its ai_usage; the token counts it returns
  // are folded into this report's own per-model cost.
  const rollup = await generateConversationInsights(from, to);
  const usage = mergeUsage(
    report.usage,
    rollup.model,
    rollup.inputTokens,
    rollup.outputTokens
  );

  await updateAnalyticsReport(report.id, {
    phase: nextPhase("insights", options),
    progress: { ...progress, scratch: { ...scratch, insightsMd: rollup.summaryMd } },
    usage,
  });
}

// ── Phase: range-scoped top-questions per persona ─────────────────────────────

async function stepPersonas(report: AnalyticsReportDetail): Promise<void> {
  const { from, to, options } = report;
  const progress = report.progress;
  const scratch = getScratch(progress);
  let usage: ReportUsage = report.usage;

  // Initialise the queue on first entry.
  if (!Array.isArray(scratch.personaQueue)) {
    const labels = await getPersonaLabelsInRange(from, to);
    scratch.personaQueue = labels;
    scratch.personaTopQ = {};
    progress.personasTotal = labels.length;
  }

  const queue = scratch.personaQueue ?? [];
  if (queue.length === 0) {
    await updateAnalyticsReport(report.id, {
      phase: nextPhase("personas", options),
      progress: { ...progress, scratch },
    });
    return;
  }

  const batch = queue.splice(0, PERSONA_BATCH);
  const topQ = scratch.personaTopQ ?? {};
  let done = progress.personasDone;

  for (const label of batch) {
    const samples = await sampleUserMessagesForPersona(label, from, to, PERSONA_SAMPLE);
    if (samples.length === 0) {
      topQ[label] = "_Keine Nutzernachrichten in dieser Persona-Gruppe._";
      done += 1;
      continue;
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      topQ[label] = "_Anthropic-Key fehlt — Top-Fragen nicht möglich._";
      done += 1;
      continue;
    }
    try {
      const numbered = samples.map((m, i) => `${i + 1}. ${m}`).join("\n");
      const { text, usage: u } = await generateText({
        model: anthropic(PERSONA_MODEL),
        providerOptions: anthropicOptionsFor("writer"),
        maxOutputTokens: maxOutputTokensFor("writer", 500),
        system:
          "Du bist Analyst für motion sports (Fitness- und Kraftsportgeräte). Du erhältst echte " +
          "Nutzernachrichten aus dem Beratungs-Chat einer bestimmten Kundengruppe (Persona). Fasse " +
          "die häufigsten Themen, Fragen und Anliegen dieser Gruppe sachlich auf Deutsch zusammen. " +
          "Antworte als kurze Stichpunktliste (Markdown, '- '), maximal 8 Punkte, jeweils ein " +
          "prägnanter Satz. Keine Einleitung, kein Fazit, keine erfundenen Inhalte.",
        prompt:
          `Nutzernachrichten (Stichprobe, ${samples.length}):\n${numbered}\n\n` +
          "Was sind die häufigsten Themen und Fragen dieser Gruppe?",
      });
      topQ[label] = text.trim() || "_Keine klaren Themen erkennbar._";
      await recordAiUsage({
        callSite: "top_questions",
        model: PERSONA_MODEL,
        inputTokens: u?.inputTokens ?? 0,
        outputTokens: u?.outputTokens ?? 0,
      });
      usage = mergeUsage(usage, PERSONA_MODEL, u?.inputTokens ?? 0, u?.outputTokens ?? 0);
    } catch (err) {
      reportError(err, { route: "lib/analytics-report-generate", phase: "personas" });
      topQ[label] = "_Top-Fragen fehlgeschlagen._";
    }
    done += 1;
  }

  const remaining = queue.length;
  await updateAnalyticsReport(report.id, {
    phase: remaining === 0 ? nextPhase("personas", options) : "personas",
    progress: {
      ...progress,
      personasDone: done,
      scratch: { ...scratch, personaQueue: queue, personaTopQ: topQ },
    },
    usage,
  });
}

// ── Phase: aggregate, pseudonymous customer-knowledge synthesis ───────────────

async function stepSynthesis(report: AnalyticsReportDetail): Promise<void> {
  const { from, to, options } = report;
  const progress = report.progress;
  const scratch = getScratch(progress);
  let usage: ReportUsage = report.usage;

  const [personas, summaries, stats] = await Promise.all([
    getRangePersonaInsights(from, to, 5),
    loadAnalysesForRollup(from, to, SYNTHESIS_SUMMARIES),
    getConversationStats(from, to),
  ]);

  let md: string;
  if (summaries.length === 0) {
    md = "_Keine analysierten Gespräche im Zeitraum — keine Kundensynthese möglich._";
  } else if (!process.env.ANTHROPIC_API_KEY) {
    md = "_Anthropic-Key nicht konfiguriert — Kundensynthese nicht möglich._";
  } else {
    const personaBlock = personas
      .map(
        (p) =>
          `- ${p.personaDisplay}: ${p.chatCount} Gespräch(e)` +
          (p.favoriteProducts.length
            ? ` · häufig empfohlen: ${p.favoriteProducts.map((f) => f.name).join(", ")}`
            : "")
      )
      .join("\n");
    const categoryBlock = stats.categories.map((c) => `- ${c.label}: ${c.count}`).join("\n");
    const summaryBlock = summaries
      .map((s, i) => {
        const cat = s.category ? (CATEGORY_LABELS as Record<string, string>)[s.category] ?? s.category : "?";
        return `${i + 1}. [${cat}] ${s.summary.trim()}`;
      })
      .join("\n");

    const { text, usage: u } = await generateText({
      model: anthropic(SYNTHESIS_MODEL),
      providerOptions: anthropicOptionsFor("analyst"),
      maxOutputTokens: maxOutputTokensFor("analyst", 1200),
      system:
        "Du bist Analyst bei motion sports (Fitness- und Kraftsportgeräte). Aus den verdichteten " +
        "Beratungsdaten EINES Zeitraums (Persona-Verteilung, Kategorien, Gesprächs-Zusammenfassungen) " +
        "erstellst du ein aggregiertes KUNDENWISSEN auf Deutsch (Markdown) für Produkt-, Marketing- und " +
        "Beratungsteam. Es ist PSEUDONYM — keine einzelnen Personen, nur Muster über Gruppen.\n\n" +
        "Gliederung (Markdown-Überschriften):\n" +
        "1. **Wer kauft/fragt** — dominierende Segmente & Personas im Zeitraum.\n" +
        "2. **Bedürfnisse & Kaufmotive** — was Kund:innen wollen, welche Produkte/Themen ziehen.\n" +
        "3. **Einwände & Reibung** — Preis, Größe, Technik, Lieferzeit usw.\n" +
        "4. **Chancen** — konkrete Empfehlungen für Sortiment, Bündel, Ansprache.\n\n" +
        "Faktenbasiert, knapp, priorisiert. Erfinde nichts, was nicht aus den Daten hervorgeht.",
      prompt:
        `Zeitraum: ${from} bis ${to}\n\n## Persona-Verteilung\n${personaBlock || "(keine)"}\n\n` +
        `## Kategorien\n${categoryBlock || "(keine)"}\n\n` +
        `## Gesprächs-Zusammenfassungen (Stichprobe ${summaries.length})\n${summaryBlock}\n\n` +
        "Erstelle jetzt das aggregierte Kundenwissen.",
    });
    md = text.trim() || "_Keine klaren Muster erkennbar._";
    await recordAiUsage({
      callSite: "analytics_report",
      model: SYNTHESIS_MODEL,
      inputTokens: u?.inputTokens ?? 0,
      outputTokens: u?.outputTokens ?? 0,
    });
    usage = mergeUsage(usage, SYNTHESIS_MODEL, u?.inputTokens ?? 0, u?.outputTokens ?? 0);
  }

  await updateAnalyticsReport(report.id, {
    phase: nextPhase("customer_synthesis", options),
    progress: { ...progress, scratch: { ...scratch, customerKnowledgeMd: md } },
    usage,
  });
}

// ── Phase: per-customer "current understanding" profiles (identity) ───────────

async function stepProfiles(report: AnalyticsReportDetail): Promise<void> {
  const { from, to, options } = report;
  const progress = report.progress;
  const scratch = getScratch(progress);
  let usage: ReportUsage = report.usage;

  if (!Array.isArray(scratch.customerQueue)) {
    const ids = await getActiveCustomerIdsInRange(from, to, options.maxProfiles);
    scratch.customerQueue = ids;
    scratch.profiles = [];
    progress.profilesTotal = ids.length;
  }

  const queue = scratch.customerQueue ?? [];
  if (queue.length === 0) {
    await updateAnalyticsReport(report.id, {
      phase: nextPhase("customer_profiles", options),
      progress: { ...progress, scratch },
    });
    return;
  }

  const batch = queue.splice(0, PROFILE_BATCH);
  const profiles = scratch.profiles ?? [];
  let done = progress.profilesDone;
  let failed = progress.profilesFailed;

  for (const cid of batch) {
    try {
      // The shared regeneration path: stores text + structured fields on the
      // customer too, so the (expensive) pass also refreshes the live profile.
      const res = await regenerateCustomerProfile(cid);
      if (res.ok) {
        const customer = await getCustomerById(cid);
        usage = mergeUsage(usage, PROFILE_MODEL, res.usage.inputTokens, res.usage.outputTokens);
        profiles.push({
          customerId: cid,
          name: customer ? customerDisplayName(customer) : `Kunde #${cid}`,
          profileSummary: res.summary,
          sessionCount: res.sessionCount,
          lastSeenAt: customer?.lastSeenAt ?? null,
        });
        done += 1;
      } else {
        failed += 1;
      }
    } catch (err) {
      reportError(err, { route: "lib/analytics-report-generate", phase: "profiles" });
      failed += 1;
    }
  }

  const remaining = queue.length;
  await updateAnalyticsReport(report.id, {
    phase: remaining === 0 ? nextPhase("customer_profiles", options) : "customer_profiles",
    progress: {
      ...progress,
      profilesDone: done,
      profilesFailed: failed,
      scratch: { ...scratch, customerQueue: queue, profiles },
    },
    usage,
  });
}

// ── Phase: the business snapshot + the previous report to compare with ───────

async function stepSnapshot(report: AnalyticsReportDetail): Promise<void> {
  const { from, to, options } = report;
  const progress = report.progress;
  const scratch = getScratch(progress);

  const [snapshot, previous, kpis, stats, spend] = await Promise.all([
    // The Shopify cross-check of the Mo codes goes through the KPI screen's
    // 10-minute cache and is bounded by a timeout inside the snapshot.
    getBusinessSnapshot({ from, to }, { includeShopify: true }),
    getPreviousCompletedReport(report.id),
    getReportKpis(from, to),
    getConversationStats(from, to),
    getRangeSpend(from, to),
  ]);
  const comparison = buildReportComparison(
    { snapshot, kpis, qualities: stats.qualities, spend, from, to },
    previous
  ) as ReportComparison | null;

  await updateAnalyticsReport(report.id, {
    phase: nextPhase("snapshot", options),
    progress: { ...progress, scratch: { ...scratch, snapshot, comparison } },
  });
}

// ── Phases: the two strategist passes (decisions, plan) ───────────────────────

async function strategistInput(report: AnalyticsReportDetail, scratch: ReportScratch) {
  const personasAgg = await getRangePersonaInsights(report.from, report.to, 5);
  const topQ = scratch.personaTopQ ?? {};
  return {
    snapshot: scratch.snapshot ?? null,
    comparison: scratch.comparison ?? null,
    insightsMd: scratch.insightsMd ?? null,
    customerKnowledgeMd: scratch.customerKnowledgeMd ?? null,
    personas: personasAgg.map((p) => ({ ...p, topQuestionsMd: topQ[p.personaLabel] ?? null })),
    notes: scratch.notes ?? [],
  };
}

const PASS_LABELS = { decisions: "Entscheidungsteil", plan: "Maßnahmenteil" } as const;

/**
 * One strategist pass per step. Success → next phase. A timeout or a failed
 * output stays in the phase and is retried on the next step one rung lower on
 * the effort ladder; an exhausted ladder or a missing key moves on with a note
 * (the report still completes — the snapshot and the other chapters stand).
 * A step the platform killed mid-call counts as a failed attempt (in-flight
 * mark); a mark that may still belong to a running step answers "busy".
 */
async function stepStrategist(
  report: AnalyticsReportDetail,
  pass: "decisions" | "plan",
  stepStartedAt: number
): Promise<"busy" | void> {
  const { options } = report;
  const progress = report.progress;
  const scratch = getScratch(progress);
  const strat: StrategistScratch = scratch.strategist ?? {
    decisionsAttempts: 0,
    planAttempts: 0,
    decisionsEffort: null,
    planEffort: null,
    notes: [],
  };
  const attemptsKey = pass === "decisions" ? "decisionsAttempts" : "planAttempts";
  const label = PASS_LABELS[pass];
  const inFlight = settleInFlightAttempt(strat[attemptsKey], strat.inFlight, pass);
  if (inFlight.live) return "busy";
  if (inFlight.interrupted) {
    const killedEffort = strategistEffortForAttempt(inFlight.attempts - 1) ?? "?";
    strat.notes = pushNote(
      strat.notes,
      `${label}: Versuch mit Denktiefe „${killedEffort}“ vom Server nach ${STEP_MAX_DURATION_S} s abgebrochen.`
    );
  }
  strat[attemptsKey] = inFlight.attempts;
  strat.inFlight = null;
  const effort = strategistEffortForAttempt(strat[attemptsKey]);

  const advance = async (patch: Partial<ReportScratch>, usage?: ReportUsage) => {
    await updateAnalyticsReport(report.id, {
      phase: nextPhase(pass, options),
      progress: { ...progress, scratch: { ...scratch, ...patch, strategist: strat } },
      ...(usage ? { usage } : {}),
    });
  };

  if (!process.env.ANTHROPIC_API_KEY) {
    strat.notes = pushNote(strat.notes, `Anthropic-Key fehlt — ${label} übersprungen.`);
    await advance({});
    return;
  }
  if (!scratch.snapshot) {
    strat.notes = pushNote(strat.notes, `Keine Geschäftsdaten — ${label} übersprungen.`);
    await advance({});
    return;
  }
  if (effort === null) {
    strat.notes = pushNote(strat.notes, `${label} nach ${strat[attemptsKey]} Versuchen nicht erstellt.`);
    await advance({});
    return;
  }

  const input = await strategistInput(report, scratch);
  // Mark the attempt before the minutes-long call: if the platform kills this
  // step, the next one finds the mark and moves down the ladder.
  strat.inFlight = { pass, attempt: strat[attemptsKey], startedAt: new Date().toISOString() };
  await updateAnalyticsReport(report.id, {
    phase: pass,
    progress: { ...progress, scratch: { ...scratch, strategist: strat } },
  });
  strat.inFlight = null;
  const timeoutMs = callTimeoutWithinStep({ stepStartedAt, maxDurationS: STEP_MAX_DURATION_S, capMs: STRATEGIST_TIMEOUT_MS });
  const res =
    pass === "decisions"
      ? await runStrategistObject({
          schema: decisionsSchema,
          ...buildDecisionsPrompt(input),
          answerTokens: DECISIONS_ANSWER_TOKENS,
          callSite: "analytics_report",
          effort,
          timeoutMs,
          label: "analytics-decisions",
        })
      : await runStrategistObject({
          schema: planSchema,
          ...buildPlanPrompt(input, scratch.decisions ?? null),
          answerTokens: PLAN_ANSWER_TOKENS,
          callSite: "analytics_report",
          effort,
          timeoutMs,
          label: "analytics-plan",
        });
  const usage = mergeUsage(report.usage, res.model, res.inputTokens, res.outputTokens);

  if (res.ok) {
    if (pass === "decisions") strat.decisionsEffort = effort;
    else strat.planEffort = effort;
    if (strat[attemptsKey] > 0) {
      strat.notes = pushNote(
        strat.notes,
        `${label} im ${strat[attemptsKey] + 1}. Versuch mit Denktiefe „${effort}“ erstellt (vorher Zeitlimit oder Fehler).`
      );
    }
    await advance(
      pass === "decisions" ? { decisions: normalizeDecisions(res.object) } : { plan: normalizePlan(res.object) },
      usage
    );
    return;
  }
  if (res.reason === "unconfigured") {
    strat.notes = pushNote(strat.notes, `Anthropic-Key fehlt — ${label} übersprungen.`);
    await advance({}, usage);
    return;
  }

  // Timeout, truncated or failed output: stay in the phase; the next step
  // retries with less thinking until the ladder is exhausted.
  strat[attemptsKey] += 1;
  if (strategistEffortForAttempt(strat[attemptsKey]) === null) {
    strat.notes = pushNote(strat.notes, `${label} nicht erstellt (${res.message}).`);
    await advance({}, usage);
    return;
  }
  await updateAnalyticsReport(report.id, {
    phase: pass,
    progress: { ...progress, scratch: { ...scratch, strategist: strat } },
    usage,
  });
}

// ── Phase: pure aggregations + finalise the sections payload ──────────────────

async function stepAssemble(report: AnalyticsReportDetail): Promise<void> {
  const { from, to, options } = report;
  const progress = report.progress;
  const scratch = getScratch(progress);

  const appendixCap = Math.min(options.maxAnalyze, APPENDIX_HARD_CAP);
  const [kpis, stats, personasAgg, appendix, spend, customerBase, campaigns] = await Promise.all([
    getReportKpis(from, to),
    getConversationStats(from, to),
    getRangePersonaInsights(from, to, 5),
    options.includeAppendix ? loadAppendixRows(from, to, appendixCap) : Promise.resolve([]),
    getRangeSpend(from, to),
    getReportCustomerBase(from, to),
    getReportCampaigns(from, to),
  ]);

  const topQ = scratch.personaTopQ ?? {};
  const personas = personasAgg.map((p) => ({ ...p, topQuestionsMd: topQ[p.personaLabel] ?? null }));

  let notes = scratch.notes ?? [];
  if (options.includeAppendix && appendix.length >= appendixCap && kpis.analyzed > appendix.length) {
    notes = pushNote(notes, `Anhang auf ${appendixCap} Gespräche begrenzt.`);
  }

  // The decision layer exists for reports that went through the snapshot
  // phase; a report started before it (and resumed now) stays a v1 payload.
  const decisionLayer: Partial<ReportSections> = scratch.snapshot
    ? {
        version: REPORT_SECTIONS_VERSION,
        snapshot: scratch.snapshot,
        comparison: scratch.comparison ?? null,
        // The normalisers guarantee the ReportDecision shape.
        decision: assembleDecision({
          decisions: scratch.decisions ?? null,
          plan: scratch.plan ?? null,
          model: STRATEGIST_MODEL,
          efforts: {
            decisions: scratch.strategist?.decisionsEffort ?? null,
            plan: scratch.strategist?.planEffort ?? null,
          },
          notes: scratch.strategist?.notes ?? [],
          generatedAt: new Date().toISOString(),
        }) as ReportDecision,
      }
    : {};

  const sections: ReportSections = {
    kpis,
    spend,
    categories: stats.categories.map((c) => ({ label: c.label, count: c.count })),
    qualities: stats.qualities.map((q) => ({ label: q.label, count: q.count })),
    insightsMd: scratch.insightsMd ?? null,
    personas,
    customerKnowledgeMd: scratch.customerKnowledgeMd ?? null,
    profiles: scratch.profiles ?? [],
    appendix,
    notes,
    customerBase,
    campaigns,
    ...decisionLayer,
  };

  await updateAnalyticsReport(report.id, {
    status: "complete",
    phase: "done",
    sections,
    completed: true,
    // The intermediate work-queues now live in `sections`; drop scratch so the
    // finished row (and the sidebar list payload) stays lean.
    progress: { ...progress, scratch: {} },
  });
}
