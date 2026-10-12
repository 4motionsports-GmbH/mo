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
//   - Kontakthäufigkeit: the soft warning threshold („Warnung ab n Werbe-Mails
//     in N Tagen“, admin_settings 0078) — editable; next to it, read-only, the
//     HARD cap MARKETING_MIN_SEND_INTERVAL_DAYS so the two never get mixed up.
//
// Designs are NOT edited here — a new design is a new code module; after
// deployment it appears in this list automatically. The server component
// (EinstellungenTab) seeds the data; this workspace owns the selection state
// and calls the guarded /api/admin/email-designs routes.

import * as React from "react";
import { BellRing, Check, Eye, Mail, Palette, Save } from "lucide-react";
import {
  EMAIL_THEME_KINDS,
  EMAIL_THEME_KIND_HINTS,
  EMAIL_THEME_KIND_LABELS,
} from "@/lib/email-theme.mjs";
import { ADMIN_DATE_MEDIUM, formatAdmin } from "@/lib/admin-datetime.mjs";
import {
  CONTACT_FREQUENCY_COUNTED,
  CONTACT_FREQUENCY_LIMITS,
  DEFAULT_CONTACT_FREQUENCY,
  contactFrequencySummary,
  sendIntervalLabel,
  validateContactFrequencyInput,
} from "@/lib/contact-frequency.mjs";
import {
  Button,
  Callout,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  InfoTip,
  Input,
  Select,
  StatusBadge,
  toast,
} from "../ui";
import { adminFetch, friendlyErrorMessage } from "../lib/admin-fetch";
import { useAsyncAction } from "../lib/use-async-action";
import {
  DesignPreviewDialog,
  type DesignPreviewTarget,
} from "./DesignPreviewDialog";
import { SystemStatusCard } from "./SystemStatusCard";
import { ShopifySyncCard, type ShopifySyncCardProps } from "./ShopifySyncCard";
import type {
  ContactFrequencyCardProps,
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
  contactFrequency,
  systemStatus,
  shopifySync,
}: {
  dbReady: boolean;
  designs: EmailDesignMetaItem[];
  initialSelections: Partial<Record<string, string>>;
  sendConfig: SendConfigProps;
  contactFrequency: ContactFrequencyCardProps;
  systemStatus: SystemStatus;
  /** Einstellungen → Shopify-Abgleich (null without a database). */
  shopifySync: ShopifySyncCardProps | null;
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

      <ContactFrequencyCard dbReady={dbReady} {...contactFrequency} />

      {shopifySync && <ShopifySyncCard {...shopifySync} />}

      <SystemStatusCard status={systemStatus} />

      <DesignPreviewDialog target={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

/** The field's own error (the shared strict rule, one field at a time). */
function fieldError(field: "maxMails" | "windowDays", raw: string): string | null {
  const probe = validateContactFrequencyInput(
    field === "maxMails" ? { maxMails: raw, windowDays: 0 } : { maxMails: 0, windowDays: raw },
  );
  return probe.ok ? null : probe.message;
}

/**
 * „Kontakthäufigkeit“ — the soft warning before a marketing mail to a person
 * who already received several (lib/contact-frequency.mjs). Saved through the
 * guarded settings route; without a database the inputs are disabled and the
 * default applies. Next to it, read-only, the hard cap
 * MARKETING_MIN_SEND_INTERVAL_DAYS.
 */
function ContactFrequencyCard({
  dbReady,
  settings,
  minSendIntervalDays,
}: ContactFrequencyCardProps & { dbReady: boolean }) {
  const [saved, setSaved] = React.useState(settings);
  const [maxMails, setMaxMails] = React.useState(String(settings.maxMails));
  const [windowDays, setWindowDays] = React.useState(String(settings.windowDays));
  const maxMailsError = fieldError("maxMails", maxMails);
  const windowDaysError = fieldError("windowDays", windowDays);
  const parsed = validateContactFrequencyInput({ maxMails, windowDays });
  const dirty =
    !parsed.ok ||
    parsed.settings.maxMails !== saved.maxMails ||
    parsed.settings.windowDays !== saved.windowDays;

  const save = useAsyncAction(
    async () => {
      if (!parsed.ok) throw new Error(parsed.message);
      const json = await adminFetch<{ ok?: boolean; settings?: { maxMails: number; windowDays: number } }>(
        "/api/admin/settings/contact-frequency",
        { body: parsed.settings },
      );
      return json.settings ?? parsed.settings;
    },
    {
      errorToast: "Kontakthäufigkeit nicht gespeichert",
      onSuccess: (next) => {
        setSaved(next);
        setMaxMails(String(next.maxMails));
        setWindowDays(String(next.windowDays));
        toast({
          variant: "success",
          title: "Kontakthäufigkeit gespeichert",
          description: contactFrequencySummary(next),
        });
      },
    },
  );

  const { maxMails: mailBounds, windowDays: dayBounds } = CONTACT_FREQUENCY_LIMITS;
  const disabled = !dbReady || save.pending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className="size-4" aria-hidden /> Kontakthäufigkeit
          <InfoTip panelClassName="max-w-md">
            <p>
              Ein Hinweis vor dem Senden, wenn eine Person in kurzer Zeit schon
              mehrere Werbe-Mails bekommen hat — im Prüftisch der Kampagne (auch
              beim Einplanen) und in Kunden → Marketing. Es ist nur eine Warnung:
              „Trotzdem senden“ verschickt die Mail.
            </p>
            <p>{CONTACT_FREQUENCY_COUNTED}</p>
            <p>
              Testkontakte bekommen nie eine Warnung; der automatische Versand
              eingeplanter Mails prüft sie nicht. 0 in einem der beiden Felder
              schaltet die Warnung aus. Standard: ab{" "}
              {DEFAULT_CONTACT_FREQUENCY.maxMails} Werbe-Mails in{" "}
              {DEFAULT_CONTACT_FREQUENCY.windowDays} Tagen.
            </p>
          </InfoTip>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!dbReady && (
          <Callout tone="warning" compact>
            Keine Datenbank konfiguriert (DATABASE_URL) — die Einstellung kann
            nicht gespeichert werden. Es gilt der Standard.
          </Callout>
        )}
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!disabled && dirty && parsed.ok) void save.run();
          }}
        >
          <Field
            label="Warnung ab (Mails)"
            info={`Warnung ab … Werbe-Mails: ganze Zahl von ${mailBounds.min} bis ${mailBounds.max}. Die Warnung erscheint, wenn die Person schon so viele oder mehr bekommen hat; 0 = aus.`}
            error={maxMailsError}
            className="w-44"
          >
            <Input
              type="number"
              inputMode="numeric"
              min={mailBounds.min}
              max={mailBounds.max}
              step={1}
              value={maxMails}
              onChange={(e) => setMaxMails(e.target.value)}
              disabled={disabled}
            />
          </Field>
          <Field
            label="Zeitraum (Tage)"
            info={`In … Tagen: ganze Zahl von ${dayBounds.min} bis ${dayBounds.max}: der Zeitraum, in dem gezählt wird (rückwärts ab jetzt); 0 = aus.`}
            error={windowDaysError}
            className="w-44"
          >
            <Input
              type="number"
              inputMode="numeric"
              min={dayBounds.min}
              max={dayBounds.max}
              step={1}
              value={windowDays}
              onChange={(e) => setWindowDays(e.target.value)}
              disabled={disabled}
            />
          </Field>
          <Button
            type="submit"
            size="sm"
            className="mb-px"
            loading={save.pending}
            disabled={!dbReady || !dirty || !parsed.ok}
          >
            <Save /> Speichern
          </Button>
        </form>
        <dl className="grid gap-x-8 text-sm sm:grid-cols-2">
          <ConfigRow label="Gilt jetzt">{contactFrequencySummary(saved)}</ConfigRow>
          <ConfigRow
            label={
              <span className="flex items-center gap-1">
                Sperrfrist
                <InfoTip>
                  MARKETING_MIN_SEND_INTERVAL_DAYS aus den Umgebungsvariablen —
                  eine harte Grenze: Solange die letzte Werbe-Mail an die
                  Adresse jünger ist, lehnt der Server den Versand ab. Die
                  Kontakthäufigkeit oben ist dagegen nur ein Hinweis.
                </InfoTip>
              </span>
            }
          >
            {sendIntervalLabel(minSendIntervalDays)}
          </ConfigRow>
        </dl>
      </CardContent>
    </Card>
  );
}

function ConfigRow({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate font-medium">{children}</dd>
    </div>
  );
}
