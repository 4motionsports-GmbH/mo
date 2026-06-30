// "Komplettanalyse" generation orchestrator — the server-only stepper that drives
// one report from 'running' to 'complete' by advancing its phase state-machine
// ONE BOUNDED CHUNK per call. The client (the report page) calls /api/admin/
// analytics/step repeatedly until status != 'running', showing live progress.
// This is the same "process a batch, report what remains, run again" shape the
// bulk conversation analysis uses, so a big interval with hundreds of
// conversations never blocks a single request past maxDuration.
//
// It deliberately RE-USES the app's existing AI passes rather than re-implementing
// them: the per-conversation analysis (conversation-analysis), the customer
// "current understanding" profile (customer-profile), and the rollup data-loaders
// + prompt builder (admin-conversations / conversation-analysis-core). The
// aggregate insights, the range-scoped persona top-questions and the aggregate
// customer-knowledge synthesis are run here directly so their token usage can be
// captured into the report's own per-model cost (each ALSO records into ai_usage
// for the global cost KPI, like every other backend LLM call).

import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { recordAiUsage } from "./ai-usage-store";
import { reportError } from "./observability";
import {
  getAnalyticsReport,
  updateAnalyticsReport,
  getReportKpis,
  getRangePersonaInsights,
  getPersonaLabelsInRange,
  getActiveCustomerIdsInRange,
  loadAppendixRows,
  getRangeSpend,
  sampleUserMessagesForPersona,
  type AnalyticsReportDetail,
  type ReportProgress,
  type ReportSections,
  type ReportUsage,
  type ReportProfileSection,
} from "./analytics-report-store";
import {
  getAdminConversationDetail,
  saveConversationAnalysis,
  loadUnanalyzedIds,
  countUnanalyzedInRange,
  loadAnalysesForRollup,
  getConversationStats,
} from "./admin-conversations";
import { generateConversationAnalysis, ANALYSIS_MODEL } from "./conversation-analysis";
import { generateCustomerProfile } from "./customer-profile";
import { getCustomerById, loadCustomerSessions, saveCustomerProfileSummary } from "./customer-store";
import { loadCustomerCorrespondence } from "./email-messages-store";
import { buildRollupPrompt, CATEGORY_LABELS } from "./conversation-analysis-core.mjs";
import {
  mergeUsage,
  nextPhase,
  INSIGHTS_MODEL,
  PERSONA_MODEL,
  SYNTHESIS_MODEL,
  PROFILE_MODEL,
} from "./analytics-report-core.mjs";

// Per-step work budgets — sized so a single /step stays well under maxDuration.
const ANALYZE_BATCH = 12; // cheap Haiku passes
const PERSONA_BATCH = 2; // Sonnet top-questions
const PROFILE_BATCH = 1; // Opus per-customer profile (slow → one per step)

// Bounds on the heavier inputs/outputs so a huge interval stays sane.
const ROLLUP_MAX = 400;
const SYNTHESIS_SUMMARIES = 150;
const PERSONA_SAMPLE = 80;
const APPENDIX_HARD_CAP = 800;

const BOUNDARY_NOTE =
  "\n\n---\n\n_**Grenze (bewusst):** Diese Insights sind Entscheidungsgrundlage für " +
  "einen Menschen. Mo passt seinen Prompt bzw. sein Verhalten NICHT automatisch an — " +
  "ein Mensch entscheidet über jede Verfeinerung._";

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
}

export interface StepResult {
  ok: boolean;
  status?: string;
  phase?: string;
  progress?: ReportProgress;
  costEur?: number;
  done: boolean;
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

/**
 * Advance the report by one bounded chunk. Never throws: a fatal error marks the
 * report 'failed' with a message; per-item failures inside a phase are counted
 * and skipped. Returns the fresh post-step state so the client can keep stepping.
 */
export async function stepReport(id: number): Promise<StepResult> {
  const report = await getAnalyticsReport(id);
  if (!report) return { ok: false, done: true, error: "not_found" };
  if (report.status !== "running") {
    return {
      ok: true,
      status: report.status,
      phase: report.phase,
      progress: report.progress,
      costEur: report.costEur,
      done: true,
    };
  }

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
  }

