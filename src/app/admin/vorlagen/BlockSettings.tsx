"use client";

// The settings of one block of the block editor (BlockEditor.tsx): one case
// per block type with its fields, then its „Gestaltung“ (BlockStyleFields).
// A section's settings and columns live in SectionEditor.tsx / the editor's
// tree. Every change is a patch the editor merges into the block
// (updateMailBlock) and normalises.

import * as React from "react";
import { ArrowLeftRight, Trash2, X } from "lucide-react";
import { MAIL_TEMPLATE_LIMITS, MENU_SEPARATORS } from "@/lib/mail-template-doc.mjs";
import {
  CatalogProductPicker,
  Checkbox,
  Field,
  IconButton,
  Input,
  SegmentedControl,
  Select,
  StatusBadge,
  toast,
  type CatalogSearchHit,
  type CatalogVariantHit,
} from "../ui";
import type { MailDoc } from "./BlockEditor";
import { BlockStyleFields } from "./BlockStyleFields";
import { useCatalogInfo } from "./catalog-info";
import { ALIGN_OPTIONS, AlignField, ColorField, DraftInput, DraftTextarea, ImageUrlField, NumberField } from "./editor-fields";
import { MenuItemsField, type MenuLink } from "./MenuItemsField";

type Block = MailDoc["blocks"][number];
type MailStyle = MailDoc["style"];
type Patch = (p: Record<string, unknown>) => void;

const SEPARATOR_LABELS: Record<string, string> = { "|": "|  Strich", "·": "·  Punkt", "/": "/  Schrägstrich", none: "ohne" };

/** The catalog ref of a picked product / variant (product-ref.mjs). */
const refOf = (hit: CatalogSearchHit, v: CatalogVariantHit | null) => (v?.variantId ? `${hit.productId}~${v.variantId}` : hit.productId);
const nameOf = (hit: CatalogSearchHit, v: CatalogVariantHit | null) => (v?.variantId ? `${hit.title} — ${v.title ?? ""}` : hit.title);
const availableOf = (hit: CatalogSearchHit, v: CatalogVariantHit | null) => (v ? v.available !== false : hit.inStock !== false);

