"use client";

// The settings of a section („Abschnitt mit Spalten“) and of its columns —
// the parts of an expanded section row in the block editor (BlockEditor.tsx
// renders the columns' block lists between them). The layout goes through
// setSectionColumns, a column's width through columnWidthsWith (the other
// columns give way), everything else is a patch.

import * as React from "react";
import { SECTION_LAYOUTS } from "@/lib/mail-template-tree.mjs";
import { Checkbox, Disclosure, Field, SegmentedControl, Select } from "../ui";
import type { MailDoc } from "./BlockEditor";
import { ColorField, ImageUrlField, NumberField } from "./editor-fields";
import { sectionLayoutFits, sectionLayoutPreset, sectionStyledCount } from "@/lib/block-editor-core.mjs";

type Block = MailDoc["blocks"][number];
type MailStyle = MailDoc["style"];
type Patch = (p: Record<string, unknown>) => void;

export interface SectionColumn {
  id: string;
  width: number;
  valign: string;
  background: string | null;
  padding: number;
  blocks: Block[];
}

/** The columns of a section block (normalised: 1–4, widths adding up to 100). */
export function sectionColumns(section: Block): SectionColumn[] {
  return ((section as Record<string, unknown>).columns as SectionColumn[] | undefined) ?? [];
}

/** Layout, background and „Gestaltung“ of a section. */
export function SectionSettings({
  section,
  onPatch,
  onLayout,
  uploadConfigured,
  disabled,
  style,
}: {
  section: Block;
  onPatch: Patch;
  /** a key of SECTION_LAYOUTS */
  onLayout: (key: string) => void;
  uploadConfigured: boolean;
  disabled?: boolean;
  style: MailStyle;
}) {
  const r = section as Record<string, unknown>;
  const widths = sectionColumns(section).map((c) => c.width);
  const preset = sectionLayoutPreset(widths);
  const styled = sectionStyledCount(section);
  const stack = r.stack !== false;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Layout"
          info="Wie viele Spalten nebeneinander stehen. Bei weniger Spalten rücken die Bausteine der wegfallenden Spalten in die letzte Spalte — es geht nichts verloren. Eigene Breiten: in den Einstellungen der Spalte."
        >
          <Select value={preset?.key ?? "custom"} onChange={(e) => onLayout(e.target.value)} disabled={disabled}>
            {!preset && (
              <option value="custom" disabled>
                Eigene Breiten ({widths.join(" + ")} %)
              </option>
            )}
            {SECTION_LAYOUTS.map((l) => (
              <option key={l.key} value={l.key} disabled={!sectionLayoutFits(section, l.widths.length)}>
                {l.label}
              </option>
            ))}
          </Select>
        </Field>
        <ColorField
          label="Hintergrund"
          info="Die Farbe des ganzen Abschnitts. Leer = die Kartenfarbe der Mail."
          placeholder="Kartenfarbe"
          value={(r.background as string | null) ?? null}
          fallback={style.cardBackground}
          onChange={(background) => onPatch({ background })}
          disabled={disabled}
        />
      </div>
      <ImageUrlField
        label="Hintergrundbild"
        info="Ein Bild hinter dem Abschnitt, der Inhalt steht darüber (auch in Outlook). Dazu eine passende Hintergrundfarbe setzen — sie erscheint, solange Bilder blockiert sind. JPG oder PNG."
        value={String(r.bgImage ?? "")}
        onCommit={(bgImage) => onPatch({ bgImage })}
        uploadConfigured={uploadConfigured}
        disabled={disabled}
      />
      {(Boolean(r.bgImage) || Number(r.minHeight) > 0) && (
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField
            label="Mindesthöhe (px)"
            info="0–800 px — damit das Hintergrundbild zu sehen ist, auch wenn wenig Inhalt darüber steht."
            value={r.minHeight as number}
            min={0}
            max={800}
            onCommit={(minHeight) => onPatch({ minHeight })}
            disabled={disabled}
          />
        </div>
      )}
      <Disclosure title="Gestaltung" framed={false} meta={styled > 0 ? `${styled} angepasst` : "Standard"} contentClassName="pt-1">
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <NumberField
              label="Abstand oben (px)"
              info="0–120 px innerhalb des Abschnitts (Standard 24)."
              value={r.padTop as number}
              min={0}
              max={120}
              onCommit={(padTop) => onPatch({ padTop })}
              disabled={disabled}
            />
            <NumberField
              label="Abstand unten (px)"
              info="0–120 px innerhalb des Abschnitts (Standard 24)."
              value={r.padBottom as number}
              min={0}
              max={120}
              onCommit={(padBottom) => onPatch({ padBottom })}
              disabled={disabled}
            />
            <NumberField
              label="Seitenabstand (px)"
              info="0–60 px links und rechts. Leer = wie die Mail (Seitenrand unter „Farben & Schrift“), 0 = randlos — z. B. für ein Bild bis an den Rand."
              value={r.padX as number | null}
              min={0}
              max={60}
              placeholder={`Wie die Mail (${style.contentPadding})`}
              onCommit={(padX) => onPatch({ padX })}
              disabled={disabled}
            />
            <NumberField
              label="Spaltenabstand (px)"
              info="0–48 px zwischen den Spalten (Standard 20)."
              value={r.gap as number}
              min={0}
              max={48}
              onCommit={(gap) => onPatch({ gap })}
              disabled={disabled}
            />
            <NumberField
              label="Ecken (px)"
              info="Abgerundete Ecken, 0–32 px. Outlook für Windows zeigt sie eckig."
              value={r.radius as number}
              min={0}
              max={32}
              onCommit={(radius) => onPatch({ radius })}
              disabled={disabled}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <ColorField
              label="Rahmenfarbe"
              info="Ein feiner Rahmen um den Abschnitt. Leer = ohne Rahmen."
              placeholder="Kein Rahmen"
              value={(r.borderColor as string | null) ?? null}
              none
              onChange={(borderColor) => onPatch({ borderColor })}
              disabled={disabled}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Field
              label="Auf dem Handy untereinander"
              inline
              className="w-fit"
              info="Auf schmalen Bildschirmen stehen die Spalten untereinander (Standard). Aus = immer nebeneinander — nur für kleine Inhalte wie Symbole oder Logo und Menü."
            >
              <Checkbox checked={stack} onChange={(e) => onPatch({ stack: e.target.checked })} disabled={disabled} />
            </Field>
            <Field
              label="Auf dem Handy letzte Spalte zuerst"
              inline
              className="w-fit"
              info="Untereinander kommt die letzte Spalte nach oben — z. B. Text links und Bild rechts am PC, auf dem Handy das Bild zuerst."
            >
              <Checkbox checked={r.reverse === true} onChange={(e) => onPatch({ reverse: e.target.checked })} disabled={disabled || !stack} />
            </Field>
          </div>
        </div>
      </Disclosure>
    </>
  );
}

