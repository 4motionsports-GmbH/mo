"use client";

// "Neuer Verbesserungslauf": choose the period of the business data (a
// Komplettanalyse's or the last 7 / 30 / 90 full days), optionally a
// Komplettanalyse whose conversation insights the chat suggestions read and
// whose open recommendations come into the run, and start
// (POST /api/admin/improve/run). The steps of a run, the model and the
// estimate are shown before starting; the explanation lives in the (i).

import * as React from "react";
import { BarChart3, FileText, FlaskConical, Lightbulb, Sparkles } from "lucide-react";
import { germanDate } from "@/lib/kpi-range.mjs";
import { eur, num } from "@/lib/admin-format.mjs";
import { Button, Card, CardContent, Checkbox, Field, InfoTip, SegmentedControl, Select, cn, toast } from "../ui";
import { adminFetch, friendlyErrorMessage } from "../lib/admin-fetch";
import { useAsyncAction } from "../lib/use-async-action";
import type { CompletedReportOption, RunEstimate } from "./types";

type Preset = "report" | "7d" | "30d" | "90d";

export function NewRunPanel({
  completedReports,
  hasRuns,
  estimate,
  onCreated,
}: {
  completedReports: CompletedReportOption[];
  hasRuns: boolean;
  estimate: RunEstimate;
  onCreated: (id: number) => void;
}) {
  const initial = completedReports.find((r) => r.decision) ?? completedReports[0] ?? null;
  const [reportId, setReportId] = React.useState<string>(initial ? String(initial.id) : "");
  const [preset, setPreset] = React.useState<Preset>(initial ? "report" : "30d");
  const [importRecs, setImportRecs] = React.useState(true);
  const report = completedReports.find((r) => String(r.id) === reportId) ?? null;
  const effectivePreset: Preset = !report && preset === "report" ? "30d" : preset;
  const willImport = Boolean(report?.decision && report.recommendations.open > 0 && importRecs);

  const start = useAsyncAction(
    async () => {
      try {
        const data = await adminFetch<{ id?: number }>("/api/admin/improve/run", {
          body: {
            reportId: report ? report.id : null,
            preset: effectivePreset,
            importRecommendations: willImport,
          },
        });
        if (!data.id) throw new Error("Unbekannter Fehler.");
        return data.id;
      } catch (err) {
        toast({ variant: "error", title: "Lauf konnte nicht gestartet werden", description: friendlyErrorMessage(err) });
        throw err;
      }
    },
    { errorToast: false, onSuccess: (id) => id != null && onCreated(id) }
  );

  const presetOptions = [
    ...(report
      ? [{ value: "report" as Preset, label: `Wie die Analyse (${germanDate(report.from).slice(0, 6)}–${germanDate(report.to).slice(0, 6)})` }]
      : []),
    { value: "7d" as Preset, label: "7 Tage" },
    { value: "30d" as Preset, label: "30 Tage" },
    { value: "90d" as Preset, label: "90 Tage" },
  ];
  const withEffectCheck = estimate.changesToMeasure > 0;
  const steps = [
    { icon: <BarChart3 />, label: "Geschäftsdaten", note: "Zeitraum vs. Vorperiode" },
    {
      icon: <FlaskConical />,
      label: "Wirkung messen",
      note: withEffectCheck ? `${num(estimate.changesToMeasure)} Änderungen` : "noch keine Änderungen",
    },
    { icon: <Sparkles />, label: "Wirkungs-Check", note: withEffectCheck ? "Opus 5.5" : "entfällt", muted: !withEffectCheck },
    { icon: <Lightbulb />, label: "Vorschläge", note: "Opus 5.5 · 2 Durchgänge" },
  ];

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <Sparkles className="size-4 text-accent" aria-hidden />
          Neuer Verbesserungslauf
          <InfoTip label="So funktioniert es" panelClassName="max-w-md">
            <p>
              <strong>1 · Geschäftsdaten:</strong> Umsatz durch Mo, der Weg vom Chat zur Bestellung, Anmeldung, Einwilligung,
              Kampagnen, Eingang, Wissen, Qualität und KI-Kosten des Zeitraums — dieselben Zahlen wie die KPIs, gegen die
              gleich lange Vorperiode.
            </p>
            <p>
              <strong>2 · Wirkung messen:</strong> Jede übernommene Anweisung und jede erledigte Maßnahme wird an ihrer
              Erfolgskennzahl gemessen — vorher gegen nachher, mit Stichprobe, Test und Störfaktoren.
              {hasRuns ? "" : " Ab dem Moment, in dem du die ersten Vorschläge übernimmst."}
            </p>
            <p>
              <strong>3 · Vorschläge:</strong> Das Strategie-Modell (Opus 5.5) bewertet die Wirkung und schlägt vor, was als
              Nächstes zu tun ist — mit Belegen, erwarteter Wirkung, Erfolgskennzahl, Aufwand, Risiko, wer handelt und wo.
            </p>
            <p>
              <strong>4 · Du entscheidest:</strong> Übernehmen, einplanen oder verwerfen. Nichts passiert automatisch.
            </p>
          </InfoTip>
        </h2>

        <ol className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <li
              key={s.label}
              className={cn(
                "flex items-start gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2",
                s.muted && "opacity-60"
              )}
            >
              <span className="mt-0.5 inline-flex text-accent [&_svg]:size-4" aria-hidden>
                {s.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-foreground">
                  {i + 1} · {s.label}
                </span>
                <span className="block text-2xs text-muted-foreground">{s.note}</span>
              </span>
            </li>
          ))}
        </ol>

        <div className="grid gap-4 lg:grid-cols-2">
          <Field
            label="Komplettanalyse"
            info="Optional. Ihre Gesprächs-Insights, Personas und das Kundenwissen fließen in die Vorschläge zu Chat & Prompt ein. Bei einer Entscheidungs-Analyse können ihre Maßnahmen hier übernommen werden — dann werden sie hier entschieden und im nächsten Lauf gemessen."
            htmlFor="vb-report"
          >
            <Select
              id="vb-report"
              value={reportId}
              onChange={(e) => {
                setReportId(e.target.value);
                setPreset(e.target.value ? "report" : "30d");
              }}
            >
              <option value="">Ohne Komplettanalyse</option>
              {completedReports.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                  {r.decision ? "" : " (ohne Entscheidungsteil)"}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Zeitraum der Geschäftsdaten"
            info="Verglichen mit der gleich langen Vorperiode. Die Voreinstellungen enden gestern — ein angebrochener Tag würde die Zahlen verzerren."
          >
            <SegmentedControl
              label="Zeitraum der Geschäftsdaten"
              size="sm"
              value={effectivePreset}
              onChange={setPreset}
              options={presetOptions}
            />
          </Field>
        </div>

        {report?.decision &&
          (report.recommendations.open > 0 ? (
            <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
              <Checkbox checked={importRecs} onChange={(e) => setImportRecs(e.target.checked)} className="mt-0.5" />
              <span>
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <FileText className="size-3.5 text-accent" aria-hidden />
                  Maßnahmen der Komplettanalyse übernehmen
                </span>
                <span className="block text-xs text-muted-foreground">
                  {num(report.recommendations.open)} von {num(report.recommendations.total)} noch nicht im Backlog
                </span>
              </span>
            </label>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <FileText className="size-3.5" aria-hidden />
              Alle {num(report.recommendations.total)} Maßnahmen dieser Analyse sind schon im Backlog.
            </p>
          ))}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            Strategie-Modell Opus 5.5 · ca. {eur(withEffectCheck ? estimate.eurWithEffectCheck : estimate.eurWithoutEffectCheck)} ·{" "}
            {num(estimate.minutes[0])}–{num(estimate.minutes[1])} Minuten
            <InfoTip>
              Zwei bis drei Durchgänge des Strategie-Modells mit hoher Denktiefe; die Messung und die Geschäftsdaten kosten
              nichts. Die tatsächlichen Kosten stehen am Lauf und unter KPIs → KI-Kosten („Verbesserung“).
            </InfoTip>
          </span>
          <Button onClick={() => void start.run()} loading={start.pending}>
            {!start.pending && <Sparkles />}
            Lauf starten
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
