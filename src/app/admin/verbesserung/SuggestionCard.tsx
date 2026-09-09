"use client";

// One improvement suggestion, presented as a simple decision card:
//
//   priority line + status  →  title  →  THE ACTION (directive text or
//   proposal)  →  collapsible "Warum? Details & Belege"  →  buttons.
//
// The operator's mental model is a to-do list: Neu → Geplant → Erledigt /
// Verworfen. Cards with a ready-made directive have ONE primary action
// („Übernehmen") that adopts the text as a live directive and marks the card
// Erledigt in one click. Everything explanatory (evidence, expected KPI
// effect, category) lives behind the details toggle so the card stays
// scannable. Only „Verwerfen" asks for an optional note (it feeds the next
// run's Wirkungs-Check); the positive actions apply instantly.

import * as React from "react";
import { Check, Wand2, X, RotateCcw } from "lucide-react";
import {
  SHOP_CATEGORIES,
  MO_CATEGORIES,
  SUGGESTION_STATUS_LABELS,
  MAX_DIRECTIVE_CHARS,
} from "@/lib/improvement-core.mjs";
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
  cn,
  toast,
  type StatusTone,
} from "../ui";
import { adminFetch, friendlyErrorMessage } from "../lib/admin-fetch";

export interface SuggestionItem {
  id: number;
  lane: "shop" | "mo";
  category: string;
  title: string;
  rationaleMd: string;
  proposalMd: string;
  directiveText: string | null;
  expectedEffect: string | null;
  impact: string;
  effort: string;
  evidence: string[];
  status: "open" | "accepted" | "implemented" | "dismissed";
  statusNote: string | null;
}

function categoryLabel(s: SuggestionItem): string {
  const map = (s.lane === "mo" ? MO_CATEGORIES : SHOP_CATEGORIES) as Record<string, string>;
  return map[s.category] ?? s.category;
}

const STATUS_TONE: Record<SuggestionItem["status"], StatusTone> = {
  open: "neutral",
  accepted: "info",
  implemented: "success",
  dismissed: "neutral",
};

// Impact + effort condensed into ONE plain-language priority line with a
// traffic-light dot, instead of two separate jargon chips.
function priority(impact: string, effort: string): { text: string; dot: string } {
  const impactTxt =
    impact === "hoch" ? "Große Wirkung" : impact === "niedrig" ? "Kleine Wirkung" : "Mittlere Wirkung";
  const effortTxt =
    effort === "niedrig" ? "wenig Aufwand" : effort === "hoch" ? "viel Aufwand" : "mittlerer Aufwand";
  const dot =
    impact === "hoch" && effort !== "hoch" ? "bg-success" : impact === "niedrig" ? "bg-muted-foreground" : "bg-info";
  return { text: `${impactTxt} · ${effortTxt}`, dot };
}

export function SuggestionCard({
  suggestion,
  onChanged,
}: {
  suggestion: SuggestionItem;
  onChanged: (s: SuggestionItem) => void;
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
        description:
          "Die Regel steht jetzt in „Anweisungen an Mo“ (unten) und kann dort jederzeit angepasst oder abgeschaltet werden.",
      });
    } catch (err) {
      toast({ variant: "error", title: "Übernahme fehlgeschlagen", description: friendlyErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const prio = priority(suggestion.impact, suggestion.effort);
  const hasDirective = Boolean(suggestion.directiveText);
  const { status } = suggestion;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn("size-2 rounded-full", prio.dot)} aria-hidden />
            {prio.text}
          </span>
          <StatusBadge tone={STATUS_TONE[status]} dot={status !== "open"}>
            {(SUGGESTION_STATUS_LABELS as Record<string, string>)[status] ?? status}
          </StatusBadge>
        </div>
        <h4 className="text-sm font-semibold text-foreground">{suggestion.title}</h4>

        {hasDirective ? (
          <div className="rounded-lg border border-accent/30 bg-accent-soft/60 p-3">
            <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              So würde Mo künftig beraten
            </p>
            {status === "implemented" || status === "dismissed" ? (
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
                  Direkt anpassbar — genau dieser Text gilt nach dem Übernehmen ·{" "}
                  {num(directiveDraft.trim().length)}/{num(MAX_DIRECTIVE_CHARS)} Zeichen
                </p>
              </>
            )}
          </div>
        ) : (
          <div>
            <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">Was zu tun ist</p>
            <Markdown content={suggestion.proposalMd} className="mt-1 text-sm" />
          </div>
        )}

        <Disclosure title={<span className="text-xs">Warum? Details &amp; Belege</span>} framed={false}>
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-3">
            <p className="text-xs text-muted-foreground">
              Kategorie: <span className="text-foreground">{categoryLabel(suggestion)}</span>
            </p>
            <div>
              <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">Begründung</p>
              <Markdown content={suggestion.rationaleMd} className="mt-1 text-sm" />
            </div>
            {hasDirective && (
              <div>
                <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                  Ausführlicher Vorschlag
                </p>
                <Markdown content={suggestion.proposalMd} className="mt-1 text-sm" />
              </div>
            )}
            {suggestion.evidence.length > 0 && (
              <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                {suggestion.evidence.map((e, i) => (
                  <li key={i}>· {e}</li>
                ))}
              </ul>
            )}
            {suggestion.expectedEffect && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Daran messen wir den Erfolg:</span>{" "}
                {suggestion.expectedEffect}
              </p>
            )}
          </div>
        </Disclosure>

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
          <div className="flex flex-wrap items-center gap-2">
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
