"use client";

// „Farben & Schrift“ — the style of the whole mail (mail-template-doc.mjs
// normalizeMailStyle): colours, fonts, the card and the buttons, the logo.
// Part of the block editor (BlockEditor.tsx); every change is normalised.

import * as React from "react";
import { EMAIL_BUTTON_SHAPES } from "@/lib/email-theme.mjs";
import { Disclosure, Field, SegmentedControl } from "../ui";
import type { MailDoc } from "./BlockEditor";
import { ColorField, FontSelect, ImageUrlField, NumberField, WEB_FONT_INFO } from "./editor-fields";

type MailStyle = MailDoc["style"];

const BUTTON_SHAPE_LABELS: Record<string, string> = { pill: "Pille", rounded: "Abgerundet", square: "Eckig" };

function GroupTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</p>;
}

export function DocStyleFields({
  style,
  onPatch,
  uploadConfigured,
  disabled,
}: {
  style: MailStyle;
  /** raw values — the editor normalises */
  onPatch: (p: Record<string, unknown>) => void;
  uploadConfigured: boolean;
  disabled?: boolean;
}) {
  const required = (key: string) => (v: string | null) => {
    if (v) onPatch({ [key]: v });
  };
  return (
    <Disclosure title="Farben & Schrift" meta={<span className="text-2xs text-muted-foreground">gilt für die ganze Mail</span>}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <GroupTitle>Farben</GroupTitle>
          <div className="grid gap-3 sm:grid-cols-3">
            <ColorField label="Akzentfarbe" value={style.accentColor} onChange={required("accentColor")} allowEmpty={false} disabled={disabled} />
            <ColorField label="Button-Schrift" value={style.buttonTextColor} onChange={required("buttonTextColor")} allowEmpty={false} disabled={disabled} />
            <ColorField
              label="Linkfarbe"
              info="Die Farbe der Links im Text. Leer = die Akzentfarbe."
              placeholder="Akzentfarbe"
              value={style.linkColor ?? null}
              fallback={style.accentColor}
              onChange={(linkColor) => onPatch({ linkColor })}
              disabled={disabled}
            />
            <ColorField label="Überschriften" value={style.headingColor} onChange={required("headingColor")} allowEmpty={false} disabled={disabled} />
            <ColorField label="Text" value={style.textColor} onChange={required("textColor")} allowEmpty={false} disabled={disabled} />
            <ColorField
              label="Kartenfarbe"
              info="Der Hintergrund der Mail selbst (600 px breit) und jedes Bausteins ohne eigene Farbe."
              value={style.cardBackground}
              onChange={required("cardBackground")}
              allowEmpty={false}
              disabled={disabled}
            />
            <ColorField
              label="Hintergrund außen"
              info="Die Fläche um die Mail herum (breite Bildschirme)."
              value={style.outerBackground}
              onChange={required("outerBackground")}
              allowEmpty={false}
              disabled={disabled}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <GroupTitle>Schrift</GroupTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Schrift" info={WEB_FONT_INFO}>
              <FontSelect value={style.fontFamily} onChange={(fontFamily) => fontFamily && onPatch({ fontFamily })} disabled={disabled} />
            </Field>
            <Field label="Überschriften-Schrift" info={<>Eine eigene Schrift für Überschriften und Produktnamen. „Wie Text“ = dieselbe Schrift wie der Text. {WEB_FONT_INFO}</>}>
              <FontSelect value={style.headingFont ?? null} emptyLabel="Wie Text" onChange={(headingFont) => onPatch({ headingFont })} disabled={disabled} />
            </Field>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <GroupTitle>Karte &amp; Buttons</GroupTitle>
          <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)]">
            <Field label="Button-Form">
              <SegmentedControl
                label="Button-Form"
                size="sm"
                value={style.buttonShape}
                onChange={(buttonShape) => onPatch({ buttonShape })}
                options={EMAIL_BUTTON_SHAPES.map((s) => ({ value: s, label: BUTTON_SHAPE_LABELS[s] ?? s }))}
                disabled={disabled}
              />
            </Field>
            <NumberField
              label="Seitenrand (px)"
              info="16–60 px Abstand der Inhalte zum Rand der Mail (Standard 60). Auf dem Handy sind es immer 15 px."
              value={style.contentPadding}
              min={16}
              max={60}
              onCommit={(contentPadding) => onPatch({ contentPadding })}
              disabled={disabled}
            />
            <NumberField
              label="Ecken der Karte (px)"
              info="0–24 px abgerundete Ecken der Mail. Outlook für Windows zeigt sie eckig."
              value={style.cardRadius}
              min={0}
              max={24}
              onCommit={(cardRadius) => onPatch({ cardRadius })}
              disabled={disabled}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <GroupTitle>Logo</GroupTitle>
          <ImageUrlField
            label="Eigenes Logo"
            info="Hochladen oder die https-Adresse eines Logos (PNG/JPG). Leer = das motion-sports-Logo. Es erscheint im Baustein „Logo“."
            value={style.logoUrl ?? ""}
            placeholder="Standard-Logo"
            onCommit={(v) => onPatch({ logoUrl: v || null })}
            uploadConfigured={uploadConfigured}
            disabled={disabled}
          />
        </div>
      </div>
    </Disclosure>
  );
}
