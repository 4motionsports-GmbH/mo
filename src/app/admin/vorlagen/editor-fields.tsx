"use client";

// The small fields of the block editor (BlockEditor.tsx and its parts):
// colour, text and number fields that keep what is typed while they have the
// focus, a picture address with upload, alignment and the font choice.

import * as React from "react";
import { ImageUp } from "lucide-react";
import { mailFontLabel } from "@/lib/mail-template-doc.mjs";
import { Button, Field, Input, SegmentedControl, Select, Textarea, toast } from "../ui";
import { cn } from "../ui/cn";
import { adminFetch, errorMessage } from "../lib/admin-fetch";
import { MAIL_FONT_GROUPS } from "@/lib/block-editor-core.mjs";

/**
 * A colour field: picker + hex text, applied on blur. With `allowEmpty`, an
 * empty field is null — the colour of the style / of what is around
 * (`placeholder` says which; `fallback` is what the picker shows meanwhile),
 * or with `none` no colour at all (a bar, a border): the picker is dimmed.
 */
export function ColorField({
  label,
  value,
  onChange,
  allowEmpty = true,
  placeholder,
  fallback,
  none = false,
  info,
  disabled,
  className,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  allowEmpty?: boolean;
  placeholder?: string;
  fallback?: string | null;
  none?: boolean;
  info?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const [text, setText] = React.useState(value ?? "");
  React.useEffect(() => setText(value ?? ""), [value]);
  return (
    <Field label={label} info={info} className={className}>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          aria-label={`${label} wählen`}
          value={value ?? fallback ?? "#000000"}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={cn(
            "h-8 w-9 shrink-0 cursor-pointer rounded border border-border bg-card p-0.5 disabled:cursor-not-allowed disabled:opacity-50",
            none && value == null && "opacity-35"
          )}
        />
        <Input
          aria-label={label}
          value={text}
          placeholder={allowEmpty ? placeholder ?? "Standard" : "#rrggbb"}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const v = text.trim().toLowerCase();
            if (!v && allowEmpty) onChange(null);
            else if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(v)) onChange(v.length === 4 ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : v);
            else setText(value ?? "");
          }}
          disabled={disabled}
          className="h-8 font-mono text-xs"
        />
      </div>
    </Field>
  );
}

/**
 * A one-line field of the block editor. Every keystroke goes straight into
 * the document (normalizeMailTemplateDoc: trimmed, links and numbers
 * validated), so the preview follows live — but while the field has the
 * focus it shows what was typed: otherwise a trailing space (the start of the
 * next word), a half-typed https link or a number on its way to its value
 * would be normalised away under the cursor. On blur it shows the stored value.
 */
