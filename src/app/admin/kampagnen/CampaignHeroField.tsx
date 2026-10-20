"use client";

// „Kampagnenbild“ — the campaign's own default hero picture (Kampagnen-Editor
// → Gestaltung, in „Neue Kampagne“ and „Bearbeiten“; docs/CAMPAIGNS.md).
//
// Staged: the operator states where the picture comes from (required — it
// decides the EU „KI-generiertes Bild“ label and the file's marking), the
// browser checks and, if needed, shrinks it (lib/prepare-hero-upload.ts),
// POST /api/admin/campaigns/hero-image processes and stores the desktop and
// phone files and returns the value — and „Speichern“ commits it with the
// rest of the form. „Entfernen“ only clears the field (no confirm: nothing is
// deleted until Speichern, and no file is ever deleted — sent mails keep
// their URL). The previews are the PROCESSED files, so the operator sees the
// crop, the light overlay on the text side and the phone crop as mailed.

import * as React from "react";
import { ImageOff } from "lucide-react";
import { ADMIN_DATE_TIME_SHORT, formatAdmin } from "@/lib/admin-datetime.mjs";
import { num } from "@/lib/admin-format.mjs";
import { campaignHeroUrls } from "@/lib/campaign-hero.mjs";
import { HERO_UPLOAD_ACCEPT } from "@/lib/email-hero-upload-client.mjs";
import { Button, Callout, Field, FileDropZone, InfoTip, Label, Select, StatusBadge } from "../ui";
import { adminFetch } from "../lib/admin-fetch";
import { prepareHeroUpload } from "../lib/prepare-hero-upload";
import { useAsyncAction } from "../lib/use-async-action";
import type { CampaignHeroImageProps } from "./types";

/** The InfoTip of the field (design text, verbatim; split into paragraphs). */
const HERO_FIELD_INFO = (
  <>
    <p>
      Standard-Titelbild dieser Kampagne im Design „Performance“. Es ersetzt das allgemeine Standardbild in allen
      Mails der Kampagne; ein im Kampagnen-Desk pro Mail erzeugtes KI-Titelbild hat Vorrang.
    </p>
    <p>
      Format: JPG, PNG oder WebP, max. 4 MB (iPhone-HEIC vorher als JPG exportieren). Größe: Querformat, empfohlen
      1536 × 720 px oder größer (ca. 2,1 : 1), mindestens 1280 × 600 px; andere Formate werden zugeschnitten — hohe
      Bilder mittig, breite vom rechten Rand.
    </p>
    <p>
      Motiv nach rechts: die linke Hälfte trägt Überschrift, Text und Button und wird bis etwa 64 % der Breite hell
      überblendet; auf dem Smartphone erscheint nur der rechte Teil (ab 40 %) unter dem Text. Keine Schrift und
      keine Logos im Bild.
    </p>
    <p>
      Nur Bilder mit Nutzungsrechten für E-Mail-Werbung verwenden, erkennbare Personen nur mit Einwilligung.
      Gespeichert wird ein JPEG; Kamera-Metadaten (z. B. GPS) werden entfernt.
    </p>
  </>
);

const ORIGIN_INFO =
  "Pflichtangabe. Bestimmt den Hinweis „KI-generiertes Bild“ in der Mail (EU-KI-Verordnung Art. 50) und die maschinenlesbare Kennzeichnung der Datei. Zum Ändern das Bild erneut hochladen.";

const NOT_CONFIGURED = "Bild-Upload nicht eingerichtet (BLOB_READ_WRITE_TOKEN fehlt).";

type Origin = "" | "photo" | "ai";

interface UploadResult {
  heroImage: CampaignHeroImageProps;
  warnings?: string[];
}

/** Same picture and the same AI statement (what a save would change). */
export const sameHero = (a: CampaignHeroImageProps | null, b: CampaignHeroImageProps | null) =>
  (a?.file ?? null) === (b?.file ?? null) && (a?.ai ?? null) === (b?.ai ?? null);

/** A preview image that degrades to a neutral box when the file cannot load
 *  (e.g. a local setup without the blob store). */
