"use client";

// "Neuer Verbesserungslauf": pick a completed Komplettanalyse and start a run
// (POST /api/admin/improve/run). The three-step explanation lives in the (i).

import * as React from "react";
import { Sparkles } from "lucide-react";
import { Button, Callout, Card, CardContent, Field, InfoTip, Select } from "../ui";
import { adminFetch, friendlyErrorMessage } from "../lib/admin-fetch";
import { useAsyncAction } from "../lib/use-async-action";
import { toast } from "../ui";
import type { CompletedReportOption } from "./types";

export function NewRunPanel({
  completedReports,
  hasRuns,
  onCreated,
}: {
  completedReports: CompletedReportOption[];
  hasRuns: boolean;
  onCreated: (id: number) => void;
}) {
  const [reportId, setReportId] = React.useState<string>(
    completedReports.length > 0 ? String(completedReports[0].id) : ""
  );
  const start = useAsyncAction(
    async () => {
      const id = Number(reportId);
      if (!Number.isInteger(id) || id <= 0) return null;
      try {
        const data = await adminFetch<{ id?: number }>("/api/admin/improve/run", { body: { reportId: id } });
        if (!data.id) throw new Error("Unbekannter Fehler.");
        return data.id;
      } catch (err) {
        toast({
          variant: "error",
          title: "Lauf konnte nicht gestartet werden",
          description: friendlyErrorMessage(err),
        });
        throw err;
      }
    },
    { errorToast: false, onSuccess: (id) => id != null && onCreated(id) }
  );

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <Sparkles className="size-4 text-accent" aria-hidden />
          Neuer Verbesserungslauf
          <InfoTip label="So funktioniert es" panelClassName="max-w-md">
            <p>
              <strong>1 · Mo schlägt vor:</strong> Er liest die gewählte Komplettanalyse und seine
              eigene Konfiguration und macht daraus belegte Vorschläge — für den Shop und für sich
              selbst.
            </p>
            <p>
              <strong>2 · Du entscheidest:</strong> Jede Karte übernehmen, als erledigt markieren
              oder verwerfen. Nichts passiert automatisch.
            </p>
            <p>
              <strong>3 · Der nächste Lauf misst:</strong>{" "}
              {hasRuns
                ? "Dieser Lauf beginnt mit dem Wirkungs-Check — haben die beschlossenen Maßnahmen die Kennzahlen bewegt?"
                : "Ab dem zweiten Lauf prüft Mo ehrlich, ob die beschlossenen Maßnahmen die Kennzahlen bewegt haben."}
            </p>
            <p>
              2–3 Modell-Aufrufe (Sonnet) · typischerweise deutlich unter 0,50 €. Es wird nichts
              automatisch geändert — jeder Vorschlag wartet auf deine Entscheidung.
            </p>
          </InfoTip>
        </h2>

        {completedReports.length === 0 ? (
          <Callout tone="warning">
            Noch keine fertige Komplettanalyse vorhanden — bitte zuerst im Tab „Analyse“ eine
            Komplettanalyse erstellen.
          </Callout>
        ) : (
          <>
            <Field label="Grundlage" info="Eine fertige Komplettanalyse — der Lauf liest ihre Kennzahlen, Insights und Personas." htmlFor="vb-report">
              <Select id="vb-report" value={reportId} onChange={(e) => setReportId(e.target.value)}>
                {completedReports.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                2–3 Modell-Aufrufe (Sonnet) · typischerweise deutlich unter 0,50 €
              </span>
              <Button onClick={() => void start.run()} disabled={!reportId} loading={start.pending}>
                {!start.pending && <Sparkles />}
                Lauf starten
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