function ImageFields({
  block,
  patch,
  uploadConfigured,
  disabled,
  showWidth,
}: {
  block: Block;
  patch: Patch;
  uploadConfigured: boolean;
  disabled?: boolean;
  showWidth: boolean;
}) {
  const r = block as Record<string, unknown>;
  const width = r.width;
  const mode = typeof width === "number" ? "px" : width === "content" ? "content" : "full";
  return (
    <>
      <ImageUrlField
        label="Bild (https-Adresse)"
        info="Hochladen oder die https-Adresse eines Bildes einfügen (z. B. aus Shopify → Inhalte → Dateien). JPG, PNG oder GIF; mindestens 1200 px breit für ein vollbreites Bild."
        value={String(r.src ?? "")}
        onCommit={(src) => patch({ src })}
        uploadConfigured={uploadConfigured}
        disabled={disabled}
      />
      {String(r.src ?? "") && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={String(r.src)} alt="" className="max-h-28 w-auto max-w-full rounded border border-border object-contain" />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Alternativtext" info="Wird gezeigt, wenn Bilder blockiert sind, und vorgelesen — kurz beschreiben, was zu sehen ist.">
          <DraftInput value={String(r.alt ?? "")} onCommit={(v) => patch({ alt: v })} disabled={disabled} />
        </Field>
        <Field label="Link beim Klick" info="https://… oder leer.">
          <DraftInput value={String(r.href ?? "")} placeholder="https://motionsports.de/…" onCommit={(v) => patch({ href: v })} disabled={disabled} />
        </Field>
      </div>
      {showWidth && (
        <div className="flex flex-wrap items-start gap-x-5 gap-y-3">
          <Field
            label="Breite"
            info="Ganze Breite = bis an den Rand der Mail bzw. der Spalte · Mit Rand = innerhalb des Seitenrands · Feste Breite = höchstens so breit (40–600 px), nie breiter als der Platz."
          >
            <SegmentedControl
              label="Breite"
              size="sm"
              value={mode}
              onChange={(m) => patch({ width: m === "px" ? 300 : m })}
              options={[
                { value: "full", label: "Ganze Breite" },
                { value: "content", label: "Mit Rand" },
                { value: "px", label: "Feste Breite" },
              ]}
              disabled={disabled}
            />
          </Field>
          {mode === "px" && (
            <NumberField
              label="Breite (px)"
              className="w-32"
              value={width as number}
              min={40}
              max={600}
              placeholder="300"
              // an empty field keeps the width (empty would mean „Ganze Breite“)
              onCommit={(v) => v.trim() !== "" && patch({ width: v })}
              disabled={disabled}
            />
          )}
        </div>
      )}
    </>
  );
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Sold-out products may be chosen on purpose (a mail prepared for an item back soon) — but never by accident. */
function warnSoldOut(name: string, single: boolean) {
  toast({
    variant: "warning",
    title: single ? "Ausverkauftes Produkt gewählt" : "Ausverkauftes Produkt hinzugefügt",
    description: single
      ? `${name} ist gerade nicht lieferbar. Der Baustein erscheint in der Mail erst, wenn es wieder lieferbar ist — bis dahin fehlt er.`
      : `${name} ist gerade nicht lieferbar. In der Mail erscheint es erst, wenn es wieder lieferbar ist — bis dahin fehlt es.`,
  });
}

/** Name + „Ausverkauft“ / „Nicht im Katalog“ of a chosen ref (the live catalog, or what the picker knew). */
function ProductBadges({ refId }: { refId: string }) {
  const entry = useCatalogInfo().info[refId];
  return (
    <>
      <span className="min-w-0 flex-1 truncate">{entry?.name ?? refId}</span>
      {entry?.available === false && <StatusBadge tone="warning">Ausverkauft</StatusBadge>}
      {entry && entry.available === null && <StatusBadge tone="destructive">Nicht im Katalog</StatusBadge>}
    </>
  );
}

function ProductsFields({ block, onPatch, disabled }: { block: Block; onPatch: Patch; disabled?: boolean }) {
  const r = block as Record<string, unknown>;
  const refs = (r.refs as string[]) ?? [];
  const { remember } = useCatalogInfo();
  const full = refs.length >= MAIL_TEMPLATE_LIMITS.productsPerBlock;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Überschrift">
          <DraftInput value={String(r.title ?? "")} onCommit={(v) => onPatch({ title: v })} disabled={disabled} />
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
        info="Bild, Name, aktueller Preis und Link kommen beim Versand aus dem Katalog — bei einer geplanten Rundmail mit dem Stand beim Versandstart, sonst beim Freigeben. Ausverkaufte Produkte lassen sich vorbereiten: In der Mail erscheinen sie erst, wenn sie wieder lieferbar sind — bis dahin fehlen sie (ein Baustein ganz ohne lieferbares Produkt entfällt)."
      >
        <div className="flex flex-col gap-2">
          {refs.length > 0 && (
            <ul className="flex flex-col gap-1">
              {refs.map((ref) => (
                <li key={ref} className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
                  <ProductBadges refId={ref} />
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
              isSelected={(hit, v) => refs.includes(refOf(hit, v))}
              onSelect={(hit, v) => {
                const ref = refOf(hit, v);
                if (refs.includes(ref)) return;
                const name = nameOf(hit, v);
                const available = availableOf(hit, v);
                remember(ref, { name, available, imageUrl: hit.imageUrl ?? null });
                onPatch({ refs: [...refs, ref] });
                if (!available) warnSoldOut(name, false);
              }}
            />
          )}
        </div>
      </Field>
    </>
  );
}

/** The one product of „Produkt-Highlight“: the chosen one with its state, the picker to choose / change it. */
function ProductField({ block, onPatch, disabled }: { block: Block; onPatch: Patch; disabled?: boolean }) {
  const ref = String((block as Record<string, unknown>).ref ?? "");
  const { info, remember } = useCatalogInfo();
  const [choosing, setChoosing] = React.useState(false);
  const image = ref ? info[ref]?.imageUrl : null;
  return (
    <Field
      label="Produkt"
      info="Bild, Name, aktueller Preis (auch Sale- und „ab“-Preis) und Link kommen live aus dem Katalog — bei einer geplanten Rundmail mit dem Stand beim Versandstart, sonst beim Freigeben. Ein ausverkauftes Produkt lässt sich vorbereiten: Der Baustein erscheint erst, wenn es wieder lieferbar ist — bis dahin fehlt er in der Mail."
    >
      <div className="flex flex-col gap-2">
        {ref && (
          <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt="" width={28} height={28} className="size-7 shrink-0 rounded object-cover" />
            ) : (
              <span className="size-7 shrink-0 rounded bg-muted" aria-hidden />
            )}
            <ProductBadges refId={ref} />
            {!disabled && (
              <>
                <IconButton label={choosing ? "Produktsuche schließen" : "Anderes Produkt wählen"} size="icon-sm" onClick={() => setChoosing((v) => !v)}>
                  {choosing ? <X /> : <ArrowLeftRight />}
                </IconButton>
                <IconButton
                  label="Produkt entfernen"
                  size="icon-sm"
                  onClick={() => {
                    setChoosing(false);
                    onPatch({ ref: "" });
                  }}
                >
                  <Trash2 />
                </IconButton>
              </>
            )}
          </div>
        )}
        {!disabled && (!ref || choosing) && (
          <CatalogProductPicker
            allVariantsOption
            selectLabel={ref ? "übernehmen" : "wählen"}
            isSelected={(hit, v) => ref === refOf(hit, v)}
            onSelect={(hit, v) => {
              const next = refOf(hit, v);
              const name = nameOf(hit, v);
              const available = availableOf(hit, v);
              remember(next, { name, available, imageUrl: hit.imageUrl ?? null });
              setChoosing(false);
              onPatch({ ref: next });
              if (!available) warnSoldOut(name, true);
            }}
          />
        )}
      </div>
    </Field>
  );
}

const check = (label: string, checked: boolean, onChange: (v: boolean) => void, disabled?: boolean, info?: string) => (
  <Field label={label} inline className="w-fit" info={info}>
    <Checkbox checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
  </Field>
);

/** The settings of one block (not a section — see SectionEditor.tsx). */
export function BlockSettings({
  block,
  onPatch,
  uploadConfigured,
  disabled,
  style,
}: {
  block: Block;
  onPatch: Patch;
  uploadConfigured: boolean;
  disabled?: boolean;
  style: MailStyle;
}) {
  const r = block as Record<string, unknown>;
  const align = (values: readonly { value: string; label: string }[] = ALIGN_OPTIONS) => (
    <AlignField value={String(r.align ?? "left")} onChange={(v) => onPatch({ align: v })} options={values} disabled={disabled} />
  );
  const colorOf = (key: string) => (r[key] as string | null | undefined) ?? null;
  let main: React.ReactNode;
  switch (block.type) {
    case "logo":
      main = (
        <div className="grid gap-3 sm:grid-cols-2">
          {align()}
          <Field label="Breite (px)" info="60–300 px. Das Logo selbst: „Eigenes Logo“ unter „Farben & Schrift“.">
            <DraftInput type="number" min={60} max={300} value={String(r.width ?? 144)} onCommit={(v) => onPatch({ width: v })} disabled={disabled} />
          </Field>
        </div>
      );
      break;
    case "heading":
      main = (
        <>
          <Field label="Text" info="Platzhalter: {{vorname}} oder {{vorname|Ersatz}}.">
            <DraftInput value={String(r.text ?? "")} maxLength={MAIL_TEMPLATE_LIMITS.headingChars} onCommit={(v) => onPatch({ text: v })} disabled={disabled} />
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
            <ColorField label="Schriftfarbe" value={colorOf("color")} fallback={style.headingColor} onChange={(color) => onPatch({ color })} disabled={disabled} />
            <ColorField
              label="Hintergrund (Band)"
              value={colorOf("background")}
              fallback={style.cardBackground}
              onChange={(background) => onPatch({ background })}
              disabled={disabled}
            />
          </div>
        </>
      );
      break;
    case "text":
      main = (
        <>
          <Field
            label="Text"
            info="Leerzeile = neuer Absatz · Zeilen mit „- “ = Aufzählung · **fett** · Links als [Text](https://…) · Platzhalter {{vorname}}."
          >
            <DraftTextarea rows={6} value={String(r.text ?? "")} maxLength={MAIL_TEMPLATE_LIMITS.textChars} onCommit={(v) => onPatch({ text: v })} disabled={disabled} />
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
            <ColorField label="Schriftfarbe" value={colorOf("color")} fallback={style.textColor} onChange={(color) => onPatch({ color })} disabled={disabled} />
            <ColorField
              label="Hintergrund"
              value={colorOf("background")}
              fallback={style.cardBackground}
              onChange={(background) => onPatch({ background })}
              disabled={disabled}
            />
          </div>
        </>
      );
      break;
    case "greeting":
      main = (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Mit Vornamen" info="Muss {{vorname}} enthalten, z. B. „Hallo {{vorname}},“.">
            <DraftInput value={String(r.text ?? "")} onCommit={(v) => onPatch({ text: v })} disabled={disabled} />
          </Field>
          <Field label="Ohne Vornamen" info="Steht da, wenn kein Vorname bekannt ist.">
            <DraftInput value={String(r.fallback ?? "")} onCommit={(v) => onPatch({ fallback: v })} disabled={disabled} />
          </Field>
          {align(ALIGN_OPTIONS.filter((o) => o.value !== "right"))}
        </div>
      );
      break;
    case "image":
      main = <ImageFields block={block} patch={onPatch} uploadConfigured={uploadConfigured} disabled={disabled} showWidth />;
      break;
    case "hero":
      main = (
        <>
          <ImageFields block={block} patch={onPatch} uploadConfigured={uploadConfigured} disabled={disabled} showWidth={false} />
          {check("Hero-Überschrift zeigen", r.showHeadline !== false, (showHeadline) => onPatch({ showHeadline }), disabled, "Die Überschrift des KI-Titelbilds unter dem Bild.")}
        </>
      );
      break;
    case "button":
      main = (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Beschriftung">
              <DraftInput value={String(r.label ?? "")} maxLength={MAIL_TEMPLATE_LIMITS.labelChars} onCommit={(v) => onPatch({ label: v })} disabled={disabled} />
            </Field>
            <Field label="Link" info="https://… — Links in den Shop bekommen automatisch UTM-Parameter, jeder Klick wird gezählt.">
              <DraftInput value={String(r.href ?? "")} placeholder="https://motionsports.de/…" onCommit={(v) => onPatch({ href: v })} disabled={disabled} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {align()}
            {check("Ganze Breite", r.fullWidth === true, (fullWidth) => onPatch({ fullWidth }), disabled)}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <ColorField label="Buttonfarbe" value={colorOf("color")} fallback={style.accentColor} onChange={(color) => onPatch({ color })} disabled={disabled} />
            <ColorField label="Schriftfarbe" value={colorOf("textColor")} fallback={style.buttonTextColor} onChange={(textColor) => onPatch({ textColor })} disabled={disabled} />
          </div>
        </>
      );
      break;
    case "products":
      main = <ProductsFields block={block} onPatch={onPatch} disabled={disabled} />;
      break;
    case "product":
      main = (
        <>
          <ProductField block={block} onPatch={onPatch} disabled={disabled} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Darstellung" info="Bild links: auf dem Handy steht das Bild über dem Text.">
              <SegmentedControl
                label="Darstellung"
                size="sm"
                value={String(r.layout ?? "stacked")}
                onChange={(layout) => onPatch({ layout })}
                options={[
                  { value: "stacked", label: "Bild oben" },
                  { value: "side", label: "Bild links" },
                ]}
                disabled={disabled}
              />
            </Field>
            {align()}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {check("Bild zeigen", r.showImage !== false, (showImage) => onPatch({ showImage }), disabled)}
            {check("Preis zeigen", r.showPrice !== false, (showPrice) => onPatch({ showPrice }), disabled)}
            {check("Beschreibung zeigen", r.showDescription === true, (showDescription) => onPatch({ showDescription }), disabled, "Die Kurzbeschreibung aus dem Katalog.")}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Button-Beschriftung" info="z. B. „Zum Produkt“. Leer = kein Button — Bild und Name bleiben verlinkt.">
              <DraftInput
                value={String(r.buttonLabel ?? "")}
                placeholder="Kein Button"
                maxLength={MAIL_TEMPLATE_LIMITS.labelChars}
                onCommit={(buttonLabel) => onPatch({ buttonLabel })}
                disabled={disabled}
              />
            </Field>
            <ColorField label="Schriftfarbe" value={colorOf("color")} fallback={style.textColor} onChange={(color) => onPatch({ color })} disabled={disabled} />
            <NumberField
              label="Namensgröße (px)"
              info="12–40 px. Leer = passend zur Breite."
              value={r.nameSize as number | undefined}
              min={12}
              max={40}
              placeholder="Automatisch"
              onCommit={(nameSize) => onPatch({ nameSize })}
              disabled={disabled}
            />
          </div>
        </>
      );
      break;
    case "menu":
      main = (
        <>
          <MenuItemsField items={(r.items as MenuLink[] | undefined) ?? []} onChange={(items) => onPatch({ items })} disabled={disabled} />
          <div className="grid gap-3 sm:grid-cols-2">
            {align()}
            <Field label="Trennzeichen">
              <Select value={String(r.separator ?? "|")} onChange={(e) => onPatch({ separator: e.target.value })} disabled={disabled}>
                {MENU_SEPARATORS.map((s) => (
                  <option key={s} value={s}>
                    {SEPARATOR_LABELS[s] ?? s}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {check("Großbuchstaben", r.uppercase !== false, (uppercase) => onPatch({ uppercase }), disabled)}
            {check("Fett", r.bold !== false, (bold) => onPatch({ bold }), disabled)}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <ColorField label="Schriftfarbe" value={colorOf("color")} fallback={style.textColor} onChange={(color) => onPatch({ color })} disabled={disabled} />
            <NumberField
              label="Schriftgröße (px)"
              info="10–28 px."
              value={r.fontSize as number | undefined}
              min={10}
              max={28}
              placeholder="Standard (13)"
              onCommit={(fontSize) => onPatch({ fontSize })}
              disabled={disabled}
            />
          </div>
        </>
      );
      break;
    case "coupon":
      main = (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Code" info="Genau wie in Shopify → Rabatte angelegt (ein für alle gleicher Code). „Code einlösen“ hinterlegt ihn im Warenkorb.">
              <Input value={String(r.code ?? "")} className="font-mono uppercase" onChange={(e) => onPatch({ code: e.target.value })} disabled={disabled} />
            </Field>
            <Field label="Was er bringt" info="z. B. „25 % auf alles“ — muss zum Rabatt in Shopify passen.">
              <DraftInput value={String(r.headline ?? "")} onCommit={(v) => onPatch({ headline: v })} disabled={disabled} />
            </Field>
          </div>
          <Field label="Bedingungen" info="z. B. „Gültig bis 30.11.2026 · nicht mit anderen Rabatten kombinierbar“.">
            <DraftInput value={String(r.terms ?? "")} onCommit={(v) => onPatch({ terms: v })} disabled={disabled} />
          </Field>
        </>
      );
      break;
    case "countdown":
      main = (
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
            <DraftInput value={String(r.heading ?? "")} onCommit={(v) => onPatch({ heading: v })} disabled={disabled} />
          </Field>
        </div>
      );
      break;
    case "divider":
      main = (
        <div className="grid gap-3 sm:grid-cols-2">
          <ColorField label="Linienfarbe" value={colorOf("color")} fallback="#e0e0e0" onChange={(color) => onPatch({ color })} disabled={disabled} />
        </div>
      );
      break;
    case "spacer":
      main = (
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField
            label="Höhe (px)"
            info="4–200 px."
            value={r.height as number}
            min={4}
            max={200}
            onCommit={(height) => onPatch({ height })}
            disabled={disabled}
          />
        </div>
      );
      break;
    case "social":
      // stored only when not centred
      main = (
        <div className="grid gap-3 sm:grid-cols-2">
          <AlignField value={String(r.align ?? "center")} onChange={(v) => onPatch({ align: v })} disabled={disabled} />
        </div>
      );
      break;
    case "html":
      main = (
        <Field
          label="HTML"
          info="Für Profis, z. B. aus einem Newsletter-Tool: Tabellen und Inline-Styles verwenden. Skripte, Formulare, Kommentare und Event-Attribute werden entfernt. Platzhalter wie {{vorname}} werden hier nicht ersetzt. Unbedingt eine Testmail in Outlook und auf dem Handy ansehen."
        >
          <DraftTextarea rows={8} className="font-mono text-xs" value={String(r.html ?? "")} maxLength={MAIL_TEMPLATE_LIMITS.htmlChars} onCommit={(html) => onPatch({ html })} disabled={disabled} />
        </Field>
      );
      break;
    case "mo_content":
      main = check("Überschrift der Mail zeigen", r.showHeading !== false, (showHeading) => onPatch({ showHeading }), disabled, "z. B. „Deine persönliche Empfehlung“ über Mos Text.");
      break;
    case "footer":
      main = check("Social-Media-Symbole", r.showSocial !== false, (showSocial) => onPatch({ showSocial }), disabled);
      break;
    default:
      // mo_offer, mo_promo: Mo fills them per mail (what they do: the InfoTip of the row)
      main = <p className="text-xs text-muted-foreground">Dieser Baustein hat keine Einstellungen.</p>;
  }
  return (
    <>
      {main}
      <BlockStyleFields block={block} onPatch={onPatch} disabled={disabled} style={style} />
    </>
  );
}
