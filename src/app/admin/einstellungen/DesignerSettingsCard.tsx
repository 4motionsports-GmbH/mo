"use client";

// Einstellungen → „KI-Gestalter“ — how the AI designer of Vorlagen and
// Rundmail works for the whole team (lib/mail-template-designer-settings.mjs;
// one admin_settings row, key "mail_designer", migration 0078):
//   · Qualität — Schnell / Gründlich / Maximal, a model and an effort each. A
//     stored pair that is no level shows as no selected segment with
//     „Eigene Einstellung: …“; such a pair is chosen in the rarely needed
//     „Modell und Denktiefe selbst wählen“ (open when the stored pair is one);
//   · Gestaltungsfreiheit and „Mo-Funktionen von sich aus einbauen“;
//   · Hausstil — part of every run's system prompt (≤ 2,000 characters,
//     counted as the server stores it).
// The KI-Gestalter panel can change quality, freedom and the capabilities
// switch for one conversation and links here (`?tab=einstellungen#ki-gestalter`,
// in a new tab); the house style always applies. „Standard wiederherstellen“
// resets the choices, not the house style — „Speichern“ stores everything
// (POST /api/admin/settings/designer). Without a database the controls are
// disabled and the defaults apply.

import * as React from "react";
import { RotateCcw, Save, Sparkles } from "lucide-react";
import { num } from "@/lib/admin-format.mjs";
import {
  DESIGNER_EFFORTS,
  DESIGNER_FREEDOM,
  DESIGNER_MODELS,
  DESIGNER_QUALITY,
  HOUSE_STYLE_MAX_CHARS,
  designerEffortLabel,
  designerModelLabel,
  designerQualityOf,
  designerSettingsLabel,
  validateDesignerSettingsInput,
  type DesignerEffort,
  type DesignerFreedom,
  type DesignerSettings,
} from "@/lib/mail-template-designer-settings.mjs";
import {
  DESIGNER_SETTINGS_ANCHOR,
  DESIGNER_TEXTS,
  designerChoiceWithQuality,
  designerSettingsDirty,
  designerSettingsWithDefaultChoices,
  houseStyleLength,
  isDefaultDesignerChoice,
} from "@/lib/mail-designer-choice.mjs";
import {
  Button,
  Callout,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Disclosure,
  Field,
  InfoTip,
  SegmentedControl,
  Select,
  Textarea,
  toast,
} from "../ui";
import { adminFetch } from "../lib/admin-fetch";
import { useAsyncAction } from "../lib/use-async-action";

const QUALITY_OPTIONS = DESIGNER_QUALITY.map((q) => ({ value: q.id, label: q.label }));
const FREEDOM_OPTIONS = DESIGNER_FREEDOM.map((f) => ({ value: f.id as DesignerFreedom, label: f.label }));

const paragraphs = (list: readonly string[]) => list.map((p) => <p key={p}>{p}</p>);

/** The label of a control group with its explanation (the radio groups name themselves). */
function ControlLabel({ title, info }: { title: string; info: readonly string[] }) {
  return (
    <div className="flex items-center gap-1.5 text-xs font-medium leading-none text-foreground">
      {title}
      <InfoTip label={`Was „${title}“ bedeutet`} panelClassName="max-w-md">
        {paragraphs(info)}
      </InfoTip>
    </div>
  );
}

