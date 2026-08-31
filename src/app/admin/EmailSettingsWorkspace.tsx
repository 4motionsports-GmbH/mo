"use client";

// The "Einstellungen" tab's email workspace: manage the stored e-mail design
// templates ("Vorlagen"), assign one to each outgoing email type, and check
// the send configuration — everything email-related in one place.
//
// Server component (EinstellungenTab) seeds the data; this card owns the edit
// state and calls the guarded /api/admin/email-templates routes (same
// fetch→toast pattern as DirectivesCard). The template editor previews through
// the shared EmailPreviewButton with the CURRENT on-screen tokens, so unsaved
// edits are visible before saving.

import * as React from "react";
import { Check, Loader2, Mail, Palette, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  Select,
  toast,
} from "./ui";
import { EmailPreviewButton } from "./EmailPreviewButton";
import {
  DEFAULT_EMAIL_THEME,
  EMAIL_BUTTON_SHAPES,
  EMAIL_BUTTON_SHAPE_LABELS,
  EMAIL_FONT_CHOICES,
  EMAIL_FONT_KEYS,
  EMAIL_THEME_KINDS,
  EMAIL_THEME_KIND_HINTS,
  EMAIL_THEME_KIND_LABELS,
  MAX_TEMPLATE_DESCRIPTION_CHARS,
  MAX_TEMPLATE_NAME_CHARS,
} from "@/lib/email-theme.mjs";

// Serialized shapes from the server / API routes.
export interface EmailThemeFields {
  accentColor: string;
  bandBackground: string;
  bandTextColor: string;
  outerBackground: string;
  fontFamily: string;
  buttonShape: string;
  logoUrl: string | null;
  showSocial: boolean;
}

export interface EmailTemplateItem {
  id: number;
  name: string;
  description: string | null;
  theme: EmailThemeFields;
  createdAt: string;
  updatedAt: string;
}

export interface SendConfigProps {
  configured: boolean;
  senderAddress: string | null;
  inboundAddress: string | null;
  logoOverride: string | null;
}

interface EditorState {
  /** null = create new template. */
  id: number | null;
  name: string;
  description: string;
  accentColor: string;
  bandBackground: string;
  bandTextColor: string;
  outerBackground: string;
  fontFamily: string;
  buttonShape: string;
  logoUrl: string;
  showSocial: boolean;
}

function editorFromTemplate(t: EmailTemplateItem | null): EditorState {
  const theme = t?.theme ?? (DEFAULT_EMAIL_THEME as EmailThemeFields);
  return {
    id: t?.id ?? null,
    name: t?.name ?? "",
    description: t?.description ?? "",
    accentColor: theme.accentColor,
    bandBackground: theme.bandBackground,
    bandTextColor: theme.bandTextColor,
    outerBackground: theme.outerBackground,
    fontFamily: theme.fontFamily,
    buttonShape: theme.buttonShape,
    logoUrl: theme.logoUrl ?? "",
    showSocial: theme.showSocial,
  };
}

function themePayload(e: EditorState): Record<string, unknown> {
  return {
    accentColor: e.accentColor,
    bandBackground: e.bandBackground,
    bandTextColor: e.bandTextColor,
    outerBackground: e.outerBackground,
    fontFamily: e.fontFamily,
    buttonShape: e.buttonShape,
    logoUrl: e.logoUrl.trim() || null,
    showSocial: e.showSocial,
  };
}

const dateFmt = (iso: string) =>
  new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });

