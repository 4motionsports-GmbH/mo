"use client";

// „Wirkung umgesetzter Änderungen“ — every adopted directive and implemented
// change of the last 120 days, measured on its success metric: the before and
// after windows with both sample sizes, the change, the test, the verdict and
// its confidence, the target, side effects on the guardrail metrics and every
// confounder (other changes, releases, switch flips; a measurement change
// blocks the comparison). The strategist's reading (keep / adjust / roll back
// / watch, next step) sits on each card when the Wirkungs-Check ran.

import * as React from "react";
import { AlertTriangle, CalendarClock, FlaskConical, GitCommitHorizontal, MessageSquareText, Rocket, ToggleRight } from "lucide-react";
import { formatMetricValue } from "@/lib/business-snapshot-core.mjs";
import { germanDate } from "@/lib/kpi-range.mjs";
import { num } from "@/lib/admin-format.mjs";
import { OWNER_LANE_LABELS } from "@/lib/improvement-core.mjs";
import type { EffectReview, Measurement, MeasuredMetric } from "@/lib/improvement-types";
import { Card, CardContent, Disclosure, Section, StatusBadge, cn } from "../ui";
import { DeltaPill, type SnapshotMetric } from "../analytics/report-parts";
import { ConfidenceBadge, FieldLabel, RecommendationBadge, VerdictBadge } from "./parts";

const SOURCE_LABELS: Record<Measurement["metricSource"], string> = {
  erfolgsmass: "Erfolgskennzahl des Vorschlags",
  erwartete_wirkung: "aus der erwarteten Wirkung",
  standard: "Standardkennzahl des Bereichs",
};

function stateLine(m: Measurement): string {
  const since = germanDate(m.date);
  if (m.kind === "directive") {
    if (m.state === "deaktiviert") return `Anweisung #${m.id} · live vom ${since} bis ${m.until ? germanDate(m.until) : "?"}`;
    return `Anweisung #${m.id} · ${m.state === "geaendert" ? "Text geändert am" : "live seit"} ${since}`;
  }
  return `Vorschlag #${m.id} · erledigt am ${since}`;
}

function testText(x: MeasuredMetric): string {
  if (x.verdict === "zu_frueh" || x.verdict === "nicht_messbar" || x.verdict === "nicht_vergleichbar") return "";
  if (x.test === "none") return "ohne Test (nur Richtung)";
  const via = x.test === "companion" ? " über die Bestellungen" : x.test === "poisson_rate" ? " je Gespräch" : "";
  const z = x.z == null ? "" : `z = ${num(x.z, 2)}`;
  const reading = x.significant ? "statistisch klar" : x.small ? "kleine Stichprobe — nicht belastbar" : "im Rahmen des Zufalls";
  return `${z}${via} · ${reading}`;
}

function nText(n: MeasuredMetric["testN"], which: "before" | "after", unit: MeasuredMetric["unit"]): string {
  if (!n || (unit !== "rate" && unit !== "ratio")) return "";
  const v = which === "after" ? n.after : n.before;
  return v == null ? "" : ` (n = ${num(v)})`;
}

