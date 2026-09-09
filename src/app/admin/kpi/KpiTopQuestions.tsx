"use client";

// Client island for the on-demand "Top-Fragen pro Persona" insight. The cached
// summary (if any) is rendered immediately from the server; the button runs the
// token-costing Anthropic pass via POST /api/admin/kpi/top-questions and swaps in
// the fresh result. The token cost is stated in the (i) next to the button so it
// is never a surprise.

import * as React from "react";
import { Sparkles } from "lucide-react";
import { ADMIN_DATE_TIME_MEDIUM, formatAdmin } from "@/lib/admin-datetime.mjs";
import { num } from "@/lib/admin-format.mjs";
import type { TopQuestionsSummary } from "@/lib/kpi-top-questions";
import { Button, InfoTip, Markdown, Skeleton } from "../ui";
import { adminFetch, friendlyErrorMessage } from "../lib/admin-fetch";
import { useAsyncAction } from "../lib/use-async-action";

export function KpiTopQuestions({
  personaLabel,
  initial,
}: {
  personaLabel: string;
  initial: TopQuestionsSummary | null;
}) {
  const [summary, setSummary] = React.useState<TopQuestionsSummary | null>(initial);
  const generate = useAsyncAction(
    async (force: boolean) => {
      let data: { summary?: TopQuestionsSummary };
      try {
        data = await adminFetch<{ summary?: TopQuestionsSummary }>("/api/admin/kpi/top-questions", {
          body: { personaLabel, force },
        });
      } catch (err) {
        throw new Error(friendlyErrorMessage(err, "Fehler beim Erstellen der Zusammenfassung."));
      }
      if (!data.summary) throw new Error("Fehler beim Erstellen der Zusammenfassung.");
      return data.summary;
    },
    { errorToast: false, onSuccess: setSummary }
  );

  return (
    <div className="mt-3 border-t border-dashed border-border pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="flex items-center gap-1.5 text-[13px] text-foreground">
          Top-Fragen dieser Gruppe
          <InfoTip>
            On-Demand-KI-Analyse von bis zu 80 echten Nutzernachrichten — kostet Anthropic-Tokens
            (wenige Cent pro Lauf). Ergebnis wird zwischengespeichert.
          </InfoTip>
        </strong>
        <Button
          variant="secondary"
          size="xs"
          onClick={() => void generate.run(summary != null)}
          loading={generate.pending}
        >
          {!generate.pending && <Sparkles />}
          {generate.pending ? "Wird erstellt…" : summary ? "Neu generieren" : "Top-Fragen generieren"}
        </Button>
      </div>

      {generate.error && (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {generate.error}
        </p>
      )}

      {generate.pending && !summary && (
        <div className="mt-2 space-y-1.5" aria-hidden>
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-10/12" />
          <Skeleton className="h-3 w-9/12" />
        </div>
      )}

      {summary && (
        <div className={generate.pending ? "opacity-60 transition-opacity" : undefined}>
          <Markdown content={summary.summaryMd} className="mt-2 text-[13px]" />
          <p className="mt-2 text-2xs text-muted-foreground">
            Stichprobe: {num(summary.sampleSize)} Nachrichten ·{" "}
            {summary.cached ? "zwischengespeichert" : "frisch generiert"} ·{" "}
            {formatAdmin(summary.generatedAt, ADMIN_DATE_TIME_MEDIUM, summary.generatedAt)}
            {summary.model ? ` · ${summary.model}` : ""}
          </p>
        </div>
      )}
    </div>
  );
}
