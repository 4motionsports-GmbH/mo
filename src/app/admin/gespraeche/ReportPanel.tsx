"use client";

// Aggregierter Insights-Report — the on-demand rollup over the CACHED
// per-conversation summaries (never transcripts), cached per window and
// regenerated on a deliberate click. Collapsed by default: reference material,
// not the work surface. Carries the curated per-section "Belege" links.

import * as React from "react";
import { Sparkles } from "lucide-react";
import type { InsightsReference, InsightsRollup, InsightsSection } from "@/lib/admin-conversations";
import { ADMIN_DATE_TIME_MEDIUM, formatAdmin } from "@/lib/admin-datetime.mjs";
import { eur, num, plural } from "@/lib/admin-format.mjs";
import { Button, Callout, Disclosure, EmptyState, InfoTip, Markdown, Skeleton } from "../ui";
import { adminFetch } from "../lib/admin-fetch";
import { useAsyncAction } from "../lib/use-async-action";

// German section labels matching the report's headings (order = report order).
const SECTION_LABELS: Record<InsightsSection, string> = {
  top_themen: "Top-Themen & Fragen",
  stockend: "Wo Beratungen stocken oder scheitern",
  beduerfnisse: "Häufige unerfüllte Bedürfnisse",
  vorschlaege: "Vorschläge zur Verfeinerung",
};
const SECTION_ORDER: InsightsSection[] = ["top_themen", "stockend", "beduerfnisse", "vorschlaege"];

export function ReportPanel({
  from,
  to,
  analyzedCount,
  initialInsights,
  onOpenConversation,
}: {
  from: string;
  to: string;
  /** Analysed conversations in the window (enables generation). */
  analyzedCount: number;
  initialInsights: InsightsRollup | null;
  onOpenConversation: (id: number) => void;
}) {
  const windowKey = `${from}|${to}`;
  // A freshly generated report wins over the server's cached one for the same
  // window; a navigation to another window falls back to the server's value.
  const [fresh, setFresh] = React.useState<{ key: string; insights: InsightsRollup } | null>(null);
  const insights = fresh && fresh.key === windowKey ? fresh.insights : initialInsights;
  const [open, setOpen] = React.useState(false);

  const generate = useAsyncAction(
    async (force: boolean) => {
      const data = await adminFetch<{ insights?: InsightsRollup }>("/api/admin/conversations/insights", {
        body: { from, to, force },
      });
      if (!data.insights) throw new Error("Insights konnten nicht erstellt werden.");
      return data.insights;
    },
    {
      errorToast: false,
      onSuccess: (result) => {
        setFresh({ key: windowKey, insights: result });
        setOpen(true);
      },
    }
  );

  const hasReport = Boolean(insights && insights.summaryMd);
  const meta = insights
    ? `${plural(insights.analyzedCount, "Zusammenfassung", "Zusammenfassungen")} · ${
        insights.cached ? "zwischengespeichert" : "frisch generiert"
      } · ${formatAdmin(insights.generatedAt, ADMIN_DATE_TIME_MEDIUM, insights.generatedAt)}${
        insights.costEur > 0 ? ` · ~${eur(insights.costEur, 4)}` : ""
      }`
    : undefined;

  return (
    <Disclosure
      title={
        <span className="flex items-center gap-1.5">
          <Sparkles className="size-4 text-accent" aria-hidden />
          Aggregierter Insights-Report
        </span>
      }
      meta={meta}
      open={open}
      onOpenChange={setOpen}
      actions={
        <>
          <InfoTip>
            KI-Pass über die bereits zwischengespeicherten Zusammenfassungen (nicht über
            Transkripte) — günstig und skalierbar. Ergebnis wird je Zeitraum zwischengespeichert.
            Enthält Empfehlungen zur Verfeinerung auf Basis aller analysierten Gespräche.
            {analyzedCount === 0 ? " Zuerst Gespräche analysieren." : ""}
          </InfoTip>
          <Button
            variant="secondary"
            size="sm"
            loading={generate.pending}
            disabled={analyzedCount === 0}
            onClick={() => void generate.run(insights != null && insights.analyzedCount > 0)}
          >
            {!generate.pending && <Sparkles />}
            {generate.pending
              ? "Wird erstellt…"
              : insights && insights.analyzedCount > 0
                ? "Neu generieren"
                : "Insights generieren"}
          </Button>
        </>
      }
    >
      {generate.error && (
        <Callout tone="destructive" compact className="mb-3">
          {generate.error}
        </Callout>
      )}

      {generate.pending && !hasReport && (
        <div className="space-y-1.5" aria-hidden>
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-10/12" />
          <Skeleton className="h-3 w-9/12" />
        </div>
      )}

      {!hasReport && !generate.pending && (
        <EmptyState
          compact
          plain
          title="Noch kein Report für diesen Zeitraum."
          description={
            analyzedCount === 0
              ? "Zuerst Gespräche analysieren (einzeln oder „Alle auswerten“)."
              : "„Insights generieren“ fasst die gespeicherten Analysen zusammen."
          }
        />
      )}

      {hasReport && insights && (
        <div className={generate.pending ? "opacity-60 transition-opacity" : undefined}>
          <Markdown content={insights.summaryMd} className="text-sm" />
          {insights.references.length > 0 ? (
            <InsightsReferences references={insights.references} onOpenConversation={onOpenConversation} />
          ) : (
            insights.cached &&
            insights.model != null && (
              <p className="mt-2 text-2xs italic text-muted-foreground">
                Neu generieren, um verlinkte Beleg-Gespräche zu erhalten.
              </p>
            )
          )}
          {insights.model && (
            <p className="mt-2 text-2xs text-muted-foreground">Modell: {insights.model}</p>
          )}
        </div>
      )}
    </Disclosure>
  );
}

/** Per-section collapsibles listing the conversations that back each finding. */
function InsightsReferences({
  references,
  onOpenConversation,
}: {
  references: InsightsReference[];
  onOpenConversation: (id: number) => void;
}) {
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        Belege
        <InfoTip>
          Kuratierte Beispiele je Abschnitt. Vollständige Listen: Kategorie-/Qualitäts-Balken oben
          anklicken.
        </InfoTip>
      </div>
      {SECTION_ORDER.map((section) => {
        const refs = references.filter((r) => r.section === section);
        if (refs.length === 0) return null;
        return (
          <Disclosure
            key={section}
            title={<span className="text-xs">{SECTION_LABELS[section]}</span>}
            meta={`${num(refs.length)} Beleg-Gespräche`}
            className="bg-surface-2/60"
          >
            <ul className="flex flex-col gap-1.5 text-xs">
              {refs.map((r) => (
                <li key={`${r.section}-${r.conversationId}`}>
                  <button
                    type="button"
                    className="font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => onOpenConversation(r.conversationId)}
                  >
                    Gespräch #{r.conversationId} öffnen
                  </button>
                  {r.reason && <span className="text-muted-foreground"> — {r.reason}</span>}
                </li>
              ))}
            </ul>
          </Disclosure>
        );
      })}
    </div>
  );
}
