"use client";

// Insights panels for the conversation inspector, split so the workspace can
// order the page around the master–detail grid (the primary work surface):
//
//   GespraecheStatsPanel  — ABOVE the list: the FREE category/quality
//     distribution (pure DB GROUP BY, no tokens) as CLICKABLE filter bars,
//     window stats and the confirmed bulk "analyze all" action. Sits directly
//     above the conversation list it filters.
//
//   GespraecheReportPanel — BELOW the grid: the on-demand AGGREGATE rollup
//     narrative (summarises cached summaries, not transcripts; cached per
//     window; regenerated on a deliberate click), COLLAPSED by default so the
//     long report never pushes the work area off screen. Carries the curated
//     per-section reference links ("Belege") — complete listings are the
//     filters' job.
//
// Themed via the admin tokens; German copy inline. No model is ever called on
// render — only the explicit buttons hit the token-costing endpoints.

import * as React from "react";
import { useRouter } from "next/navigation";
import { Sparkles, BarChart3, Layers, MessageSquare, ChevronDown } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  Badge,
  Markdown,
  Skeleton,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  toast,
} from "./ui";
import type {
  ConversationStats,
  InsightsRollup,
  InsightsReference,
  InsightsSection,
} from "@/lib/admin-conversations";

function fmtTs(iso: string): string {
  try {
    return new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}
function eur(n: number): string {
  return n.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 4 });
}

// ── Distribution bars (clickable list filters) ────────────────────────────────

