"use client";

// The campaign editor (Neue Kampagne / Bearbeiten) — one sheet, eight sections:
// Grundlagen, Briefing, Zielgruppe (builder + „beschreiben“ via KI + live
// count), Angebot, Gestaltung (with the Kampagnenbild upload, 0079 —
// CampaignHeroField), Brief (letters as a channel, 0074), Automatik,
// Prüfen & testen (estimate + sample mails, CampaignCheckSection). Everything is validated again on the
// server (campaign-def.validateCampaignInput); the audience spec is normalised
// there (audience-spec.mjs). The live count always means „with consent“ — the
// e-mail channel never reaches anyone without it. A Rundmail's Zielgruppe
// starts with the common choices (Alle mit Einwilligung, Nur Double-Opt-in,
// Testgruppe = „Nur diese Adressen“, Eigene Filter); the count then says how
// many of the listed addresses match and why the others do not.
// docs/CAMPAIGNS.md §2.2 and §9.1.

import * as React from "react";
import { Sparkles, Users } from "lucide-react";
import { fromBerlinInputValue, toBerlinInputValue } from "@/lib/admin-datetime.mjs";
import { eurFromCents, num } from "@/lib/admin-format.mjs";
import { HERO_MODE_LABELS } from "@/lib/campaign-def.mjs";
import { AUDIENCE_MAX_EMAILS, audiencePresetOf, audiencePresetSpec, parseAudienceEmails } from "@/lib/audience-spec.mjs";
import {
  Button,
  Callout,
  Checkbox,
  Field,
  InfoTip,
  Input,
  SegmentedControl,
  Select,
  Sheet,
  Spinner,
  Textarea,
  ToggleChips,
  Tooltip,
  toast,
} from "../ui";
import { adminFetch, errorMessage } from "../lib/admin-fetch";
import { CampaignCheckSection, type SampleConfig } from "./CampaignCheckSection";
import { CampaignHeroField, sameHero } from "./CampaignHeroField";
import type { AudienceSpecProps, CampaignCardProps, CampaignEditorOptions, CampaignHeroImageProps, SenderOption } from "./types";

type Kind = "laufend" | "aktion" | "rundmail";

interface FormState {
  name: string;
  kind: Kind;
  startsAt: string;
  endsAt: string;
  priority: string;
  brief: string;
  audience: AudienceSpecProps;
  audienceMode: "dynamisch" | "fest";
  reentryDays: string;
  discountPercent: string;
  /** Always the individual selection (discount-scope.mjs) — saving narrows
   * an older campaign's whole-order scope. */
  discountScope: "recommendations";
  discountValidUntil: string;
  designKey: string;
  heroMode: "none" | "default" | "ai_ab" | "ai_all";
  /** The Kampagnenbild — a staged upload or the saved one; null = none. */
  heroImage: CampaignHeroImageProps | null;
  textMode: "" | "detailed" | "compact" | "minimal";
  moPromo: boolean;
  ctaKind: "mo_chat" | "shop";
  ctaUrl: string;
  autoPreparePerDay: string;
  dailyTarget: string;
  letterMode: "aus" | "ohne_einwilligung" | "alle";
  /** Postage cap in euros as typed; empty = none. */
  letterBudgetEur: string;
  /** Absender (0081): an identity id, "" = the default sender. */
  senderId: string;
  /** A NEW Rundmail starts from: "starter:<key>", "template:<id>" or "rundmail:<id>" (a copy). */
  contentFrom: string;
}

type AudiencePreset = "alle" | "doi" | "test" | "eigene";

/** Why a listed address of „Nur diese Adressen“ is (not) in the audience (audience-store.ts). */
const EMAIL_STATUS_LABELS: Record<string, string> = {
  passt: "passt",
  unbekannt: "keine Kundin / kein Kunde mit dieser Adresse",
  ohne_einwilligung: "ohne Einwilligung in E-Mail-Werbung",
  gesperrt: "gesperrt (Abmeldung, Bounce, Beschwerde oder Löschung)",
  andere_filter: "passt nicht zu den übrigen Filtern",
};

interface Preview {
  description: string;
  /** CAMPAIGN_ALLOW_SINGLE_OPT_IN — without it only double opt-in matches are sent. */
  allowSingleOptIn?: boolean;
  preview: {
    total: number;
    /** Of the total: with a provable double opt-in. */
    confirmed?: number;
    /** „Nur diese Adressen“: every listed address with its status. */
    emails?: Array<{ email: string; status: string }>;
    withMo: number;
    withoutConsent?: { total: number; letterReach: number };
    letters?: { total: number; withAddress: number };
    byLanguage: { de: number; en: number };
    sample: Array<{ customerId: number; email: string; name: string | null }>;
  };
}

const LIFECYCLE = [
  { value: "frisch", label: "Frisch gekauft (<7 T.)" },
  { value: "ausbauen_frueh", label: "Ausbauen — früh (7–30 T.)" },
  { value: "ausbauen", label: "Ausbauen (1–3 Mon.)" },
  { value: "weiterentwickeln", label: "Weiterentwickeln (3–12 Mon.)" },
  { value: "zurueckholen", label: "Zurückholen (1–2 J.)" },
  { value: "ruhen", label: "Ruhen (>2 J.)" },
  { value: "unbekannt", label: "Ohne Kauf" },
] as const;
const VALUE_TIERS = [
  { value: "klein", label: "Kleinteile" },
  { value: "komponente", label: "Komponenten" },
  { value: "grossgeraet", label: "Großgeräte" },
] as const;
const CHURN = [
  { value: "niedrig", label: "niedrig" },
  { value: "mittel", label: "mittel" },
  { value: "hoch", label: "hoch" },
] as const;
const LEVELS = [
  { value: "confirmed_opt_in", label: "Double-Opt-in" },
  { value: "single_opt_in", label: "Single-Opt-in" },
  { value: "unknown", label: "Unbekannt" },
] as const;
const LANGS = [
  { value: "de", label: "Deutsch" },
  { value: "en", label: "Englisch" },
] as const;

/** ISO ⇄ value of a <input type="datetime-local">, in Berlin time whatever zone the browser runs in
 * (admin-datetime.mjs — the same on the server render and in the browser). */
const toLocalInput = (iso: string | null): string => toBerlinInputValue(iso);
const fromLocalInput = (v: string): string | null => (v ? fromBerlinInputValue(v) : null);
const intOrNull = (v: string): number | null => (v.trim() === "" ? null : Math.round(Number(v)));

