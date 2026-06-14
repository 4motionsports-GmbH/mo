"use client";

// Client island for the on-demand "Top-Fragen pro Persona" insight. The cached
// summary (if any) is rendered immediately from the server; the button runs the
// token-costing Anthropic pass via POST /api/admin/kpi/top-questions and swaps in
// the fresh result. The token cost is stated up front so it's never a surprise.
//
// Themed via the admin design tokens (Button + token colors) so it reads
// correctly in BOTH light and dark mode — no hardcoded hex colors.

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button, Markdown, Skeleton } from "./ui";

interface Summary {
  personaLabel: string;
  summaryMd: string;
  sampleSize: number;
  model: string | null;
  generatedAt: string;
  cached: boolean;
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString("de-DE", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function KpiTopQuestions({
  personaLabel,
  initial,
}: {
  personaLabel: string;
  initial: Summary | null;
}) {
  const [summary, setSummary] = useState<Summary | null>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(force: boolean) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/kpi/top-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personaLabel, force }),
      });
      const data = (await res.json()) as { summary?: Summary; error?: { message?: string } };
      if (!res.ok || !data.summary) {
        setError(data.error?.message ?? "Fehler beim Erstellen der Zusammenfassung.");
        return;
      }
      setSummary(data.summary);
    } catch {
      setError("Netzwerkfehler — bitte erneut versuchen.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-3 border-t border-dashed border-border pt-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <strong className="text-[13px] text-foreground">Top-Fragen dieser Gruppe</strong>
        <Button variant="secondary" size="sm" onClick={() => run(summary != null)} disabled={loading}>
          <Sparkles />
          {loading ? "Wird erstellt…" : summary ? "Neu generieren" : "Top-Fragen generieren"}
        </Button>
      </div>

      <p className="mt-1.5 text-[11px] text-muted-foreground">
        ⚠️ On-Demand-KI-Analyse von bis zu 80 echten Nutzernachrichten — kostet
        Anthropic-Tokens (wenige Cent pro Lauf). Ergebnis wird zwischengespeichert.
      </p>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      {loading && !summary && (
        <div className="mt-2 space-y-1.5" aria-hidden>
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-10/12" />
          <Skeleton className="h-3 w-9/12" />
        </div>
      )}

      {summary && (
        <div className={loading ? "opacity-60 transition-opacity" : undefined}>
          <Markdown content={summary.summaryMd} className="mt-2 text-[13px]" />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Stichprobe: {summary.sampleSize} Nachrichten ·{" "}
            {summary.cached ? "zwischengespeichert" : "frisch generiert"} ·{" "}
            {formatTimestamp(summary.generatedAt)}
            {summary.model ? ` · ${summary.model}` : ""}
          </p>
        </div>
      )}
    </div>
  );
}
