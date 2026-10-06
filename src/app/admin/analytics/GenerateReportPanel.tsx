"use client";

// The generator for a new Komplettanalyse. Pick an interval (presets or a custom
// from/to), choose what to include, see a live ZERO-token preview (scope, cost
// incl. the strategist share, expected duration, the report it will be compared
// with), then generate. Generation itself is created server-side as a 'running'
// report and the workspace selects it, where the progress driver finishes it.

import * as React from "react";
import { CalendarRange, Clock, History, Loader2, Sparkles } from "lucide-react";
import { eur, num, plural } from "@/lib/admin-format.mjs";
import { germanDate } from "@/lib/kpi-range.mjs";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  InfoTip,
  Input,
  SegmentedControl,
  Skeleton,
  toast,
} from "../ui";
import { adminFetch, friendlyErrorMessage } from "../lib/admin-fetch";
import { useAsyncAction } from "../lib/use-async-action";

type PresetKey = "7d" | "30d" | "90d" | "custom";
const PRESETS: ReadonlyArray<{ value: PresetKey; label: string }> = [
  { value: "7d", label: "7 Tage" },
  { value: "30d", label: "30 Tage" },
  { value: "90d", label: "90 Tage" },
  { value: "custom", label: "Zeitraum…" },
];

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

interface Estimate {
  range: { from: string; to: string; label: string };
  conversations: number;
  unanalyzed: number;
  personaCount: number;
  customerCount: number;
  estimateEur: number;
  strategistEur?: number;
  minutes?: { low: number; high: number };
  previousReport?: { id: number; title: string; from: string; to: string } | null;
}

function periodText(from: string, to: string) {
  return from === to ? germanDate(from) : `${germanDate(from)} – ${germanDate(to)}`;
}

function PreviewRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-xs text-foreground">
      <span className="mt-0.5 shrink-0 text-muted-foreground [&_svg]:size-3.5" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function GenerateReportPanel({ onCreated }: { onCreated: (id: number) => void }) {
  const [preset, setPreset] = React.useState<PresetKey>("30d");
  const [customFrom, setCustomFrom] = React.useState(todayYmd());
  const [customTo, setCustomTo] = React.useState(todayYmd());
  const [includePerCustomer, setIncludePerCustomer] = React.useState(false);
  const [includeAppendix, setIncludeAppendix] = React.useState(true);
  const [estimate, setEstimate] = React.useState<Estimate | null>(null);
  const [estimating, setEstimating] = React.useState(false);

  const customValid = Boolean(customFrom && customTo && customFrom <= customTo);
  const inputsValid = preset !== "custom" || customValid;

  const requestBody = React.useCallback(
    () => ({
      range: preset,
      from: preset === "custom" ? customFrom : undefined,
      to: preset === "custom" ? customTo : undefined,
      includePerCustomer,
    }),
    [preset, customFrom, customTo, includePerCustomer]
  );

  // Live, debounced cost estimate whenever the interval / per-customer toggle moves.
  React.useEffect(() => {
    if (!inputsValid) {
      setEstimate(null);
      return;
    }
    const controller = new AbortController();
    setEstimating(true);
    const t = setTimeout(async () => {
      try {
        const data = await adminFetch<Estimate>("/api/admin/analytics/estimate", {
          body: requestBody(),
          signal: controller.signal,
        });
        if (!controller.signal.aborted) setEstimate(data);
      } catch {
        if (!controller.signal.aborted) setEstimate(null);
      } finally {
        if (!controller.signal.aborted) setEstimating(false);
      }
    }, 350);
    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [inputsValid, requestBody]);

  const generate = useAsyncAction(
    async () => {
      try {
        const data = await adminFetch<{ id?: number }>("/api/admin/analytics/create", {
          body: { ...requestBody(), includeAppendix },
        });
        if (!data.id) throw new Error("Unbekannter Fehler");
        return data.id;
      } catch (err) {
        toast({
          variant: "error",
          title: "Konnte nicht starten",
          description: friendlyErrorMessage(err),
          duration: 6000,
        });
        throw err;
      }
    },
    { errorToast: false, onSuccess: (id) => onCreated(id) }
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-5 text-accent" aria-hidden />
          Neue Komplettanalyse
          <InfoTip panelClassName="max-w-md">
            Ein Entscheidungsbericht für einen Zeitraum: Das Strategie-Modell (Opus 5.5) liest die
            Geschäftsdaten — Umsatz durch Mo (wie auf der KPI-Seite), vom Chat zur Bestellung, Anmelde- und
            Einwilligungs-Funnel, Kampagnen, Bundles und Briefe, Eingang, Kundenbasis und Wiederkauf, Qualität, Wissen, KI-Kosten — im Vergleich zur
            Vorperiode und zum letzten Bericht, dazu alle Gesprächsanalysen. Heraus kommen die
            Entscheidungen, die jetzt anstehen, die Engpässe, priorisierte Maßnahmen mit Verantwortung
            und Erfolgsmessung, Experimente sowie Risiken und Messhinweise. Bewusst gründlich (und damit
            teurer); die Erstellung läuft schrittweise mit Fortschrittsanzeige, gespeichert und als PDF
            exportierbar.
          </InfoTip>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <div className="text-xs font-semibold text-foreground">Zeitraum</div>
            <SegmentedControl label="Zeitraum" value={preset} options={PRESETS} onChange={(value) => setPreset(value)} />
            {preset === "custom" && (
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-2xs text-muted-foreground">
                  Von
                  <Input
                    type="date"
                    value={customFrom}
                    max={customTo || todayYmd()}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="h-8 w-auto text-xs"
                  />
                </label>
                <label className="flex flex-col gap-1 text-2xs text-muted-foreground">
                  Bis
                  <Input
                    type="date"
                    value={customTo}
                    min={customFrom}
                    max={todayYmd()}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="h-8 w-auto text-xs"
                  />
                </label>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-xs font-semibold text-foreground">Umfang</div>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox checked={includePerCustomer} onChange={(e) => setIncludePerCustomer(e.target.checked)} />
              Einzelne Kundenprofile (identitätsbezogen)
              <InfoTip>
                Regeneriert pro aktivem Kunden das „aktuelle Verständnis“ (Opus) — am teuersten und
                enthält Namen. Sonst bleibt der Bericht pseudonym. Die Profile fließen nie in die
                Strategie-Synthese ein.
              </InfoTip>
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox checked={includeAppendix} onChange={(e) => setIncludeAppendix(e.target.checked)} />
              Anhang: jedes Gespräch auflisten
              <InfoTip>
                Hängt jede Gesprächs-Zusammenfassung (Kategorie, Qualität) an — „alles an einem Ort“,
                aber ein längeres PDF.
              </InfoTip>
            </label>
          </div>

          <div>
            <Button onClick={() => void generate.run()} disabled={!inputsValid} loading={generate.pending}>
              {!generate.pending && <Sparkles />}
              {generate.pending ? "Wird gestartet…" : "Komplettanalyse generieren"}
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface-2 p-4" aria-live="polite">
          <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-foreground">
            Vorschau
            <InfoTip>
              Ohne KI-Aufruf geschätzt. Bereits analysierte Gespräche werden kostenlos wiederverwendet; die
              Dauer hängt vor allem von der Zahl neuer Gespräche und der Denkzeit des Strategie-Modells ab.
              Die Erstellung läuft, solange der Bericht geöffnet ist; wer die Seite verlässt, pausiert sie —
              beim nächsten Öffnen des Berichts geht es an derselben Stelle weiter.
            </InfoTip>
          </div>
          {estimating && !estimate ? (
            <div className="flex flex-col gap-2" aria-busy="true" aria-label="Schätze Umfang und Kosten">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-3/5" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          ) : estimate ? (
            <div className={estimating ? "flex flex-col gap-2.5 opacity-60" : "flex flex-col gap-2.5"}>
              <PreviewRow icon={<CalendarRange />}>
                <span className="font-semibold">{estimate.range.label}</span>
                <div className="text-muted-foreground">
                  {plural(estimate.conversations, "Gespräch", "Gespräche")} · {num(estimate.unanalyzed)} noch zu
                  analysieren · {plural(estimate.personaCount, "Persona-Gruppe", "Persona-Gruppen")}
                  {includePerCustomer ? ` · ${plural(estimate.customerCount, "Kundenprofil", "Kundenprofile")}` : ""}
                </div>
              </PreviewRow>
              <PreviewRow icon={<Sparkles />}>
                Geschätzte KI-Kosten: <strong>ca. {eur(estimate.estimateEur)}</strong>
                {estimate.strategistEur != null && (
                  <div className="text-muted-foreground">
                    davon Entscheidungsteil (Opus 5.5, zwei Durchgänge) ca. {eur(estimate.strategistEur)}
                  </div>
                )}
              </PreviewRow>
              {estimate.minutes && (
                <PreviewRow icon={<Clock />}>
                  Dauer ca. {num(estimate.minutes.low)}–{num(estimate.minutes.high)} Minuten
                </PreviewRow>
              )}
              <PreviewRow icon={<History />}>
                {estimate.previousReport ? (
                  <>
                    Vergleich mit dem letzten Bericht:{" "}
                    <span className="font-medium">{periodText(estimate.previousReport.from, estimate.previousReport.to)}</span>
                  </>
                ) : (
                  "Erster Bericht — verglichen wird mit der Vorperiode."
                )}
              </PreviewRow>
            </div>
          ) : (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              {estimating && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              {inputsValid ? "Keine Schätzung verfügbar." : "Bitte gültigen Zeitraum wählen."}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
