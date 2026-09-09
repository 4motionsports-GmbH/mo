"use client";

// The generator for a new Komplettanalyse. Pick an interval (presets or a custom
// from/to), choose what to include, see a live ZERO-token cost estimate, then
// generate. Generation itself is created server-side as a 'running' report and
// the workspace selects it, where the progress driver finishes it.

import * as React from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { eur, num, plural } from "@/lib/admin-format.mjs";
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
            Verdichtet ALLE KI-Analysen für ein Zeitintervall an einem Ort: Gesprächsanalyse,
            Insights, Personas &amp; Top-Fragen, Kundenwissen — gespeichert und als PDF exportierbar.
            Bewusst gründlich (und damit teurer); die Erstellung läuft schrittweise mit
            Fortschrittsanzeige. Der neue Bericht erscheint sofort links im Seitenpanel und läuft
            dort weiter.
          </InfoTip>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold text-foreground">Zeitraum</div>
          <SegmentedControl
            label="Zeitraum"
            value={preset}
            options={PRESETS}
            onChange={(value) => setPreset(value)}
          />
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
            <Checkbox
              checked={includePerCustomer}
              onChange={(e) => setIncludePerCustomer(e.target.checked)}
            />
            Einzelne Kundenprofile (identitätsbezogen)
            <InfoTip>
              Regeneriert pro aktivem Kunden das „aktuelle Verständnis“ (Opus) — am teuersten und
              enthält Namen. Sonst bleibt der Bericht pseudonym.
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

        <div className="rounded-lg border border-dashed border-border bg-surface-2 p-3 text-xs" aria-live="polite">
          {estimating ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Schätze Umfang &amp; Kosten…
            </span>
          ) : estimate ? (
            <div className="flex flex-col gap-1">
              <div className="font-semibold text-foreground">{estimate.range.label}</div>
              <div className="text-muted-foreground">
                {plural(estimate.conversations, "Gespräch", "Gespräche")} · {num(estimate.unanalyzed)}{" "}
                noch zu analysieren · {plural(estimate.personaCount, "Persona-Gruppe", "Persona-Gruppen")}
                {includePerCustomer ? ` · ${plural(estimate.customerCount, "Kundenprofil", "Kundenprofile")}` : ""}
              </div>
              <div className="flex items-center gap-1.5 text-foreground">
                Geschätzte KI-Kosten: <strong>ca. {eur(estimate.estimateEur)}</strong>
                <InfoTip>Bereits analysierte Gespräche werden kostenlos wiederverwendet.</InfoTip>
              </div>
            </div>
          ) : (
            <span className="text-muted-foreground">
              {inputsValid ? "Keine Schätzung verfügbar." : "Bitte gültigen Zeitraum wählen."}
            </span>
          )}
        </div>

        <div>
          <Button onClick={() => void generate.run()} disabled={!inputsValid} loading={generate.pending}>
            {!generate.pending && <Sparkles />}
            {generate.pending ? "Wird gestartet…" : "Komplettanalyse generieren"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
