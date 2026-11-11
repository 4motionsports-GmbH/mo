"use client";

// The screen „Vorlagen“ — e-mail templates the team builds itself
// (docs/EMAIL_TEMPLATES.md). Two modes:
//   * the list: every template (card with its uses), „Neue Vorlage“ (from a
//     starter), „Importieren“ (a JSON file exported here or elsewhere);
//   * the editor (`?vorlage=<id>`): the block editor next to the live preview,
//     „Mit KI gestalten“ (the KI-Gestalter panel docked above the blocks),
//     „Rückgängig“ (several steps), Speichern (version-checked), Duplizieren,
//     Exportieren, Archivieren.
// A template with „Mos persönlicher Text“ appears as a design in
// Einstellungen (Kampagne / Marketing) and in the campaign editor; every
// template can start a Rundmail. All writes go through /api/admin/vorlagen.

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Copy,
  Download,
  FileUp,
  LayoutTemplate,
  Plus,
  Save,
  Undo2,
} from "lucide-react";
import {
  MAIL_TEMPLATE_STARTERS,
  docSupportsPersonal,
  templateExportFile,
  validateMailTemplateDoc,
} from "@/lib/mail-template-doc.mjs";
import { ADMIN_DATE_TIME_SHORT, formatAdmin } from "@/lib/admin-datetime.mjs";
import { EMAIL_THEME_KIND_LABELS } from "@/lib/email-theme.mjs";
import {
  Button,
  Callout,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  InfoTip,
  Input,
  Menu,
  SegmentedControl,
  Select,
  StatusBadge,
  toast,
  useConfirm,
} from "../ui";
import { adminFetch, errorMessage } from "../lib/admin-fetch";
import { BlockEditor, type MailDoc } from "./BlockEditor";
import { DesignerPanel, DesignerToggle } from "./DesignerPanel";
import { LivePreview } from "./LivePreview";
import { useDesignerSession } from "./use-designer-session";
import { useDocHistory } from "./use-doc-history";

export interface VorlageMeta {
  id: number;
  name: string;
  description: string | null;
  version: number;
  archivedAt: string | null;
  updatedAt: string | null;
  supportsPersonal: boolean;
  hasHero: boolean;
  blockCount: number;
  /** Mail types that use it as their design (Einstellungen). */
  usedFor: string[];
}

interface FullTemplate {
  id: number;
  name: string;
  description: string | null;
  doc: MailDoc;
  version: number;
  archivedAt: string | null;
}

function setVorlageParam(id: number | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("vorlage", String(id));
  else url.searchParams.delete("vorlage");
  window.history.replaceState(window.history.state, "", url.toString());
}

