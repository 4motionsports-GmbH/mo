"use client";

// The campaign editor (Neue Kampagne / Bearbeiten) — one sheet, six sections:
// Grundlagen, Briefing, Zielgruppe (builder + „beschreiben“ via KI + live
// count), Angebot, Gestaltung, Automatik. Everything is validated again on the
// server (campaign-def.validateCampaignInput); the audience spec is normalised
// there (audience-spec.mjs). The live count always means „with consent“ — the
// e-mail channel never reaches anyone without it. docs/CAMPAIGNS.md §2.2.

import * as React from "react";
import { Sparkles, Users } from "lucide-react";
import { num } from "@/lib/admin-format.mjs";
import { HERO_MODE_LABELS } from "@/lib/campaign-def.mjs";
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
  toast,
} from "../ui";
import { adminFetch, errorMessage } from "../lib/admin-fetch";
import type { AudienceSpecProps, CampaignCardProps, CampaignEditorOptions } from "./types";

type Kind = "laufend" | "aktion";

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
  discountScope: "all" | "recommendations" | "set";
  discountValidUntil: string;
  designKey: string;
  heroMode: "none" | "default" | "ai_ab" | "ai_all";
  textMode: "" | "detailed" | "compact" | "minimal";
  moPromo: boolean;
  ctaKind: "mo_chat" | "shop";
  ctaUrl: string;
  autoPreparePerDay: string;
  dailyTarget: string;
}

