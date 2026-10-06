"use client";

// One improvement suggestion as a decision card.
//
// v2 (decision-grade): priority, owner lane, impact / effort / confidence /
// risk, where it came from (engine or a Komplettanalyse) → title → the
// directive text (chat & prompt, editable before adopting) → why / what to
// do / expected impact / success metric (a snapshot key with today's value
// and the target, measured by the next run) → the evidence as frozen snapshot
// numbers → the link to the admin screen where it is acted on → actions.
//
// v1 (runs before 2026-10-06): the original card — the action, a details
// toggle with rationale, evidence and the expected effect.
//
// The operator's mental model is a to-do list: Neu → Geplant → Erledigt /
// Verworfen. A card with a directive has ONE primary action („Übernehmen“)
// that adopts the text as a live directive and marks the card Erledigt; every
// other card is planned or marked done when it is live. „Verwerfen“ asks for
// an optional note (it feeds the next run).

import * as React from "react";
import { CalendarCheck, Check, CornerDownRight, FileText, RotateCcw, Target, Wand2, X } from "lucide-react";
import {
  MO_CATEGORIES,
  SHOP_CATEGORIES,
  SUGGESTION_STATUS_LABELS,
  MAX_DIRECTIVE_CHARS,
} from "@/lib/improvement-core.mjs";
import { effortLabel } from "@/lib/improvement-decision.mjs";
import { formatMetricValue } from "@/lib/business-snapshot-core.mjs";
import { num } from "@/lib/admin-format.mjs";
import {
  Button,
  Card,
  CardContent,
  Disclosure,
  Input,
  Markdown,
  StatusBadge,
  Textarea,
  Tooltip,
  cn,
  toast,
  type StatusTone,
} from "../ui";
import { adminFetch, friendlyErrorMessage } from "../lib/admin-fetch";
import { AdminLinkButton } from "../analytics/report-parts";
import { FieldLabel, LaneBadge, MetricChip, PriorityBadge } from "./parts";
import type { SuggestionItem } from "./types";

export type { SuggestionItem } from "./types";

const STATUS_TONE: Record<SuggestionItem["status"], StatusTone> = {
  open: "neutral",
  accepted: "info",
  implemented: "success",
  dismissed: "neutral",
};

function levelTone(kind: "impact" | "effort" | "confidence" | "risk", v: string): StatusTone {
  if (kind === "effort") return v === "niedrig" ? "success" : v === "hoch" ? "warning" : "neutral";
  if (kind === "risk") return v === "hoch" ? "destructive" : v === "mittel" ? "warning" : "neutral";
  if (kind === "confidence") return v === "hoch" ? "info" : v === "niedrig" ? "warning" : "neutral";
  return v === "hoch" ? "accent" : v === "mittel" ? "info" : "neutral";
}

function Level({ kind, value }: { kind: "impact" | "effort" | "confidence" | "risk"; value: string | null | undefined }) {
  if (!value) return null;
  const label = { impact: "Wirkung", effort: "Aufwand", confidence: "Konfidenz", risk: "Risiko" }[kind];
  return (
    <StatusBadge tone={levelTone(kind, value)} dot={false}>
      {label} {kind === "effort" ? effortLabel(value) : value}
    </StatusBadge>
  );
}