function Distribution({
  title,
  icon,
  rows,
  activeValue,
  onSelect,
}: {
  title: string;
  icon: React.ReactNode;
  rows: Array<{ value: string; label: string; count: number }>;
  /** Currently applied list-filter value (highlighted; click again clears). */
  activeValue?: string | null;
  /** Makes the rows clickable: filters the conversation list to this value. */
  onSelect?: (value: string | null) => void;
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1;
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
        {icon}
        {title}
      </div>
      {rows.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">— noch keine Daten</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((r) => {
            const active = activeValue != null && activeValue === r.value;
            const bar = (
              <>
                <span className="w-40 shrink-0 truncate text-left text-muted-foreground" title={r.label}>
                  {r.label}
                </span>
                <span className="relative h-3 flex-1 overflow-hidden rounded-sm bg-muted">
                  <span
                    className={`absolute inset-y-0 left-0 rounded-sm ${active ? "bg-accent" : "bg-accent/70"}`}
                    style={{ width: `${Math.round((r.count / max) * 100)}%` }}
                  />
                </span>
                <span className="w-8 shrink-0 text-right tabular-nums text-foreground">
                  {r.count}
                </span>
              </>
            );
            return (
              <li key={r.value} className="text-[12px]">
                {onSelect ? (
                  <button
                    type="button"
                    onClick={() => onSelect(active ? null : r.value)}
                    aria-pressed={active}
                    title={
                      active
                        ? "Filter entfernen"
                        : `Liste auf „${r.label}" filtern — zeigt ALLE passenden Gespräche`
                    }
                    className={`flex w-full cursor-pointer items-center gap-2 rounded-sm px-0.5 py-px transition-colors hover:bg-secondary/60 ${
                      active ? "bg-accent/10" : ""
                    }`}
                  >
                    {bar}
                  </button>
                ) : (
                  <span className="flex items-center gap-2">{bar}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Stats + distribution + bulk action (rendered ABOVE the list) ──────────────

export function GespraecheStatsPanel({
  from,
  to,
  stats,
  unanalyzed,
  bulkEstimateEur,
  activeCategory,
  activeQuality,
  onFilterCategory,
  onFilterQuality,
}: {
  from: string;
  to: string;
  stats: ConversationStats;
  unanalyzed: number;
  bulkEstimateEur: number;
  activeCategory?: string | null;
  activeQuality?: string | null;
  onFilterCategory?: (category: string | null) => void;
  onFilterQuality?: (quality: string | null) => void;
}) {
  const router = useRouter();
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [bulkBusy, setBulkBusy] = React.useState(false);

  async function runBulk() {
    setBulkBusy(true);
    const id = toast({
      variant: "info",
      title: "Sammelanalyse läuft…",
      description: `${unanalyzed} Gespräch(e) im Zeitraum`,
      duration: 0,
    });
    try {
      const res = await fetch("/api/admin/conversations/analyze-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, confirm: true }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        processed?: number;
        failed?: number;
        remaining?: number;
        costEur?: number;
        unconfigured?: boolean;
        error?: { message?: string };
      };
      if (!res.ok) {
        toast.update(id, {
          variant: "error",
          title: "Sammelanalyse fehlgeschlagen",
          description: data.error?.message ?? "Unbekannter Fehler",
          duration: 6000,
        });
        return;
      }
      const remaining = data.remaining ?? 0;
      toast.update(id, {
        variant: remaining > 0 ? "warning" : "success",
        title: "Sammelanalyse",
        description:
          `${data.processed ?? 0} analysiert` +
          (data.failed ? `, ${data.failed} fehlgeschlagen` : "") +
          ` · ${eur(data.costEur ?? 0)}` +
          (remaining > 0 ? ` · noch ${remaining} offen (erneut ausführen)` : ""),
        duration: 7000,
      });
      setBulkOpen(false);
      router.refresh();
    } catch {
      toast.update(id, {
        variant: "error",
        title: "Sammelanalyse fehlgeschlagen",
        description: "Netzwerkfehler",
        duration: 6000,
      });
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <BarChart3 className="size-4 text-accent" />
            Auswertung · {from} – {to}
          </div>
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <span>
              {stats.total} Gespräch(e) · {stats.analyzedCount} analysiert
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={unanalyzed === 0 || bulkBusy}
              onClick={() => setBulkOpen(true)}
            >
              <Layers />
              {unanalyzed > 0 ? `Alle auswerten (${unanalyzed})` : "Alle ausgewertet"}
            </Button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Distribution
            title="Kategorien"
            icon={<Layers className="size-3.5 text-muted-foreground" />}
            rows={stats.categories.map((c) => ({
              value: c.category,
              label: c.label,
              count: c.count,
            }))}
            activeValue={activeCategory}
            onSelect={onFilterCategory}
          />
          <Distribution
            title="Qualität"
            icon={<BarChart3 className="size-3.5 text-muted-foreground" />}
            rows={stats.qualities.map((q) => ({
              value: q.quality,
              label: q.label,
              count: q.count,
            }))}
            activeValue={activeQuality}
            onSelect={onFilterQuality}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Klick auf einen Balken filtert die Gesprächsliste darunter auf ALLE passenden
          (analysierten) Gespräche — jedes mit seiner Kurz-Erklärung. Erneuter Klick hebt
          den Filter auf.
        </p>
      </CardContent>

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alle nicht analysierten Gespräche auswerten?</DialogTitle>
            <DialogDescription>
              {unanalyzed} Gespräch(e) im Zeitraum {from} – {to} werden mit dem günstigen
              Modell analysiert. Geschätzte Kosten: ca. {eur(bulkEstimateEur)} (≈{" "}
              {eur(bulkEstimateEur / Math.max(1, unanalyzed))} pro Gespräch). Pro Durchlauf
              wird eine Charge verarbeitet — sind danach noch welche offen, einfach erneut
              ausführen.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" disabled={bulkBusy} onClick={() => setBulkOpen(false)}>
              Abbrechen
            </Button>
            <Button size="sm" disabled={bulkBusy} onClick={runBulk}>
              {bulkBusy ? "Läuft…" : "Auswerten"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ── Report references ("Belege" — curated examples, not complete listings) ────

// German section labels matching the report's headings (order = report order).
const SECTION_LABELS: Record<InsightsSection, string> = {
  top_themen: "Top-Themen & Fragen",
  stockend: "Wo Beratungen stocken oder scheitern",
  beduerfnisse: "Häufige unerfüllte Bedürfnisse",
  vorschlaege: "Vorschläge zur Verfeinerung",
};
const SECTION_ORDER: InsightsSection[] = [
  "top_themen",
  "stockend",
  "beduerfnisse",
  "vorschlaege",
];

/** Per-section collapsibles listing the conversations that back each report
 *  finding. Clicking an entry opens that conversation in the detail panel. */
function InsightsReferences({
  references,
  onOpenConversation,
}: {
  references: InsightsReference[];
  onOpenConversation?: (id: number) => void;
}) {
  return (
    <div className="mt-3 space-y-1.5">
      {SECTION_ORDER.map((section) => {
        const refs = references.filter((r) => r.section === section);
        if (refs.length === 0) return null;
        return (
          <details
            key={section}
            className="group rounded-lg border border-border bg-muted/30"
          >
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-[12px] font-medium text-foreground [&::-webkit-details-marker]:hidden">
              <MessageSquare className="size-3.5 text-muted-foreground" />
              {SECTION_LABELS[section]}
              <Badge variant="secondary" className="text-[10px]">
                Beleg-Gespräche ({refs.length})
              </Badge>
            </summary>
            <ul className="space-y-1.5 border-t border-border/60 px-3 py-2">
              {refs.map((r) => (
                <li key={`${r.section}-${r.conversationId}`} className="text-[12px]">
                  <button
                    type="button"
                    className="font-medium text-accent underline-offset-2 hover:underline"
                    onClick={() => onOpenConversation?.(r.conversationId)}
                  >
                    Gespräch #{r.conversationId} öffnen
                  </button>
                  {r.reason && (
                    <span className="text-muted-foreground"> — {r.reason}</span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        );
      })}
      <p className="text-[11px] text-muted-foreground">
        Kuratierte Beispiele je Abschnitt. Vollständige Listen: Kategorie-/Qualitäts-Balken
        oben anklicken.
      </p>
    </div>
  );
}

// ── Aggregate report (rendered BELOW the grid, collapsed by default) ──────────

export function GespraecheReportPanel({
  from,
  to,
  analyzedCount,
  initialInsights,
  onOpenConversation,
}: {
  from: string;
  to: string;
  /** Analysed conversations in the window (enables/disables generation). */
  analyzedCount: number;
  initialInsights: InsightsRollup | null;
  onOpenConversation?: (id: number) => void;
}) {
  const [insights, setInsights] = React.useState<InsightsRollup | null>(initialInsights);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Collapsed by default: the report is reference material, not the primary
  // work surface. Auto-expands after an explicit (re)generation.
  const [open, setOpen] = React.useState(false);

  // The server hands back a fresh cached rollup for the new window on navigation.
  React.useEffect(() => {
    setInsights(initialInsights);
    setError(null);
  }, [initialInsights, from, to]);

  async function runInsights(force: boolean) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/conversations/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, force }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        insights?: InsightsRollup;
        error?: { message?: string };
      };
      if (!res.ok || !data.insights) {
        setError(data.error?.message ?? "Insights konnten nicht erstellt werden.");
        return;
      }
      setInsights(data.insights);
      setOpen(true);
    } catch {
      setError("Netzwerkfehler — bitte erneut versuchen.");
    } finally {
      setLoading(false);
    }
  }

  const hasReport = Boolean(insights && insights.summaryMd);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Sparkles className="size-4 text-accent" />
            Aggregierter Insights-Report
            {insights && (
              <span className="text-[11px] font-normal text-muted-foreground">
                {insights.analyzedCount} Zusammenfassung(en) ·{" "}
                {insights.cached ? "zwischengespeichert" : "frisch generiert"} ·{" "}
                {fmtTs(insights.generatedAt)}
                {insights.costEur > 0 ? ` · ~${eur(insights.costEur)}` : ""}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {hasReport && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
              >
                <ChevronDown className={`transition-transform ${open ? "rotate-180" : ""}`} />
                {open ? "Einklappen" : "Report anzeigen"}
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => runInsights(insights != null && insights.analyzedCount > 0)}
              disabled={loading || analyzedCount === 0}
            >
              <Sparkles />
              {loading
                ? "Wird erstellt…"
                : insights && insights.analyzedCount > 0
                  ? "Neu generieren"
                  : "Insights generieren"}
            </Button>
          </div>
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          ⚠️ KI-Pass über die bereits zwischengespeicherten Zusammenfassungen (nicht über
          Transkripte) — günstig und skalierbar. Ergebnis wird je Zeitraum
          zwischengespeichert. Enthält Empfehlungen zur Verfeinerung auf Basis aller
          analysierten Gespräche.
          {analyzedCount === 0 ? " Zuerst Gespräche analysieren." : ""}
        </p>

        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

        {loading && !hasReport && (
          <div className="mt-2 space-y-1.5" aria-hidden>
            <Skeleton className="h-3 w-11/12" />
            <Skeleton className="h-3 w-10/12" />
            <Skeleton className="h-3 w-9/12" />
          </div>
        )}

        {hasReport && open && insights && (
          <div className={`mt-3 border-t border-dashed border-border pt-3 ${loading ? "opacity-60 transition-opacity" : ""}`}>
            <Markdown content={insights.summaryMd} className="text-[13px]" />
            {insights.references.length > 0 ? (
              <InsightsReferences
                references={insights.references}
                onOpenConversation={onOpenConversation}
              />
            ) : (
              insights.cached &&
              insights.model != null && (
                <p className="mt-2 text-[11px] italic text-muted-foreground">
                  Neu generieren, um verlinkte Beleg-Gespräche zu erhalten.
                </p>
              )
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">
              {insights.model ? `Modell: ${insights.model}` : ""}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
