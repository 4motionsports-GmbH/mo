"use client";

// Auswertung — the FREE category/quality distribution of the window (pure DB
// GROUP BY over the cached analysis columns) as clickable list filters, the
// analysed/total count and the confirmed bulk "Alle auswerten" action (the one
// place in this panel that spends tokens, always behind a confirm).

import * as React from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Layers } from "lucide-react";
import type { ConversationStats } from "@/lib/admin-conversations";
import { eur, num, plural } from "@/lib/admin-format.mjs";
import { Button, Card, CardContent, InfoTip, cn, toast, useConfirm } from "../ui";
import { adminFetch, errorMessage } from "../lib/admin-fetch";

interface BulkResult {
  processed?: number;
  failed?: number;
  remaining?: number;
  costEur?: number;
}

export function StatsPanel({
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
  activeCategory: string | null;
  activeQuality: string | null;
  onFilterCategory: (category: string | null) => void;
  onFilterQuality: (quality: string | null) => void;
}) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [bulkBusy, setBulkBusy] = React.useState(false);

  async function runBulk() {
    const ok = await confirm({
      title: "Alle nicht analysierten Gespräche auswerten?",
      description: `${plural(unanalyzed, "Gespräch", "Gespräche")} im Zeitraum ${from} – ${to} werden mit dem günstigen Modell analysiert. Geschätzte Kosten: ca. ${eur(bulkEstimateEur, 4)} (≈ ${eur(bulkEstimateEur / Math.max(1, unanalyzed), 4)} pro Gespräch). Pro Durchlauf wird eine Charge verarbeitet — sind danach noch welche offen, einfach erneut ausführen.`,
      confirmLabel: "Auswerten",
    });
    if (!ok) return;
    setBulkBusy(true);
    const id = toast({
      variant: "info",
      title: "Sammelanalyse läuft…",
      description: `${plural(unanalyzed, "Gespräch", "Gespräche")} im Zeitraum`,
      duration: 0,
    });
    try {
      const data = await adminFetch<BulkResult>("/api/admin/conversations/analyze-bulk", {
        body: { from, to, confirm: true },
      });
      const remaining = data.remaining ?? 0;
      toast.update(id, {
        variant: remaining > 0 ? "warning" : "success",
        title: "Sammelanalyse",
        description:
          `${num(data.processed ?? 0)} analysiert` +
          (data.failed ? `, ${num(data.failed)} fehlgeschlagen` : "") +
          ` · ${eur(data.costEur ?? 0, 4)}` +
          (remaining > 0 ? ` · noch ${num(remaining)} offen (erneut ausführen)` : ""),
        duration: 7000,
      });
      router.refresh();
    } catch (err) {
      toast.update(id, {
        variant: "error",
        title: "Sammelanalyse fehlgeschlagen",
        description: errorMessage(err, "Netzwerkfehler"),
        duration: 6000,
      });
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <BarChart3 className="size-4 text-accent" aria-hidden />
            Auswertung
            <InfoTip>
              Verteilung der KI-Analysen im Zeitraum (nur analysierte Gespräche). Klick auf einen
              Balken filtert die Gesprächsliste darunter auf ALLE passenden (analysierten)
              Gespräche — jedes mit seiner Kurz-Erklärung. Erneuter Klick hebt den Filter auf.
            </InfoTip>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              {plural(stats.total, "Gespräch", "Gespräche")} · {num(stats.analyzedCount)} analysiert
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={unanalyzed === 0}
              loading={bulkBusy}
              onClick={() => void runBulk()}
            >
              {!bulkBusy && <Layers />}
              {unanalyzed > 0 ? `Alle auswerten (${num(unanalyzed)})` : "Alle ausgewertet"}
            </Button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Distribution
            title="Kategorien"
            rows={stats.categories.map((c) => ({ value: c.category, label: c.label, count: c.count }))}
            activeValue={activeCategory}
            onSelect={onFilterCategory}
          />
          <Distribution
            title="Qualität"
            rows={stats.qualities.map((q) => ({ value: q.quality, label: q.label, count: q.count }))}
            activeValue={activeQuality}
            onSelect={onFilterQuality}
          />
        </div>
      </CardContent>
      {confirmDialog}
    </Card>
  );
}

/** Clickable bar list: a row filters the list to its value (again = clear). */
function Distribution({
  title,
  rows,
  activeValue,
  onSelect,
}: {
  title: string;
  rows: Array<{ value: string; label: string; count: number }>;
  activeValue: string | null;
  onSelect: (value: string | null) => void;
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1;
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold text-foreground">{title}</div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Noch keine analysierten Gespräche.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {rows.map((r) => {
            const active = activeValue === r.value;
            return (
              <li key={r.value}>
                <button
                  type="button"
                  onClick={() => onSelect(active ? null : r.value)}
                  aria-pressed={active}
                  aria-label={
                    active
                      ? `Filter „${r.label}“ entfernen`
                      : `Liste auf „${r.label}“ filtern (${num(r.count)})`
                  }
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-xs transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active && "bg-accent-soft"
                  )}
                >
                  <span className={cn("w-36 shrink-0 truncate text-left", active ? "font-medium text-foreground" : "text-muted-foreground")}>
                    {r.label}
                  </span>
                  <span className="relative h-3 flex-1 overflow-hidden rounded-sm bg-muted" aria-hidden>
                    <span
                      className={cn("absolute inset-y-0 left-0 rounded-sm", active ? "bg-accent" : "bg-accent/70")}
                      style={{ width: `${Math.round((r.count / max) * 100)}%` }}
                    />
                  </span>
                  <span className="w-8 shrink-0 text-right tabular-nums text-foreground">{num(r.count)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
