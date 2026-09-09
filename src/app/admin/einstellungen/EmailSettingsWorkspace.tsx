"use client";

// The "Einstellungen" screen — the DESIGN PICKER for the code-based e-mail
// designs (src/lib/email-designs/), the per-type assignment, the read-only
// send configuration and the Systemstatus overview (decision D-5):
//
//   - Design-Bibliothek: every registered design (built with Claude Code, see
//     docs/EMAIL_DESIGNS.md) with ONE preview dialog that switches the e-mail
//     type inside — rendered through the REAL production composers with sample
//     data, so what you see is what a real send with that design produces.
//   - Zuordnung: per e-mail type, which design is currently live ("version
//     control" pointer — older designs stay selectable forever).
//   - Versand-Konfiguration + Systemstatus: env-derived, read-only.
//
// Designs are NOT edited here — a new design is a new code module; after
// deployment it appears in this list automatically. The server component
// (EinstellungenTab) seeds the data; this workspace owns the selection state
// and calls the guarded /api/admin/email-designs routes.

import * as React from "react";
import { Check, Eye, Mail, Palette } from "lucide-react";
import {
  EMAIL_THEME_KINDS,
  EMAIL_THEME_KIND_HINTS,
  EMAIL_THEME_KIND_LABELS,
} from "@/lib/email-theme.mjs";
import { ADMIN_DATE_MEDIUM, formatAdmin } from "@/lib/admin-datetime.mjs";
import {
  Button,
  Callout,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  InfoTip,
  Select,
  StatusBadge,
  toast,
} from "../ui";
import { adminFetch, friendlyErrorMessage } from "../lib/admin-fetch";
import {
  DesignPreviewDialog,
  type DesignPreviewTarget,
} from "./DesignPreviewDialog";
import { SystemStatusCard } from "./SystemStatusCard";
import type {
  EmailDesignMetaItem,
  SendConfigProps,
  SystemStatus,
} from "./types";

const kindLabel = (kind: string): string =>
  EMAIL_THEME_KIND_LABELS[kind as keyof typeof EMAIL_THEME_KIND_LABELS] ?? kind;
const kindHint = (kind: string): string | undefined =>
  EMAIL_THEME_KIND_HINTS[kind as keyof typeof EMAIL_THEME_KIND_HINTS];