export function EffectsSection({ measurements, review }: { measurements: Measurement[]; review: EffectReview | null }) {
  const byRef = React.useMemo(() => new Map((review?.items ?? []).map((i) => [i.ref, i])), [review]);
  const counts = React.useMemo(() => {
    const c = { besser: 0, schlechter: 0, offen: 0 };
    for (const m of measurements) {
      if (m.verdict.startsWith("besser")) c.besser += 1;
      else if (m.verdict.startsWith("schlechter")) c.schlechter += 1;
      else c.offen += 1;
    }
    return c;
  }, [measurements]);

  return (
    <section id="v-wirkung" className="scroll-mt-24">
      <Section
        title={
          <span className="inline-flex items-center gap-1.5">
            <FlaskConical className="size-4 text-accent" aria-hidden />
            Wirkung umgesetzter Änderungen
          </span>
        }
        level={3}
        info="Jede übernommene Anweisung und jede als erledigt markierte Maßnahme der letzten 120 Tage, gemessen an ihrer Erfolgskennzahl: „nachher“ = ab dem Tag nach der Änderung bis zum Messhorizont (nie der laufende Tag), „vorher“ = gleich lang davor. Getestet wird auf beiden Stichproben (Quoten: zwei Anteile, Anzahlen: Poisson, Umsatz über die Bestellungen). Andere Änderungen, Releases und umgestellte Schalter im Zeitraum sind Störfaktoren und senken die Konfidenz; ändert sich die Messung selbst, gibt es kein Urteil. Vorher/Nachher zeigt eine Bewegung, keinen Beweis der Ursache."
        actions={
          measurements.length > 0 ? (
            <span className="flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
              <StatusBadge tone="success" dot={false}>
                {num(counts.besser)} besser
              </StatusBadge>
              <StatusBadge tone={counts.schlechter ? "destructive" : "neutral"} dot={false}>
                {num(counts.schlechter)} schlechter
              </StatusBadge>
              <StatusBadge tone="neutral" dot={false}>
                {num(counts.offen)} offen / unverändert
              </StatusBadge>
            </span>
          ) : undefined
        }
      >
        {review?.summary && (
          <Card className="mb-3 bg-accent-soft/40">
            <CardContent className="p-4 pt-4">
              <FieldLabel>Wirkungs-Check (Opus 5.5)</FieldLabel>
              <p className="mt-1 text-sm leading-relaxed text-foreground">{review.summary}</p>
            </CardContent>
          </Card>
        )}
        {measurements.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Keine umgesetzten Änderungen in den letzten 120 Tagen. Übernommene Anweisungen und als erledigt markierte
            Vorschläge misst der nächste Lauf an ihrer Erfolgskennzahl.
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {measurements.map((m) => (
              <li key={m.ref}>
                <MeasurementCard m={m} review={byRef.get(m.ref) ?? null} />
              </li>
            ))}
          </ol>
        )}
      </Section>
    </section>
  );
}