export function SuggestionCard({
  suggestion,
  onChanged,
  range,
  showRun = false,
}: {
  suggestion: SuggestionItem;
  onChanged: (s: SuggestionItem) => void;
  /** The run's period — KPI links open on it. */
  range: { from: string; to: string } | null;
  /** Backlog view: name the run the suggestion came from. */
  showRun?: boolean;
}) {
  const [dismissing, setDismissing] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  // The directive text is directly editable BEFORE adopting — whatever stands
  // in the box is exactly what goes live into Mo's system prompt.
  const [directiveDraft, setDirectiveDraft] = React.useState(suggestion.directiveText ?? "");

  const applyStatus = async (status: SuggestionItem["status"], statusNote?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const data = await adminFetch<{ suggestion?: SuggestionItem }>("/api/admin/improve/suggestion", {
        body: { suggestionId: suggestion.id, status, note: statusNote?.trim() || undefined },
      });
      if (!data.suggestion) throw new Error("Unbekannter Fehler");
      onChanged(data.suggestion);
      setDismissing(false);
      setNote("");
    } catch (err) {
      toast({ variant: "error", title: "Änderung fehlgeschlagen", description: friendlyErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const adopt = async () => {
    if (busy || !directiveDraft.trim()) return;
    setBusy(true);
    try {
      const data = await adminFetch<{ suggestion?: SuggestionItem }>("/api/admin/improve/adopt", {
        // Send the (possibly edited) text — the server stores exactly this.
        body: { suggestionId: suggestion.id, content: directiveDraft },
      });
      if (!data.suggestion) throw new Error("Unbekannter Fehler");
      onChanged(data.suggestion);
      toast({
        variant: "success",
        title: "Übernommen — Mo berät ab sofort so",
        description: "Die Regel steht jetzt in „Anweisungen an Mo“ (unten); der nächste Lauf misst ihre Wirkung.",
      });
    } catch (err) {
      toast({ variant: "error", title: "Übernahme fehlgeschlagen", description: friendlyErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const { status } = suggestion;
  const hasDirective = Boolean(suggestion.directiveText);
  const decided = status === "implemented" || status === "dismissed";

  const directiveBox = hasDirective ? (
    <div className="rounded-lg border border-accent/30 bg-accent-soft/60 p-3">
      <FieldLabel>So würde Mo künftig beraten</FieldLabel>
      {decided ? (
        <p className="mt-1 text-sm text-foreground">{suggestion.directiveText}</p>
      ) : (
        <>
          <Textarea
            value={directiveDraft}
            onChange={(e) => setDirectiveDraft(e.target.value)}
            maxLength={MAX_DIRECTIVE_CHARS}
            className="mt-1 min-h-[80px] bg-card text-sm"
            aria-label="Anweisungstext"
          />
          <p className="mt-1 text-2xs text-muted-foreground">
            Direkt anpassbar — genau dieser Text gilt nach dem Übernehmen · {num(directiveDraft.trim().length)}/
            {num(MAX_DIRECTIVE_CHARS)} Zeichen
          </p>
        </>
      )}
    </div>
  ) : null;

  return (
    <Card className={cn(status === "dismissed" && "opacity-75")}>
      <CardContent className="flex flex-col gap-3 p-4">
        {suggestion.detailsVersion === 2 && suggestion.details ? (
          <DecisionBody suggestion={suggestion} range={range} directiveBox={directiveBox} showRun={showRun} />
        ) : (
          <LegacyBody suggestion={suggestion} directiveBox={directiveBox} showRun={showRun} />
        )}

        {suggestion.statusNote && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Notiz:</span> {suggestion.statusNote}
          </p>
        )}

        {dismissing ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Warum nicht? (optional)</span>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="z. B. zu teuer, Evidenz zu dünn"
              className="h-8 w-64 text-sm"
              aria-label="Grund für das Verwerfen"
            />
            <Button size="sm" variant="outline" onClick={() => void applyStatus("dismissed", note)} loading={busy}>
              {!busy && <X />}
              Endgültig verwerfen
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDismissing(false)} disabled={busy}>
              Abbrechen
            </Button>
          </div>
        ) : status === "dismissed" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void applyStatus("open")} loading={busy}>
              {!busy && <RotateCcw />}
              Wieder öffnen
            </Button>
          </div>
        ) : status === "implemented" ? null : (
          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
            {hasDirective ? (
              <Button size="sm" onClick={() => void adopt()} disabled={!directiveDraft.trim()} loading={busy}>
                {!busy && <Wand2 />}
                Übernehmen — gilt ab sofort
              </Button>
            ) : (
              <Button size="sm" onClick={() => void applyStatus("implemented")} loading={busy}>
                {!busy && <Check />}
                Erledigt — ist umgesetzt
              </Button>
            )}
            {status === "open" && (
              <Button size="sm" variant="outline" onClick={() => void applyStatus("accepted")} disabled={busy}>
                <CalendarCheck />
                Einplanen
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setDismissing(true)} disabled={busy}>
              <X />
              Verwerfen
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusLine({ suggestion, showRun }: { suggestion: SuggestionItem; showRun: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {showRun && <span className="text-2xs text-muted-foreground">Lauf #{suggestion.runId}</span>}
      <StatusBadge tone={STATUS_TONE[suggestion.status]} dot={suggestion.status !== "open"}>
        {(SUGGESTION_STATUS_LABELS as Record<string, string>)[suggestion.status] ?? suggestion.status}
      </StatusBadge>
    </span>
  );
}

// ── v2 ────────────────────────────────────────────────────────────────────────

function SuccessMetricLine({ suggestion }: { suggestion: SuggestionItem }) {
  const sm = suggestion.details?.successMetric;
  if (!sm || !sm.key) {
    return (
      <p className="text-xs text-muted-foreground">
        {sm?.text ? `${sm.text} — ` : ""}keine Kennzahl aus den Geschäftsdaten; der nächste Lauf misst mit der Standardkennzahl des Bereichs.
      </p>
    );
  }
  const unit = sm.unit ?? "count";
  return (
    <div className="flex flex-col gap-1">
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-foreground">
        <Target className="size-3.5 shrink-0 text-accent" aria-hidden />
        <span className="font-medium">{sm.label ?? sm.key}</span>
        <code className="rounded bg-surface-2 px-1 text-2xs text-muted-foreground">{sm.key}</code>
        {sm.baseline && (
          <span className="tabular-nums text-muted-foreground">
            jetzt {formatMetricValue(unit, sm.baseline.value)}
          </span>
        )}
        <span className="tabular-nums">
          {sm.target != null
            ? `→ Ziel ${sm.direction === "down" ? "≤" : "≥"} ${formatMetricValue(unit, sm.target)}`
            : sm.direction === "down"
              ? "→ soll sinken"
              : "→ soll steigen"}
        </span>
        <span className="text-muted-foreground">· messbar nach {num(sm.horizonDays)} Tagen</span>
      </p>
      {sm.text && <p className="text-2xs text-muted-foreground">Vorgabe der Komplettanalyse: {sm.text}</p>}
    </div>
  );
}

function DecisionBody({
  suggestion,
  range,
  directiveBox,
  showRun,
}: {
  suggestion: SuggestionItem;
  range: { from: string; to: string } | null;
  directiveBox: React.ReactNode;
  showRun: boolean;
}) {
  const d = suggestion.details!;
  const origin = d.origin;
  const chips = suggestion.evidence.filter((e) => e.metric);
  const texts = suggestion.evidence.filter((e) => e.text && !(origin.kind === "report" && e.text === suggestion.rationaleMd));
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <PriorityBadge tier={suggestion.tier} />
          <h4 className="text-sm font-semibold leading-snug text-foreground">{suggestion.title}</h4>
        </div>
        <StatusLine suggestion={suggestion} showRun={showRun} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <LaneBadge lane={suggestion.ownerLane} />
        <Level kind="impact" value={suggestion.impact} />
        <Level kind="effort" value={suggestion.effort} />
        <Level kind="confidence" value={d.confidence} />
        <Level kind="risk" value={d.risk} />
        {origin.kind === "report" && (
          <Tooltip content={`Maßnahme ${origin.index + 1} aus „${origin.reportTitle}“ — übernommen, damit sie hier entschieden und gemessen wird.`}>
            <StatusBadge tone="accent" dot={false} icon={<FileText />}>
              Komplettanalyse #{origin.reportId}
            </StatusBadge>
          </Tooltip>
        )}
        {d.refersTo && (
          <StatusBadge tone="neutral" dot={false} icon={<CornerDownRight />}>
            bezieht sich auf {d.refersTo.startsWith("D") ? `Anweisung #${d.refersTo.slice(1)}` : `Vorschlag #${d.refersTo.slice(1)}`}
          </StatusBadge>
        )}
      </div>

      {directiveBox}

      <dl className="grid gap-x-6 gap-y-3 text-xs md:grid-cols-2">
        <div>
          <dt className="font-medium text-muted-foreground">Warum</dt>
          <dd className="mt-0.5 text-foreground">{suggestion.rationaleMd}</dd>
        </div>
        <div>
          <dt className="font-medium text-muted-foreground">{directiveBox ? "Umsetzung" : "Was zu tun ist"}</dt>
          <dd className="mt-0.5 text-foreground">{suggestion.proposalMd}</dd>
        </div>
        <div>
          <dt className="font-medium text-muted-foreground">Erwartete Wirkung</dt>
          <dd className="mt-0.5 text-foreground">{suggestion.expectedEffect || "—"}</dd>
        </div>
        <div>
          <dt className="font-medium text-muted-foreground">Erfolgsmessung</dt>
          <dd className="mt-0.5">
            <SuccessMetricLine suggestion={suggestion} />
          </dd>
        </div>
      </dl>

      {(chips.length > 0 || texts.length > 0) && (
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Belege aus den Geschäftsdaten</FieldLabel>
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {chips.map((e, i) => (
                <MetricChip key={`${e.key}-${i}`} metric={e.metric!} />
              ))}
            </div>
          )}
          {texts.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              {texts.map((e, i) => (
                <li key={i}>· {e.text}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(d.riskNote || d.link !== "none") && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {d.riskNote ? (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Risiko:</span> {d.riskNote}
            </p>
          ) : (
            <span />
          )}
          <AdminLinkButton target={d.link} range={range} />
        </div>
      )}
    </>
  );
}

// ── v1 ────────────────────────────────────────────────────────────────────────

function categoryLabel(s: SuggestionItem): string {
  const map = (s.lane === "mo" ? MO_CATEGORIES : SHOP_CATEGORIES) as Record<string, string>;
  return map[s.category] ?? s.category;
}

// Impact + effort condensed into ONE plain-language priority line.
function priorityLine(impact: string, effort: string): { text: string; dot: string } {
  const impactTxt = impact === "hoch" ? "Große Wirkung" : impact === "niedrig" ? "Kleine Wirkung" : "Mittlere Wirkung";
  const effortTxt = effort === "niedrig" ? "wenig Aufwand" : effort === "hoch" ? "viel Aufwand" : "mittlerer Aufwand";
  const dot = impact === "hoch" && effort !== "hoch" ? "bg-success" : impact === "niedrig" ? "bg-muted-foreground" : "bg-info";
  return { text: `${impactTxt} · ${effortTxt}`, dot };
}

function LegacyBody({
  suggestion,
  directiveBox,
  showRun,
}: {
  suggestion: SuggestionItem;
  directiveBox: React.ReactNode;
  showRun: boolean;
}) {
  const prio = priorityLine(suggestion.impact, suggestion.effort);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className={cn("size-2 rounded-full", prio.dot)} aria-hidden />
          {prio.text}
        </span>
        <StatusLine suggestion={suggestion} showRun={showRun} />
      </div>
      <h4 className="text-sm font-semibold text-foreground">{suggestion.title}</h4>
      {directiveBox ?? (
        <div>
          <FieldLabel>Was zu tun ist</FieldLabel>
          <Markdown content={suggestion.proposalMd} className="mt-1 text-sm" />
        </div>
      )}
      <Disclosure title={<span className="text-xs">Warum? Details &amp; Belege</span>} framed={false}>
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-3">
          <p className="text-xs text-muted-foreground">
            Kategorie: <span className="text-foreground">{categoryLabel(suggestion)}</span>
          </p>
          <div>
            <FieldLabel>Begründung</FieldLabel>
            <Markdown content={suggestion.rationaleMd} className="mt-1 text-sm" />
          </div>
          {directiveBox && (
            <div>
              <FieldLabel>Ausführlicher Vorschlag</FieldLabel>
              <Markdown content={suggestion.proposalMd} className="mt-1 text-sm" />
            </div>
          )}
          {suggestion.evidence.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              {suggestion.evidence.map((e, i) => (
                <li key={i}>· {e.text}</li>
              ))}
            </ul>
          )}
          {suggestion.expectedEffect && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Daran messen wir den Erfolg:</span> {suggestion.expectedEffect}
            </p>
          )}
        </div>
      </Disclosure>
    </>
  );
}