export function DesignerSettingsCard({
  dbReady,
  designerSettings,
}: {
  dbReady: boolean;
  /** The stored settings (the defaults without a database, a row or migration 0078). */
  designerSettings: DesignerSettings;
}) {
  const [saved, setSaved] = React.useState<DesignerSettings>(designerSettings);
  const [form, setForm] = React.useState<DesignerSettings>(designerSettings);
  const quality = designerQualityOf(form);
  const houseChars = houseStyleLength(form.houseStyle);
  const houseTooLong = houseChars > HOUSE_STYLE_MAX_CHARS;
  const parsed = validateDesignerSettingsInput(form);
  const dirty = designerSettingsDirty(form, saved);

  const save = useAsyncAction(
    async () => {
      if (!parsed.ok) throw new Error(Object.values(parsed.errors)[0] ?? "Ungültige Eingabe.");
      const json = await adminFetch<{ ok?: boolean; settings?: DesignerSettings }>("/api/admin/settings/designer", {
        body: parsed.value,
      });
      return json.settings ?? parsed.value;
    },
    {
      errorToast: "Einstellungen nicht gespeichert",
      onSuccess: (next) => {
        setSaved(next);
        setForm(next);
        toast({ variant: "success", title: "Einstellungen gespeichert", description: designerSettingsLabel(next) });
      },
    }
  );

  // The KI-Gestalter links here (`#ki-gestalter`): bring the card into view
  // even when the browser looked for the anchor before the page was complete.
  React.useEffect(() => {
    if (window.location.hash !== `#${DESIGNER_SETTINGS_ANCHOR}`) return;
    document.getElementById(DESIGNER_SETTINGS_ANCHOR)?.scrollIntoView({ block: "start" });
  }, []);

  const disabled = !dbReady || save.pending;
  const change = (patch: Partial<DesignerSettings>) => setForm((f) => ({ ...f, ...patch }));
  const counter = `${num(houseChars)} / ${num(HOUSE_STYLE_MAX_CHARS)} Zeichen`;

  return (
    <Card id={DESIGNER_SETTINGS_ANCHOR} className="scroll-mt-20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4" aria-hidden /> KI-Gestalter
          <InfoTip label="Was hier eingestellt wird" panelClassName="max-w-md">
            {DESIGNER_TEXTS.card}
          </InfoTip>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!dbReady && (
          <Callout tone="warning" compact>
            Keine Datenbank konfiguriert (DATABASE_URL) — die Einstellung kann nicht gespeichert werden. Es gilt
            der Standard.
          </Callout>
        )}
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!disabled && dirty && parsed.ok) void save.run();
          }}
        >
          <div className="grid gap-x-8 gap-y-5 lg:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-2">
              <ControlLabel title="Qualität" info={DESIGNER_TEXTS.quality} />
              <SegmentedControl
                label="Qualität"
                value={quality ?? ""}
                onChange={(q) => change(designerChoiceWithQuality(form, q))}
                options={QUALITY_OPTIONS}
                disabled={disabled}
                className="self-start"
              />
              {quality === null && (
                <p className="text-xs text-muted-foreground">
                  Eigene Einstellung: {designerModelLabel(form.model)} · Denktiefe {designerEffortLabel(form.effort)}
                </p>
              )}
              <Disclosure title="Modell und Denktiefe selbst wählen" defaultOpen={quality === null} framed={false}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Modell"
                    info={DESIGNER_MODELS.map((m) => (
                      <p key={m.id}>
                        <span className="font-semibold">{m.label}:</span> {m.note}
                      </p>
                    ))}
                  >
                    <Select value={form.model} onChange={(e) => change({ model: e.target.value })} disabled={disabled}>
                      {DESIGNER_MODELS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Denktiefe" info={DESIGNER_TEXTS.effort}>
                    <Select
                      value={form.effort}
                      onChange={(e) => change({ effort: e.target.value as DesignerEffort })}
                      disabled={disabled}
                    >
                      {DESIGNER_EFFORTS.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              </Disclosure>
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <ControlLabel title="Gestaltungsfreiheit" info={DESIGNER_TEXTS.freedom} />
              <SegmentedControl
                label="Gestaltungsfreiheit"
                value={form.freedom}
                onChange={(freedom) => change({ freedom })}
                options={FREEDOM_OPTIONS}
                disabled={disabled}
                className="max-w-full flex-wrap self-start"
              />
              <div className="mt-3 flex items-center gap-1.5">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.proactive}
                    onChange={(e) => change({ proactive: e.target.checked })}
                    disabled={disabled}
                  />
                  Mo-Funktionen von sich aus einbauen
                </label>
                <InfoTip label="Was „Mo-Funktionen von sich aus einbauen“ bedeutet" panelClassName="max-w-sm">
                  {paragraphs(DESIGNER_TEXTS.proactive)}
                </InfoTip>
              </div>
            </div>
          </div>
          <Field
            label="Hausstil"
            info={DESIGNER_TEXTS.houseStyle}
            error={houseTooLong ? `Höchstens ${num(HOUSE_STYLE_MAX_CHARS)} Zeichen — bitte kürzen.` : undefined}
            hint={<span className={houseTooLong ? "text-destructive" : undefined}>{counter}</span>}
          >
            <Textarea
              rows={5}
              value={form.houseStyle}
              onChange={(e) => change({ houseStyle: e.target.value })}
              placeholder={DESIGNER_TEXTS.houseStylePlaceholder}
              disabled={disabled}
              className="resize-y"
            />
          </Field>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setForm((f) => designerSettingsWithDefaultChoices(f))}
              disabled={disabled || isDefaultDesignerChoice(form)}
            >
              <RotateCcw /> Standard wiederherstellen
            </Button>
            <Button type="submit" size="sm" loading={save.pending} disabled={!dbReady || !dirty || !parsed.ok}>
              <Save /> Speichern
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