function MeasurementCard({ m, review }: { m: Measurement; review: EffectReview["items"][number] | null }) {
  const primary = m.metrics[0];
  const guardrails = m.metrics.slice(1);
  const w = m.window;
  const reasons = primary?.reasons ?? [];
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-2xs font-medium text-muted-foreground">
              {m.kind === "directive" ? (
                <MessageSquareText className="size-3.5" aria-hidden />
              ) : (
                <GitCommitHorizontal className="size-3.5" aria-hidden />
              )}
              {stateLine(m)} · {(OWNER_LANE_LABELS as Record<string, string>)[m.lane] ?? m.lane}
            </p>
            <h4 className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-foreground">{m.title}</h4>
          </div>
          <span className="flex shrink-0 flex-wrap items-center gap-1.5">
            <VerdictBadge verdict={m.verdict} size="md" />
            <ConfidenceBadge level={m.confidence} />
          </span>
        </div>

        {primary && (
          <div className="grid gap-3 rounded-lg border border-border bg-surface-2 p-3 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <FieldLabel>{SOURCE_LABELS[m.metricSource]}</FieldLabel>
              <p className="mt-0.5 text-sm font-medium text-foreground">
                {primary.label} <code className="ml-1 rounded bg-card px-1 text-2xs font-normal text-muted-foreground">{primary.key}</code>
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs tabular-nums text-foreground">
                <span className="text-muted-foreground">vorher</span>
                {formatMetricValue(primary.unit, primary.previous)}
                <span className="text-muted-foreground">{nText(primary.testN, "before", primary.unit)}</span>
                <span className="text-muted-foreground">→ nachher</span>
                <strong className="font-semibold">{formatMetricValue(primary.unit, primary.value)}</strong>
                <span className="text-muted-foreground">{nText(primary.testN, "after", primary.unit)}</span>
                {primary.delta && <DeltaPill metric={primary as unknown as SnapshotMetric} />}
              </p>
              {testText(primary) && <p className="mt-0.5 text-2xs text-muted-foreground">{testText(primary)}</p>}
            </div>
            <div className="flex min-w-0 flex-col gap-1 text-2xs text-muted-foreground">
              {w.days > 0 && w.before ? (
                <p className="flex items-start gap-1.5">
                  <CalendarClock className="mt-px size-3.5 shrink-0" aria-hidden />
                  <span>
                    nachher {germanDate(w.from)} – {germanDate(w.to)} ({num(w.days)} Tage
                    {w.complete ? "" : ` von ${num(w.horizonDays)}, läuft noch`}) · vorher {germanDate(w.before.from)} –{" "}
                    {germanDate(w.before.to)}
                  </span>
                </p>
              ) : (
                <p className="flex items-start gap-1.5">
                  <CalendarClock className="mt-px size-3.5 shrink-0" aria-hidden />
                  <span>Noch kein vollständiger Tag nach der Änderung.</span>
                </p>
              )}
              {m.target && (
                <p className={cn("font-medium", m.target.reached ? "text-success" : "text-foreground")}>
                  Ziel {m.target.direction === "down" ? "≤" : "≥"} {formatMetricValue(primary.unit, m.target.value)} —{" "}
                  {m.target.reached === null ? "nicht prüfbar" : m.target.reached ? "erreicht" : "noch nicht erreicht"}
                </p>
              )}
              {m.sideEffects.length > 0 && (
                <p className="flex items-start gap-1.5 text-warning">
                  <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
                  <span>
                    Nebenwirkung: {m.sideEffects.map((s) => `${s.label} ${s.deltaText}`).join(" · ")}
                  </span>
                </p>
              )}
            </div>
          </div>
        )}

        {m.confounders.length > 0 && (
          <ul className="flex flex-col gap-0.5 text-2xs">
            {m.confounders.map((c, i) => (
              <li key={i} className={cn("flex items-start gap-1.5", c.measurement ? "text-warning" : "text-muted-foreground")}>
                {c.kind === "release" ? (
                  <Rocket className="mt-px size-3 shrink-0" aria-hidden />
                ) : c.kind === "switch" ? (
                  <ToggleRight className="mt-px size-3 shrink-0" aria-hidden />
                ) : (
                  <GitCommitHorizontal className="mt-px size-3 shrink-0" aria-hidden />
                )}
                <span>
                  {c.measurement ? "Messänderung: " : "Störfaktor: "}
                  {c.label}
                  {c.date && c.kind === "release" ? ` (${germanDate(c.date)})` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}

        {review && (
          <div className="rounded-lg border border-accent/30 bg-accent-soft/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <FieldLabel>Einschätzung (Opus 5.5)</FieldLabel>
              <RecommendationBadge value={review.recommendation} />
            </div>
            <p className="mt-1 text-xs text-foreground">{review.assessment}</p>
            {review.nextStep && (
              <p className="mt-1 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Nächster Schritt:</span> {review.nextStep}
              </p>
            )}
          </div>
        )}

        {(reasons.length > 0 || guardrails.length > 0) && (
          <Disclosure title={<span className="text-xs">Warum dieses Urteil? Nebenwirkungen</span>} framed={false}>
            <div className="flex flex-col gap-2 text-xs">
              {reasons.length > 0 && (
                <ul className="flex flex-col gap-0.5 text-muted-foreground">
                  {reasons.map((r, i) => (
                    <li key={i}>· {r}</li>
                  ))}
                </ul>
              )}
              {guardrails.map((g) => (
                <div key={g.key} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-muted-foreground">Nebenwirkung</span>
                  <span className="text-foreground">{g.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatMetricValue(g.unit, g.previous)} → {formatMetricValue(g.unit, g.value)}
                  </span>
                  {g.delta && <DeltaPill metric={g as unknown as SnapshotMetric} />}
                  <VerdictBadge verdict={g.verdict} />
                </div>
              ))}
            </div>
          </Disclosure>
        )}
      </CardContent>
    </Card>
  );
}
