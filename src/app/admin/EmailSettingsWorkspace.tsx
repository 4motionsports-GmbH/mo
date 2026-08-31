"use client";

// The "Einstellungen" tab's email workspace — the DESIGN PICKER for the
// code-based email designs (src/lib/email-designs/):
//
//   - Design-Bibliothek: every registered design (built with Claude Code, see
//     docs/EMAIL_DESIGNS.md) with a live preview per email type — rendered
//     through the REAL production composers with sample data, so what you see
//     is what a real send with that design produces.
//   - Zuordnung: per email type, which design is currently live ("version
//     control" pointer — older designs stay selectable forever).
//   - Versand-Konfiguration: read-only env-derived Resend settings.
//
// Designs are NOT edited here — a new design is a new code module authored
// with Claude Code; after deployment it appears in this list automatically.
// Server component (EinstellungenTab) seeds the data; this card owns the
// selection state and calls the guarded /api/admin/email-designs routes.

import * as React from "react";
import { Check, Mail, Palette, Sparkles } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
  toast,
} from "./ui";
import { EmailPreviewButton } from "./EmailPreviewButton";
import {
  EMAIL_THEME_KINDS,
  EMAIL_THEME_KIND_HINTS,
  EMAIL_THEME_KIND_LABELS,
} from "@/lib/email-theme.mjs";

// Serialized registry metadata (email-designs/registry.ts listEmailDesignMeta).
export interface EmailDesignMetaItem {
  key: string;
  name: string;
  description: string;
  addedAt: string;
  supportedKinds: string[];
  isDefault: boolean;
}

export interface SendConfigProps {
  configured: boolean;
  senderAddress: string | null;
  inboundAddress: string | null;
  logoOverride: string | null;
}

const kindLabel = (kind: string): string =>
  EMAIL_THEME_KIND_LABELS[kind as keyof typeof EMAIL_THEME_KIND_LABELS] ?? kind;

const addedAtLabel = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("de-DE", { dateStyle: "medium" });
};

