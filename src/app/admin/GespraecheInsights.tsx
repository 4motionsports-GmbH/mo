"use client";

// Insights panel for the conversation inspector. Three pieces, all about the
// CURRENT date window:
//   1. a FREE category/quality distribution (pure DB GROUP BY over cached
//      analyses — no tokens), rendered as little bars;
//   2. the confirmed BULK "analyze all un-analysed" action, with the estimated
//      cost shown BEFORE the operator confirms (never automatic);
//   3. the on-demand AGGREGATE rollup narrative (summarises the cached summaries,
//      not transcripts) — cached, regenerated on a deliberate click.
//
// Themed via the admin tokens; German copy inline. No model is ever called on
// render — only the explicit buttons hit the token-costing endpoints.

import * as React from "react";
import { useRouter } from "next/navigation";
import { Sparkles, BarChart3, Layers } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
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
import type { ConversationStats, InsightsRollup } from "@/lib/admin-conversations";

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

function Distribution({
  title,
  icon,
  rows,
}: {
  title: string;
  icon: React.ReactNode;
  rows: Array<{ label: string; count: number }>;
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
          {rows.map((r) => (
            <li key={r.label} className="flex items-center gap-2 text-[12px]">
              <span className="w-40 shrink-0 truncate text-muted-foreground" title={r.label}>
                {r.label}
              </span>
              <span className="relative h-3 flex-1 overflow-hidden rounded-sm bg-muted">
                <span
                  className="absolute inset-y-0 left-0 rounded-sm bg-accent/70"
                  style={{ width: `${Math.round((r.count / max) * 100)}%` }}
                />
              </span>
              <span className="w-8 shrink-0 text-right tabular-nums text-foreground">
                {r.count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function GespraecheInsights({
  from,
  to,
  stats,
  unanalyzed,
  bulkEstimateEur,
  initialInsights,
}: {
  from: string;
  to: string;
  stats: ConversationStats;
  unanalyzed: number;
  bulkEstimateEur: number;
  initialInsights: InsightsRollup | null;
}) {
  const router = useRouter();
  const [insights, setInsights] = React.useState<InsightsRollup | null>(initialInsights);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [bulkBusy, setBulkBusy] = React.useState(false);

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
    } catch {
      setError("Netzwerkfehler — bitte erneut versuchen.");
    } finally {
      setLoading(false);
    }
  }

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
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <BarChart3 className="size-4 text-accent" />
            Insights · {from} – {to}
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
            rows={stats.categories}
          />
          <Distribution
            title="Qualität"
            icon={<BarChart3 className="size-3.5 text-muted-foreground" />}
            rows={stats.qualities}
          />
        </div>

        <div className="border-t border-dashed border-border pt-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <strong className="text-[13px] text-foreground">Aggregierter Insights-Report</strong>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => runInsights(insights != null && insights.analyzedCount > 0)}
              disabled={loading || stats.analyzedCount === 0}
            >
              <Sparkles />
              {loading
                ? "Wird erstellt…"
                : insights && insights.analyzedCount > 0
                  ? "Neu generieren"
                  : "Insights generieren"}
            </Button>
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            ⚠️ KI-Pass über die bereits zwischengespeicherten Zusammenfassungen (nicht über
            Transkripte) — günstig und skalierbar. Ergebnis wird je Zeitraum zwischengespeichert.
            {stats.analyzedCount === 0 ? " Zuerst Gespräche analysieren." : ""}
          </p>

          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

          {loading && !insights && (
            <div className="mt-2 space-y-1.5" aria-hidden>
              <Skeleton className="h-3 w-11/12" />
              <Skeleton className="h-3 w-10/12" />
              <Skeleton className="h-3 w-9/12" />
            </div>
          )}

          {insights && insights.summaryMd && (
            <div className={loading ? "opacity-60 transition-opacity" : undefined}>
              <Markdown content={insights.summaryMd} className="mt-2 text-[13px]" />
              <p className="mt-2 text-[11px] text-muted-foreground">
                {insights.analyzedCount} Zusammenfassung(en) ·{" "}
                {insights.cached ? "zwischengespeichert" : "frisch generiert"} ·{" "}
                {fmtTs(insights.generatedAt)}
                {insights.model ? ` · ${insights.model}` : ""}
                {insights.costEur > 0 ? ` · ~${eur(insights.costEur)}` : ""}
              </p>
            </div>
          )}
        </div>
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
