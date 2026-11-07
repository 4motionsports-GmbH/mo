"use client";

// The block editor of e-mail templates and Rundmails (docs/EMAIL_TEMPLATES.md):
// the list of blocks with their settings, the „Farben & Schrift“ of the whole
// mail, and „Baustein hinzufügen“. Controlled: the parent owns the document
// (mail-template-doc.mjs) and renders the live preview next to it. Every
// change goes through normalizeMailTemplateDoc, so the editor can never hold
// a document the server would refuse to render. Pure UI — saving, the AI and
// the preview belong to the parent screen.

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  ImageUp,
  Plus,
  Trash2,
} from "lucide-react";
import {
  MAIL_BLOCK_CATALOG,
  MAIL_BLOCK_TYPES,
  MAIL_TEMPLATE_LIMITS,
  normalizeMailBlock,
  normalizeMailTemplateDoc,
} from "@/lib/mail-template-doc.mjs";
import { EMAIL_BUTTON_SHAPES, EMAIL_FONT_CHOICES, EMAIL_FONT_KEYS } from "@/lib/email-theme.mjs";
import { ADMIN_DATE_TIME_SHORT, formatAdmin } from "@/lib/admin-datetime.mjs";
import {
  Button,
  CatalogProductPicker,
  Checkbox,
  Disclosure,
  Field,
  IconButton,
  InfoTip,
  Input,
  Menu,
  SegmentedControl,
  Select,
  Textarea,
  toast,
} from "../ui";
import { cn } from "../ui/cn";
import { adminFetch, errorMessage } from "../lib/admin-fetch";

export type MailDoc = ReturnType<typeof normalizeMailTemplateDoc>;
type Block = MailDoc["blocks"][number];
export type BlockUse = "bulk" | "personal" | "template";
export interface DocIssue {
  blockId: string | null;
  message: string;
}

const GROUP_LABELS: Record<string, string> = {
  inhalt: "Inhalt",
  angebot: "Angebot",
  mo: "Mo-Bausteine (persönliche Mails)",
  rahmen: "Rahmen",
};
const BUTTON_SHAPE_LABELS: Record<string, string> = { pill: "Pille", rounded: "Abgerundet", square: "Eckig" };

/** A one-line summary of a block for its collapsed row. */
function blockSummary(b: Block): string {
  const r = b as Record<string, unknown>;
  switch (b.type) {
    case "heading":
    case "text":
    case "greeting":
      return String(r.text ?? "").split("\n")[0] ?? "";
    case "image":
    case "hero":
      return String(r.alt || r.src || "") || "Kein Bild gewählt";
    case "button":
      return String(r.label ?? "");
    case "products":
      return `${(r.refs as string[]).length} Produkt(e)${r.title ? ` — ${String(r.title)}` : ""}`;
    case "coupon":
      return String(r.code || "Kein Code");
    case "countdown":
      return r.until ? formatAdmin(String(r.until), ADMIN_DATE_TIME_SHORT) : "Kein Ende gesetzt";
    case "html":
      return `${String(r.html ?? "").length} Zeichen HTML`;
    case "spacer":
      return `${String(r.height)} px`;
    default:
      return MAIL_BLOCK_CATALOG[b.type]?.description ?? "";
  }
}