/** The settings of one column (inside its „Spalte n · w %“ disclosure). */
export function ColumnSettings({
  column,
  count,
  onPatch,
  onWidth,
  sectionBackground,
  disabled,
}: {
  column: SectionColumn;
  /** columns of the section — one column is always 100 % wide */
  count: number;
  onPatch: Patch;
  onWidth: (raw: string) => void;
  /** what shows through a column without its own colour */
  sectionBackground: string;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <NumberField
        label="Breite (%)"
        info="5–95 % des Abschnitts. Die anderen Spalten passen sich an, zusammen bleiben es 100 %."
        value={column.width}
        min={5}
        max={95}
        onCommit={onWidth}
        disabled={disabled || count < 2}
      />
      <Field label="Vertikal" info="Wo der Inhalt steht, wenn die Spalten nebeneinander unterschiedlich hoch sind.">
        <SegmentedControl
          label="Vertikale Ausrichtung"
          size="sm"
          value={column.valign || "top"}
          onChange={(valign) => onPatch({ valign })}
          options={[
            { value: "top", label: "Oben" },
            { value: "middle", label: "Mitte" },
            { value: "bottom", label: "Unten" },
          ]}
          disabled={disabled}
        />
      </Field>
      <ColorField
        label="Hintergrund"
        info="Eine eigene Farbe der Spalte (z. B. eine Kachel). Leer = der Hintergrund des Abschnitts."
        value={column.background}
        fallback={sectionBackground}
        onChange={(background) => onPatch({ background })}
        disabled={disabled}
      />
      <NumberField
        label="Innenabstand (px)"
        info="0–48 px rund um den Inhalt der Spalte — mit eigenem Hintergrund meist 16–24 px."
        value={column.padding}
        min={0}
        max={48}
        onCommit={(padding) => onPatch({ padding })}
        disabled={disabled}
      />
    </div>
  );
}