export function DraftInput({
  value,
  onCommit,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onFocus" | "onBlur"> & {
  value: string;
  onCommit: (raw: string) => void;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);
  return (
    <Input
      {...props}
      value={draft ?? value}
      onFocus={() => setDraft(value)}
      onChange={(e) => {
        setDraft(e.target.value);
        onCommit(e.target.value);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

/**
 * DraftInput for several lines (the text block): the normaliser trims a
 * text, so without the draft a space or a new line typed at the end would
 * vanish under the cursor.
 */
export function DraftTextarea({
  value,
  onCommit,
  ...props
}: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "onFocus" | "onBlur"> & {
  value: string;
  onCommit: (raw: string) => void;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);
  return (
    <Textarea
      {...props}
      value={draft ?? value}
      onFocus={() => setDraft(value)}
      onChange={(e) => {
        setDraft(e.target.value);
        onCommit(e.target.value);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

/**
 * A number field (px, %): typed freely, stored as the normaliser clamps it.
 * The raw text goes to the document — an empty field is null (= Standard)
 * for an optional field and the default for a required one.
 */
export function NumberField({
  label,
  info,
  value,
  min,
  max,
  placeholder,
  onCommit,
  disabled,
  className,
}: {
  label: string;
  info?: React.ReactNode;
  value: number | null | undefined;
  min: number;
  max: number;
  placeholder?: string;
  onCommit: (raw: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Field label={label} info={info} className={className}>
      <DraftInput
        type="number"
        step={1}
        min={min}
        max={max}
        value={value == null ? "" : String(value)}
        placeholder={placeholder}
        onCommit={onCommit}
        disabled={disabled}
      />
    </Field>
  );
}

/** Upload a picture (raw body) → its public URL. */
export function useImageUpload(onUrl: (url: string) => void) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const pick = () => inputRef.current?.click();
  const input = (
    <input
      ref={inputRef}
      type="file"
      accept="image/jpeg,image/png,image/gif,image/webp"
      className="hidden"
      onChange={async (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        if (file.size > 4_000_000) {
          toast({ variant: "error", title: "Bild zu groß", description: "Höchstens 4 MB — bitte verkleinern." });
          return;
        }
        setBusy(true);
        try {
          const json = await adminFetch<{ url: string; warnings?: string[] }>("/api/admin/vorlagen/image", { rawBody: file });
          onUrl(json.url);
          toast({
            variant: json.warnings?.length ? "warning" : "success",
            title: "Bild hochgeladen",
            description: json.warnings?.join(" ") || undefined,
          });
        } catch (err) {
          toast({ variant: "error", title: "Upload fehlgeschlagen", description: errorMessage(err) });
        } finally {
          setBusy(false);
        }
      }}
    />
  );
  return { pick, busy, input };
}

/** A picture address (https) with „Hochladen“ next to it. */
export function ImageUrlField({
  label,
  info,
  value,
  onCommit,
  uploadConfigured,
  disabled,
  placeholder = "https://…",
  className,
}: {
  label: string;
  info?: React.ReactNode;
  value: string;
  onCommit: (url: string) => void;
  uploadConfigured: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const upload = useImageUpload(onCommit);
  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:items-end", className)}>
      <Field label={label} className="min-w-0 flex-1" info={info}>
        <DraftInput value={value} placeholder={placeholder} onCommit={onCommit} disabled={disabled} />
      </Field>
      {upload.input}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mb-px self-start sm:self-auto"
        onClick={upload.pick}
        loading={upload.busy}
        disabled={disabled || !uploadConfigured}
      >
        <ImageUp /> Hochladen
      </Button>
    </div>
  );
}

export const ALIGN_OPTIONS = [
  { value: "left", label: "Links" },
  { value: "center", label: "Mitte" },
  { value: "right", label: "Rechts" },
] as const;

/** Links / Mitte / Rechts (or a subset). */
export function AlignField({
  value,
  onChange,
  options = ALIGN_OPTIONS,
  label = "Ausrichtung",
  info,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options?: readonly { value: string; label: string }[];
  label?: string;
  info?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <Field label={label} info={info}>
      <SegmentedControl
        label={label}
        size="sm"
        value={value}
        onChange={onChange}
        options={options.map((o) => ({ value: o.value, label: o.label }))}
        disabled={disabled}
      />
    </Field>
  );
}

/** The fonts as a select, the theme fonts and the web fonts in their own groups. */
export function FontSelect({
  value,
  onChange,
  emptyLabel,
  disabled,
  id,
  "aria-describedby": describedBy,
}: {
  value: string | null;
  onChange: (key: string | null) => void;
  /** The option for „no font of its own“ (null); omitted = a font is required. */
  emptyLabel?: string;
  disabled?: boolean;
  id?: string;
  "aria-describedby"?: string;
}) {
  return (
    <Select id={id} aria-describedby={describedBy} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} disabled={disabled}>
      {emptyLabel && <option value="">{emptyLabel}</option>}
      {MAIL_FONT_GROUPS.map((g) => (
        <optgroup key={g.key} label={g.label}>
          {g.keys.map((k) => (
            <option key={k} value={k}>
              {mailFontLabel(k)}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}

/** The explanation of the web fonts — next to every font choice. */
export const WEB_FONT_INFO =
  "Web-Schriften (Oswald, Poppins, Playfair …) zeigen Apple Mail, das iPhone und Outlook für Mac. Gmail, Outlook für Windows und andere Programme zeigen stattdessen eine ähnliche Standardschrift — die Mail bleibt lesbar, sieht dort aber schlichter aus.";