function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[^A-Za-z0-9äöüÄÖÜß_-]+/g, "-").replace(/^-+|-+$/g, "") || "vorlage"}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function VorlagenWorkspace({
  dbReady,
  templates: initial,
  initialId,
  uploadConfigured,
  aiConfigured,
}: {
  dbReady: boolean;
  templates: VorlageMeta[];
  initialId: number | null;
  uploadConfigured: boolean;
  aiConfigured: boolean;
}) {
  const router = useRouter();
  const [editingId, setEditingId] = React.useState<number | null>(initialId);
  const [showArchived, setShowArchived] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const importRef = React.useRef<HTMLInputElement>(null);

  const open = (id: number | null) => {
    setEditingId(id);
    setVorlageParam(id);
    if (id === null) router.refresh();
  };

  const importFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const json = await adminFetch<{ template: FullTemplate }>("/api/admin/vorlagen", { body: { action: "import", file: parsed } });
      toast({ variant: "success", title: "Vorlage importiert", description: json.template.name });
      open(json.template.id);
    } catch (err) {
      toast({
        variant: "error",
        title: "Import fehlgeschlagen",
        description: err instanceof SyntaxError ? "Die Datei ist kein gültiges JSON." : errorMessage(err),
      });
    }
  };

  if (editingId !== null) {
    return (
      <TemplateEditorView
        key={editingId}
        id={editingId}
        uploadConfigured={uploadConfigured}
        aiConfigured={aiConfigured}
        onClose={() => open(null)}
        onOpen={(id) => open(id)}
        usedFor={initial.find((t) => t.id === editingId)?.usedFor ?? []}
      />
    );
  }

  const visible = initial.filter((t) => (showArchived ? t.archivedAt : !t.archivedAt));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          label="Vorlagen anzeigen"
          value={showArchived ? "archiv" : "aktiv"}
          onChange={(v) => setShowArchived(v === "archiv")}
          options={[
            { value: "aktiv", label: "Aktiv" },
            { value: "archiv", label: "Archiv" },
          ]}
        />
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void importFile(file);
          }}
        />
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => importRef.current?.click()} disabled={!dbReady}>
            <FileUp /> Importieren
          </Button>
          <Button size="sm" onClick={() => setCreating(true)} disabled={!dbReady}>
            <Plus /> Neue Vorlage
          </Button>
        </div>
      </div>

      {!dbReady && <Callout tone="warning">Keine Datenbank konfiguriert (DATABASE_URL) — Vorlagen können nicht gespeichert werden.</Callout>}

      {visible.length === 0 ? (
        <Card>
          <CardContent className="py-10 pt-10">
            <EmptyState
              plain
              icon={<LayoutTemplate />}
              title={showArchived ? "Keine archivierten Vorlagen" : "Noch keine Vorlagen"}
              description="Eine Vorlage legt das Aussehen einer Mail fest — für Rundmails (z. B. Black Week) oder als Design für Mos persönliche Kampagnen-Mails."
              action={
                !showArchived && dbReady ? (
                  <Button size="sm" onClick={() => setCreating(true)}>
                    <Plus /> Neue Vorlage
                  </Button>
                ) : undefined
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {visible.map((t) => (
            <Card key={t.id} className="flex flex-col">
              <CardContent className="flex flex-1 flex-col gap-2 p-4 pt-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button type="button" className="truncate text-left text-base font-semibold hover:underline" onClick={() => open(t.id)}>
                    {t.name}
                  </button>
                  {t.supportsPersonal ? (
                    <StatusBadge tone="accent" dot={false}>
                      Persönliche Mails + Rundmail
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral" dot={false}>
                      Rundmail
                    </StatusBadge>
                  )}
                  {t.archivedAt && (
                    <StatusBadge tone="neutral" dot={false}>
                      Archiviert
                    </StatusBadge>
                  )}
                </div>
                {t.description && <p className="line-clamp-2 text-sm text-muted-foreground">{t.description}</p>}
                {t.usedFor.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {t.usedFor.map((k) => (
                      <StatusBadge key={k} tone="success" dot={false}>
                        Aktiv: {EMAIL_THEME_KIND_LABELS[k as keyof typeof EMAIL_THEME_KIND_LABELS] ?? k}
                      </StatusBadge>
                    ))}
                  </div>
                )}
                <p className="mt-auto pt-1 text-2xs text-muted-foreground">
                  {t.blockCount} Bausteine · Version {t.version}
                  {t.updatedAt ? ` · geändert ${formatAdmin(t.updatedAt, ADMIN_DATE_TIME_SHORT)}` : ""}
                </p>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => open(t.id)}>
                    Bearbeiten
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <NewTemplateDialog open={creating} onOpenChange={setCreating} onCreated={(id) => open(id)} />
    </div>
  );
}

function NewTemplateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (id: number) => void;
}) {
  const [name, setName] = React.useState("");
  const [starter, setStarter] = React.useState<string>(MAIL_TEMPLATE_STARTERS[0].key);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const json = await adminFetch<{ template: { id: number } }>("/api/admin/vorlagen", {
        body: { action: "create", name, starter },
      });
      onOpenChange(false);
      setName("");
      onCreated(json.template.id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const chosen = MAIL_TEMPLATE_STARTERS.find((s) => s.key === starter);
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Neue Vorlage</DialogTitle>
          <DialogDescription>Starte mit einem Beispiel und passe alles an — oder lass danach die KI gestalten.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {error && <Callout tone="destructive">{error}</Callout>}
          <Field label="Name" required>
            <Input data-autofocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="z. B. Black Week 2026" />
          </Field>
          <Field label="Starten mit">
            <Select value={starter} onChange={(e) => setStarter(e.target.value)}>
              {MAIL_TEMPLATE_STARTERS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          {chosen && <p className="text-xs text-muted-foreground">{chosen.description}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Abbrechen
          </Button>
          <Button onClick={() => void create()} loading={busy} disabled={name.trim().length < 3}>
            Anlegen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplateEditorView({
  id,
  uploadConfigured,
  aiConfigured,
  usedFor,
  onClose,
  onOpen,
}: {
  id: number;
  uploadConfigured: boolean;
  aiConfigured: boolean;
  usedFor: string[];
  onClose: () => void;
  onOpen: (id: number) => void;
}) {
  const { confirm, confirmDialog } = useConfirm();
  const [loaded, setLoaded] = React.useState<FullTemplate | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  // The document with its „Rückgängig“ steps (every AI result is one).
  const { doc, setDoc, replaceDoc, undo, resetDoc, undoSteps } = useDocHistory<MailDoc | null>(null);
  const [designerOpen, setDesignerOpen] = React.useState(false);
  const designer = useDesignerSession({ use: "template", doc, onResult: (result) => replaceDoc(result.doc) });
  const [saving, setSaving] = React.useState(false);
  const [previewUse, setPreviewUse] = React.useState<"bulk" | "personal">("bulk");

  React.useEffect(() => {
    let alive = true;
    adminFetch<{ template: FullTemplate }>("/api/admin/vorlagen", { body: { action: "get", id } })
      .then((json) => {
        if (!alive) return;
        setLoaded(json.template);
        setName(json.template.name);
        setDescription(json.template.description ?? "");
        resetDoc(json.template.doc);
        setPreviewUse(docSupportsPersonal(json.template.doc) ? "personal" : "bulk");
      })
      .catch((err) => alive && setLoadError(errorMessage(err)));
    return () => {
      alive = false;
    };
  }, [id, resetDoc]);

  if (loadError) {
    return (
      <div className="flex flex-col gap-3">
        <Button variant="ghost" size="sm" className="self-start" onClick={onClose}>
          <ArrowLeft /> Alle Vorlagen
        </Button>
        <Callout tone="destructive">{loadError}</Callout>
      </div>
    );
  }
  if (!loaded || !doc) {
    return <p className="text-sm text-muted-foreground">Vorlage wird geladen …</p>;
  }

  const dirty =
    name !== loaded.name || description !== (loaded.description ?? "") || JSON.stringify(doc) !== JSON.stringify(loaded.doc);
  const personal = docSupportsPersonal(doc);
  const issues = validateMailTemplateDoc(doc, personal ? "personal" : "bulk");

  const save = async () => {
    setSaving(true);
    try {
      const json = await adminFetch<{ template: FullTemplate }>("/api/admin/vorlagen", {
        body: { action: "save", id, name, description, doc, expectedVersion: loaded.version },
      });
      setLoaded(json.template);
      resetDoc(json.template.doc);
      toast({ variant: "success", title: "Vorlage gespeichert", description: `Version ${json.template.version}` });
    } catch (err) {
      toast({ variant: "error", title: "Nicht gespeichert", description: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  const leave = async () => {
    if (dirty && !(await confirm({ title: "Ungespeicherte Änderungen verwerfen?", confirmLabel: "Verwerfen", tone: "destructive" }))) return;
    onClose();
  };

  const duplicate = async () => {
    try {
      const json = await adminFetch<{ template: { id: number } }>("/api/admin/vorlagen", { body: { action: "duplicate", id } });
      toast({ variant: "success", title: "Kopie angelegt" });
      onOpen(json.template.id);
    } catch (err) {
      toast({ variant: "error", title: "Duplizieren fehlgeschlagen", description: errorMessage(err) });
    }
  };

  const archive = async (archived: boolean) => {
    if (archived && !(await confirm({ title: `„${loaded.name}“ archivieren?`, description: "Kampagnen, die sie schon verwenden, sehen weiter gleich aus. Wiederherstellen ist jederzeit möglich.", confirmLabel: "Archivieren" }))) return;
    try {
      const json = await adminFetch<{ template: FullTemplate }>("/api/admin/vorlagen", { body: { action: "archive", id, archived } });
      setLoaded({ ...loaded, archivedAt: json.template.archivedAt });
      toast({ variant: "success", title: archived ? "Archiviert" : "Wiederhergestellt" });
    } catch (err) {
      toast({ variant: "error", title: "Nicht möglich", description: errorMessage(err) });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => void leave()}>
          <ArrowLeft /> Alle Vorlagen
        </Button>
        {loaded.archivedAt && <StatusBadge tone="neutral">Archiviert</StatusBadge>}
        {usedFor.map((k) => (
          <StatusBadge key={k} tone="success" dot={false}>
            Aktiv: {EMAIL_THEME_KIND_LABELS[k as keyof typeof EMAIL_THEME_KIND_LABELS] ?? k}
          </StatusBadge>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {undoSteps > 0 && (
            <Button variant="ghost" size="sm" onClick={undo}>
              <Undo2 /> Rückgängig
            </Button>
          )}
          <DesignerToggle
            open={designerOpen}
            onToggle={() => setDesignerOpen((o) => !o)}
            aiConfigured={aiConfigured}
            running={designer.running}
          />
          <Button size="sm" onClick={() => void save()} loading={saving} disabled={!dirty || name.trim().length < 3}>
            <Save /> Speichern
          </Button>
          <Menu
            label="Weitere Aktionen"
            size="sm"
            items={[
              { key: "dup", label: "Duplizieren", icon: <Copy />, onSelect: () => void duplicate() },
              {
                key: "export",
                label: "Exportieren (JSON)",
                icon: <Download />,
                onSelect: () => downloadJson(name, templateExportFile({ name, description: description || null, doc })),
              },
              loaded.archivedAt
                ? { key: "restore", label: "Wiederherstellen", icon: <ArchiveRestore />, onSelect: () => void archive(false), separatorBefore: true }
                : { key: "archive", label: "Archivieren", icon: <Archive />, onSelect: () => void archive(true), separatorBefore: true },
            ]}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required>
          <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Beschreibung">
          <Input value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} placeholder="Wofür ist die Vorlage gedacht?" />
        </Field>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          {designerOpen && aiConfigured && (
            <DesignerPanel session={designer} use="template" onClose={() => setDesignerOpen(false)} />
          )}
          <p className="flex items-center gap-1 text-sm font-semibold">
            Bausteine
            <InfoTip panelClassName="max-w-md">
              <p>
                Mit „Mos persönlicher Text“ wird die Vorlage zum Design für Mos persönliche Mails (Kampagne, Marketing) —
                auswählbar in Einstellungen und in der Kampagne. Mo schreibt weiter den Text, wählt Produkte und Rabatt;
                die Vorlage bestimmt, wo alles steht und was es umgibt.
              </p>
              <p>Jede Vorlage kann eine Rundmail starten (dann ohne Mo-Bausteine).</p>
            </InfoTip>
          </p>
          <BlockEditor
            doc={doc}
            onChange={setDoc}
            use="template"
            issues={issues}
            uploadConfigured={uploadConfigured}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-2 xl:sticky xl:top-4 xl:self-start">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">Vorschau</p>
            <SegmentedControl
              label="Vorschau als"
              size="sm"
              value={previewUse}
              onChange={setPreviewUse}
              options={[
                { value: "bulk", label: "Rundmail" },
                { value: "personal", label: "Persönliche Mail", disabled: !personal },
              ]}
            />
          </div>
          <LivePreview doc={doc} use={previewUse === "personal" && personal ? "personal" : "bulk"} subject={name} title={`Vorschau ${name}`} />
        </div>
      </div>

      {confirmDialog}
    </div>
  );
}
