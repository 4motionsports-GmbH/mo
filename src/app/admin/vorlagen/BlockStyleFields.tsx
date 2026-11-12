"use client";

// „Gestaltung“ — the optional design settings of a block (BlockEditor.tsx):
// its spacing and own background, the type of text blocks, the shape of
// buttons, lines and pictures … Every field empty = the block's standard
// (the field is then omitted from the document, mail-template-doc.mjs);
// numbers are typed through DraftInput, so nothing is normalised away while
// typing. Collapsed by default; its row says how many settings are made.

import * as React from "react";
import { TEXT_BULLETS, countdownLook, readableInk } from "@/lib/mail-template-doc.mjs";
import { EMAIL_BUTTON_SHAPES } from "@/lib/email-theme.mjs";
import { Checkbox, Disclosure, Field, SegmentedControl, Select } from "../ui";
import type { MailDoc } from "./BlockEditor";
import { AlignField, ColorField, FontSelect, NumberField, WEB_FONT_INFO } from "./editor-fields";
import { BLOCK_STYLE_FIELDS, styledFieldCount } from "@/lib/block-editor-core.mjs";

type Block = MailDoc["blocks"][number];
type MailStyle = MailDoc["style"];
type Patch = (p: Record<string, unknown>) => void;

interface StyleProps {
  block: Block;
  onPatch: Patch;
  disabled?: boolean;
  style: MailStyle;
}

const PAD_INFO =
  "0–120 px. Leer = der übliche Abstand des Bausteins (in einer Spalte entfällt er am oberen und unteren Rand der Spalte).";
const BACKGROUND_INFO = "Eine eigene Farbe hinter dem Baustein, über die ganze Breite der Mail bzw. der Spalte. Leer = die Farbe drumherum.";

/** px sizes and line heights the renderer uses when a text block has none of its own. */
const HEADING_PX: Record<string, number> = { s: 16, m: 20, l: 26, xl: 34 };
const TEXT_PX: Record<string, number> = { s: 12, m: 14, l: 16 };

const BULLET_LABELS: Record<string, string> = {
  "✓": "✓ Haken",
  "→": "→ Pfeil",
  "–": "– Strich",
  "★": "★ Stern",
  "1.": "1. 2. 3. (nummeriert)",
};
const SHAPE_LABELS: Record<string, string> = { pill: "Pille", rounded: "Abgerundet", square: "Eckig" };

/** Abstand oben / unten (+ Hintergrund) — the box every content block takes. */
function BoxFields({
  block,
  onPatch,
  disabled,
  style,
  background = true,
  backgroundInfo = BACKGROUND_INFO,
}: StyleProps & { background?: boolean; backgroundInfo?: string }) {
  const r = block as Record<string, unknown>;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <NumberField
        label="Abstand oben (px)"
        info={PAD_INFO}
        value={r.padTop as number | undefined}
        min={0}
        max={120}
        placeholder="Standard"
        onCommit={(padTop) => onPatch({ padTop })}
        disabled={disabled}
      />
      <NumberField
        label="Abstand unten (px)"
        info={PAD_INFO}
        value={r.padBottom as number | undefined}
        min={0}
        max={120}
        placeholder="Standard"
        onCommit={(padBottom) => onPatch({ padBottom })}
        disabled={disabled}
      />
      {background && (
        <ColorField
          label="Hintergrund"
          info={backgroundInfo}
          value={(r.background as string | null | undefined) ?? null}
          fallback={style.cardBackground}
          onChange={(v) => onPatch({ background: v })}
          disabled={disabled}
        />
      )}
    </div>
  );
}