interface Preview {
  description: string;
  preview: {
    total: number;
    withMo: number;
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

/** ISO → value of a <input type="datetime-local"> in the browser's zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null);
const intOrNull = (v: string): number | null => (v.trim() === "" ? null : Math.round(Number(v)));

function initialState(c: CampaignCardProps | null): FormState {
  return {
    name: c?.name ?? "",
    kind: c?.kind === "laufend" ? "laufend" : "aktion",
    startsAt: toLocalInput(c?.startsAt ?? null),
    endsAt: toLocalInput(c?.endsAt ?? null),
    priority: String(c?.priority ?? 50),
    brief: c?.brief ?? "",
    audience: c?.audience ?? { v: 1 },
    audienceMode: c?.audienceMode ?? "fest",
    reentryDays: c?.reentryDays != null ? String(c.reentryDays) : "",
    discountPercent: String(c?.discountPercent ?? 0),
    discountScope: c?.discountScope ?? "all",
    discountValidUntil: toLocalInput(c?.discountValidUntil ?? null),
    designKey: c?.designKey ?? "",
    heroMode: c?.heroMode ?? "default",
    textMode: c?.textMode ?? "",
    moPromo: c?.moPromo ?? true,
    ctaKind: c?.ctaKind ?? "mo_chat",
    ctaUrl: c?.ctaUrl ?? "",
    autoPreparePerDay: String(c?.autoPreparePerDay ?? 0),
    dailyTarget: c?.dailyTarget != null ? String(c.dailyTarget) : "",
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
  onClose,
  onSaved,
}: {
  open: boolean;
  campaign: CampaignCardProps | null;
  campaigns: CampaignCardProps[];
  options: CampaignEditorOptions;
  onClose: () => void;
  onSaved: (id: number) => void;
}) {
  const [form, setForm] = React.useState<FormState>(() => initialState(campaign));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [describe, setDescribe] = React.useState("");
  const [assisting, setAssisting] = React.useState<null | "audience" | "brief">(null);
  const [aiNote, setAiNote] = React.useState<string | null>(null);
  const isEinzel = campaign?.kind === "einzel";

  React.useEffect(() => {
    if (open) {
      setForm(initialState(campaign));
      setError(null);
      setAiNote(null);
      setDescribe("");
    }
  }, [open, campaign]);

  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));
  const patchAudience = (p: Partial<AudienceSpecProps>) =>
    setForm((f) => {
      const next: AudienceSpecProps = { ...f.audience, ...p };
      for (const [k, v] of Object.entries(next)) {
        if (v === undefined || (Array.isArray(v) && v.length === 0)) delete (next as Record<string, unknown>)[k];
      }
      return { ...f, audience: next };
    });

  // Live count, debounced; only while the sheet is open.
  const audienceKey = JSON.stringify(form.audience);
  React.useEffect(() => {
    if (!open || isEinzel) return;
    const controller = new AbortController();
    setPreviewLoading(true);
    const handle = setTimeout(() => {
      adminFetch<Preview>("/api/admin/campaigns/audience-preview", {
        body: { audience: JSON.parse(audienceKey) },
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
  }, [audienceKey, open, isEinzel]);

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

  const save = async () => {
    setSaving(true);
    setError(null);
    const payload: Record<string, unknown> = {
      name: form.name,
      brief: form.brief,
      priority: Math.round(Number(form.priority) || 0),
      discountPercent: Math.round(Number(form.discountPercent) || 0),
      discountScope: form.discountScope,
      designKey: form.designKey || null,
      heroMode: form.heroMode,
      textMode: form.textMode || null,
      moPromo: form.moPromo,
      ctaKind: form.ctaKind,
      ctaUrl: form.ctaUrl,
      autoPreparePerDay: Math.round(Number(form.autoPreparePerDay) || 0),
      dailyTarget: intOrNull(form.dailyTarget),
    };
    if (!isEinzel) {
      Object.assign(payload, {
        audience: form.audience,
        audienceMode: form.audienceMode,
        startsAt: fromLocalInput(form.startsAt),
        endsAt: fromLocalInput(form.endsAt),
        discountValidUntil: form.kind === "aktion" ? fromLocalInput(form.discountValidUntil) : null,
        reentryDays: form.kind === "laufend" ? intOrNull(form.reentryDays) : null,
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

  const a = form.audience;
  const otherCampaigns = campaigns.filter((c) => c.id !== campaign?.id && c.kind !== "einzel");

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => (!o ? onClose() : undefined)}
      size="xl"
      title={campaign ? `${campaign.name} bearbeiten` : "Neue Kampagne"}
      actions={
        <Button size="sm" onClick={() => void save()} loading={saving}>
          Speichern
        </Button>
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
                info="Laufend: läuft dauerhaft und nimmt Kund:innen nach einer Wartezeit erneut auf (z. B. Lebenszyklus). Aktion: ein Anlass mit Zeitraum (z. B. Black Friday)."
              >
                <SegmentedControl
                  label="Art"
                  value={form.kind}
                  onChange={(kind) =>
                    patch({
                      kind,
                      audienceMode: kind === "laufend" ? "dynamisch" : "fest",
                      heroMode: kind === "laufend" ? "ai_ab" : "default",
                      reentryDays: kind === "laufend" ? "180" : "",
                    })
                  }
                  options={[
                    { value: "aktion", label: "Aktion" },
                    { value: "laufend", label: "Laufend" },
                  ]}
                />
              </Field>
            )}
          </div>
          {!isEinzel && (
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

        {/* Zielgruppe */}
        {!isEinzel && (
          <section className="flex flex-col gap-3">
            <SectionTitle info="Wer die Kampagne bekommen soll. Es kommen immer nur Kund:innen mit Einwilligung in E-Mail-Werbung und ohne Sperre (Bounce, Beschwerde, Löschung) in Frage — die Filter grenzen weiter ein.">
              Zielgruppe
            </SectionTitle>
            <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3 sm:flex-row sm:items-end">
              <Field label="Beschreiben" className="flex-1" info="In eigenen Worten, z. B. „Großgeräte-Käufer der letzten zwei Jahre, die noch nie mit Mo gesprochen haben“. Die KI setzt die Filter — prüfen und anpassen.">
                <Input value={describe} onChange={(e) => setDescribe(e.target.value)} placeholder="Wer soll die Mail bekommen?" />
              </Field>
              <Button size="sm" variant="outline" onClick={() => void assistAudience()} loading={assisting === "audience"} disabled={describe.trim().length < 5}>
                <Sparkles /> Filter setzen
              </Button>
            </div>
            {aiNote && <p className="text-xs text-muted-foreground">KI: {aiNote}</p>}

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <div className="flex flex-col gap-3">
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
              </div>

              <aside className="flex h-fit flex-col gap-2 rounded-md border border-border bg-card p-3 lg:sticky lg:top-0" aria-live="polite">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Users className="size-3.5" aria-hidden /> Passende Kund:innen mit Einwilligung
                  {previewLoading && <Spinner className="ml-auto size-3.5" />}
                </div>
                <div className="text-2xl font-semibold tabular-nums">{preview ? num(preview.preview.total) : "—"}</div>
                {preview && (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {num(preview.preview.withMo)} mit Mo-Gespräch · DE {num(preview.preview.byLanguage.de)} · EN{" "}
                      {num(preview.preview.byLanguage.en)}
                    </p>
                    <p className="text-xs">{preview.description}</p>
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
            <Field label="Gilt für">
              <SegmentedControl
                label="Rabatt gilt für"
                value={form.discountScope}
                onChange={(discountScope) => patch({ discountScope })}
                options={[
                  { value: "all", label: "Alles" },
                  { value: "recommendations", label: "Empfehlungen" },
                  { value: "set", label: "Set" },
                ]}
              />
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
            <Field label="Titelbild" info="KI-Titelbilder entstehen beim Vorbereiten (Kosten pro Bild). A/B: nur jede zweite Mail — für den Vergleich in den KPIs.">
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

        {/* Automatik */}
        <section className="flex flex-col gap-3">
          <SectionTitle info={`Nächtliche Vorbereitung: Entwürfe pro Tag aus dem gemeinsamen Kontingent (CAMPAIGN_AUTO_PREPARE_COUNT = ${num(options.autoPrepareBudget)}). Gesendet wird nie automatisch.`}>
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
      </div>
    </Sheet>
  );
}
