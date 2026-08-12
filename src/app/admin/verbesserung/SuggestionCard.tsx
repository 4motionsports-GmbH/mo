"use client";

// One improvement suggestion with its operator lifecycle. The card shows WHY
// (rationale + evidence), WHAT (proposal) and — for adoptable Mo suggestions —
// the ready-made directive text with the one-click "Als Anweisung übernehmen"
// action (the only path from suggestion to live behaviour, always explicit).
// Status changes ask for an optional note; the note feeds the next run's
// Wirkungs-Check, so honesty here pays off later.

import * as React from "react";
import { Loader2, Check, Wand2, X, ThumbsUp } from "lucide-react";
import { Badge, Button, Card, CardContent, Input, Markdown, toast } from "../ui";
import {
  LANE_LABELS,
  SHOP_CATEGORIES,
  MO_CATEGORIES,
  SUGGESTION_STATUS_LABELS,
} from "@/lib/improvement-core.mjs";

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

export function SuggestionCard({
  suggestion,
  onChanged,
}: {
  suggestion: SuggestionItem;
  onChanged: (s: SuggestionItem) => void;
}) {
  const [pending, setPending] = React.useState<SuggestionItem["status"] | null>(null);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const submitStatus = React.useCallback(async () => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/improve/suggestion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suggestionId: suggestion.id,
          status: pending,
          note: note.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        suggestion?: SuggestionItem;
        error?: { message?: string };
      };
      if (!res.ok || !data.suggestion) {
        toast({
          variant: "error",
          title: "Status-Änderung fehlgeschlagen",
          description: data.error?.message,
        });
        return;
      }
      onChanged(data.suggestion);
      setPending(null);
      setNote("");
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler", description: "Bitte erneut versuchen." });
    } finally {
      setBusy(false);
    }
  }, [pending, busy, note, suggestion.id, onChanged]);

  const adopt = React.useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/improve/adopt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestionId: suggestion.id }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        suggestion?: SuggestionItem;
        directive?: { id: number };
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
        title: "Anweisung übernommen",
        description:
          "Die Anweisung ist aktiv und fließt innerhalb weniger Minuten in Mos System-Prompt ein (Karte „Anweisungen an Mo“ unten).",
      });
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler", description: "Bitte erneut versuchen." });
    } finally {
      setBusy(false);
    }
  }, [busy, suggestion.id, onChanged]);

  const terminal = suggestion.status === "implemented" || suggestion.status === "dismissed";

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h4 className="min-w-0 text-sm font-semibold text-foreground">{suggestion.title}</h4>
          {statusBadge(suggestion.status)}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <Badge variant="secondary">{(LANE_LABELS as Record<string, string>)[suggestion.lane]}</Badge>
          <Badge variant="secondary">{categoryLabel(suggestion)}</Badge>
          <Badge variant={suggestion.impact === "hoch" ? "accent" : "outline"}>
            Wirkung: {suggestion.impact}
          </Badge>
          <Badge variant="outline">Aufwand: {suggestion.effort}</Badge>
        </div>

        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Warum (Evidenz)
          </p>
          <Markdown content={suggestion.rationaleMd} className="mt-1 text-[13px]" />
          {suggestion.evidence.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-[12px] text-muted-foreground">
              {suggestion.evidence.map((e, i) => (
                <li key={i}>· {e}</li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Vorschlag
          </p>
          <Markdown content={suggestion.proposalMd} className="mt-1 text-[13px]" />
        </div>

        {suggestion.expectedEffect && (
          <p className="text-[12px] text-muted-foreground">
            <span className="font-medium text-foreground">Erwartete Wirkung:</span>{" "}
            {suggestion.expectedEffect}
          </p>
        )}

        {suggestion.directiveText && (
          <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Fertiger Anweisungstext
            </p>
            <p className="mt-1 text-[13px] text-foreground">{suggestion.directiveText}</p>
            {suggestion.status !== "implemented" && (
              <Button size="sm" className="mt-2" onClick={adopt} disabled={busy}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
                Als Anweisung übernehmen
              </Button>
            )}
          </div>
        )}

        {suggestion.statusNote && (
          <p className="text-[12px] text-muted-foreground">
            <span className="font-medium text-foreground">Notiz:</span> {suggestion.statusNote}
          </p>
        )}

        {pending ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-muted-foreground">
              „{(SUGGESTION_STATUS_LABELS as Record<string, string>)[pending]}“ — Notiz (optional):
            </span>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="z. B. warum verworfen / wie umgesetzt"
              className="h-8 w-64 text-[13px]"
            />
            <Button size="sm" onClick={submitStatus} disabled={busy}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              Bestätigen
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPending(null)} disabled={busy}>
              Abbrechen
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {suggestion.status !== "accepted" && !terminal && (
              <Button size="sm" variant="outline" onClick={() => setPending("accepted")}>
                <ThumbsUp className="size-3.5" />
                Annehmen
              </Button>
            )}
            {suggestion.status !== "implemented" && (
              <Button size="sm" variant="outline" onClick={() => setPending("implemented")}>
                <Check className="size-3.5" />
                Umgesetzt
              </Button>
            )}
            {suggestion.status !== "dismissed" && (
              <Button size="sm" variant="outline" onClick={() => setPending("dismissed")}>
                <X className="size-3.5" />
                Verwerfen
              </Button>
            )}
            {terminal && suggestion.status === "dismissed" && (
              <Button size="sm" variant="outline" onClick={() => setPending("open")}>
                Wieder öffnen
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
