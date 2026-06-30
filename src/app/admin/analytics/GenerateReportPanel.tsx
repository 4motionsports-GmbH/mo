"use client";

// The generator for a new Komplettanalyse. Pick an interval (presets or a custom
// from/to), choose what to include, see a live ZERO-token cost estimate, then
// generate. Generation itself is created server-side as a 'running' report and
// the client is navigated to its page, where the progress driver finishes it.

import * as React from "react";
import { Sparkles, Loader2, CalendarRange, Users, ListTree } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Input,
  Checkbox,
  toast,
} from "../ui";

const PRESETS: Array<{ key: "7d" | "30d" | "90d"; label: string }> = [
  { key: "7d", label: "7 Tage" },
  { key: "30d", label: "30 Tage" },
  { key: "90d", label: "90 Tage" },
];

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}
function eur(n: number): string {
  return n.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
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
  const [preset, setPreset] = React.useState<"7d" | "30d" | "90d" | "custom">("30d");
  const [customFrom, setCustomFrom] = React.useState(todayYmd());
  const [customTo, setCustomTo] = React.useState(todayYmd());
  const [includePerCustomer, setIncludePerCustomer] = React.useState(false);
  const [includeAppendix, setIncludeAppendix] = React.useState(true);

  const [estimate, setEstimate] = React.useState<Estimate | null>(null);
  const [estimating, setEstimating] = React.useState(false);
  const [creating, setCreating] = React.useState(false);

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
    let cancelled = false;
    setEstimating(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/admin/analytics/estimate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody()),
        });
        const data = (await res.json().catch(() => null)) as Estimate | null;
        if (!cancelled && res.ok && data) setEstimate(data);
        else if (!cancelled) setEstimate(null);
      } catch {
        if (!cancelled) setEstimate(null);
      } finally {
        if (!cancelled) setEstimating(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [inputsValid, requestBody]);

  async function generate() {
    setCreating(true);
    try {
      const res = await fetch("/api/admin/analytics/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...requestBody(), includeAppendix }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: number; error?: { message?: string } };
      if (!res.ok || !data.id) {
        toast({
          variant: "error",
          title: "Konnte nicht starten",
          description: data.error?.message ?? "Unbekannter Fehler",
          duration: 6000,
        });
        return;
      }
      // The report row is created 'running'; the workspace selects it and its
      // progress driver finishes generation in place.
      onCreated(data.id);
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler", description: "Bitte erneut versuchen.", duration: 6000 });
    } finally {
      setCreating(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-5 text-accent" />
          Neue Komplettanalyse
        </CardTitle>
        <CardDescription>
          Verdichtet ALLE KI-Analysen für ein Zeitintervall an einem Ort: Gesprächsanalyse, Insights,
          Personas &amp; Top-Fragen, Kundenwissen — gespeichert und als PDF exportierbar. Bewusst
          gründlich (und damit teurer); die Erstellung läuft schrittweise mit Fortschrittsanzeige.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Interval */}
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <CalendarRange className="size-3.5 text-muted-foreground" />
            Zeitraum
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map((p) => (
              <Button
                key={p.key}
                size="sm"
                variant={preset === p.key ? "default" : "outline"}
                onClick={() => setPreset(p.key)}
              >
                {p.label}
              </Button>
            ))}
            <Button
              size="sm"
              variant={preset === "custom" ? "default" : "outline"}
              onClick={() => setPreset("custom")}
              aria-expanded={preset === "custom"}
            >
              Benutzerdefiniert
            </Button>
          </div>
          {preset === "custom" && (
            <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-border/60 pt-2">
              <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                Von
                <Input
                  type="date"
                  value={customFrom}
                  max={customTo || todayYmd()}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="h-8 w-auto"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                Bis
                <Input
                  type="date"
                  value={customTo}
                  min={customFrom}
                  max={todayYmd()}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="h-8 w-auto"
                />
              </label>
            </div>
          )}
        </div>

        {/* Options */}
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-[13px] text-foreground">
            <Checkbox
              checked={includePerCustomer}
              onChange={(e) => setIncludePerCustomer(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="inline-flex items-center gap-1 font-semibold">
                <Users className="size-3.5 text-muted-foreground" />
                Einzelne Kundenprofile (identitätsbezogen)
              </span>
              <span className="block text-[11px] text-muted-foreground">
                Regeneriert pro aktivem Kunden das „aktuelle Verständnis“ (Opus) — am teuersten und
                enthält Namen. Sonst bleibt der Bericht pseudonym.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-[13px] text-foreground">
            <Checkbox
              checked={includeAppendix}
              onChange={(e) => setIncludeAppendix(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="inline-flex items-center gap-1 font-semibold">
                <ListTree className="size-3.5 text-muted-foreground" />
                Anhang: jedes Gespräch auflisten
              </span>
              <span className="block text-[11px] text-muted-foreground">
                Hängt jede Gesprächs-Zusammenfassung (Kategorie, Qualität) an — „alles an einem Ort“,
                aber ein längeres PDF.
              </span>
            </span>
          </label>
        </div>

        {/* Estimate */}
        <div className="rounded-lg border border-dashed border-border bg-muted/30 p-3 text-[12px]">
          {estimating ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Schätze Umfang &amp; Kosten…
            </span>
          ) : estimate ? (
            <div className="space-y-1">
              <div className="font-semibold text-foreground">{estimate.range.label}</div>
              <div className="text-muted-foreground">
                {estimate.conversations} Gespräch(e) · {estimate.unanalyzed} noch zu analysieren ·{" "}
                {estimate.personaCount} Persona-Gruppe(n)
                {includePerCustomer ? ` · ${estimate.customerCount} Kundenprofil(e)` : ""}
              </div>
              <div className="text-foreground">
                Geschätzte KI-Kosten: <strong>ca. {eur(estimate.estimateEur)}</strong>{" "}
                <span className="text-muted-foreground">
                  (bereits analysierte Gespräche werden kostenlos wiederverwendet)
                </span>
              </div>
            </div>
          ) : (
            <span className="text-muted-foreground">
              {inputsValid ? "Keine Schätzung verfügbar." : "Bitte gültigen Zeitraum wählen."}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={generate} disabled={!inputsValid || creating}>
            {creating ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {creating ? "Wird gestartet…" : "Komplettanalyse generieren"}
          </Button>
          <span className="text-[11px] text-muted-foreground">
            Erscheint sofort links im Seitenpanel und läuft dort weiter.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