export function EmailSettingsWorkspace({
  dbReady,
  designs,
  initialSelections,
  sendConfig,
  systemStatus,
}: {
  dbReady: boolean;
  designs: EmailDesignMetaItem[];
  initialSelections: Partial<Record<string, string>>;
  sendConfig: SendConfigProps;
  systemStatus: SystemStatus;
}) {
  const [selections, setSelections] =
    React.useState<Partial<Record<string, string>>>(initialSelections);
  const [busyKind, setBusyKind] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<DesignPreviewTarget | null>(
    null,
  );

  // The selection effective for a kind: stored key if this deploy knows it,
  // otherwise classic (mirrors the fail-soft resolution on the send path).
  const effectiveKey = React.useCallback(
    (kind: string): string => {
      const key = selections[kind];
      return key && designs.some((d) => d.key === key) ? key : "classic";
    },
    [selections, designs],
  );
  const kindsUsing = (designKey: string): string[] =>
    EMAIL_THEME_KINDS.filter((k) => effectiveKey(k) === designKey);

  const openPreview = (designKey: string, kind: string) => {
    const design = designs.find((d) => d.key === designKey);
    if (!design) return;
    setPreview({
      designKey,
      designName: design.name,
      supportedKinds: design.supportedKinds,
      kind,
    });
  };

  const assign = async (kind: string, designKey: string) => {
    if (busyKind !== null) return;
    setBusyKind(kind);
    try {
      const data = await adminFetch<{ ok?: boolean }>(
        "/api/admin/email-designs/assign",
        {
          body: { kind, designKey: designKey === "classic" ? null : designKey },
        },
      );
      if (!data.ok) throw new Error("Unbekannter Fehler");
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
    } catch (err) {
      toast({
        variant: "error",
        title: "Zuordnung fehlgeschlagen",
        description: friendlyErrorMessage(err),
      });
    } finally {
      setBusyKind(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="size-4" aria-hidden /> Design-Bibliothek
            <InfoTip panelClassName="max-w-md">
              <p>
                Alle verfügbaren E-Mail-Designs. Jedes Design definiert das
                allgemeine Erscheinungsbild und ist für jeden E-Mail-Typ
                maßgeschneidert — die Vorschau zeigt pro Typ exakt, wie eine
                echte E-Mail mit diesem Design aussieht (mit Beispieldaten). Die
                Inhalte (KI-Texte, Produkte, Rechtstexte) bleiben immer
                unverändert.
              </p>
              <p>
                Neue Designs werden mit Claude Code entwickelt (Anleitung:{" "}
                <code>docs/EMAIL_DESIGNS.md</code>) und erscheinen hier nach dem
                Deployment automatisch. Bestehende Designs bleiben dauerhaft
                erhalten und auswählbar — ein Redesign ist immer ein neues
                Design, kein Überschreiben.
              </p>
            </InfoTip>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {designs.map((design) => {
            const used = kindsUsing(design.key);
            return (
              <div
                key={design.key}
                className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border p-3.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{design.name}</p>
                    {design.isDefault && (
                      <StatusBadge tone="neutral" dot={false}>
                        Standard
                      </StatusBadge>
                    )}
                    {used.length > 0 ? (
                      used.map((k) => (
                        <StatusBadge key={k} tone="success" dot={false}>
                          Aktiv: {kindLabel(k)}
                        </StatusBadge>
                      ))
                    ) : (
                      <StatusBadge tone="neutral" dot={false}>
                        Nicht in Verwendung
                      </StatusBadge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {design.description}
                  </p>
                  <p className="mt-1 text-2xs text-muted-foreground">
                    Hinzugefügt am{" "}
                    {formatAdmin(
                      design.addedAt,
                      ADMIN_DATE_MEDIUM,
                      design.addedAt,
                    )}{" "}
                    · {design.supportedKinds.map(kindLabel).join(", ")}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    openPreview(
                      design.key,
                      design.supportedKinds[0] ?? EMAIL_THEME_KINDS[0],
                    )
                  }
                  disabled={design.supportedKinds.length === 0}
                >
                  <Eye /> Vorschau
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Check className="size-4" aria-hidden /> Aktives Design je
            E-Mail-Typ
            <InfoTip>
              Wähle für jeden E-Mail-Typ, welches Design er aktuell verwendet.
              Die KI erstellt und versendet die E-Mails wie gewohnt — im
              gewählten Design. Ein Wechsel wirkt sofort auf neue Sendungen und
              lässt sich jederzeit zurücknehmen.
            </InfoTip>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!dbReady && (
            <Callout tone="warning" compact>
              Keine Datenbank konfiguriert (DATABASE_URL) — die Auswahl kann
              nicht gespeichert werden. Alle E-Mails verwenden das
              Standard-Design.
            </Callout>
          )}
          {EMAIL_THEME_KINDS.map((kind) => {
            const current = effectiveKey(kind);
            const options = designs.filter((d) =>
              d.supportedKinds.includes(kind),
            );
            const hint = kindHint(kind);
            return (
              <div
                key={kind}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3.5"
              >
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  {kindLabel(kind)}
                  {hint && <InfoTip>{hint}</InfoTip>}
                </p>
                <div className="flex w-full items-center gap-2 sm:w-auto">
                  <Select
                    aria-label={`Design für ${kindLabel(kind)}`}
                    value={current}
                    onChange={(e) => void assign(kind, e.target.value)}
                    disabled={!dbReady || busyKind !== null}
                    className="h-8 w-full py-0 pr-8 text-xs sm:w-64"
                  >
                    {options.map((d) => (
                      <option key={d.key} value={d.key}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openPreview(current, kind)}
                  >
                    <Eye /> Vorschau
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="size-4" aria-hidden /> Versand-Konfiguration
            <InfoTip>
              Diese Werte kommen aus den Umgebungsvariablen des Deployments
              (Resend) und werden hier nur angezeigt. Der rechtlich geprüfte
              Text der Anmelde-Bestätigung (DOI) und der Abmelde-Hinweis in
              Marketing-E-Mails bleiben von Designs unberührt.
            </InfoTip>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 text-sm sm:grid-cols-2">
            <ConfigRow label="E-Mail-Versand">
              <StatusBadge
                tone={sendConfig.configured ? "success" : "destructive"}
              >
                {sendConfig.configured ? "Konfiguriert" : "Nicht konfiguriert"}
              </StatusBadge>
            </ConfigRow>
            <ConfigRow label="Absender-Adresse">
              {sendConfig.senderAddress ?? "—"}
            </ConfigRow>
            <ConfigRow label="Antwort-/Eingangsadresse">
              {sendConfig.inboundAddress ?? "—"}
            </ConfigRow>
            <ConfigRow label="Logo-Override (EMAIL_LOGO_URL)">
              {sendConfig.logoOverride ?? "—"}
            </ConfigRow>
          </dl>
        </CardContent>
      </Card>

      <SystemStatusCard status={systemStatus} />

      <DesignPreviewDialog target={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function ConfigRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate font-medium">{children}</dd>
    </div>
  );
}
