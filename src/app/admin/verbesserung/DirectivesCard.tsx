"use client";

// Mo's live instruction layer — the "secured input field" of the improvement
// loop. Every active directive is injected into Mo's system prompt (within the
// ~5-minute chat cache); edits and toggles are versioned append-only and shown
// in the per-directive Verlauf. The core prompt itself stays in git — this card
// edits ONLY the bounded directive section.

import * as React from "react";
import { Loader2, Plus, Pencil, History, Power, Check } from "lucide-react";
import { Badge, Button, Card, CardContent, Textarea, toast } from "../ui";

export interface DirectiveItem {
  id: number;
  content: string;
  active: boolean;
  source: "operator" | "suggestion";
  suggestionId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface DirectiveLimits {
  maxActive: number;
  maxChars: number;
}

interface DirectiveVersion {
  id: number;
  content: string;
  active: boolean;
  action: "created" | "updated" | "activated" | "deactivated";
  createdAt: string;
}

const ACTION_LABELS: Record<DirectiveVersion["action"], string> = {
  created: "Angelegt",
  updated: "Text geändert",
  activated: "Aktiviert",
  deactivated: "Deaktiviert",
};

function fmtTs(iso: string): string {
  try {
    return new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function DirectivesCard({
  initialDirectives,
  limits,
}: {
  initialDirectives: DirectiveItem[];
  limits: DirectiveLimits;
}) {
  const [directives, setDirectives] = React.useState<DirectiveItem[]>(initialDirectives);
  const [newContent, setNewContent] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const activeCount = directives.filter((d) => d.active).length;

  const replaceDirective = React.useCallback((d: DirectiveItem) => {
    setDirectives((list) => {
      const exists = list.some((x) => x.id === d.id);
      return exists ? list.map((x) => (x.id === d.id ? d : x)) : [...list, d];
    });
  }, []);

  const create = React.useCallback(async () => {
    const content = newContent.trim();
    if (!content || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/directives/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        directive?: DirectiveItem;
        error?: { message?: string };
      };
      if (!res.ok || !data.directive) {
        toast({
          variant: "error",
          title: "Anweisung konnte nicht angelegt werden",
          description: data.error?.message,
        });
        return;
      }
      replaceDirective(data.directive);
      setNewContent("");
      toast({
        variant: "success",
        title: "Anweisung aktiv",
        description: "Sie fließt innerhalb weniger Minuten in Mos System-Prompt ein.",
      });
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler", description: "Bitte erneut versuchen." });
    } finally {
      setBusy(false);
    }
  }, [newContent, busy, replaceDirective]);

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Anweisungen an Mo</h3>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Kurze Verhaltensregeln, die live in Mos System-Prompt eingefügt werden (Abschnitt
            „Aktuelle Anweisungen vom motion sports Team“). Änderungen wirken innerhalb von ~5
            Minuten im Chat; jede Änderung wird versioniert. Max. {limits.maxActive} aktive
            Anweisungen à {limits.maxChars} Zeichen — Mos Kern-Prompt bleibt unverändert im Code
            (Git).
          </p>
        </div>

        {directives.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            Noch keine Anweisungen. Lege unten die erste an — oder übernimm eine aus einem
            Verbesserungsvorschlag.
          </p>
        ) : (
          <ul className="space-y-2">
            {directives.map((d) => (
              <DirectiveRow key={d.id} directive={d} limits={limits} onChanged={replaceDirective} />
            ))}
          </ul>
        )}

        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-[12px] font-medium text-foreground">
            Neue Anweisung ({activeCount}/{limits.maxActive} aktiv)
          </p>
          <Textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            maxLength={limits.maxChars}
            placeholder='z. B. „Wenn ein Kunde nach Lieferzeiten für Speditionsware fragt, weise proaktiv auf die Lieferung frei Bordsteinkante hin.“'
            className="min-h-[64px] text-[13px]"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground">
              {newContent.trim().length}/{limits.maxChars} Zeichen
            </span>
            <Button size="sm" onClick={create} disabled={busy || !newContent.trim()}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              Anweisung aktivieren
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DirectiveRow({
  directive,
  limits,
  onChanged,
}: {
  directive: DirectiveItem;
  limits: DirectiveLimits;
  onChanged: (d: DirectiveItem) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(directive.content);
  const [busy, setBusy] = React.useState(false);
  const [versions, setVersions] = React.useState<DirectiveVersion[] | null>(null);
  const [showHistory, setShowHistory] = React.useState(false);

  const save = React.useCallback(async () => {
    const content = draft.trim();
    if (!content || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/directives/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: directive.id, content }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        directive?: DirectiveItem;
        error?: { message?: string };
      };
      if (!res.ok || !data.directive) {
        toast({
          variant: "error",
          title: "Speichern fehlgeschlagen",
          description: data.error?.message,
        });
        return;
      }
      onChanged(data.directive);
      setEditing(false);
      setVersions(null);
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler", description: "Bitte erneut versuchen." });
    } finally {
      setBusy(false);
    }
  }, [draft, busy, directive.id, onChanged]);

  const toggle = React.useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/directives/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: directive.id, active: !directive.active }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        directive?: DirectiveItem;
        error?: { message?: string };
      };
      if (!res.ok || !data.directive) {
        toast({
          variant: "error",
          title: "Umschalten fehlgeschlagen",
          description: data.error?.message,
        });
        return;
      }
      onChanged(data.directive);
      setVersions(null);
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler", description: "Bitte erneut versuchen." });
    } finally {
      setBusy(false);
    }
  }, [busy, directive.id, directive.active, onChanged]);

  const loadHistory = React.useCallback(async () => {
    if (showHistory) {
      setShowHistory(false);
      return;
    }
    setShowHistory(true);
    if (versions) return;
    try {
      const res = await fetch(`/api/admin/directives/versions?id=${directive.id}`);
      const data = (await res.json().catch(() => ({}))) as { versions?: DirectiveVersion[] };
      setVersions(Array.isArray(data.versions) ? data.versions : []);
    } catch {
      setVersions([]);
    }
  }, [showHistory, versions, directive.id]);

  return (
    <li className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {directive.active ? (
            <Badge variant="success">aktiv</Badge>
          ) : (
            <Badge variant="secondary">inaktiv</Badge>
          )}
          {directive.source === "suggestion" && <Badge variant="info">aus Vorschlag</Badge>}
          <span className="text-[11px] text-muted-foreground">
            zuletzt geändert {fmtTs(directive.updatedAt)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={loadHistory} title="Verlauf anzeigen">
            <History className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(directive.content);
              setEditing((v) => !v);
            }}
            title="Bearbeiten"
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={toggle}
            disabled={busy}
            title={directive.active ? "Deaktivieren" : "Aktivieren"}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Power className="size-3.5" />}
          </Button>
        </div>
      </div>

      {editing ? (
        <div className="mt-2 space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={limits.maxChars}
            className="min-h-[64px] text-[13px]"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={save} disabled={busy || !draft.trim()}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              Speichern
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={busy}>
              Abbrechen
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-1.5 text-[13px] text-foreground">{directive.content}</p>
      )}

      {showHistory && (
        <div className="mt-2 space-y-1.5 border-t border-border/60 pt-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Verlauf
          </p>
          {versions === null ? (
            <p className="text-[12px] text-muted-foreground">Wird geladen…</p>
          ) : versions.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">Kein Verlauf vorhanden.</p>
          ) : (
            <ul className="space-y-1">
              {versions.map((v) => (
                <li key={v.id} className="text-[12px] text-muted-foreground">
                  <span className="font-medium text-foreground">{ACTION_LABELS[v.action]}</span>{" "}
                  · {fmtTs(v.createdAt)}
                  {(v.action === "created" || v.action === "updated") && (
                    <span className="mt-0.5 block text-muted-foreground">„{v.content}“</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