/** The settings a sample mail depends on, as the sample route validates them.
 * NOT the Kampagnenbild: it goes to the samples as its own prop, so a new
 * picture never marks paid AI samples as outdated (CampaignCheckSection). */
function sampleConfigOf(f: FormState): SampleConfig {
  return {
    name: f.name,
    // Samples exist for AI campaigns only (a Rundmail has no section for them).
    kind: f.kind === "laufend" ? "laufend" : "aktion",
    brief: f.brief,
    endsAt: fromLocalInput(f.endsAt),
    discountPercent: Math.round(Number(f.discountPercent) || 0),
    discountScope: f.discountScope,
    discountValidUntil: f.kind === "aktion" ? fromLocalInput(f.discountValidUntil) : null,
    designKey: f.designKey || null,
    textMode: f.textMode || null,
    moPromo: f.moPromo,
    ctaKind: f.ctaKind,
    ctaUrl: f.ctaUrl,
  };
}

function initialState(c: CampaignCardProps | null, presetAudience: Record<string, unknown> | null = null): FormState {
  return {
    name: c?.name ?? "",
    kind: c?.kind === "laufend" ? "laufend" : c?.kind === "rundmail" ? "rundmail" : "aktion",
    startsAt: toLocalInput(c?.startsAt ?? null),
    endsAt: toLocalInput(c?.endsAt ?? null),
    priority: String(c?.priority ?? 50),
    brief: c?.brief ?? "",
    audience: c?.audience ?? (presetAudience as FormState["audience"] | null) ?? { v: 1 },
    audienceMode: c?.audienceMode ?? "fest",
    reentryDays: c?.reentryDays != null ? String(c.reentryDays) : "",
    discountPercent: String(c?.discountPercent ?? 0),
    // "set" is retired (a set mail carries no code, offer-mode.mjs).
    discountScope: "recommendations",
    discountValidUntil: toLocalInput(c?.discountValidUntil ?? null),
    designKey: c?.designKey ?? "",
    heroMode: c?.heroMode ?? "default",
    heroImage: c?.heroImage ?? null,
    textMode: c?.textMode ?? "",
    moPromo: c?.moPromo ?? true,
    ctaKind: c?.ctaKind ?? "mo_chat",
    ctaUrl: c?.ctaUrl ?? "",
    autoPreparePerDay: String(c?.autoPreparePerDay ?? 0),
    dailyTarget: c?.dailyTarget != null ? String(c.dailyTarget) : "",
    letterMode: c?.letterMode ?? "aus",
    letterBudgetEur: c?.letterBudgetCents != null ? String(c.letterBudgetCents / 100) : "",
    senderId: c?.sender?.id ?? "",
    contentFrom: "starter:black-week",
  };
}

function RangeInputs({
  label,
  info,
  unit,
  value,
  onChange,
}: {
  label: string;
  info: string;
  unit: string;
  value: { min?: number; max?: number } | undefined;
  onChange: (v: { min?: number; max?: number } | undefined) => void;
}) {
  const set = (key: "min" | "max", raw: string) => {
    const next = { ...(value ?? {}) };
    const n = raw.trim() === "" ? undefined : Math.max(0, Math.round(Number(raw)));
    if (n === undefined || Number.isNaN(n)) delete next[key];
    else next[key] = n;
    onChange(next.min === undefined && next.max === undefined ? undefined : next);
  };
  return (
    <Field label={unit ? `${label} (${unit})` : label} info={info}>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={0}
          inputMode="numeric"
          aria-label={`${label} ab`}
          placeholder="ab"
          value={value?.min ?? ""}
          onChange={(e) => set("min", e.target.value)}
        />
        <span className="text-xs text-muted-foreground">–</span>
        <Input
          type="number"
          min={0}
          inputMode="numeric"
          aria-label={`${label} bis`}
          placeholder="bis"
          value={value?.max ?? ""}
          onChange={(e) => set("max", e.target.value)}
        />
      </div>
    </Field>
  );
}

function SectionTitle({ children, info }: { children: React.ReactNode; info?: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-1.5 text-sm font-semibold">
      {children}
      {info && <InfoTip>{info}</InfoTip>}
    </h3>
  );
}