/** Size, weight, font, spacing and case of a text block (heading, text, greeting). */
function TextStyleFields({
  block,
  onPatch,
  disabled,
  sizeDefault,
  lineDefault,
  fontEmptyLabel,
}: StyleProps & { sizeDefault: number; lineDefault: number; fontEmptyLabel: string }) {
  const r = block as Record<string, unknown>;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <NumberField
        label="Schriftgröße (px)"
        info="10–72 px. Leer = die gewählte Größe."
        value={r.fontSize as number | undefined}
        min={10}
        max={72}
        placeholder={`Standard (${sizeDefault})`}
        onCommit={(fontSize) => onPatch({ fontSize })}
        disabled={disabled}
      />
      <Field label="Gewicht">
        <SegmentedControl
          label="Gewicht"
          size="sm"
          value={(r.weight as string | undefined) ?? "default"}
          onChange={(v) => onPatch({ weight: v === "default" ? null : v })}
          options={[
            { value: "default", label: "Standard" },
            { value: "normal", label: "Normal" },
            { value: "bold", label: "Fett" },
          ]}
          disabled={disabled}
        />
      </Field>
      <NumberField
        label="Zeilenhöhe (%)"
        info="100–250 % der Schriftgröße."
        value={r.lineHeight as number | undefined}
        min={100}
        max={250}
        placeholder={`Standard (${lineDefault})`}
        onCommit={(lineHeight) => onPatch({ lineHeight })}
        disabled={disabled}
      />
      <NumberField
        label="Buchstabenabstand (px)"
        info="-2 bis 20 px — z. B. 1–2 px für eine Überschrift in Großbuchstaben."
        value={r.letterSpacing as number | undefined}
        min={-2}
        max={20}
        placeholder="0"
        onCommit={(letterSpacing) => onPatch({ letterSpacing })}
        disabled={disabled}
      />
      <Field label="Schrift" info={WEB_FONT_INFO}>
        <FontSelect value={(r.font as string | undefined) ?? null} emptyLabel={fontEmptyLabel} onChange={(font) => onPatch({ font })} disabled={disabled} />
      </Field>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 sm:pt-6">
        <Field label="Kursiv" inline className="w-fit">
          <Checkbox checked={r.italic === true} onChange={(e) => onPatch({ italic: e.target.checked })} disabled={disabled} />
        </Field>
        <Field label="Großbuchstaben" inline className="w-fit" info="Per CSS — geschrieben (und vorgelesen) wird der Text, wie er eingegeben ist.">
          <Checkbox checked={r.uppercase === true} onChange={(e) => onPatch({ uppercase: e.target.checked })} disabled={disabled} />
        </Field>
      </div>
    </div>
  );
}