  const after = await getAnalyticsReport(id);
  if (!after) return { ok: false, done: true, error: "not_found" };
  return {
    ok: true,
    status: after.status,
    phase: after.phase,
    progress: after.progress,
    costEur: after.costEur,
    done: after.status !== "running",
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
  let usage: ReportUsage = report.usage;

  const analyses = await loadAnalysesForRollup(from, to, ROLLUP_MAX);
  let insightsMd: string;

  if (analyses.length === 0) {
    insightsMd = "_Keine analysierten Gespräche im Zeitraum — keine Insights möglich._";
  } else if (!process.env.ANTHROPIC_API_KEY) {
    insightsMd = "_Anthropic-Key nicht konfiguriert — Insights nicht möglich._";
  } else {
    const { text, usage: u } = await generateText({
      model: anthropic(INSIGHTS_MODEL),
      maxOutputTokens: 1300,
      system:
        "Du bist Analyst bei motion sports (Fitness- und Kraftsportgeräte). Du erhältst " +
        "KURZ-ZUSAMMENFASSUNGEN vieler Beratungsgespräche (bereits verdichtet) zwischen " +
        "Kunden und dem Chatbot 'Mo', jeweils mit Kategorie und Qualitätssignal. Erstelle " +
        "daraus EINEN kompakten, umsetzbaren Insights-Report auf Deutsch (Markdown) für das " +
        "Produkt-/Beratungsteam.\n\nGliederung (mit Markdown-Überschriften):\n" +
        "1. **Top-Themen & Fragen**\n2. **Wo Beratungen stocken oder scheitern**\n" +
        "3. **Häufige unerfüllte Bedürfnisse**\n4. **Vorschläge zur Verfeinerung (für einen Menschen)** " +
        "— als Empfehlungen, nicht als automatische Änderungen.\n\nSei faktenbasiert, knapp und " +
        "priorisiere nach Häufigkeit/Wirkung. Erfinde nichts.",
      prompt:
        `Zeitraum: ${from} bis ${to}\nAnzahl analysierter Gespräche: ${analyses.length}\n\n` +
        `## Zusammenfassungen (verdichtet, mit [Kategorie · Qualität])\n\n` +
        `${buildRollupPrompt(analyses)}\n\nErstelle jetzt den Insights-Report.`,
    });
    insightsMd = (text.trim() || "_Keine klaren Muster erkennbar._") + BOUNDARY_NOTE;
    await recordAiUsage({
      callSite: "conversation_insights",
      model: INSIGHTS_MODEL,
      inputTokens: u?.inputTokens ?? 0,
      outputTokens: u?.outputTokens ?? 0,
    });
    usage = mergeUsage(usage, INSIGHTS_MODEL, u?.inputTokens ?? 0, u?.outputTokens ?? 0);
  }

  await updateAnalyticsReport(report.id, {
    phase: nextPhase("insights", options),
    progress: { ...progress, scratch: { ...scratch, insightsMd } },
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
        maxOutputTokens: 500,
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
      maxOutputTokens: 1200,
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
      const customer = await getCustomerById(cid);
      if (!customer) {
        failed += 1;
        continue;
      }
      const [sessions, correspondence] = await Promise.all([
        loadCustomerSessions(cid),
        loadCustomerCorrespondence(cid),
      ]);
      const res = await generateCustomerProfile({
        sessions,
        purchases: customer.purchaseSummary,
        accountContext: customer.shopifyAccountSummary?.addressContext ?? null,
        correspondence,
      });
      if (res.ok) {
        // Persist back onto the customer row too, so the (expensive) regeneration
        // also refreshes the live "current understanding" — not just this report.
        await saveCustomerProfileSummary(cid, res.summary);
        usage = mergeUsage(usage, PROFILE_MODEL, res.usage.inputTokens, res.usage.outputTokens);
        profiles.push({
          customerId: cid,
          name: customerDisplayName(customer),
          profileSummary: res.summary,
          sessionCount: sessions.length,
          lastSeenAt: customer.lastSeenAt ?? null,
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

// ── Phase: pure aggregations + finalise the sections payload ──────────────────

async function stepAssemble(report: AnalyticsReportDetail): Promise<void> {
  const { from, to, options } = report;
  const progress = report.progress;
  const scratch = getScratch(progress);

  const appendixCap = Math.min(options.maxAnalyze, APPENDIX_HARD_CAP);
  const [kpis, stats, personasAgg, appendix, spend] = await Promise.all([
    getReportKpis(from, to),
    getConversationStats(from, to),
    getRangePersonaInsights(from, to, 5),
    options.includeAppendix ? loadAppendixRows(from, to, appendixCap) : Promise.resolve([]),
    getRangeSpend(from, to),
  ]);

  const topQ = scratch.personaTopQ ?? {};
  const personas = personasAgg.map((p) => ({ ...p, topQuestionsMd: topQ[p.personaLabel] ?? null }));

  let notes = scratch.notes ?? [];
  if (options.includeAppendix && appendix.length >= appendixCap && kpis.analyzed > appendix.length) {
    notes = pushNote(notes, `Anhang auf ${appendixCap} Gespräche begrenzt.`);
  }

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
  };

  await updateAnalyticsReport(report.id, {
    status: "complete",
    phase: "done",
    sections,
    completed: true,
    progress: { ...progress, scratch: { ...scratch, notes } },
  });
}