/** A colour field: picker + hex text + „Standard“ (empty = the style's colour). */
function ColorField({
  label,
  value,
  onChange,
  allowEmpty = true,
  disabled,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  allowEmpty?: boolean;
  disabled?: boolean;
}) {
  const [text, setText] = React.useState(value ?? "");
  React.useEffect(() => setText(value ?? ""), [value]);
  return (
    <Field label={label}>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          aria-label={`${label} wählen`}
          value={value ?? "#000000"}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="h-8 w-9 shrink-0 cursor-pointer rounded border border-border bg-card p-0.5"
        />
        <Input
          value={text}
          placeholder={allowEmpty ? "Standard" : "#rrggbb"}
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

/** Upload a picture (raw body) → its public URL. */
function useImageUpload(onUrl: (url: string) => void) {
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

function ImageFields({
  block,
  patch,
  uploadConfigured,
  disabled,
  showWidth,
}: {
  block: Block;
  patch: (p: Record<string, unknown>) => void;
  uploadConfigured: boolean;
  disabled?: boolean;
  showWidth: boolean;
}) {
  const r = block as Record<string, unknown>;
  const upload = useImageUpload((url) => patch({ src: url }));
  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field label="Bild (https-Adresse)" className="flex-1" info="Hochladen oder die https-Adresse eines Bildes einfügen (z. B. aus Shopify → Inhalte → Dateien). JPG, PNG oder GIF; mindestens 1200 px breit für ein vollbreites Bild.">
          <Input value={String(r.src ?? "")} placeholder="https://…" onChange={(e) => patch({ src: e.target.value })} disabled={disabled} />
        </Field>
        {upload.input}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mb-px"
          onClick={upload.pick}
          loading={upload.busy}
          disabled={disabled || !uploadConfigured}
        >
          <ImageUp /> Hochladen
        </Button>
      </div>
      {String(r.src ?? "") && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={String(r.src)} alt="" className="max-h-28 w-auto max-w-full rounded border border-border object-contain" />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Alternativtext" info="Wird gezeigt, wenn Bilder blockiert sind, und vorgelesen — kurz beschreiben, was zu sehen ist.">
          <Input value={String(r.alt ?? "")} onChange={(e) => patch({ alt: e.target.value })} disabled={disabled} />
        </Field>
        <Field label="Link beim Klick" info="https://… oder leer.">
          <Input value={String(r.href ?? "")} placeholder="https://motionsports.de/…" onChange={(e) => patch({ href: e.target.value })} disabled={disabled} />
        </Field>
      </div>
      {showWidth && (
        <Field label="Breite">
          <SegmentedControl
            label="Breite"
            size="sm"
            value={String(r.width ?? "full") as "full" | "content"}
            onChange={(width) => patch({ width })}
            options={[
              { value: "full", label: "Ganze Breite" },
              { value: "content", label: "Mit Rand" },
            ]}
            disabled={disabled}
          />
        </Field>
      )}
    </>
  );
}

const ALIGN_OPTIONS = [
  { value: "left", label: "Links" },
  { value: "center", label: "Mitte" },
  { value: "right", label: "Rechts" },
] as const;

/** The settings of one block. */
function BlockSettings({
  block,
  onPatch,
  uploadConfigured,
  disabled,
}: {
  block: Block;
  onPatch: (p: Record<string, unknown>) => void;
  uploadConfigured: boolean;
  disabled?: boolean;
}) {
  const r = block as Record<string, unknown>;
  const align = (values: readonly { value: string; label: string }[] = ALIGN_OPTIONS) => (
    <Field label="Ausrichtung">
      <SegmentedControl
        label="Ausrichtung"
        size="sm"
        value={String(r.align ?? "left")}
        onChange={(v) => onPatch({ align: v })}
        options={values.map((o) => ({ value: o.value, label: o.label }))}
        disabled={disabled}
      />
    </Field>
  );
  switch (block.type) {
    case "logo":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {align(ALIGN_OPTIONS.filter((o) => o.value !== "right"))}
          <Field label="Breite (px)" info="60–300 px.">
            <Input type="number" min={60} max={300} value={String(r.width ?? 144)} onChange={(e) => onPatch({ width: Number(e.target.value) })} disabled={disabled} />
          </Field>
        </div>
      );
    case "heading":
      return (
        <>
          <Field label="Text" info="Platzhalter: {{vorname}} oder {{vorname|Ersatz}}.">
            <Input value={String(r.text ?? "")} maxLength={MAIL_TEMPLATE_LIMITS.headingChars} onChange={(e) => onPatch({ text: e.target.value })} disabled={disabled} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Größe">
              <SegmentedControl
                label="Größe"
                size="sm"
                value={String(r.size ?? "l")}
                onChange={(size) => onPatch({ size })}
                options={[
                  { value: "s", label: "S" },
                  { value: "m", label: "M" },
                  { value: "l", label: "L" },
                  { value: "xl", label: "XL" },
                ]}
                disabled={disabled}
              />
            </Field>
            {align()}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <ColorField label="Schriftfarbe" value={(r.color as string | null) ?? null} onChange={(color) => onPatch({ color })} disabled={disabled} />
            <ColorField label="Hintergrund (Band)" value={(r.background as string | null) ?? null} onChange={(background) => onPatch({ background })} disabled={disabled} />
          </div>
        </>
      );
    case "text":
      return (
        <>
          <Field
            label="Text"
            info="Leerzeile = neuer Absatz · Zeilen mit „- “ = Aufzählung · **fett** · Links als [Text](https://…) · Platzhalter {{vorname}}."
          >
            <Textarea rows={6} value={String(r.text ?? "")} maxLength={MAIL_TEMPLATE_LIMITS.textChars} onChange={(e) => onPatch({ text: e.target.value })} disabled={disabled} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Größe">
              <SegmentedControl
                label="Größe"
                size="sm"
                value={String(r.size ?? "m")}
                onChange={(size) => onPatch({ size })}
                options={[
                  { value: "s", label: "Klein" },
                  { value: "m", label: "Normal" },
                  { value: "l", label: "Groß" },
                ]}
                disabled={disabled}
              />
            </Field>
            {align()}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <ColorField label="Schriftfarbe" value={(r.color as string | null) ?? null} onChange={(color) => onPatch({ color })} disabled={disabled} />
            <ColorField label="Hintergrund" value={(r.background as string | null) ?? null} onChange={(background) => onPatch({ background })} disabled={disabled} />
          </div>
        </>
      );
    case "greeting":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Mit Vornamen" info="Muss {{vorname}} enthalten, z. B. „Hallo {{vorname}},“.">
            <Input value={String(r.text ?? "")} onChange={(e) => onPatch({ text: e.target.value })} disabled={disabled} />
          </Field>
          <Field label="Ohne Vornamen" info="Steht da, wenn kein Vorname bekannt ist.">
            <Input value={String(r.fallback ?? "")} onChange={(e) => onPatch({ fallback: e.target.value })} disabled={disabled} />
          </Field>
          {align(ALIGN_OPTIONS.filter((o) => o.value !== "right"))}
        </div>
      );
    case "image":
      return <ImageFields block={block} patch={onPatch} uploadConfigured={uploadConfigured} disabled={disabled} showWidth />;
    case "hero":
      return (
        <>
          <ImageFields block={block} patch={onPatch} uploadConfigured={uploadConfigured} disabled={disabled} showWidth={false} />
          <Field label="Hero-Überschrift zeigen" inline info="Die Überschrift des KI-Titelbilds unter dem Bild.">
            <Checkbox checked={r.showHeadline !== false} onChange={(e) => onPatch({ showHeadline: e.target.checked })} disabled={disabled} />
          </Field>
        </>
      );
    case "button":
      return (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Beschriftung">
              <Input value={String(r.label ?? "")} maxLength={MAIL_TEMPLATE_LIMITS.labelChars} onChange={(e) => onPatch({ label: e.target.value })} disabled={disabled} />
            </Field>
            <Field label="Link" info="https://… — Links in den Shop bekommen automatisch UTM-Parameter, jeder Klick wird gezählt.">
              <Input value={String(r.href ?? "")} placeholder="https://motionsports.de/…" onChange={(e) => onPatch({ href: e.target.value })} disabled={disabled} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {align()}
            <Field label="Ganze Breite" inline>
              <Checkbox checked={r.fullWidth === true} onChange={(e) => onPatch({ fullWidth: e.target.checked })} disabled={disabled} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <ColorField label="Buttonfarbe" value={(r.color as string | null) ?? null} onChange={(color) => onPatch({ color })} disabled={disabled} />
            <ColorField label="Schriftfarbe" value={(r.textColor as string | null) ?? null} onChange={(textColor) => onPatch({ textColor })} disabled={disabled} />
          </div>
        </>
      );
    case "products":
      return <ProductsFields block={block} onPatch={onPatch} disabled={disabled} />;
    case "coupon":
      return (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Code" info="Genau wie in Shopify → Rabatte angelegt (ein für alle gleicher Code). „Code einlösen“ hinterlegt ihn im Warenkorb.">
              <Input value={String(r.code ?? "")} className="font-mono uppercase" onChange={(e) => onPatch({ code: e.target.value })} disabled={disabled} />
            </Field>
            <Field label="Was er bringt" info="z. B. „25 % auf alles“ — muss zum Rabatt in Shopify passen.">
              <Input value={String(r.headline ?? "")} onChange={(e) => onPatch({ headline: e.target.value })} disabled={disabled} />
            </Field>
          </div>
          <Field label="Bedingungen" info="z. B. „Gültig bis 30.11.2026 · nicht mit anderen Rabatten kombinierbar“.">
            <Input value={String(r.terms ?? "")} onChange={(e) => onPatch({ terms: e.target.value })} disabled={disabled} />
          </Field>
        </>
      );
    case "countdown":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Ende" info="Der Countdown zählt bis hierhin — bei jedem Öffnen der Mail neu berechnet.">
            <Input
              type="datetime-local"
              value={toLocalInput((r.until as string | null) ?? null)}
              onChange={(e) => onPatch({ until: e.target.value ? new Date(e.target.value).toISOString() : null })}
              disabled={disabled}
            />
          </Field>
          <Field label="Text darüber">
            <Input value={String(r.heading ?? "")} onChange={(e) => onPatch({ heading: e.target.value })} disabled={disabled} />
          </Field>
        </div>
      );
    case "divider":
      return <ColorField label="Linienfarbe" value={(r.color as string | null) ?? null} onChange={(color) => onPatch({ color })} disabled={disabled} />;
    case "spacer":
      return (
        <Field label="Höhe (px)" info="8–80 px.">
          <Input type="number" min={8} max={80} value={String(r.height ?? 24)} onChange={(e) => onPatch({ height: Number(e.target.value) })} disabled={disabled} />
        </Field>
      );
    case "html":
      return (
        <Field
          label="HTML"
          info="Für Profis, z. B. aus einem Newsletter-Tool: Tabellen und Inline-Styles verwenden. Skripte, Formulare, Kommentare und Event-Attribute werden entfernt. Unbedingt eine Testmail in Outlook und auf dem Handy ansehen."
        >
          <Textarea rows={8} className="font-mono text-xs" value={String(r.html ?? "")} maxLength={MAIL_TEMPLATE_LIMITS.htmlChars} onChange={(e) => onPatch({ html: e.target.value })} disabled={disabled} />
        </Field>
      );
    case "mo_content":
      return (
        <Field label="Überschrift der Mail zeigen" inline info="z. B. „Deine persönliche Empfehlung“ über Mos Text.">
          <Checkbox checked={r.showHeading !== false} onChange={(e) => onPatch({ showHeading: e.target.checked })} disabled={disabled} />
        </Field>
      );
    case "footer":
      return (
        <Field label="Social-Media-Symbole" inline>
          <Checkbox checked={r.showSocial !== false} onChange={(e) => onPatch({ showSocial: e.target.checked })} disabled={disabled} />
        </Field>
      );
    default:
      return <p className="text-xs text-muted-foreground">{MAIL_BLOCK_CATALOG[block.type]?.description}</p>;
  }
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ProductsFields({
  block,
  onPatch,
  disabled,
}: {
  block: Block;
  onPatch: (p: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  const r = block as Record<string, unknown>;
  const refs = (r.refs as string[]) ?? [];
  const [names, setNames] = React.useState<Record<string, string>>({});
  const full = refs.length >= MAIL_TEMPLATE_LIMITS.productsPerBlock;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Überschrift">
          <Input value={String(r.title ?? "")} onChange={(e) => onPatch({ title: e.target.value })} disabled={disabled} />
        </Field>
        <Field label="Darstellung">
          <SegmentedControl
            label="Darstellung"
            size="sm"
            value={String(r.layout ?? "rows") as "rows" | "grid"}
            onChange={(layout) => onPatch({ layout })}
            options={[
              { value: "rows", label: "Zeilen" },
              { value: "grid", label: "Raster" },
            ]}
            disabled={disabled}
          />
        </Field>
      </div>
      <Field
        label={`Produkte (${refs.length}/${MAIL_TEMPLATE_LIMITS.productsPerBlock})`}
        info="Bild, Name, aktueller Preis und Link kommen beim Freigeben aus dem Katalog. Ausverkaufte Produkte fallen automatisch weg."
      >
        <div className="flex flex-col gap-2">
          {refs.length > 0 && (
            <ul className="flex flex-col gap-1">
              {refs.map((ref) => (
                <li key={ref} className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
                  <span className="min-w-0 flex-1 truncate">{names[ref] ?? ref}</span>
                  <IconButton
                    label="Produkt entfernen"
                    size="icon-sm"
                    onClick={() => onPatch({ refs: refs.filter((x) => x !== ref) })}
                    disabled={disabled}
                  >
                    <Trash2 />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
          {!disabled && !full && (
            <CatalogProductPicker
              allVariantsOption
              selectLabel="hinzufügen"
              isSelected={(hit, v) => refs.includes(v?.variantId ? `${hit.productId}~${v.variantId}` : hit.productId)}
              disableReason={(hit) => (hit.inStock === false ? "Ausverkauft" : null)}
              onSelect={(hit, v) => {
                const ref = v?.variantId ? `${hit.productId}~${v.variantId}` : hit.productId;
                if (refs.includes(ref)) return;
                setNames((n) => ({ ...n, [ref]: v?.variantId ? `${hit.title} — ${v.title ?? ""}` : hit.title }));
                onPatch({ refs: [...refs, ref] });
              }}
            />
          )}
        </div>
      </Field>
    </>
  );
}

/**
 * The editor. `use` decides which blocks „Baustein hinzufügen“ offers
 * (a Rundmail never gets Mo blocks); `issues` (validateMailTemplateDoc)
 * marks the blocks with problems.
 */
export function BlockEditor({
  doc,
  onChange,
  use,
  issues,
  uploadConfigured,
  disabled = false,
}: {
  doc: MailDoc;
  onChange: (doc: MailDoc) => void;
  use: BlockUse;
  issues?: { errors: DocIssue[]; warnings: DocIssue[] };
  uploadConfigured: boolean;
  disabled?: boolean;
}) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  const blocks = doc.blocks;
  const set = (next: Block[]) => onChange(normalizeMailTemplateDoc({ ...doc, blocks: next }));
  const patchBlock = (id: string, p: Record<string, unknown>) =>
    set(blocks.map((b) => (b.id === id ? ({ ...b, ...p } as Block) : b)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= blocks.length - 1) return; // the footer stays last
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    set(next);
  };
  const remove = (id: string) => set(blocks.filter((b) => b.id !== id));
  const duplicate = (i: number) => {
    const taken = new Set(blocks.map((b) => b.id));
    const copy = normalizeMailBlock({ ...blocks[i], id: undefined }, taken);
    if (!copy) return;
    const next = [...blocks];
    next.splice(i + 1, 0, copy as Block);
    set(next);
  };
  const add = (type: string) => {
    const taken = new Set(blocks.map((b) => b.id));
    const block = normalizeMailBlock({ type }, taken);
    if (!block) return;
    const at = openId ? blocks.findIndex((b) => b.id === openId) + 1 : blocks.length - 1;
    const next = [...blocks];
    next.splice(Math.min(Math.max(at, 0), blocks.length - 1), 0, block as Block);
    set(next);
    setOpenId(block.id);
  };
  const style = doc.style;
  const patchStyle = (p: Partial<MailDoc["style"]>) => onChange(normalizeMailTemplateDoc({ ...doc, style: { ...style, ...p } }));
  const issuesFor = (id: string) => ({
    errors: (issues?.errors ?? []).filter((x) => x.blockId === id),
    warnings: (issues?.warnings ?? []).filter((x) => x.blockId === id),
  });
  const singletons = new Set(blocks.filter((b) => ["hero", "mo_content", "mo_offer", "mo_promo"].includes(b.type)).map((b) => b.type));
  const addable = MAIL_BLOCK_TYPES.filter((t) => {
    const c = MAIL_BLOCK_CATALOG[t];
    if (t === "footer") return false;
    if (use === "bulk" && !c.bulk) return false;
    return !singletons.has(t);
  });
  const groups = ["inhalt", "angebot", "mo", "rahmen"].filter((g) => addable.some((t) => MAIL_BLOCK_CATALOG[t].group === g));
  const full = blocks.length >= MAIL_TEMPLATE_LIMITS.blocks;

  return (
    <div className="flex flex-col gap-3">
      <Disclosure title="Farben & Schrift" meta={<span className="text-2xs text-muted-foreground">gilt für die ganze Mail</span>}>
        <div className="grid gap-3 sm:grid-cols-3">
          <ColorField label="Akzentfarbe" value={style.accentColor} onChange={(v) => v && patchStyle({ accentColor: v })} allowEmpty={false} disabled={disabled} />
          <ColorField label="Button-Schrift" value={style.buttonTextColor} onChange={(v) => v && patchStyle({ buttonTextColor: v })} allowEmpty={false} disabled={disabled} />
          <ColorField label="Hintergrund außen" value={style.outerBackground} onChange={(v) => v && patchStyle({ outerBackground: v })} allowEmpty={false} disabled={disabled} />
          <ColorField label="Überschriften" value={style.headingColor} onChange={(v) => v && patchStyle({ headingColor: v })} allowEmpty={false} disabled={disabled} />
          <ColorField label="Text" value={style.textColor} onChange={(v) => v && patchStyle({ textColor: v })} allowEmpty={false} disabled={disabled} />
          <Field label="Schrift">
            <Select value={style.fontFamily} onChange={(e) => patchStyle({ fontFamily: e.target.value as MailDoc["style"]["fontFamily"] })} disabled={disabled}>
              {EMAIL_FONT_KEYS.map((k) => (
                <option key={k} value={k}>
                  {EMAIL_FONT_CHOICES[k].label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Button-Form">
            <SegmentedControl
              label="Button-Form"
              size="sm"
              value={style.buttonShape}
              onChange={(buttonShape) => patchStyle({ buttonShape })}
              options={EMAIL_BUTTON_SHAPES.map((s) => ({ value: s, label: BUTTON_SHAPE_LABELS[s] ?? s }))}
              disabled={disabled}
            />
          </Field>
          <Field label="Eigenes Logo" className="sm:col-span-2" info="https-Adresse eines Logos (PNG/JPG). Leer = das motion-sports-Logo.">
            <Input value={style.logoUrl ?? ""} placeholder="Standard-Logo" onChange={(e) => patchStyle({ logoUrl: e.target.value || null })} disabled={disabled} />
          </Field>
        </div>
      </Disclosure>

      <ol className="flex flex-col gap-2" aria-label="Bausteine">
        {blocks.map((b, i) => {
          const meta = MAIL_BLOCK_CATALOG[b.type];
          const open = openId === b.id;
          const { errors, warnings } = issuesFor(b.id);
          const isFooter = b.type === "footer";
          return (
            <li
              key={b.id}
              className={cn(
                "rounded-lg border bg-card",
                errors.length ? "border-destructive/60" : open ? "border-accent" : "border-border"
              )}
            >
              <div className="flex items-center gap-1 px-2 py-1.5">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left hover:bg-surface-2"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : b.id)}
                >
                  {open ? <ChevronDown className="size-4 shrink-0" aria-hidden /> : <ChevronRight className="size-4 shrink-0" aria-hidden />}
                  <span className="shrink-0 text-sm font-medium">{meta?.label ?? b.type}</span>
                  <span className="min-w-0 truncate text-xs text-muted-foreground">{blockSummary(b)}</span>
                  {errors.length > 0 && <span className="ml-auto shrink-0 text-2xs font-medium text-destructive">{errors.length} Fehler</span>}
                  {!errors.length && warnings.length > 0 && (
                    <span className="ml-auto shrink-0 text-2xs font-medium text-warning">Hinweis</span>
                  )}
                </button>
                {!isFooter && !disabled && (
                  <>
                    <IconButton label="Nach oben" size="icon-sm" onClick={() => move(i, -1)} disabled={i === 0}>
                      <ArrowUp />
                    </IconButton>
                    <IconButton label="Nach unten" size="icon-sm" onClick={() => move(i, 1)} disabled={i >= blocks.length - 2}>
                      <ArrowDown />
                    </IconButton>
                    <IconButton label="Duplizieren" size="icon-sm" onClick={() => duplicate(i)} disabled={full || singletons.has(b.type)}>
                      <Copy />
                    </IconButton>
                    <IconButton label="Entfernen" size="icon-sm" onClick={() => remove(b.id)}>
                      <Trash2 />
                    </IconButton>
                  </>
                )}
              </div>
              {(errors.length > 0 || warnings.length > 0) && (
                <ul className="flex flex-col gap-0.5 px-3 pb-1.5 text-2xs">
                  {errors.map((x, k) => (
                    <li key={`e${k}`} className="text-destructive">
                      {x.message}
                    </li>
                  ))}
                  {warnings.map((x, k) => (
                    <li key={`w${k}`} className="text-muted-foreground">
                      {x.message}
                    </li>
                  ))}
                </ul>
              )}
              {open && (
                <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
                  <p className="flex items-center gap-1 text-2xs text-muted-foreground">
                    {meta?.description}
                    {isFooter && <InfoTip>Pflicht: Abmelde-Link, Impressum und Firmenangaben stehen in jeder Mail.</InfoTip>}
                  </p>
                  <BlockSettings block={b} onPatch={(p) => patchBlock(b.id, p)} uploadConfigured={uploadConfigured} disabled={disabled} />
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {!disabled && (
        <Menu
          label="Baustein hinzufügen"
          align="start"
          trigger={
            <Button variant="outline" size="sm" disabled={full} className="self-start">
              <Plus /> Baustein hinzufügen
            </Button>
          }
          items={groups.flatMap((g, gi) =>
            addable
              .filter((t) => MAIL_BLOCK_CATALOG[t].group === g)
              .map((t, ti) => ({
                key: t,
                label: (
                  <span className="flex flex-col">
                    <span>{MAIL_BLOCK_CATALOG[t].label}</span>
                    <span className="text-2xs text-muted-foreground">{GROUP_LABELS[g]}</span>
                  </span>
                ),
                onSelect: () => add(t),
                separatorBefore: gi > 0 && ti === 0,
              }))
          )}
        />
      )}
    </div>
  );
}