/** The fields of „Gestaltung“ for one block type. */
function StyleFieldsFor(props: StyleProps) {
  const { block, onPatch, disabled, style } = props;
  const r = block as Record<string, unknown>;
  const color = (key: string) => (r[key] as string | null | undefined) ?? null;
  switch (block.type) {
    case "logo":
    case "product":
    case "social":
    case "html":
      return <BoxFields {...props} />;
    case "heading":
      return (
        <>
          <TextStyleFields
            {...props}
            sizeDefault={HEADING_PX[String(r.size)] ?? HEADING_PX.l}
            lineDefault={125}
            fontEmptyLabel="Wie die Überschriften"
          />
          <BoxFields {...props} background={false} />
        </>
      );
    case "text":
      return (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Aufzählungszeichen" info="Für Zeilen, die mit „- “ beginnen.">
              <Select value={(r.bullet as string | undefined) ?? ""} onChange={(e) => onPatch({ bullet: e.target.value || null })} disabled={disabled}>
                <option value="">Standard (•)</option>
                {TEXT_BULLETS.map((b) => (
                  <option key={b} value={b}>
                    {BULLET_LABELS[b] ?? b}
                  </option>
                ))}
              </Select>
            </Field>
            <ColorField
              label="Akzentbalken"
              info="Ein farbiger Balken links neben dem Text — für ein Zitat oder einen Hinweis. Leer = kein Balken."
              placeholder="Kein Balken"
              value={color("accentBar")}
              fallback={style.accentColor}
              none
              onChange={(accentBar) => onPatch({ accentBar })}
              disabled={disabled}
            />
          </div>
          <TextStyleFields {...props} sizeDefault={TEXT_PX[String(r.size)] ?? TEXT_PX.m} lineDefault={150} fontEmptyLabel="Wie die Mail" />
          <BoxFields {...props} background={false} />
        </>
      );
    case "greeting":
      return (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <ColorField
              label="Schriftfarbe"
              value={color("color")}
              fallback={style.textColor}
              onChange={(c) => onPatch({ color: c })}
              disabled={disabled}
            />
          </div>
          <TextStyleFields {...props} sizeDefault={TEXT_PX.m} lineDefault={150} fontEmptyLabel="Wie die Mail" />
          <BoxFields {...props} />
        </>
      );
    case "image":
      return (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <AlignField
              value={(r.align as string | undefined) ?? "center"}
              onChange={(align) => onPatch({ align })}
              info="Für Bilder, die schmaler sind als die Mail bzw. die Spalte."
              disabled={disabled}
            />
            <NumberField
              label="Ecken (px)"
              info="Abgerundete Ecken, 0–40 px. Outlook für Windows zeigt sie eckig."
              value={r.radius as number | undefined}
              min={0}
              max={40}
              placeholder="0"
              onCommit={(radius) => onPatch({ radius })}
              disabled={disabled}
            />
          </div>
          <BoxFields {...props} />
        </>
      );
    case "button":
      return (
        <>
          <div className="flex flex-wrap gap-x-5 gap-y-3">
            <Field label="Größe">
              <SegmentedControl
                label="Größe"
                size="sm"
                value={(r.size as string | undefined) ?? "m"}
                onChange={(size) => onPatch({ size })}
                options={[
                  { value: "s", label: "S" },
                  { value: "m", label: "M" },
                  { value: "l", label: "L" },
                ]}
                disabled={disabled}
              />
            </Field>
            <Field label="Form" info="Standard = die Button-Form unter „Farben & Schrift“.">
              <SegmentedControl
                label="Form"
                size="sm"
                value={(r.shape as string | undefined) ?? "default"}
                onChange={(v) => onPatch({ shape: v === "default" ? null : v })}
                options={[{ value: "default", label: "Standard" }, ...EMAIL_BUTTON_SHAPES.map((s) => ({ value: s as string, label: SHAPE_LABELS[s] ?? s }))]}
                disabled={disabled}
              />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nur Rahmen" inline className="w-fit self-center sm:pt-5" info="Kein gefüllter Button: Rahmen und Schrift in der Buttonfarbe.">
              <Checkbox checked={r.outline === true} onChange={(e) => onPatch({ outline: e.target.checked })} disabled={disabled} />
            </Field>
            <ColorField
              label="Rahmenfarbe"
              info="Ein Rahmen um den Button. Leer = ohne Rahmen (bei „Nur Rahmen“ in der Buttonfarbe)."
              placeholder={r.outline === true ? "Buttonfarbe" : "Kein Rahmen"}
              value={color("borderColor")}
              fallback={(r.color as string | null) ?? style.accentColor}
              none={r.outline !== true}
              onChange={(borderColor) => onPatch({ borderColor })}
              disabled={disabled}
            />
          </div>
          <BoxFields {...props} />
        </>
      );
    case "coupon": {
      // what the coupon's texts stand on — the pickers show the automatic colours
      const ground = color("cardColor") ?? color("background") ?? style.cardBackground;
      return (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <ColorField
              label="Rahmenfarbe"
              info="Rahmen und Überschrift der Gutschein-Karte. Leer = die Akzentfarbe."
              placeholder="Akzentfarbe"
              value={color("accent")}
              fallback={style.accentColor}
              onChange={(accent) => onPatch({ accent })}
              disabled={disabled}
            />
            <ColorField
              label="Kartenfarbe"
              info="Die Fläche der Gutschein-Karte selbst. Leer = ohne Füllung — der Hintergrund drumherum."
              placeholder="Ohne Füllung"
              value={color("cardColor")}
              fallback={ground}
              none
              onChange={(cardColor) => onPatch({ cardColor })}
              disabled={disabled}
            />
            <NumberField
              label="Ecken (px)"
              info="Abgerundete Ecken der Karte, 0–24 px. Outlook für Windows zeigt sie eckig."
              value={r.radius as number | undefined}
              min={0}
              max={24}
              placeholder="8"
              onCommit={(radius) => onPatch({ radius })}
              disabled={disabled}
            />
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-3">
            <Field label="Rahmen">
              <SegmentedControl
                label="Rahmen"
                size="sm"
                value={(r.borderStyle as string | undefined) ?? "dashed"}
                onChange={(v) => onPatch({ borderStyle: v === "dashed" ? null : v })}
                options={[
                  { value: "dashed", label: "Gestrichelt" },
                  { value: "solid", label: "Durchgezogen" },
                  { value: "none", label: "Ohne" },
                ]}
                disabled={disabled}
              />
            </Field>
            <Field
              label="Einlösen als"
              info="Link = „Code einlösen →“ als Textlink. Button = ein gefüllter Button im Button-Look der Mail (Akzentfarbe, Button-Schriftfarbe und Button-Form unter „Farben & Schrift“)."
            >
              <SegmentedControl
                label="Einlösen als"
                size="sm"
                value={(r.cta as string | undefined) ?? "link"}
                onChange={(v) => onPatch({ cta: v === "link" ? null : v })}
                options={[
                  { value: "link", label: "Link" },
                  { value: "button", label: "Button" },
                ]}
                disabled={disabled}
              />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <ColorField
              label="Schriftfarbe"
              info="„Dein Code“, Überschrift und Bedingungen. Leer = die Textfarbe der Mail, auf der Karte gut lesbar."
              placeholder="Automatisch"
              value={color("textColor")}
              fallback={readableInk(style.textColor, ground)}
              onChange={(textColor) => onPatch({ textColor })}
              disabled={disabled}
            />
            <ColorField
              label="Farbe des Codes"
              info="Leer = die Überschriftenfarbe der Mail, auf der Karte gut lesbar."
              placeholder="Automatisch"
              value={color("codeColor")}
              fallback={readableInk(style.headingColor, ground, 3)}
              onChange={(codeColor) => onPatch({ codeColor })}
              disabled={disabled}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Schrift des Codes" info={WEB_FONT_INFO}>
              <FontSelect
                value={(r.codeFont as string | undefined) ?? null}
                emptyLabel="Wie die Überschriften"
                onChange={(codeFont) => onPatch({ codeFont })}
                disabled={disabled}
              />
            </Field>
          </div>
          <BoxFields {...props} />
        </>
      );
    }
    case "countdown": {
      // the automatic look (the pickers show it while a field is empty)
      const look = countdownLook(block, style);
      return (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <ColorField
              label="Kacheln"
              info="Die Kacheln hinter den Zahlen. Leer = automatisch: ein Ton heller (auf dunklem Hintergrund) bzw. etwas dunkler (auf hellem Hintergrund) als der Hintergrund."
              placeholder="Automatisch"
              value={color("tileColor")}
              fallback={look.tile}
              onChange={(tileColor) => onPatch({ tileColor })}
              disabled={disabled}
            />
            <ColorField
              label="Ziffern"
              info="Leer = die Akzentfarbe, wenn sie auf den Kacheln gut lesbar ist, sonst die Überschriftenfarbe."
              placeholder="Automatisch"
              value={color("digitColor")}
              fallback={look.digit}
              onChange={(digitColor) => onPatch({ digitColor })}
              disabled={disabled}
            />
            <ColorField
              label="Beschriftung"
              info="Tage, Stunden, Minuten, die Zeile im Bild und die Zeile mit dem genauen Ende darunter. Leer = eine gedämpfte, gut lesbare Schriftfarbe."
              placeholder="Automatisch"
              value={color("labelColor")}
              fallback={look.label}
              onChange={(labelColor) => onPatch({ labelColor })}
              disabled={disabled}
            />
          </div>
          <BoxFields
            {...props}
            backgroundInfo="Eine eigene Farbe hinter dem Countdown — zugleich der Grund des Countdown-Bilds, es geht nahtlos darin auf. Leer = die Kartenfarbe der Mail."
          />
        </>
      );
    }
    case "products":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <ColorField
            label="Kartenfarbe"
            info="Eine Karte hinter jedem Produkt. Leer = ohne Karte, direkt auf der Kartenfarbe der Mail."
            placeholder="Ohne Karte"
            value={color("cardColor")}
            fallback={style.cardBackground}
            none
            onChange={(cardColor) => onPatch({ cardColor })}
            disabled={disabled}
          />
          <ColorField
            label="Schriftfarbe"
            info="Name, Preis und Beschreibung. Leer = die Überschriften- und Textfarbe der Mail, gut lesbar."
            placeholder="Wie die Mail"
            value={color("textColor")}
            fallback={readableInk(style.textColor, color("cardColor") ?? style.cardBackground)}
            onChange={(textColor) => onPatch({ textColor })}
            disabled={disabled}
          />
        </div>
      );
    case "menu":
      return (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField
              label="Buchstabenabstand (px)"
              info="-2 bis 20 px — z. B. 1–2 px bei Großbuchstaben."
              value={r.letterSpacing as number | undefined}
              min={-2}
              max={20}
              placeholder="0"
              onCommit={(letterSpacing) => onPatch({ letterSpacing })}
              disabled={disabled}
            />
            <Field label="Schrift" info={WEB_FONT_INFO}>
              <FontSelect value={(r.font as string | undefined) ?? null} emptyLabel="Wie die Mail" onChange={(font) => onPatch({ font })} disabled={disabled} />
            </Field>
          </div>
          <BoxFields {...props} />
        </>
      );
    case "divider":
      return (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField
              label="Stärke (px)"
              info="1–8 px."
              value={r.thickness as number | undefined}
              min={1}
              max={8}
              placeholder="1"
              onCommit={(thickness) => onPatch({ thickness })}
              disabled={disabled}
            />
            <NumberField
              label="Länge (%)"
              info="10–100 % der Breite."
              value={r.widthPct as number | undefined}
              min={10}
              max={100}
              placeholder="100"
              onCommit={(widthPct) => onPatch({ widthPct })}
              disabled={disabled}
            />
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-3">
            <Field label="Linie">
              <SegmentedControl
                label="Linie"
                size="sm"
                value={(r.lineStyle as string | undefined) ?? "solid"}
                onChange={(lineStyle) => onPatch({ lineStyle })}
                options={[
                  { value: "solid", label: "Durchgezogen" },
                  { value: "dashed", label: "Gestrichelt" },
                  { value: "dotted", label: "Gepunktet" },
                ]}
                disabled={disabled}
              />
            </Field>
            <AlignField
              value={(r.align as string | undefined) ?? "center"}
              onChange={(align) => onPatch({ align })}
              info="Für eine Linie, die kürzer ist als 100 %."
              disabled={disabled}
            />
          </div>
          <BoxFields {...props} />
        </>
      );
    case "spacer":
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <ColorField
            label="Hintergrund"
            info={BACKGROUND_INFO}
            value={color("background")}
            fallback={style.cardBackground}
            onChange={(background) => onPatch({ background })}
            disabled={disabled}
          />
        </div>
      );
    case "footer":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <ColorField
            label="Hintergrund"
            info="Leer = hellgrau. Impressum und Abmelde-Link müssen gut lesbar bleiben — zu einem dunklen Hintergrund eine helle Schrift wählen."
            placeholder="Hellgrau"
            value={color("background")}
            fallback="#f9f9f9"
            onChange={(background) => onPatch({ background })}
            disabled={disabled}
          />
          <ColorField
            label="Schriftfarbe"
            info="Leer = schwarz. Der Pflichttext muss sich deutlich vom Hintergrund abheben — bei zu wenig Kontrast erscheint ein Hinweis."
            placeholder="Schwarz"
            value={color("textColor")}
            fallback="#000000"
            onChange={(textColor) => onPatch({ textColor })}
            disabled={disabled}
          />
        </div>
      );
    default:
      return null;
  }
}

/** The „Gestaltung“ section of a block's settings, or nothing for a block without design settings. */
export function BlockStyleFields(props: StyleProps) {
  if (!BLOCK_STYLE_FIELDS[props.block.type]) return null;
  const count = styledFieldCount(props.block);
  return (
    <Disclosure title="Gestaltung" framed={false} meta={count > 0 ? `${count} angepasst` : "Standard"} contentClassName="pt-1">
      <div className="flex flex-col gap-3">
        <StyleFieldsFor {...props} />
      </div>
    </Disclosure>
  );
}