export function CampaignEditor({
  open,
  campaign,
  campaigns,
  options,
  presetAudience = null,
  onClose,
  onSaved,
}: {
  open: boolean;
  campaign: CampaignCardProps | null;
  campaigns: CampaignCardProps[];
  options: CampaignEditorOptions;
  /** A new campaign starts with this audience (from Kunden „Ähnliche Kunden“). */
  presetAudience?: Record<string, unknown> | null;
  onClose: () => void;
  /** `kind` is set for a NEW Rundmail — the overview opens its workspace. */
  onSaved: (id: number, kind?: "rundmail") => void;
}) {
  const [form, setForm] = React.useState<FormState>(() => initialState(campaign, presetAudience));
  const [saving, setSaving] = React.useState(false);
  const [heroUploading, setHeroUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [describe, setDescribe] = React.useState("");
  const [assisting, setAssisting] = React.useState<null | "audience" | "brief">(null);
  const [aiNote, setAiNote] = React.useState<string | null>(null);
  // A Rundmail's common choices over the spec; „Eigene Filter“ keeps its last spec while a preset is tried.
  const [preset, setPreset] = React.useState<AudiencePreset>(() => audiencePresetOf(campaign?.audience ?? presetAudience));
  const [emailsText, setEmailsText] = React.useState(() => (campaign?.audience?.emails ?? []).join("\n"));
  const customSpec = React.useRef<AudienceSpecProps | null>(null);
  const isEinzel = campaign?.kind === "einzel";
  const isRundmail = form.kind === "rundmail";
  // A released Rundmail keeps audience, sender and schedule (frozen with its
  // content) — only the name can still change (the server enforces it too).
  const rundmailLocked = isRundmail && campaign != null && campaign.status !== "entwurf";

  React.useEffect(() => {
    if (open) {
      setForm(initialState(campaign, presetAudience));
      setError(null);
      setAiNote(null);
      setDescribe("");
      setPreset(audiencePresetOf(campaign?.audience ?? presetAudience));
      setEmailsText((campaign?.audience?.emails ?? []).join("\n"));
      customSpec.current = null;
    }
  }, [open, campaign, presetAudience]);

  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));
  const patchAudience = (p: Partial<AudienceSpecProps>) =>
    setForm((f) => {
      const next: AudienceSpecProps = { ...f.audience, ...p };
      for (const [k, v] of Object.entries(next)) {
        if (v === undefined || (Array.isArray(v) && v.length === 0)) delete (next as Record<string, unknown>)[k];
      }
      return { ...f, audience: next };
    });

  // „Nur diese Adressen“: the typed text stays as typed; the spec holds the normalised list.
  const parsedEmails = React.useMemo(() => parseAudienceEmails(emailsText), [emailsText]);
  const changeEmails = (text: string) => {
    setEmailsText(text);
    patchAudience({ emails: parseAudienceEmails(text).emails });
  };
  const choosePreset = (next: AudiencePreset) => {
    if (next === preset) return;
    if (preset === "eigene") customSpec.current = form.audience;
    const spec =
      next === "eigene"
        ? (customSpec.current ?? form.audience)
        : (audiencePresetSpec(next, { emails: parseAudienceEmails(emailsText).emails }) as AudienceSpecProps);
    setForm((f) => ({ ...f, audience: spec }));
    setPreset(next);
  };
  const isTestGroup = isRundmail && preset === "test";
  // A test group without a single valid address would be „everyone with consent“ — never save that.
  const testGroupEmpty = isTestGroup && !(form.audience.emails && form.audience.emails.length > 0);
  const showBuilder = !isRundmail || preset === "eigene";

  // Live count, debounced; only while the sheet is open.
  const audienceKey = JSON.stringify(form.audience);
  const letterModeKey = form.letterMode;
  React.useEffect(() => {
    if (!open || isEinzel) return;
    const controller = new AbortController();
    setPreviewLoading(true);
    const handle = setTimeout(() => {
      adminFetch<Preview>("/api/admin/campaigns/audience-preview", {
        body: {
          audience: JSON.parse(audienceKey),
          letterMode: letterModeKey === "aus" ? null : letterModeKey,
        },
        signal: controller.signal,
      })
        .then((json) => {
          if (!controller.signal.aborted) setPreview(json);
        })
        .catch(() => {
          if (!controller.signal.aborted) setPreview(null);
        })
        .finally(() => {
          if (!controller.signal.aborted) setPreviewLoading(false);
        });
    }, 400);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [audienceKey, letterModeKey, open, isEinzel]);

  const assistAudience = async () => {
    setAssisting("audience");
    setAiNote(null);
    try {
      const json = await adminFetch<{ spec: AudienceSpecProps; explanation: string }>("/api/admin/campaigns/assist", {
        body: { action: "audience", text: describe },
      });
      setForm((f) => ({ ...f, audience: json.spec }));
      setAiNote(json.explanation);
    } catch (err) {
      toast({ variant: "error", title: "KI-Vorschlag nicht möglich", description: errorMessage(err) });
    } finally {
      setAssisting(null);
    }
  };

  const assistBrief = async () => {
    setAssisting("brief");
    try {
      const json = await adminFetch<{ brief: string }>("/api/admin/campaigns/assist", {
        body: {
          action: "brief",
          name: form.name,
          kind: form.kind,
          notes: form.brief,
          endsAt: fromLocalInput(form.endsAt),
          discountPercent: Math.round(Number(form.discountPercent) || 0),
        },
      });
      patch({ brief: json.brief });
    } catch (err) {
      toast({ variant: "error", title: "KI-Vorschlag nicht möglich", description: errorMessage(err) });
    } finally {
      setAssisting(null);
    }
  };

  // The chosen identity object, or null (the default sender). A stored
  // identity that is no longer in the Einstellungen list keeps its own data.
  const senderFor = (id: string): SenderOption | null =>
    !id ? null : (options.senders.identities.find((x) => x.id === id) ?? (campaign?.sender?.id === id ? campaign.sender : null));

  const save = async () => {
    if (testGroupEmpty) {
      setError("Testgruppe: mindestens eine gültige Adresse eintragen — sonst ginge die Rundmail an alle mit Einwilligung.");
      return;
    }
    setSaving(true);
    setError(null);
    if (isRundmail) {
      const payload: Record<string, unknown> = rundmailLocked
        ? { name: form.name }
        : {
            name: form.name,
            audience: form.audience,
            startsAt: null,
            endsAt: fromLocalInput(form.endsAt),
            priority: Math.round(Number(form.priority) || 0),
            sender: senderFor(form.senderId),
          };
      try {
        if (campaign) {
          await adminFetch("/api/admin/campaigns/update", { body: { id: campaign.id, ...payload } });
          onSaved(campaign.id);
        } else {
          const [fromKind, fromValue] = form.contentFrom.split(":");
          const json = await adminFetch<{ id: number }>("/api/admin/campaigns", {
            body: {
              ...payload,
              kind: "rundmail",
              ...(fromKind === "template"
                ? { templateId: Number(fromValue) }
                : fromKind === "rundmail"
                  ? { fromRundmailId: Number(fromValue) }
                  : { starter: fromValue }),
            },
          });
          onSaved(json.id, "rundmail");
        }
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setSaving(false);
      }
      return;
    }
    const payload: Record<string, unknown> = {
      name: form.name,
      brief: form.brief,
      priority: Math.round(Number(form.priority) || 0),
      discountPercent: Math.round(Number(form.discountPercent) || 0),
      discountScope: form.discountScope,
      designKey: form.designKey || null,
      heroMode: form.heroMode,
      // Every kind, Einzelansprache too (validated by campaign-def; null clears it).
      heroImage: form.heroImage,
      textMode: form.textMode || null,
      moPromo: form.moPromo,
      ctaKind: form.ctaKind,
      ctaUrl: form.ctaUrl,
      autoPreparePerDay: Math.round(Number(form.autoPreparePerDay) || 0),
      dailyTarget: intOrNull(form.dailyTarget),
      sender: senderFor(form.senderId),
    };
    if (!isEinzel) {
      Object.assign(payload, {
        audience: form.audience,
        audienceMode: form.audienceMode,
        startsAt: fromLocalInput(form.startsAt),
        endsAt: fromLocalInput(form.endsAt),
        discountValidUntil: form.kind === "aktion" ? fromLocalInput(form.discountValidUntil) : null,
        reentryDays: form.kind === "laufend" ? intOrNull(form.reentryDays) : null,
        letterMode: form.letterMode,
        letterBudgetCents:
          form.letterBudgetEur.trim() === "" ? null : Math.round(Number(form.letterBudgetEur.replace(",", ".")) * 100),
      });
    }
    try {
      if (campaign) {
        await adminFetch("/api/admin/campaigns/update", { body: { id: campaign.id, ...payload } });
        onSaved(campaign.id);
      } else {
        const json = await adminFetch<{ id: number }>("/api/admin/campaigns", { body: { ...payload, kind: form.kind } });
        onSaved(json.id);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const sampleConfig = React.useMemo(() => sampleConfigOf(form), [form]);
  const sampleKey = JSON.stringify(sampleConfig);
  const savedSampleKey = React.useMemo(
    () => (campaign ? JSON.stringify(sampleConfigOf(initialState(campaign))) : null),
    [campaign]
  );
  // A staged Kampagnenbild is not part of the sample key (paid samples stay
  // valid), but the test send renders the SAVED picture — so it blocks the
  // test send until saved, like any other unsaved change.
  const heroDirty = campaign != null && !sameHero(form.heroImage, campaign.heroImage ?? null);

  const a = form.audience;
  const otherCampaigns = campaigns.filter((c) => c.id !== campaign?.id && c.kind !== "einzel");
  // „Hat Rundmail erhalten“: the other Rundmails (released or planned — a reminder can be prepared ahead).
  const otherRundmails = campaigns.filter((c) => c.id !== campaign?.id && c.kind === "rundmail" && c.status !== "entwurf");
  // The design the mails will use: the campaign's own, else the Einstellungen
  // choice (an unknown key falls back to it too — email-design-store).
  const effectiveDesign =
    (form.designKey ? options.designs.find((d) => d.key === form.designKey) : undefined) ?? options.settingsDesign;

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => (!o ? onClose() : undefined)}
      size="xl"
      title={campaign ? `${campaign.name} bearbeiten` : "Neue Kampagne"}
      actions={
        <Tooltip content="Das Kampagnenbild wird noch verarbeitet." disabled={!heroUploading}>
          <span className="inline-flex">
            <Button size="sm" onClick={() => void save()} loading={saving} disabled={heroUploading}>
              Speichern
            </Button>
          </span>
        </Tooltip>
      }
    >
      <div className="flex flex-col gap-6 pb-8">
        {error && <Callout tone="destructive">{error}</Callout>}

        {/* Grundlagen */}
        <section className="flex flex-col gap-3">
          <SectionTitle>Grundlagen</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" required>
              <Input data-autofocus value={form.name} maxLength={80} onChange={(e) => patch({ name: e.target.value })} placeholder="z. B. Black Friday 2026" />
            </Field>
            {!campaign && (
              <Field
                label="Art"
                info="Aktion: ein Anlass mit Zeitraum (z. B. Black Friday) — jede Mail von Mo persönlich geschrieben und einzeln geprüft. Laufend: dauerhaft, nimmt Kund:innen nach einer Wartezeit erneut auf (z. B. Lebenszyklus). Rundmail: EIN Inhalt für alle — einmal gestaltet, getestet und an die ganze Zielgruppe gesendet (z. B. Black-Week-Newsletter)."
              >
                <SegmentedControl
                  label="Art"
                  value={form.kind}
                  onChange={(kind) => {
                    // A Rundmail shows its „Empfänger“ choice for the filters set so far.
                    if (kind === "rundmail") setPreset(audiencePresetOf(form.audience));
                    patch({
                      kind,
                      audienceMode: kind === "aktion" ? "fest" : "dynamisch",
                      heroMode: kind === "laufend" ? "ai_ab" : "default",
                      reentryDays: kind === "laufend" ? "180" : "",
                    });
                  }}
                  options={[
                    { value: "aktion", label: "Aktion" },
                    { value: "laufend", label: "Laufend" },
                    { value: "rundmail", label: "Rundmail" },
                  ]}
                />
              </Field>
            )}
          </div>
          {isRundmail && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Versand spätestens bis"
                info="Was bis dahin nicht gesendet ist, geht nicht mehr raus (z. B. das Ende der Black Week). Leer = offen. Den Start wählst du beim Senden."
              >
                <Input type="datetime-local" value={form.endsAt} onChange={(e) => patch({ endsAt: e.target.value })} disabled={rundmailLocked} />
              </Field>
              <Field label="Absender" info="Von welcher Adresse die Rundmail kommt. Weitere Absender (z. B. info@) legst du in Einstellungen → Absender an.">
                <SenderSelect value={form.senderId} onChange={(senderId) => patch({ senderId })} options={options} saved={campaign?.sender ?? null} disabled={rundmailLocked} />
              </Field>
            </div>
          )}
          {isRundmail && !campaign && (
            <Field
              label="Inhalt starten mit"
              info="Der Inhalt wird danach in der Rundmail selbst gestaltet — per Baukasten oder mit KI. „Rundmail: …“ übernimmt Betreff, Vorschauzeile, Sprache, Inhalt und Tempo einer anderen Rundmail (z. B. erst an eine Testgruppe, dann an alle) — die Testmail ist für die neue Rundmail wieder nötig."
            >
              <Select value={form.contentFrom} onChange={(e) => patch({ contentFrom: e.target.value })}>
                <option value="starter:black-week">Beispiel: Black Week</option>
                <option value="starter:newsletter">Beispiel: Newsletter</option>
                <option value="starter:leer">Leer</option>
                {options.templates.map((t) => (
                  <option key={t.id} value={`template:${t.id}`}>
                    Vorlage: {t.name}
                  </option>
                ))}
                {campaigns
                  .filter((c) => c.kind === "rundmail" && c.status !== "archiviert")
                  .map((c) => (
                    <option key={`r${c.id}`} value={`rundmail:${c.id}`}>
                      Rundmail: {c.name}
                    </option>
                  ))}
              </Select>
            </Field>
          )}
          {rundmailLocked && (
            <Callout tone="info" compact>
              Die Rundmail ist freigegeben — Zielgruppe, Absender und Zeitraum sind fest. Nur der Name lässt sich noch ändern.
            </Callout>
          )}
          {!isEinzel && !isRundmail && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Start" info="Vor dem Start können Entwürfe vorbereitet und an Testkontakte gesendet werden; Kund:innen erhalten erst ab dem Start Mails. Leer = sofort.">
                <Input type="datetime-local" value={form.startsAt} onChange={(e) => patch({ startsAt: e.target.value })} />
              </Field>
              <Field label="Ende" info="Danach endet die Kampagne automatisch (nächtlich). Leer = offen.">
                <Input type="datetime-local" value={form.endsAt} onChange={(e) => patch({ endsAt: e.target.value })} />
              </Field>
              <Field label="Priorität" info="0–100. Bei der nächtlichen Vorbereitung bekommen Kampagnen mit höherer Priorität zuerst ihr Kontingent.">
                <Input type="number" min={0} max={100} value={form.priority} onChange={(e) => patch({ priority: e.target.value })} />
              </Field>
            </div>
          )}
        </section>

        {/* Briefing */}
        {!isRundmail && (
        <section className="flex flex-col gap-3">
          <SectionTitle info="Anlass, Ziel, Ton, was rein muss und was nicht. Der KI-Texter liest das Briefing bei jeder Mail dieser Kampagne — die Pflichtregeln (Einwilligung, Rabatt, Abmeldelink) gelten unverändert.">
            Briefing
          </SectionTitle>
          <Textarea
            aria-label="Briefing"
            rows={6}
            maxLength={4000}
            value={form.brief}
            onChange={(e) => patch({ brief: e.target.value })}
            placeholder="Anlass: … Ziel: … Ton: … Muss rein: … Bitte nicht: …"
          />
          <div>
            <Button size="xs" variant="outline" onClick={() => void assistBrief()} loading={assisting === "brief"} disabled={!form.name.trim()}>
              <Sparkles /> Briefing vorschlagen
            </Button>
          </div>
        </section>
        )}

        {/* Zielgruppe */}
        {!isEinzel && (
          <section className={rundmailLocked ? "pointer-events-none flex flex-col gap-3 opacity-60" : "flex flex-col gap-3"} inert={rundmailLocked || undefined}>
            <SectionTitle info="Wer die Kampagne bekommen soll. Es kommen immer nur Kund:innen mit Einwilligung in E-Mail-Werbung und ohne Sperre (Bounce, Beschwerde, Löschung) in Frage — die Filter grenzen weiter ein.">
              Zielgruppe
            </SectionTitle>
            {isRundmail && (
              <Field
                label="Empfänger"
                info="Alle mit Einwilligung: jede Kundin, jeder Kunde mit Einwilligung in E-Mail-Werbung und ohne Sperre. Nur Double-Opt-in: nur mit nachweisbarer Bestätigung. Testgruppe: nur die eingetragenen Adressen — für einen echten Probelauf über den normalen Versand an eigene Konten; auch sie brauchen die Einwilligung. Eigene Filter: Lebenszyklus, Wertstufe, frühere Rundmails und mehr."
              >
                <SegmentedControl
                  label="Empfänger"
                  value={preset}
                  onChange={choosePreset}
                  options={[
                    { value: "alle", label: "Alle mit Einwilligung" },
                    { value: "doi", label: "Nur Double-Opt-in" },
                    { value: "test", label: "Testgruppe" },
                    { value: "eigene", label: "Eigene Filter" },
                  ]}
                />
              </Field>
            )}
            {showBuilder && (
            <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3 sm:flex-row sm:items-end">
              <Field label="Beschreiben" className="flex-1" info="In eigenen Worten, z. B. „Großgeräte-Käufer der letzten zwei Jahre, die noch nie mit Mo gesprochen haben“. Die KI setzt die Filter — prüfen und anpassen.">
                <Input value={describe} onChange={(e) => setDescribe(e.target.value)} placeholder="Wer soll die Mail bekommen?" />
              </Field>
              <Button size="sm" variant="outline" onClick={() => void assistAudience()} loading={assisting === "audience"} disabled={describe.trim().length < 5}>
                <Sparkles /> Filter setzen
              </Button>
            </div>
            )}
            {aiNote && showBuilder && <p className="text-xs text-muted-foreground">KI: {aiNote}</p>}

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <div className="flex flex-col gap-3">
                {(isTestGroup || (isRundmail && preset === "eigene")) && (
                  <div className="flex flex-col gap-1">
                  <Field
                    label={isTestGroup ? "Nur diese Adressen" : "Nur diese Adressen (optional)"}
                    required={isTestGroup}
                    info={`Bis zu ${AUDIENCE_MAX_EMAILS} Adressen, eine pro Zeile oder mit Komma getrennt. Die Rundmail geht nur an die Kund:innen mit diesen Adressen — und nur, wenn sie in E-Mail-Werbung eingewilligt haben und nicht gesperrt sind. So läuft ein echter Probelauf über den normalen Versand (Pakete, Tracking, Abmelde-Link) an eigene Konten, bevor die große Rundmail geplant wird.`}
                  >
                    <Textarea
                      rows={isTestGroup ? 4 : 2}
                      value={emailsText}
                      onChange={(e) => changeEmails(e.target.value)}
                      placeholder={"du@motionsports.de\nkollegin@motionsports.de"}
                    />
                  </Field>
                    <span className="block text-2xs text-muted-foreground" aria-live="polite">
                      {parsedEmails.emails.length === 0
                        ? isTestGroup
                          ? "Noch keine gültige Adresse."
                          : "Leer = keine Einschränkung."
                        : `${num(parsedEmails.emails.length)} ${parsedEmails.emails.length === 1 ? "Adresse" : "Adressen"}`}
                      {parsedEmails.duplicates > 0 ? ` · ${num(parsedEmails.duplicates)} doppelt` : ""}
                      {parsedEmails.overLimit > 0 ? ` · ${num(parsedEmails.overLimit)} über der Grenze von ${AUDIENCE_MAX_EMAILS} ignoriert` : ""}
                    </span>
                    {parsedEmails.invalid.length > 0 && (
                      <span className="block text-2xs text-destructive">Nicht erkannt: {parsedEmails.invalid.join(", ")}</span>
                    )}
                  </div>
                )}
                {showBuilder && (
                <>
                {isRundmail && otherRundmails.length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                    <Field
                      label="Hat Rundmail erhalten"
                      info="Nur wer diese Rundmail bekommen hat — z. B. für eine Erinnerung am Cyber Monday an alle, die die Black-Friday-Mail bekommen, aber nicht geklickt haben. Ermittelt wird beim Versandstart dieser Rundmail."
                    >
                      <Select
                        value={a.receivedCampaign ? String(a.receivedCampaign.id) : ""}
                        onChange={(e) =>
                          patchAudience({
                            receivedCampaign: e.target.value
                              ? { id: Number(e.target.value), ...(a.receivedCampaign?.notClicked ? { notClicked: true } : {}) }
                              : undefined,
                          })
                        }
                      >
                        <option value="">Egal</option>
                        {otherRundmails.map((c) => (
                          <option key={c.id} value={String(c.id)}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="… aber nicht geklickt" inline className="w-fit sm:pb-2">
                      <Checkbox
                        checked={a.receivedCampaign?.notClicked === true}
                        disabled={!a.receivedCampaign}
                        onChange={(e) =>
                          patchAudience({
                            receivedCampaign: a.receivedCampaign
                              ? { id: a.receivedCampaign.id, ...(e.target.checked ? { notClicked: true } : {}) }
                              : undefined,
                          })
                        }
                      />
                    </Field>
                  </div>
                )}
                <Field label="Lebenszyklus" info="Wie lange der letzte Kauf zurückliegt.">
                  <ToggleChips label="Lebenszyklus" options={LIFECYCLE} value={a.lifecycle ?? []} onChange={(v) => patchAudience({ lifecycle: v })} />
                </Field>
                <Field label="Wertstufe" info="Nach dem teuersten einzelnen Artikel: Kleinteile unter 150 €, Komponenten bis 1.499 €, Großgeräte ab 1.500 €.">
                  <ToggleChips label="Wertstufe" options={VALUE_TIERS} value={a.valueTier ?? []} onChange={(v) => patchAudience({ valueTier: v })} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Abwanderungsrisiko" info="Aus Kaufrhythmus und Zeit seit dem letzten Kauf.">
                    <ToggleChips label="Abwanderungsrisiko" options={CHURN} value={a.churn ?? []} onChange={(v) => patchAudience({ churn: v })} />
                  </Field>
                  <Field label="Mit Mo gesprochen">
                    <SegmentedControl
                      label="Mit Mo gesprochen"
                      value={a.moContact ?? "egal"}
                      onChange={(v) => patchAudience({ moContact: v === "egal" ? undefined : (v as "yes" | "no") })}
                      options={[
                        { value: "egal", label: "Egal" },
                        { value: "yes", label: "Ja" },
                        { value: "no", label: "Nie" },
                      ]}
                    />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <RangeInputs label="Letzter Kauf vor" unit="Tage" info="Tage seit dem letzten Kauf." value={a.lastOrderDays} onChange={(v) => patchAudience({ lastOrderDays: v })} />
                  <RangeInputs label="Bestellungen" unit="" info="Anzahl bezahlter Bestellungen." value={a.ordersCount} onChange={(v) => patchAudience({ ordersCount: v })} />
                  <RangeInputs label="Umsatz" unit="€" info="Summe aller bezahlten Bestellungen." value={a.totalSpentEur} onChange={(v) => patchAudience({ totalSpentEur: v })} />
                </div>
                {options.categories.length > 0 && (
                  <Field label="Hat gekauft aus Kategorie">
                    <ToggleChips
                      label="Kategorien"
                      options={options.categories.map((c) => ({ value: c, label: c }))}
                      value={a.categories ?? []}
                      onChange={(v) => patchAudience({ categories: v })}
                    />
                  </Field>
                )}
                <Field label="Persona" info="Aus dem KI-Profil; „ohne Persona“ = noch kein Profil.">
                  <ToggleChips
                    label="Persona"
                    options={[...options.personas.map((p) => ({ value: p.key, label: p.label })), { value: "unknown", label: "ohne Persona" }]}
                    value={a.persona ?? []}
                    onChange={(v) => patchAudience({ persona: v })}
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Sprache">
                    <ToggleChips label="Sprache" options={LANGS} value={a.language ?? []} onChange={(v) => patchAudience({ language: v })} />
                  </Field>
                  <Field label="Einwilligung" info="Nur Double-Opt-in ist ohne weitere Freigabe versendbar (CAMPAIGN_ALLOW_SINGLE_OPT_IN).">
                    <ToggleChips label="Einwilligung" options={LEVELS} value={a.optInLevels ?? []} onChange={(v) => patchAudience({ optInLevels: v })} />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Keine Werbe-Mail in den letzten" info="Schließt Kund:innen aus, die kürzlich eine Kampagnen-Mail bekommen haben.">
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        value={a.excludeMailedWithinDays ?? ""}
                        onChange={(e) => patchAudience({ excludeMailedWithinDays: e.target.value ? Math.round(Number(e.target.value)) : undefined })}
                      />
                      <span className="text-xs text-muted-foreground">Tagen</span>
                    </div>
                  </Field>
                  <Field label="Hat geklickt in den letzten" info="Nur Kund:innen, die kürzlich in einer Mail geklickt haben.">
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        value={a.clickedWithinDays ?? ""}
                        onChange={(e) => patchAudience({ clickedWithinDays: e.target.value ? Math.round(Number(e.target.value)) : undefined })}
                      />
                      <span className="text-xs text-muted-foreground">Tagen</span>
                    </div>
                  </Field>
                </div>
                {otherCampaigns.length > 0 && (
                  <Field label="Nicht in Kampagne" info="Wer schon Empfänger:in einer dieser Kampagnen ist, bleibt draußen.">
                    <ToggleChips
                      label="Nicht in Kampagne"
                      options={otherCampaigns.map((c) => ({ value: String(c.id), label: c.name }))}
                      value={(a.excludeCampaignIds ?? []).map(String)}
                      onChange={(v) => patchAudience({ excludeCampaignIds: v.map(Number) })}
                    />
                  </Field>
                )}
                </>
                )}
                {isRundmail ? (
                  <p className="text-xs text-muted-foreground">
                    Die Zielgruppe wird beim Versand-Start frisch ermittelt — wer sich bis dahin anmeldet, ist dabei; wer sich abmeldet, nicht.
                  </p>
                ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Zielgruppe"
                    info="Dynamisch: wird nächtlich neu abgeglichen — neue Treffer kommen dazu, nicht mehr passende offene Empfänger:innen fallen heraus. Fest: wird beim Start einmal übernommen."
                  >
                    <SegmentedControl
                      label="Zielgruppe"
                      value={form.audienceMode}
                      onChange={(audienceMode) => patch({ audienceMode })}
                      options={[
                        { value: "fest", label: "Fest" },
                        { value: "dynamisch", label: "Dynamisch" },
                      ]}
                    />
                  </Field>
                  {form.kind === "laufend" && (
                    <Field label="Erneut aufnehmen nach" info="Wer eine Mail dieser Kampagne bekommen hat, kommt frühestens nach so vielen Tagen wieder in die Warteschlange. Leer = nie.">
                      <div className="flex items-center gap-2">
                        <Input type="number" min={14} value={form.reentryDays} onChange={(e) => patch({ reentryDays: e.target.value })} />
                        <span className="text-xs text-muted-foreground">Tagen</span>
                      </div>
                    </Field>
                  )}
                </div>
                )}
              </div>

              <aside className="flex h-fit flex-col gap-2 rounded-md border border-border bg-card p-3 lg:sticky lg:top-0" aria-live="polite">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Users className="size-3.5" aria-hidden /> Passende Kund:innen mit Einwilligung
                  {previewLoading && <Spinner className="ml-auto size-3.5" />}
                </div>
                <div className="text-2xl font-semibold tabular-nums">{preview && !testGroupEmpty ? num(preview.preview.total) : "—"}</div>
                {testGroupEmpty && <p className="text-xs text-muted-foreground">Erst Adressen eintragen.</p>}
                {preview && !testGroupEmpty && (
                  <>
                    {preview.preview.confirmed != null && (
                      <p className="text-xs">
                        davon {num(preview.preview.confirmed)} mit Double-Opt-in
                        {preview.allowSingleOptIn === false && preview.preview.total > preview.preview.confirmed && (
                          <span className="text-muted-foreground"> — nur sie werden angeschrieben (CAMPAIGN_ALLOW_SINGLE_OPT_IN ist aus)</span>
                        )}
                      </p>
                    )}
                    {preview.preview.emails && preview.preview.emails.length > 0 && (
                      <div className="flex flex-col gap-0.5 border-t border-border pt-2 text-xs">
                        <p className="font-medium">
                          {num(preview.preview.emails.filter((x) => x.status === "passt").length)} von {num(preview.preview.emails.length)}{" "}
                          {preview.preview.emails.length === 1 ? "Adresse passt" : "Adressen passen"}
                        </p>
                        {preview.preview.emails
                          .filter((x) => x.status !== "passt")
                          .map((x) => (
                            <p key={x.email} className="text-destructive">
                              <span className="break-all font-medium">{x.email}</span> — {EMAIL_STATUS_LABELS[x.status] ?? x.status}
                            </p>
                          ))}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {num(preview.preview.withMo)} mit Mo-Gespräch · DE {num(preview.preview.byLanguage.de)} · EN{" "}
                      {num(preview.preview.byLanguage.en)}
                    </p>
                    <p className="text-xs">{preview.description}</p>
                    {preview.preview.withoutConsent && preview.preview.withoutConsent.total > 0 && (
                      <p className="flex items-start gap-1 text-xs text-muted-foreground">
                        <span>
                          Ohne Einwilligung passen weitere {num(preview.preview.withoutConsent.total)} — davon{" "}
                          {num(preview.preview.withoutConsent.letterReach)} per Brief erreichbar.
                        </span>
                        <InfoTip>
                          E-Mail-Werbung geht nur an Personen mit Einwilligung. Bestandskunden ohne Einwilligung lassen
                          sich per Werbebrief erreichen, wenn eine Lieferadresse bekannt ist und kein Widerspruch vorliegt
                          (Kunden → Brief).
                        </InfoTip>
                      </p>
                    )}
                    {preview.preview.sample.length > 0 && (
                      <ul className="flex flex-col gap-0.5 border-t border-border pt-2 text-xs text-muted-foreground">
                        {preview.preview.sample.map((s) => (
                          <li key={s.customerId} className="truncate">
                            {s.name ?? s.email}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </aside>
            </div>
          </section>
        )}

        {!isRundmail && (
        <>
        {/* Angebot */}
        <section className="flex flex-col gap-3">
          <SectionTitle info="Startwerte für „Vorbereiten“ — pro Entwurf weiterhin änderbar. Codes werden erst beim Senden erzeugt (eindeutig, einmal einlösbar).">
            Angebot
          </SectionTitle>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Rabatt" info={`0 = kein Rabatt, höchstens ${options.maxDiscountPercent} %.`}>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={options.maxDiscountPercent}
                  value={form.discountPercent}
                  onChange={(e) => patch({ discountPercent: e.target.value })}
                />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
            </Field>
            <Field
              label="Gilt für"
              info="Der Rabattcode gilt nur für die individuelle Auswahl der Mail — genau die Produkte, die sie zeigt (ein Produkt mit allen Varianten in jeder Variante, eine gewählte Variante nur in dieser). Er ist einmalig einlösbar und mit keinem anderen Rabatt kombinierbar. Mails, an die ein Set angehängt wird, tragen keinen Code — der Set-Preis ist dort das Angebot."
            >
              <span className="flex h-9 items-center text-sm">Individuelle Auswahl</span>
            </Field>
            {form.kind === "aktion" && !isEinzel && (
              <Field label="Codes gültig bis" info="Alle Codes dieser Aktion enden zu diesem Zeitpunkt. Leer = übliche Gültigkeit ab Versand.">
                <Input type="datetime-local" value={form.discountValidUntil} onChange={(e) => patch({ discountValidUntil: e.target.value })} />
              </Field>
            )}
          </div>
        </section>

        {/* Gestaltung */}
        <section className="flex flex-col gap-3">
          <SectionTitle>Gestaltung</SectionTitle>
          <Field label="Absender" info="Von welcher Adresse die Mails dieser Kampagne kommen und wohin Antworten gehen. Weitere Absender (z. B. info@) legst du in Einstellungen → Absender an.">
            <SenderSelect value={form.senderId} onChange={(senderId) => patch({ senderId })} options={options} saved={campaign?.sender ?? null} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Design" info="Leer = das in Einstellungen für Kampagnen gewählte Design.">
              <Select value={form.designKey} onChange={(e) => patch({ designKey: e.target.value })}>
                <option value="">Wie in Einstellungen</option>
                {options.designs.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Titelbild" info="KI-Titelbilder entstehen beim Vorbereiten (Kosten pro Bild). A/B: nur jede zweite Mail — für den Vergleich in den KPIs. Mails ohne KI-Titelbild zeigen das Kampagnenbild, ohne Kampagnenbild das Standardbild des Designs.">
              <Select value={form.heroMode} onChange={(e) => patch({ heroMode: e.target.value as FormState["heroMode"] })}>
                {Object.entries(HERO_MODE_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Textlänge">
              <Select value={form.textMode} onChange={(e) => patch({ textMode: e.target.value as FormState["textMode"] })}>
                <option value="">Standard</option>
                <option value="detailed">Ausführlich</option>
                <option value="compact">Kompakt</option>
                <option value="minimal">Minimal</option>
              </Select>
            </Field>
          </div>
          <CampaignHeroField
            value={form.heroImage}
            saved={campaign?.heroImage ?? null}
            onChange={(heroImage) => patch({ heroImage })}
            onBusyChange={setHeroUploading}
            campaignId={campaign?.id ?? null}
            designHasHero={effectiveDesign.hasHero}
            designName={effectiveDesign.name}
            uploadConfigured={options.heroUpload.configured}
            defaultUrl={options.heroUpload.defaultUrl}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Button führt zu" info="Mo-Chat: der Button öffnet die Beratung mit Mo. Shop: ein Link in den Shop, z. B. die Black-Friday-Kollektion.">
              <SegmentedControl
                label="Button führt zu"
                value={form.ctaKind}
                onChange={(ctaKind) => patch({ ctaKind })}
                options={[
                  { value: "mo_chat", label: "Mo-Chat" },
                  { value: "shop", label: "Shop" },
                ]}
              />
            </Field>
            {form.ctaKind === "shop" && (
              <Field label="Shop-Link" required>
                <Input type="url" value={form.ctaUrl} onChange={(e) => patch({ ctaUrl: e.target.value })} placeholder="https://…" />
              </Field>
            )}
          </div>
          <Field label="Mo-Hinweis anhängen" inline info="Der Block „Frag Mo, deinen persönlichen Berater“ unter der Mail.">
            <Checkbox checked={form.moPromo} onChange={(e) => patch({ moPromo: e.target.checked })} />
          </Field>
        </section>

        {/* Brief */}
        {!isEinzel && (
          <section className="flex flex-col gap-3">
            <SectionTitle info="Werbebriefe per Post (Pingen) an Kund:innen mit abgeschlossener Bestellung, ohne Widerspruch gegen Briefwerbung — vor allem an alle, die keine E-Mail-Einwilligung haben. Adresse ist nur die Lieferadresse der letzten Bestellung. Jeder Brief wird im Prüftisch (Ansicht „Briefe“) geschrieben, geprüft und einzeln freigegeben; im Fuß stehen fest der Widerspruchshinweis und der Absender.">
              Brief
            </SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Briefe">
                <Select value={form.letterMode} onChange={(e) => patch({ letterMode: e.target.value as FormState["letterMode"] })}>
                  <option value="aus">Keine Briefe</option>
                  <option value="ohne_einwilligung">An alle ohne E-Mail-Einwilligung</option>
                  <option value="alle">An alle (auch mit Einwilligung)</option>
                </Select>
              </Field>
              {form.letterMode !== "aus" && (
                <Field
                  label="Porto-Budget (€)"
                  info="Obergrenze fürs Porto dieser Kampagne. Leer = ohne Grenze. Der Versand stoppt, wenn das Budget ausgeschöpft ist."
                >
                  <Input
                    type="number"
                    min={0}
                    step="1"
                    inputMode="decimal"
                    value={form.letterBudgetEur}
                    onChange={(e) => patch({ letterBudgetEur: e.target.value })}
                    placeholder="ohne Grenze"
                  />
                </Field>
              )}
            </div>
            {form.letterMode !== "aus" && (
              <>
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  {preview?.preview.letters
                    ? `Per Brief: ${num(preview.preview.letters.total)} Empfänger:innen (Adresse schon bekannt: ${num(preview.preview.letters.withAddress)}) · ≈ ${eurFromCents(preview.preview.letters.total * options.letters.costCents)} Porto bei ${eurFromCents(options.letters.costCents)} je Brief`
                    : "Per Brief: wird gezählt …"}
                </p>
                {!options.letters.sendsApproved && (
                  <Callout tone="warning">
                    Briefversand ist nicht freigeschaltet (PHYSICAL_MAIL_SENDS_APPROVED) — Briefe lassen sich vorbereiten,
                    aber nicht senden.
                  </Callout>
                )}
                {options.letters.sendsApproved && !options.letters.pingenConfigured && (
                  <Callout tone="warning">Pingen ist nicht konfiguriert — Briefe lassen sich vorbereiten, aber nicht senden.</Callout>
                )}
              </>
            )}
          </section>
        )}

        {/* Automatik */}
        <section className="flex flex-col gap-3">
          <SectionTitle info={`Nächtliche Vorbereitung: Entwürfe pro Tag aus dem gemeinsamen Kontingent (CAMPAIGN_AUTO_PREPARE_COUNT = ${num(options.autoPrepareBudget)}). Gesendet wird nur, was jemand im Prüftisch freigegeben hat — mit „Senden“ sofort oder mit „Einplanen“ zur gewählten Zeit.`}>
            Automatik
          </SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Automatisch vorbereiten" hint={options.autoPrepareBudget === 0 ? "Nächtliche Vorbereitung ist ausgeschaltet." : undefined}>
              <div className="flex items-center gap-2">
                <Input type="number" min={0} max={500} value={form.autoPreparePerDay} onChange={(e) => patch({ autoPreparePerDay: e.target.value })} />
                <span className="text-xs text-muted-foreground">Entwürfe / Nacht</span>
              </div>
            </Field>
            <Field label="Tagesziel" info="Wie viele Mails pro Tag geprüft werden sollen — nur Anzeige im Prüftisch.">
              <Input type="number" min={1} value={form.dailyTarget} onChange={(e) => patch({ dailyTarget: e.target.value })} />
            </Field>
          </div>
        </section>

        </>
        )}

        {!isEinzel && !isRundmail && (
          <CampaignCheckSection
            campaignId={campaign?.id ?? null}
            audience={form.audience}
            config={sampleConfig}
            configKey={sampleKey}
            heroImage={form.heroImage}
            dirty={(savedSampleKey !== null && savedSampleKey !== sampleKey) || heroDirty}
            recipients={preview ? preview.preview.total : null}
            counting={previewLoading}
            heroMode={form.heroMode}
            dailyTarget={intOrNull(form.dailyTarget)}
            autoPreparePerDay={Math.round(Number(form.autoPreparePerDay) || 0)}
            startsAt={fromLocalInput(form.startsAt)}
            endsAt={fromLocalInput(form.endsAt)}
            options={options}
          />
        )}
      </div>
    </Sheet>
  );
}

/** Absender: the default sender or one of the identities from Einstellungen. */
function SenderSelect({
  value,
  onChange,
  options,
  saved,
  disabled,
}: {
  value: string;
  onChange: (id: string) => void;
  options: CampaignEditorOptions;
  saved: SenderOption | null;
  disabled?: boolean;
}) {
  const list = [...options.senders.identities];
  // A stored identity removed from Einstellungen stays selectable as it is.
  if (saved && !list.some((s) => s.id === saved.id)) list.push(saved);
  const chosen = list.find((s) => s.id === value) ?? null;
  return (
    <div className="flex flex-col gap-1">
      <Select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">Standard: {options.senders.defaultFrom ?? "nicht konfiguriert"}</option>
        {list.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} &lt;{s.address}&gt;
          </option>
        ))}
      </Select>
      <span className="text-2xs text-muted-foreground">
        {chosen
          ? chosen.replies === "mo"
            ? "Antworten landen in Mo (Eingang)."
            : `Antworten gehen an ${chosen.address}.`
          : "Antworten landen in Mo (Eingang)."}
      </span>
    </div>
  );
}