// One themed color input: native picker + editable hex text, kept in sync.
function ColorField({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const validHex = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} (Farbwähler)`}
          value={validHex ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="h-9 w-11 shrink-0 cursor-pointer rounded-md border border-input bg-card p-1"
        />
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#008ccb"
          maxLength={7}
          disabled={disabled}
          className={validHex ? undefined : "border-destructive"}
        />
      </div>
    </div>
  );
}

export function EmailSettingsWorkspace({
  dbReady,
  initialTemplates,
  initialAssignments,
  sendConfig,
}: {
  dbReady: boolean;
  initialTemplates: EmailTemplateItem[];
  initialAssignments: Partial<Record<string, number>>;
  sendConfig: SendConfigProps;
}) {
  const [templates, setTemplates] = React.useState<EmailTemplateItem[]>(initialTemplates);
  const [assignments, setAssignments] =
    React.useState<Partial<Record<string, number>>>(initialAssignments);
  const [editor, setEditor] = React.useState<EditorState | null>(null);
  const [busy, setBusy] = React.useState<null | "save" | number | `assign:${string}`>(null);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<number | null>(null);

  const kindsUsing = React.useCallback(
    (templateId: number): string[] =>
      EMAIL_THEME_KINDS.filter((k) => assignments[k] === templateId),
    [assignments]
  );

  const setField = React.useCallback(
    <K extends keyof EditorState>(key: K, value: EditorState[K]) => {
      setEditor((prev) => (prev ? { ...prev, [key]: value } : prev));
    },
    []
  );

  const save = React.useCallback(async () => {
    if (!editor || busy !== null) return;
    if (!editor.name.trim()) {
      toast({
        variant: "error",
        title: "Name fehlt",
        description: "Bitte gib der Vorlage einen Namen.",
      });
      return;
    }
    setBusy("save");
    try {
      const res = await fetch("/api/admin/email-templates/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editor.id ?? undefined,
          name: editor.name,
          description: editor.description.trim() || null,
          ...themePayload(editor),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        template?: EmailTemplateItem;
        error?: { message?: string };
      };
      if (!res.ok || !data.template) {
        toast({
          variant: "error",
          title: "Vorlage konnte nicht gespeichert werden",
          description: data.error?.message,
        });
        return;
      }
      const saved = data.template;
      setTemplates((prev) =>
        prev.some((t) => t.id === saved.id)
          ? prev.map((t) => (t.id === saved.id ? saved : t))
          : [...prev, saved]
      );
      setEditor(null);
      toast({
        variant: "success",
        title: "Vorlage gespeichert",
        description: `„${saved.name}“ ist ${
          editor.id == null ? "angelegt" : "aktualisiert"
        } — zugeordnete E-Mail-Typen verwenden sie ab sofort.`,
      });
    } catch {
      toast({
        variant: "error",
        title: "Netzwerkfehler",
        description: "Bitte erneut versuchen.",
      });
    } finally {
      setBusy(null);
    }
  }, [editor, busy]);

  const remove = React.useCallback(
    async (template: EmailTemplateItem) => {
      if (busy !== null) return;
      setBusy(template.id);
      try {
        const res = await fetch("/api/admin/email-templates/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: template.id }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: { message?: string };
        };
        if (!res.ok || !data.ok) {
          toast({
            variant: "error",
            title: "Vorlage konnte nicht gelöscht werden",
            description: data.error?.message,
          });
          return;
        }
        setTemplates((prev) => prev.filter((t) => t.id !== template.id));
        setAssignments((prev) => {
          const next = { ...prev };
          for (const k of Object.keys(next)) {
            if (next[k] === template.id) delete next[k];
          }
          return next;
        });
        if (editor?.id === template.id) setEditor(null);
        toast({
          variant: "success",
          title: "Vorlage gelöscht",
          description:
            "Bisher zugeordnete E-Mail-Typen verwenden wieder das Standard-Design.",
        });
      } catch {
        toast({
          variant: "error",
          title: "Netzwerkfehler",
          description: "Bitte erneut versuchen.",
        });
      } finally {
        setBusy(null);
        setConfirmDeleteId(null);
      }
    },
    [busy, editor]
  );

  const assign = React.useCallback(
    async (kind: string, templateId: number | null) => {
      if (busy !== null) return;
      setBusy(`assign:${kind}`);
      const previous = assignments[kind] ?? null;
      try {
        const res = await fetch("/api/admin/email-templates/assign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, templateId }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: { message?: string };
        };
        if (!res.ok || !data.ok) {
          toast({
            variant: "error",
            title: "Zuordnung fehlgeschlagen",
            description: data.error?.message,
          });
          return;
        }
        setAssignments((prev) => {
          const next = { ...prev };
          if (templateId == null) delete next[kind];
          else next[kind] = templateId;
          return next;
        });
        const label = EMAIL_THEME_KIND_LABELS[kind as keyof typeof EMAIL_THEME_KIND_LABELS];
        const name =
          templateId == null
            ? "Standard-Design"
            : (templates.find((t) => t.id === templateId)?.name ?? "Vorlage");
        toast({
          variant: "success",
          title: "Zuordnung gespeichert",
          description: `${label} verwendet ab sofort „${name}“.`,
        });
      } catch {
        toast({
          variant: "error",
          title: "Netzwerkfehler",
          description: "Bitte erneut versuchen.",
        });
        setAssignments((prev) => {
          const next = { ...prev };
          if (previous == null) delete next[kind];
          else next[kind] = previous;
          return next;
        });
      } finally {
        setBusy(null);
      }
    },
    [busy, assignments, templates]
  );

  if (!dbReady) {
    return (
      <div className="mb-4 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-3 text-sm text-warning">
        Keine Datenbank konfiguriert (DATABASE_URL) — E-Mail-Vorlagen können nicht
        gespeichert werden. Alle E-Mails verwenden das Standard-Design.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Vorlagen ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Palette className="h-4 w-4" /> E-Mail-Vorlagen
              </CardTitle>
              <CardDescription>
                Gestalte das Erscheinungsbild der ausgehenden E-Mails: Farben, Schrift,
                Buttons, Logo. Die Inhalte (KI-Texte, Produkte, Rechtstexte) bleiben
                unverändert — eine Vorlage ändert nur das Design drumherum.
              </CardDescription>
            </div>
            {editor === null && (
              <Button
                type="button"
                onClick={() => setEditor(editorFromTemplate(null))}
                disabled={busy !== null}
              >
                <Plus className="me-1.5 h-4 w-4" /> Neue Vorlage
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {templates.length === 0 && editor === null && (
            <p className="text-sm text-muted-foreground">
              Noch keine Vorlagen — alle E-Mails verwenden das Standard-Design. Lege mit
              „Neue Vorlage“ die erste an.
            </p>
          )}

          {templates.map((t) => {
            const used = kindsUsing(t.id);
            const isEditing = editor?.id === t.id;
            return (
              <div key={t.id} className="rounded-lg border border-border p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    {/* Mini swatches: accent / band / background at a glance. */}
                    <span className="flex shrink-0 items-center gap-1" aria-hidden>
                      {[t.theme.accentColor, t.theme.bandBackground, t.theme.outerBackground].map(
                        (c, i) => (
                          <span
                            key={i}
                            className="inline-block h-4 w-4 rounded-full border border-border"
                            style={{ backgroundColor: c }}
                          />
                        )
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{t.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {t.description || `Zuletzt geändert ${dateFmt(t.updatedAt)}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {used.length > 0 ? (
                      used.map((k) => (
                        <Badge key={k} variant="secondary">
                          {EMAIL_THEME_KIND_LABELS[k as keyof typeof EMAIL_THEME_KIND_LABELS]}
                        </Badge>
                      ))
                    ) : (
                      <Badge variant="outline">Nicht zugeordnet</Badge>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setConfirmDeleteId(null);
                        setEditor(isEditing ? null : editorFromTemplate(t));
                      }}
                      disabled={busy !== null}
                    >
                      <Pencil className="me-1 h-3.5 w-3.5" />
                      {isEditing ? "Schließen" : "Bearbeiten"}
                    </Button>
                    {confirmDeleteId === t.id ? (
                      <>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => void remove(t)}
                          disabled={busy !== null}
                        >
                          {busy === t.id ? (
                            <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="me-1 h-3.5 w-3.5" />
                          )}
                          Wirklich löschen
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmDeleteId(null)}
                          disabled={busy !== null}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmDeleteId(t.id)}
                        disabled={busy !== null}
                        title={
                          used.length > 0
                            ? "Zugeordnete E-Mail-Typen fallen auf das Standard-Design zurück"
                            : "Vorlage löschen"
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>

                {isEditing && editor && (
                  <TemplateEditor
                    editor={editor}
                    setField={setField}
                    busy={busy !== null}
                    saving={busy === "save"}
                    onSave={() => void save()}
                    onCancel={() => setEditor(null)}
                  />
                )}
              </div>
            );
          })}

          {editor !== null && editor.id === null && (
            <div className="rounded-lg border border-border p-3.5">
              <p className="text-sm font-semibold">Neue Vorlage</p>
              <TemplateEditor
                editor={editor}
                setField={setField}
                busy={busy !== null}
                saving={busy === "save"}
                onSave={() => void save()}
                onCancel={() => setEditor(null)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Zuordnung ────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Check className="h-4 w-4" /> Zuordnung je E-Mail-Typ
          </CardTitle>
          <CardDescription>
            Wähle für jeden E-Mail-Typ, welche Vorlage er verwendet. Ohne Zuordnung gilt
            das Standard-Design (das bisherige Erscheinungsbild). Die KI erstellt und
            versendet die E-Mails wie gewohnt — im gewählten Design.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {EMAIL_THEME_KINDS.map((kind) => (
            <div
              key={kind}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {EMAIL_THEME_KIND_LABELS[kind as keyof typeof EMAIL_THEME_KIND_LABELS]}
                </p>
                <p className="text-xs text-muted-foreground">
                  {EMAIL_THEME_KIND_HINTS[kind as keyof typeof EMAIL_THEME_KIND_HINTS]}
                </p>
              </div>
              <div className="w-full sm:w-72">
                <Select
                  aria-label={`Vorlage für ${
                    EMAIL_THEME_KIND_LABELS[kind as keyof typeof EMAIL_THEME_KIND_LABELS]
                  }`}
                  value={assignments[kind] != null ? String(assignments[kind]) : ""}
                  onChange={(e) =>
                    void assign(kind, e.target.value ? Number(e.target.value) : null)
                  }
                  disabled={busy !== null}
                >
                  <option value="">Standard-Design</option>
                  {templates.map((t) => (
                    <option key={t.id} value={String(t.id)}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── Versand-Konfiguration (read-only, env-derived) ───────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" /> Versand-Konfiguration
          </CardTitle>
          <CardDescription>
            Diese Werte kommen aus den Umgebungsvariablen des Deployments (Resend) und
            werden hier nur angezeigt.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <div className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5">
              <dt className="text-muted-foreground">E-Mail-Versand</dt>
              <dd>
                {sendConfig.configured ? (
                  <Badge variant="secondary">Konfiguriert</Badge>
                ) : (
                  <Badge variant="destructive">Nicht konfiguriert</Badge>
                )}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5">
              <dt className="text-muted-foreground">Absender-Adresse</dt>
              <dd className="truncate font-medium">{sendConfig.senderAddress ?? "—"}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5">
              <dt className="text-muted-foreground">Antwort-/Eingangsadresse</dt>
              <dd className="truncate font-medium">{sendConfig.inboundAddress ?? "—"}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5">
              <dt className="text-muted-foreground">Logo-Override (EMAIL_LOGO_URL)</dt>
              <dd className="truncate font-medium">{sendConfig.logoOverride ?? "—"}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            Hinweis: Der rechtlich geprüfte Text der Anmelde-Bestätigung (DOI) und der
            Abmelde-Hinweis in Marketing-E-Mails bleiben von Vorlagen unberührt.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// The template editor form — colors, font, button shape, logo, social row —
// with a live preview through the shared preview route.
function TemplateEditor({
  editor,
  setField,
  busy,
  saving,
  onSave,
  onCancel,
}: {
  editor: EditorState;
  setField: <K extends keyof EditorState>(key: K, value: EditorState[K]) => void;
  busy: boolean;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const idPrefix = editor.id == null ? "tpl-new" : `tpl-${editor.id}`;
  return (
    <div className="mt-3 space-y-4 border-t border-border pt-3.5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-name`}>Name</Label>
          <Input
            id={`${idPrefix}-name`}
            value={editor.name}
            onChange={(e) => setField("name", e.target.value)}
            placeholder="z. B. Sommer-Kampagne"
            maxLength={MAX_TEMPLATE_NAME_CHARS}
            disabled={busy}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-desc`}>Beschreibung (optional)</Label>
          <Input
            id={`${idPrefix}-desc`}
            value={editor.description}
            onChange={(e) => setField("description", e.target.value)}
            placeholder="Wofür ist diese Vorlage gedacht?"
            maxLength={MAX_TEMPLATE_DESCRIPTION_CHARS}
            disabled={busy}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ColorField
          id={`${idPrefix}-accent`}
          label="Akzentfarbe (Buttons & Links)"
          value={editor.accentColor}
          onChange={(v) => setField("accentColor", v)}
          disabled={busy}
        />
        <ColorField
          id={`${idPrefix}-band-bg`}
          label="Bänder: Hintergrund"
          value={editor.bandBackground}
          onChange={(v) => setField("bandBackground", v)}
          disabled={busy}
        />
        <ColorField
          id={`${idPrefix}-band-text`}
          label="Bänder: Schriftfarbe"
          value={editor.bandTextColor}
          onChange={(v) => setField("bandTextColor", v)}
          disabled={busy}
        />
        <ColorField
          id={`${idPrefix}-outer`}
          label="Seiten-Hintergrund"
          value={editor.outerBackground}
          onChange={(v) => setField("outerBackground", v)}
          disabled={busy}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-font`}>Schriftart</Label>
          <Select
            id={`${idPrefix}-font`}
            value={editor.fontFamily}
            onChange={(e) => setField("fontFamily", e.target.value)}
            disabled={busy}
          >
            {EMAIL_FONT_KEYS.map((key) => (
              <option key={key} value={key}>
                {EMAIL_FONT_CHOICES[key as keyof typeof EMAIL_FONT_CHOICES].label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-shape`}>Button-Form</Label>
          <Select
            id={`${idPrefix}-shape`}
            value={editor.buttonShape}
            onChange={(e) => setField("buttonShape", e.target.value)}
            disabled={busy}
          >
            {EMAIL_BUTTON_SHAPES.map((shape) => (
              <option key={shape} value={shape}>
                {EMAIL_BUTTON_SHAPE_LABELS[shape as keyof typeof EMAIL_BUTTON_SHAPE_LABELS]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-logo`}>Logo-URL (optional, https)</Label>
          <Input
            id={`${idPrefix}-logo`}
            value={editor.logoUrl}
            onChange={(e) => setField("logoUrl", e.target.value)}
            placeholder="Leer = Standard-Logo"
            disabled={busy}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={editor.showSocial}
          onChange={(e) => setField("showSocial", e.target.checked)}
          disabled={busy}
        />
        Social-Media-Icons im Footer anzeigen
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={onSave} disabled={busy}>
          {saving ? (
            <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Check className="me-1.5 h-4 w-4" />
          )}
          Speichern
        </Button>
        <EmailPreviewButton
          path="/api/admin/email-templates/preview"
          getPayload={() => themePayload(editor)}
          title={`Vorschau — ${editor.name.trim() || "Neue Vorlage"}`}
          description="Beispiel-E-Mail mit den aktuellen (auch ungespeicherten) Design-Werten — Inhalte sind Beispieldaten."
          disabled={busy}
        />
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Abbrechen
        </Button>
      </div>
    </div>
  );
}