function PreviewImage({ src, alt, className }: { src: string; alt: string; className: string }) {
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  if (failedSrc === src) {
    return (
      <span
        role="img"
        aria-label={`${alt} — Vorschau nicht verfügbar`}
        className={`${className} flex items-center justify-center bg-surface-2 text-muted-foreground`}
      >
        <ImageOff className="size-5" aria-hidden />
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} onError={() => setFailedSrc(src)} />;
}

export interface CampaignHeroFieldProps {
  /** The form's value (staged upload or the saved picture), null = none. */
  value: CampaignHeroImageProps | null;
  /** What the campaign has stored (null for a new campaign) — for the
   *  „Noch nicht gespeichert“ badge and „Zurücksetzen“. */
  saved: CampaignHeroImageProps | null;
  onChange: (value: CampaignHeroImageProps | null) => void;
  /** An upload is running (the editor holds „Speichern“ meanwhile, or the
   *  picture would arrive after the sheet closed). */
  onBusyChange?: (busy: boolean) => void;
  /** Names the uploaded files (null = not saved yet → „new“). */
  campaignId: number | null;
  /** The effective design (campaign's own or the Einstellungen choice) shows a Titelbild. */
  designHasHero: boolean;
  designName: string;
  /** BLOB_READ_WRITE_TOKEN is set. */
  uploadConfigured: boolean;
  /** The design's default picture (what a mail shows without a Kampagnenbild). */
  defaultUrl: string;
}

export function CampaignHeroField({
  value,
  saved,
  onChange,
  onBusyChange,
  campaignId,
  designHasHero,
  designName,
  uploadConfigured,
  defaultUrl,
}: CampaignHeroFieldProps) {
  const labelId = React.useId();
  const [origin, setOrigin] = React.useState<Origin>("");
  const [replacing, setReplacing] = React.useState(false);
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const originRef = React.useRef<HTMLSelectElement>(null);
  const replaceRef = React.useRef<HTMLButtonElement>(null);
  // Where focus goes after an action removed the button that had it.
  const rootRef = React.useRef<HTMLDivElement>(null);
  const focusNext = React.useRef<"origin" | "replace" | null>(null);

  const urls = React.useMemo(() => campaignHeroUrls(value, ""), [value]);
  const dirty = !sameHero(value, saved);
  const showUploader = !urls || replacing;

  const upload = useAsyncAction(
    async (file: File, ai: boolean) => {
      setWarnings([]);
      const prepared = await prepareHeroUpload(file);
      const query = new URLSearchParams({ ai: ai ? "1" : "0", name: prepared.name });
      if (campaignId) query.set("campaignId", String(campaignId));
      return adminFetch<UploadResult>(`/api/admin/campaigns/hero-image?${query.toString()}`, {
        rawBody: prepared.blob,
      });
    },
    {
      errorToast: false,
      onError: () => {
        const active = document.activeElement;
        // The uploader is open (that is where uploads start): its first control.
        if (!active || active === document.body) focusNext.current = "origin";
      },
      onSuccess: (r) => {
        onChange(r.heroImage);
        setWarnings(Array.isArray(r.warnings) ? r.warnings : []);
        setReplacing(false);
        setOrigin("");
        focusNext.current = "replace";
      },
    }
  );

  const uploading = upload.pending;
  React.useEffect(() => {
    onBusyChange?.(uploading);
  }, [uploading, onBusyChange]);
  React.useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  React.useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    // The operator moved on to another field while the upload ran: leave the
    // focus there (a jump would turn their next keystroke into „Ersetzen…“).
    const active = document.activeElement;
    const lost = !active || active === document.body || active.getAttribute("role") === "dialog";
    if (!lost && !rootRef.current?.contains(active)) return;
    if (target === "origin") originRef.current?.focus();
    else replaceRef.current?.focus();
  });

  const startReplace = () => {
    upload.reset();
    setOrigin("");
    setReplacing(true);
    focusNext.current = "origin";
  };
  const cancelReplace = () => {
    upload.reset();
    setOrigin("");
    setReplacing(false);
    focusNext.current = "replace";
  };
  const remove = () => {
    upload.reset();
    setWarnings([]);
    setReplacing(false);
    onChange(null);
    focusNext.current = "origin";
  };
  const restore = () => {
    upload.reset();
    setWarnings([]);
    setReplacing(false);
    onChange(saved);
    focusNext.current = saved ? "replace" : "origin";
  };

  const pickDisabled = !uploadConfigured || origin === "";

  return (
    <div ref={rootRef} className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <Label id={labelId} className="text-xs">
            Kampagnenbild
          </Label>
          <InfoTip panelClassName="max-w-md">{HERO_FIELD_INFO}</InfoTip>
        </span>
        {dirty && <StatusBadge tone="warning">Noch nicht gespeichert</StatusBadge>}
      </div>

      <div role="group" aria-labelledby={labelId} className="flex flex-col gap-3 rounded-md border border-border bg-card p-3">
        {!uploadConfigured && (
          <Callout tone="warning" compact>
            {NOT_CONFIGURED}
          </Callout>
        )}
        {!designHasHero && (
          <Callout tone="info" compact>
            Nur im Design „Performance“ sichtbar — „{designName}“ hat kein Titelbild. Das Bild bleibt gespeichert und
            erscheint, sobald die Kampagne Performance nutzt.
          </Callout>
        )}

        {urls && value ? (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <figure className="flex min-w-0 flex-1 basis-80 flex-col gap-1">
                <div className="relative aspect-[32/15] w-full max-w-[640px] overflow-hidden rounded-md border border-border bg-surface-2">
                  <PreviewImage
                    src={urls.desktop}
                    alt="Kampagnenbild, Desktop-Ansicht"
                    className="absolute inset-0 size-full object-cover object-right"
                  />
                  {/* Where the mail puts its headline, text and button (left 55 %). */}
                  <div
                    className="pointer-events-none absolute bottom-[8%] left-[3%] top-[8%] w-[52%] rounded-sm border border-dashed border-accent"
                    aria-hidden
                  >
                    <span className="absolute left-1.5 top-1.5 rounded-sm bg-card px-1.5 py-0.5 text-2xs text-muted-foreground shadow-sm">
                      Textbereich: Überschrift, Text, Button
                    </span>
                  </div>
                </div>
                <figcaption className="text-2xs text-muted-foreground">Desktop</figcaption>
              </figure>
              <figure className="flex shrink-0 flex-col gap-1">
                <PreviewImage
                  src={urls.mobile}
                  alt="Kampagnenbild, Smartphone-Ansicht"
                  className="aspect-[922/720] w-36 rounded-md border border-border object-cover"
                />
                <figcaption className="text-2xs text-muted-foreground">Smartphone (unter dem Text)</figcaption>
              </figure>
            </div>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {value.name && <span className="max-w-full truncate text-foreground">{value.name}</span>}
              {value.width != null && value.height != null && (
                <span className="tabular-nums">
                  {num(value.width)} × {num(value.height)} px
                </span>
              )}
              <StatusBadge tone={value.ai ? "info" : "neutral"}>{value.ai ? "KI-generiert" : "Foto"}</StatusBadge>
              {value.uploadedAt && <span>hochgeladen {formatAdmin(value.uploadedAt, ADMIN_DATE_TIME_SHORT)}</span>}
            </div>
          </>
        ) : (
          <figure className="flex items-center gap-3">
            <PreviewImage
              src={defaultUrl}
              alt="Standardbild des Designs"
              className="aspect-[32/15] w-32 shrink-0 rounded-md border border-border object-cover object-right"
            />
            <figcaption className="text-xs text-muted-foreground">Ohne Kampagnenbild: Standardbild des Designs</figcaption>
          </figure>
        )}

        {showUploader && (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] sm:items-start">
            <Field label="Bildherkunft" required info={ORIGIN_INFO}>
              <Select
                ref={originRef}
                value={origin}
                required
                disabled={!uploadConfigured || upload.pending}
                onChange={(e) => {
                  upload.reset();
                  setOrigin(e.target.value as Origin);
                }}
              >
                <option value="">Bitte wählen …</option>
                <option value="photo">Foto oder eigene Grafik</option>
                <option value="ai">KI-generiert (EU-Hinweis in der Mail)</option>
              </Select>
            </Field>
            <FileDropZone
              accept={HERO_UPLOAD_ACCEPT}
              label="Kampagnenbild hochladen"
              prompt="Bild hierher ziehen oder"
              buttonLabel="Datei wählen"
              hint="JPG, PNG oder WebP · max. 4 MB · Querformat ab 1280 × 600 px"
              disabled={pickDisabled}
              disabledReason={uploadConfigured ? "Erst die Bildherkunft wählen" : NOT_CONFIGURED}
              busy={upload.pending}
              onFile={(file) => void upload.run(file, origin === "ai")}
            />
          </div>
        )}

        {upload.error && (
          <Callout tone="destructive" compact role="alert">
            {upload.error}
          </Callout>
        )}
        {warnings.length > 0 && (
          <Callout tone="warning" compact>
            {warnings.length === 1 ? (
              warnings[0]
            ) : (
              <ul className="list-disc pl-4">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </Callout>
        )}

        {(urls || (dirty && saved)) && (
          <div className="flex flex-wrap items-center gap-2">
            {urls && !replacing && (
              <>
                <Button ref={replaceRef} variant="outline" size="sm" onClick={startReplace} disabled={!uploadConfigured}>
                  Ersetzen…
                </Button>
                <Button variant="ghost" size="sm" onClick={remove}>
                  Entfernen
                </Button>
              </>
            )}
            {urls && replacing && (
              <Button variant="ghost" size="sm" onClick={cancelReplace} disabled={upload.pending}>
                Abbrechen
              </Button>
            )}
            {dirty && saved && (
              <Button variant="ghost" size="sm" onClick={restore} disabled={upload.pending}>
                Zurücksetzen
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
