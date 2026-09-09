"use client";

// Mo's live instruction layer — the "secured input field" of the improvement
// loop. Every active directive is injected into Mo's system prompt (within the
// ~5-minute chat cache); edits and toggles are versioned append-only and shown
// in the per-directive Verlauf. The core prompt itself stays in git — this card
// edits ONLY the bounded directive section.

import * as React from "react";
import { Plus, Pencil, History, Power, Check } from "lucide-react";
import { ADMIN_DATE_TIME_MEDIUM, formatAdmin } from "@/lib/admin-datetime.mjs";
import { num } from "@/lib/admin-format.mjs";
import { Button, Field, IconButton, InfoTip, StatusBadge, Textarea, toast } from "../ui";
import { adminFetch, friendlyErrorMessage } from "../lib/admin-fetch";
import { useAsyncAction } from "../lib/use-async-action";

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
  return formatAdmin(iso, ADMIN_DATE_TIME_MEDIUM, iso);
}

export function DirectivesCard({
  initialDirectives,
  limits,
  onActiveCountChange,
}: {
  initialDirectives: DirectiveItem[];
  limits: DirectiveLimits;
  onActiveCountChange?: (n: number) => void;
}) {
  const [directives, setDirectives] = React.useState<DirectiveItem[]>(initialDirectives);
  const [newContent, setNewContent] = React.useState("");
  const activeCount = directives.filter((d) => d.active).length;

  const replaceDirective = React.useCallback(
    (d: DirectiveItem) => {
      setDirectives((list) => {
        const exists = list.some((x) => x.id === d.id);
        const next = exists ? list.map((x) => (x.id === d.id ? d : x)) : [...list, d];
        onActiveCountChange?.(next.filter((x) => x.active).length);
        return next;
      });
    },
    [onActiveCountChange]
  );

  const create = useAsyncAction(
    async () => {
      const content = newContent.trim();
      if (!content) return null;
      try {
        const data = await adminFetch<{ directive?: DirectiveItem }>("/api/admin/directives/save", {
          body: { content },
        });
        if (!data.directive) throw new Error("Unbekannter Fehler");
        return data.directive;
      } catch (err) {
        toast({
          variant: "error",
          title: "Anweisung konnte nicht angelegt werden",
          description: friendlyErrorMessage(err),
        });
        throw err;
      }
    },
    {
      errorToast: false,
      onSuccess: (directive) => {
        if (!directive) return;
        replaceDirective(directive);
        setNewContent("");
        toast({
          variant: "success",
          title: "Anweisung aktiv",
          description: "Sie fließt innerhalb weniger Minuten in Mos System-Prompt ein.",
        });
      },
    }
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {num(activeCount)}/{num(limits.maxActive)} aktiv · max. {num(limits.maxChars)} Zeichen je Anweisung
        <InfoTip panelClassName="max-w-md">
          Kurze Verhaltensregeln, die live in Mos System-Prompt eingefügt werden (Abschnitt
          „Aktuelle Anweisungen vom motion sports Team“). Änderungen wirken innerhalb von ~5 Minuten
          im Chat; jede Änderung wird versioniert. Max. {limits.maxActive} aktive Anweisungen à{" "}
          {limits.maxChars} Zeichen — Mos Kern-Prompt bleibt unverändert im Code (Git).
        </InfoTip>
      </div>

      {directives.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Noch keine Anweisungen. Lege unten die erste an — oder übernimm eine aus einem
          Verbesserungsvorschlag.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {directives.map((d) => (
            <DirectiveRow key={d.id} directive={d} limits={limits} onChanged={replaceDirective} />
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <Field
          label="Neue Anweisung"
          hint={`${num(newContent.trim().length)}/${num(limits.maxChars)} Zeichen`}
        >
          <Textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            maxLength={limits.maxChars}
            placeholder='z. B. „Wenn ein Kunde nach Lieferzeiten für Speditionsware fragt, weise proaktiv auf die Lieferung frei Bordsteinkante hin.“'
            className="min-h-[64px] text-sm"
          />
        </Field>
        <div className="flex justify-end">
          <Button size="sm" onClick={() => void create.run()} disabled={!newContent.trim()} loading={create.pending}>
            {!create.pending && <Plus />}
            Anweisung aktivieren
          </Button>
        </div>
      </div>
    </div>
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
  const [versions, setVersions] = React.useState<DirectiveVersion[] | null>(null);
  const [showHistory, setShowHistory] = React.useState(false);

  const save = useAsyncAction(
    async () => {
      const content = draft.trim();
      if (!content) return null;
      const data = await adminFetch<{ directive?: DirectiveItem }>("/api/admin/directives/save", {
        body: { id: directive.id, content },
      });
      if (!data.directive) throw new Error("Speichern fehlgeschlagen");
      return data.directive;
    },
    {
      errorToast: "Speichern fehlgeschlagen",
      onSuccess: (d) => {
        if (!d) return;
        onChanged(d);
        setEditing(false);
        setVersions(null);
      },
    }
  );

  const toggle = useAsyncAction(
    async () => {
      const data = await adminFetch<{ directive?: DirectiveItem }>("/api/admin/directives/toggle", {
        body: { id: directive.id, active: !directive.active },
      });
      if (!data.directive) throw new Error("Umschalten fehlgeschlagen");
      return data.directive;
    },
    {
      errorToast: "Umschalten fehlgeschlagen",
      onSuccess: (d) => {
        onChanged(d);
        setVersions(null);
      },
    }
  );

  const loadHistory = async () => {
    if (showHistory) {
      setShowHistory(false);
      return;
    }
    setShowHistory(true);
    if (versions) return;
    try {
      const data = await adminFetch<{ versions?: DirectiveVersion[] }>(
        `/api/admin/directives/versions?id=${directive.id}`
      );
      setVersions(Array.isArray(data.versions) ? data.versions : []);
    } catch {
      setVersions([]);
    }
  };

  const busy = save.pending || toggle.pending;

  return (
    <li className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <StatusBadge tone={directive.active ? "success" : "neutral"}>
            {directive.active ? "aktiv" : "inaktiv"}
          </StatusBadge>
          {directive.source === "suggestion" && (
            <StatusBadge tone="info" dot={false}>
              aus Vorschlag
            </StatusBadge>
          )}
          <span className="text-2xs text-muted-foreground">zuletzt geändert {fmtTs(directive.updatedAt)}</span>
        </div>
        <div className="flex items-center gap-1">
          <IconButton label="Verlauf anzeigen" size="icon-sm" onClick={() => void loadHistory()}>
            <History />
          </IconButton>
          <IconButton
            label="Bearbeiten"
            size="icon-sm"
            onClick={() => {
              setDraft(directive.content);
              setEditing((v) => !v);
            }}
          >
            <Pencil />
          </IconButton>
          <IconButton
            label={directive.active ? "Deaktivieren" : "Aktivieren"}
            size="icon-sm"
            onClick={() => void toggle.run()}
            disabled={busy}
            loading={toggle.pending}
          >
            <Power />
          </IconButton>
        </div>
      </div>

      {editing ? (
        <div className="mt-2 flex flex-col gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={limits.maxChars}
            className="min-h-[64px] text-sm"
            aria-label="Anweisung bearbeiten"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => void save.run()} disabled={!draft.trim()} loading={save.pending}>
              {!save.pending && <Check />}
              Speichern
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={busy}>
              Abbrechen
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-1.5 text-sm text-foreground">{directive.content}</p>
      )}

      {showHistory && (
        <div className="mt-2 flex flex-col gap-1.5 border-t border-border/60 pt-2">
          <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Verlauf</p>
          {versions === null ? (
            <p className="text-xs text-muted-foreground">Wird geladen…</p>
          ) : versions.length === 0 ? (
            <p className="text-xs text-muted-foreground">Kein Verlauf vorhanden.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {versions.map((v) => (
                <li key={v.id} className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{ACTION_LABELS[v.action]}</span> · {fmtTs(v.createdAt)}
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
