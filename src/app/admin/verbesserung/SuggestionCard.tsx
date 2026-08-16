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
import { Loader2, Check, Wand2, X, ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import { Badge, Button, Card, CardContent, Input, Markdown, Textarea, toast } from "../ui";
import {
  SHOP_CATEGORIES,
  MO_CATEGORIES,
  SUGGESTION_STATUS_LABELS,
  MAX_DIRECTIVE_CHARS,
} from "@/lib/improvement-core.mjs";
import { cn } from "../ui/cn";

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

function statusBadge(status: SuggestionItem["status"]) {
  const label = (SUGGESTION_STATUS_LABELS as Record<string, string>)[status] ?? status;
  const variant =
    status === "implemented"
      ? "success"
      : status === "accepted"
        ? "info"
        : status === "dismissed"
          ? "secondary"
          : "outline";
  return <Badge variant={variant}>{label}</Badge>;
}

// Impact + effort condensed into ONE plain-language priority line with a
// traffic-light dot, instead of two separate jargon chips.
function priority(impact: string, effort: string): { text: string; dot: string } {
  const impactTxt =
    impact === "hoch" ? "Große Wirkung" : impact === "niedrig" ? "Kleine Wirkung" : "Mittlere Wirkung";
  const effortTxt =
    effort === "niedrig" ? "wenig Aufwand" : effort === "hoch" ? "viel Aufwand" : "mittlerer Aufwand";
  const dot =
    impact === "hoch" && effort !== "hoch"
      ? "bg-success"
      : impact === "niedrig"
        ? "bg-muted-foreground"
        : "bg-info";
  return { text: `${impactTxt} · ${effortTxt}`, dot };
}

export function SuggestionCard({
  suggestion,
  onChanged,
}: {
  suggestion: SuggestionItem;
  onChanged: (s: SuggestionItem) => void;
}) {
  const [showDetails, setShowDetails] = React.useState(false);
  const [dismissing, setDismissing] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  // The directive text is directly editable BEFORE adopting — whatever stands
  // in the box is exactly what goes live into Mo's system prompt.
  const [directiveDraft, setDirectiveDraft] = React.useState(suggestion.directiveText ?? "");

  const applyStatus = React.useCallback(
    async (status: SuggestionItem["status"], statusNote?: string) => {
      if (busy) return;
      setBusy(true);
      try {
        const res = await fetch("/api/admin/improve/suggestion", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            suggestionId: suggestion.id,
            status,
            note: statusNote?.trim() || undefined,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          suggestion?: SuggestionItem;
          error?: { message?: string };
        };
        if (!res.ok || !data.suggestion) {
          toast({
            variant: "error",
            title: "Änderung fehlgeschlagen",
            description: data.error?.message,
          });
          return;
        }
        onChanged(data.suggestion);
        setDismissing(false);
        setNote("");
      } catch {
        toast({ variant: "error", title: "Netzwerkfehler", description: "Bitte erneut versuchen." });
      } finally {
        setBusy(false);
      }
    },
    [busy, suggestion.id, onChanged]
  );

  const adopt = React.useCallback(async () => {
    if (busy || !directiveDraft.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/improve/adopt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suggestionId: suggestion.id,
          // Send the (possibly edited) text — the server stores exactly this.
          content: directiveDraft,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        suggestion?: SuggestionItem;
        error?: { message?: string };
      };
      if (!res.ok || !data.suggestion) {
        toast({
          variant: "error",
          title: "Übernahme fehlgeschlagen",
          description: data.error?.message,
        });
        return;
      }
      onChanged(data.suggestion);
      toast({
        variant: "success",
        title: "Übernommen — Mo berät ab sofort so",
        description:
          "Die Regel steht jetzt in „Anweisungen an Mo“ (unten) und kann dort jederzeit angepasst oder abgeschaltet werden.",
      });
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler", description: "Bitte erneut versuchen." });
    } finally {
      setBusy(false);
    }
  }, [busy, directiveDraft, suggestion.id, onChanged]);

  const prio = priority(suggestion.impact, suggestion.effort);
  const hasDirective = Boolean(suggestion.directiveText);
  const { status } = suggestion;

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        {/* Priority + status, then the title. */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <span className={cn("size-2 rounded-full", prio.dot)} aria-hidden />
            {prio.text}
          </span>
          {statusBadge(status)}
        </div>
        <h4 className="text-sm font-semibold text-foreground">{suggestion.title}</h4>

        {/* THE action — for directive cards the exact rule Mo would follow,
            otherwise the concrete change to make. */}
        {hasDirective ? (
          <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              So würde Mo künftig beraten
            </p>
            {status === "implemented" || status === "dismissed" ? (
              <p className="mt-1 text-[13px] text-foreground">{suggestion.directiveText}</p>
            ) : (
              <>
                <Textarea
                  value={directiveDraft}
                  onChange={(e) => setDirectiveDraft(e.target.value)}
                  maxLength={MAX_DIRECTIVE_CHARS}
                  className="mt-1 min-h-[80px] bg-card text-[13px]"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Direkt anpassbar — genau dieser Text gilt nach dem Übernehmen ·{" "}
                  {directiveDraft.trim().length}/{MAX_DIRECTIVE_CHARS} Zeichen
                </p>
              </>
            )}
          </div>
        ) : (
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Was zu tun ist
            </p>
            <Markdown content={suggestion.proposalMd} className="mt-1 text-[13px]" />
          </div>
        )}

        {/* Everything explanatory folds away. */}
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          className="flex items-center gap-1 text-[13px] font-medium text-accent hover:underline"
        >
          {showDetails ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          Warum? Details & Belege
        </button>
        {showDetails && (
          <div className="space-y-3 rounded-lg border border-border bg-secondary/40 p-3">
            <p className="text-[12px] text-muted-foreground">
              Kategorie: <span className="text-foreground">{categoryLabel(suggestion)}</span>
            </p>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Begründung
              </p>
              <Markdown content={suggestion.rationaleMd} className="mt-1 text-[13px]" />
            </div>
            {hasDirective && (
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Ausführlicher Vorschlag
                </p>
                <Markdown content={suggestion.proposalMd} className="mt-1 text-[13px]" />
              </div>
            )}
            {suggestion.evidence.length > 0 && (
              <ul className="space-y-0.5 text-[12px] text-muted-foreground">
                {suggestion.evidence.map((e, i) => (
                  <li key={i}>· {e}</li>
                ))}
              </ul>
            )}
            {suggestion.expectedEffect && (
              <p className="text-[12px] text-muted-foreground">
                <span className="font-medium text-foreground">Daran messen wir den Erfolg:</span>{" "}
                {suggestion.expectedEffect}
              </p>
            )}
          </div>
        )}

        {suggestion.statusNote && (
          <p className="text-[12px] text-muted-foreground">
            <span className="font-medium text-foreground">Notiz:</span> {suggestion.statusNote}
          </p>
        )}

        {/* Decision row — one clear set of actions per state. */}
        {dismissing ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-muted-foreground">Warum nicht? (optional)</span>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="z. B. zu teuer, Evidenz zu dünn"
              className="h-8 w-64 text-[13px]"
            />
            <Button size="sm" variant="outline" onClick={() => applyStatus("dismissed", note)} disabled={busy}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
              Endgültig verwerfen
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDismissing(false)} disabled={busy}>
              Abbrechen
            </Button>
          </div>
        ) : status === "dismissed" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => applyStatus("open")} disabled={busy}>
              <RotateCcw className="size-3.5" />
              Wieder öffnen
            </Button>
          </div>
        ) : status === "implemented" ? null : (
          <div className="flex flex-wrap items-center gap-2">
            {hasDirective ? (
              // One-click path: adopt = live in Mo's prompt + card is Erledigt.
              <Button size="sm" onClick={adopt} disabled={busy || !directiveDraft.trim()}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
                Übernehmen — gilt ab sofort
              </Button>
            ) : (
              // Non-directive cards: mark done once the change is really live
              // (the next run's Wirkungs-Check measures it), else dismiss.
              <Button size="sm" onClick={() => applyStatus("implemented")} disabled={busy}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                Erledigt — ist umgesetzt
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setDismissing(true)} disabled={busy}>
              <X className="size-3.5" />
              Verwerfen
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