export function EmailSettingsWorkspace({
  dbReady,
  designs,
  initialSelections,
  sendConfig,
}: {
  dbReady: boolean;
  designs: EmailDesignMetaItem[];
  initialSelections: Partial<Record<string, string>>;
  sendConfig: SendConfigProps;
}) {
  const [selections, setSelections] =
    React.useState<Partial<Record<string, string>>>(initialSelections);
  const [busyKind, setBusyKind] = React.useState<string | null>(null);

  // The selection effective for a kind: stored key if this deploy knows it,
  // otherwise classic (mirrors the fail-soft resolution on the send path).
  const effectiveKey = React.useCallback(
    (kind: string): string => {
      const key = selections[kind];
      return key && designs.some((d) => d.key === key) ? key : "classic";
    },
    [selections, designs]
  );

  const kindsUsing = React.useCallback(
    (designKey: string): string[] =>
      EMAIL_THEME_KINDS.filter((k) => effectiveKey(k) === designKey),
    [effectiveKey]
  );

  const assign = React.useCallback(
    async (kind: string, designKey: string) => {
      if (busyKind !== null) return;
      setBusyKind(kind);
      try {
        const res = await fetch("/api/admin/email-designs/assign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind,
            designKey: designKey === "classic" ? null : designKey,
          }),
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
        setSelections((prev) => {
          const next = { ...prev };
          if (designKey === "classic") delete next[kind];
          else next[kind] = designKey;
          return next;
        });
        const name = designs.find((d) => d.key === designKey)?.name ?? designKey;
        toast({
          variant: "success",
          title: "Design zugeordnet",
          description: `${kindLabel(kind)} verwendet ab sofort „${name}“.`,
        });
      } catch {
        toast({
          variant: "error",
          title: "Netzwerkfehler",
          description: "Bitte erneut versuchen.",
        });
      } finally {
        setBusyKind(null);
      }
    },
    [busyKind, designs]
  );

  return (
    <div className="space-y-5">
      {/* ── Design-Bibliothek ────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-4 w-4" /> Design-Bibliothek
          </CardTitle>
          <CardDescription>
            Alle verfügbaren E-Mail-Designs. Jedes Design definiert das allgemeine
            Erscheinungsbild und ist für jeden E-Mail-Typ maßgeschneidert — die Vorschau
            zeigt pro Typ exakt, wie eine echte E-Mail mit diesem Design aussieht (mit
            Beispieldaten). Die Inhalte (KI-Texte, Produkte, Rechtstexte) bleiben immer
            unverändert.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {designs.map((design) => {
            const used = kindsUsing(design.key);
            return (
              <div key={design.key} className="rounded-lg border border-border p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {design.name}
                      {design.isDefault && (
                        <span className="ms-2 align-middle">
                          <Badge variant="outline">Standard</Badge>
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {design.description}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Hinzugefügt am {addedAtLabel(design.addedAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {used.length > 0 ? (
                      used.map((k) => (
                        <Badge key={k} variant="secondary">
                          Aktiv: {kindLabel(k)}
                        </Badge>
                      ))
                    ) : (
                      <Badge variant="outline">Nicht in Verwendung</Badge>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">Vorschau:</span>
                  {EMAIL_THEME_KINDS.filter((k) => design.supportedKinds.includes(k)).map(
                    (k) => (
                      <EmailPreviewButton
                        key={k}
                        path="/api/admin/email-designs/preview"
                        getPayload={() => ({ designKey: design.key, kind: k })}
                        title={`${design.name} — ${kindLabel(k)}`}
                        description="Beispiel-E-Mail dieses Typs im gewählten Design — Inhalte sind Beispieldaten, Links inaktiv."
                        variant="outline"
                        size="sm"
                        label={kindLabel(k)}
                      />
                    )
                  )}
                </div>
              </div>
            );
          })}

          <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 px-3.5 py-3 text-xs text-info">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>
              Neue Designs werden mit Claude Code entwickelt (Anleitung:{" "}
              <code>docs/EMAIL_DESIGNS.md</code>) und erscheinen hier nach dem Deployment
              automatisch. Bestehende Designs bleiben dauerhaft erhalten und auswählbar —
              ein Redesign ist immer ein neues Design, kein Überschreiben.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Zuordnung ────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Check className="h-4 w-4" /> Aktives Design je E-Mail-Typ
          </CardTitle>
          <CardDescription>
            Wähle für jeden E-Mail-Typ, welches Design er aktuell verwendet. Die KI
            erstellt und versendet die E-Mails wie gewohnt — im gewählten Design. Ein
            Wechsel wirkt sofort auf neue Sendungen und lässt sich jederzeit
            zurücknehmen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!dbReady && (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-3 text-sm text-warning">
              Keine Datenbank konfiguriert (DATABASE_URL) — die Auswahl kann nicht
              gespeichert werden. Alle E-Mails verwenden das Standard-Design.
            </div>
          )}
          {EMAIL_THEME_KINDS.map((kind) => {
            const current = effectiveKey(kind);
            const options = designs.filter((d) => d.supportedKinds.includes(kind));
            return (
              <div
                key={kind}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{kindLabel(kind)}</p>
                  <p className="text-xs text-muted-foreground">
                    {EMAIL_THEME_KIND_HINTS[kind as keyof typeof EMAIL_THEME_KIND_HINTS]}
                  </p>
                </div>
                <div className="flex w-full items-center gap-2 sm:w-auto">
                  <div className="w-full sm:w-64">
                    <Select
                      aria-label={`Design für ${kindLabel(kind)}`}
                      value={current}
                      onChange={(e) => void assign(kind, e.target.value)}
                      disabled={!dbReady || busyKind !== null}
                    >
                      {options.map((d) => (
                        <option key={d.key} value={d.key}>
                          {d.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <EmailPreviewButton
                    path="/api/admin/email-designs/preview"
                    getPayload={() => ({ designKey: effectiveKey(kind), kind })}
                    title={`Aktuell aktiv — ${kindLabel(kind)}`}
                    description="So sieht dieser E-Mail-Typ mit dem aktuell gewählten Design aus (Beispieldaten)."
                    variant="outline"
                    size="sm"
                  />
                </div>
              </div>
            );
          })}
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
            Abmelde-Hinweis in Marketing-E-Mails bleiben von Designs unberührt.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
