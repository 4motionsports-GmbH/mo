"use client";

// „Mo im Konfigurator“ + „Sortiment“ of the Konfigurator screen: the operator
// settings of the Home-Gym-Konfigurator (admin_settings 'configurator',
// configurator-core.mjs) and the curated assortment Mo works in. Saved through
// POST /api/admin/konfigurator/settings; after a save the server render
// refreshes so the assortment list follows a changed tag or list.

import * as React from "react";
import { useRouter } from "next/navigation";
import { Dumbbell, ExternalLink, PackageSearch, Save, Tag, X } from "lucide-react";
import {
  CONFIGURATOR_LIMITS,
  DEFAULT_CONFIGURATOR_TAG,
  validateConfiguratorSettingsInput,
  type ConfiguratorSettings,
} from "@/lib/configurator-core.mjs";
import { eur, num, plural } from "@/lib/admin-format.mjs";
import {
  Button,
  Callout,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CatalogProductPicker,
  DataTable,
  EmptyState,
  Field,
  InfoTip,
  Input,
  Section,
  SegmentedControl,
  StatusBadge,
  Textarea,
  toast,
  type DataTableColumn,
} from "../ui";
import { adminFetch, friendlyErrorMessage } from "../lib/admin-fetch";
import { useAsyncAction } from "../lib/use-async-action";
import type { AssortmentRow } from "./types";

type Focus = ConfiguratorSettings["focus"];

const FOCUS_OPTIONS = [
  { value: "prefer", label: "Sortiment bevorzugen" },
  { value: "only", label: "Nur Sortiment" },
] as const;

const STATE_OPTIONS = [
  { value: "on", label: "Aktiv" },
  { value: "off", label: "Aus" },
] as const;

export function KonfiguratorWorkspace({
  dbReady,
  initialSettings,
  assortment,
  unknownExtraIds,
}: {
  dbReady: boolean;
  initialSettings: ConfiguratorSettings;
  assortment: AssortmentRow[];
  unknownExtraIds: string[];
}) {
  const router = useRouter();
  const [saved, setSaved] = React.useState(initialSettings);
  const [enabled, setEnabled] = React.useState(initialSettings.enabled);
  const [tag, setTag] = React.useState(initialSettings.tag);
  const [focus, setFocus] = React.useState<Focus>(initialSettings.focus);
  const [notes, setNotes] = React.useState(initialSettings.notes);
  const [extra, setExtra] = React.useState<Array<{ id: string; title: string | null }>>(
    initialSettings.extraProductIds.map((id) => ({ id, title: assortment.find((a) => a.id === id.split("~")[0])?.name ?? null }))
  );

  const draft = { enabled, tag, focus, notes, extraProductIds: extra.map((e) => e.id) };
  const parsed = validateConfiguratorSettingsInput(draft);
  const dirty =
    enabled !== saved.enabled ||
    tag.trim() !== saved.tag ||
    focus !== saved.focus ||
    notes.trim() !== saved.notes ||
    draft.extraProductIds.join(",") !== saved.extraProductIds.join(",");

  const save = useAsyncAction(
    async () => {
      if (!parsed.ok) throw new Error(parsed.message);
      const json = await adminFetch<{ ok?: boolean; settings?: ConfiguratorSettings }>(
        "/api/admin/konfigurator/settings",
        { body: parsed.settings }
      );
      return json.settings ?? parsed.settings;
    },
    {
      errorToast: "Konfigurator-Einstellungen nicht gespeichert",
      onSuccess: (next) => {
        setSaved(next);
        setTag(next.tag);
        setNotes(next.notes);
        toast({
          variant: "success",
          title: "Gespeichert",
          description: next.enabled
            ? "Mo nutzt die neuen Einstellungen spätestens nach einer Minute."
            : "Mo berät Konfigurator-Besucher jetzt wie im normalen Chat.",
        });
        router.refresh();
      },
    }
  );

  const disabled = !dbReady || save.pending;
  const soldOut = assortment.filter((a) => !a.inStock).length;

  const columns: DataTableColumn<AssortmentRow>[] = [
    {
      key: "name",
      header: "Produkt",
      sortValue: (r) => r.name,
      cell: (r) => (
        <div className="flex min-w-0 items-center gap-3">
          {r.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.image} alt="" className="size-9 shrink-0 rounded-md border border-border bg-white object-contain" />
          ) : (
            <span className="size-9 shrink-0 rounded-md border border-border bg-surface-2" aria-hidden />
          )}
          <div className="min-w-0">
            <div className="truncate font-medium">{r.name}</div>
            <div className="truncate font-mono text-2xs text-muted-foreground">{r.id}</div>
          </div>
        </div>
      ),
    },
    { key: "category", header: "Kategorie", sortValue: (r) => r.category, hideBelow: "md", cell: (r) => r.category },
    {
      key: "price",
      header: "Preis",
      align: "right",
      sortValue: (r) => r.priceMin ?? r.price,
      cell: (r) =>
        r.priceMin != null && r.priceMax != null && r.priceMax > r.priceMin
          ? `${eur(r.priceMin, 0)} – ${eur(r.priceMax, 0)}`
          : eur(r.price, 0),
    },
    {
      key: "state",
      header: "Status",
      sortValue: (r) => (r.inStock ? 1 : 0),
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.inStock ? <StatusBadge tone="success">Lieferbar</StatusBadge> : <StatusBadge tone="warning">Ausverkauft</StatusBadge>}
          {r.viaTag && (
            <StatusBadge tone="neutral" dot={false} icon={<Tag />}>
              Tag
            </StatusBadge>
          )}
          {r.viaList && (
            <StatusBadge tone="accent" dot={false}>
              Liste
            </StatusBadge>
          )}
        </div>
      ),
    },
    {
      key: "link",
      header: <span className="sr-only">Im Shop</span>,
      align: "right",
      width: "3rem",
      cell: (r) =>
        r.url ? (
          <a
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex text-muted-foreground hover:text-foreground"
            aria-label={`${r.name} im Shop öffnen`}
          >
            <ExternalLink className="size-4" />
          </a>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <Section
        title="Mo im Konfigurator"
        info="Wie Mo die Beratung auf der Konfigurator-Seite führt. Die Seite selbst (Texte, Siegel, Fragen) wird im Shopify-Theme gepflegt — Abschnitt „Home-Gym-Konfigurator“."
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Dumbbell className="size-4" aria-hidden /> Beratung
              {saved.enabled ? <StatusBadge tone="success">Aktiv</StatusBadge> : <StatusBadge tone="neutral">Aus</StatusBadge>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!dbReady && (
              <Callout tone="warning" compact className="mb-4">
                Keine Datenbank konfiguriert — die Einstellungen können nicht gespeichert werden.
              </Callout>
            )}
            <form
              className="grid grid-cols-1 gap-5 lg:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!disabled && dirty && parsed.ok) void save.run();
              }}
            >
              <Field
                label="Geführte Beratung"
                info="Aktiv: Mo bekommt die Angaben der Seite, führt mit Antwort-Chips durch die offenen Fragen und stellt einen Home-Gym-Plan zusammen. Aus: Besucher der Seite chatten mit Mo wie überall im Shop — ohne Angaben, Chips und Plan."
              >
                <SegmentedControl
                  label="Geführte Beratung"
                  value={enabled ? "on" : "off"}
                  options={STATE_OPTIONS}
                  onChange={(v) => setEnabled(v === "on")}
                  disabled={disabled}
                />
              </Field>
              <Field
                label="Sortiments-Fokus"
                info="„Sortiment bevorzugen“: Mo plant vorrangig mit dem Konfigurator-Sortiment, darf aber andere Produkte aus dem Shop dazunehmen, wenn der Kunde danach fragt oder nichts passt (z. B. ein Gymnastikball). „Nur Sortiment“: Mo empfiehlt ausschließlich Sortiments-Produkte, außer der Kunde fragt ausdrücklich nach einem anderen."
              >
                <SegmentedControl<Focus>
                  label="Sortiments-Fokus"
                  value={focus}
                  options={FOCUS_OPTIONS}
                  onChange={setFocus}
                  disabled={disabled}
                />
              </Field>
              <Field
                label="Shopify-Tag des Sortiments"
                info={`Produkte mit diesem Tag gehören zum Konfigurator-Sortiment — in Shopify unter Produkte → Produkt → „Tags“ eintragen (Groß-/Kleinschreibung egal). Der Katalog-Abgleich übernimmt neue Tags beim nächsten Sync. Standard: ${DEFAULT_CONFIGURATOR_TAG}.`}
                error={tag.trim() && !parsed.ok && /Tag/.test(parsed.message) ? parsed.message : undefined}
              >
                <Input value={tag} onChange={(e) => setTag(e.target.value)} disabled={disabled} maxLength={CONFIGURATOR_LIMITS.tagMax} />
              </Field>
              <Field
                label="Zusätzliche Produkte"
                info="Produkte ohne den Tag, die trotzdem zum Sortiment gehören — z. B. zum Testen, bevor im Shop getaggt ist. Varianten werden zum Produkt zusammengefasst."
              >
                <div className="flex flex-col gap-2">
                  <CatalogProductPicker
                    showThumbnails={false}
                    maxResults={6}
                    selectLabel="hinzufügen"
                    placeholder="Produkt suchen (tippen)…"
                    ariaLabel="Produkt zum Konfigurator-Sortiment hinzufügen"
                    isSelected={(hit) => extra.some((e) => e.id === hit.productId)}
                    disableReason={() =>
                      extra.length >= CONFIGURATOR_LIMITS.extraProductIdsMax
                        ? `Höchstens ${CONFIGURATOR_LIMITS.extraProductIdsMax} Produkte`
                        : null
                    }
                    onSelect={(hit) => {
                      if (extra.some((e) => e.id === hit.productId)) return;
                      setExtra((list) => [...list, { id: hit.productId, title: hit.title }]);
                    }}
                    onError={(err) =>
                      toast({ variant: "error", title: "Suche fehlgeschlagen", description: friendlyErrorMessage(err) })
                    }
                  />
                  {extra.length > 0 && (
                    <ul className="flex flex-wrap gap-1.5" aria-label="Zusätzliche Produkte">
                      {extra.map((e) => (
                        <li key={e.id}>
                          <span className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-surface-2 pl-2.5 pr-1 text-xs">
                            <span className="max-w-[16rem] truncate">{e.title ?? e.id}</span>
                            <button
                              type="button"
                              className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                              onClick={() => setExtra((list) => list.filter((x) => x.id !== e.id))}
                              disabled={disabled}
                              aria-label={`${e.title ?? e.id} entfernen`}
                            >
                              <X className="size-3" />
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Field>
              <Field
                label="Hinweise für Mo"
                info="Kurze Anweisungen des Teams, die Mo in jeder Konfigurator-Beratung befolgt — z. B. eine laufende Aktion, ein bevorzugtes Basisgerät, ein Liefertermin-Hinweis. Keine Rechtstexte und keine Rabattcodes, die nicht freigegeben sind."
                hint={`${num(notes.length)} / ${num(CONFIGURATOR_LIMITS.notesMax)} Zeichen`}
                error={notes.length > CONFIGURATOR_LIMITS.notesMax ? `Höchstens ${num(CONFIGURATOR_LIMITS.notesMax)} Zeichen.` : undefined}
                className="lg:col-span-2"
              >
                <Textarea
                  rows={4}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={disabled}
                  placeholder="z. B. Bei wenig Platz zuerst die Wandzugstation empfehlen. Lieferung von Racks aktuell 2–3 Wochen."
                />
              </Field>
              <div className="flex items-center gap-3 lg:col-span-2">
                <Button type="submit" size="sm" loading={save.pending} disabled={!dbReady || !dirty || !parsed.ok}>
                  <Save /> Speichern
                </Button>
                {dirty && <span className="text-xs text-muted-foreground">Ungespeicherte Änderungen</span>}
              </div>
            </form>
          </CardContent>
        </Card>
      </Section>

      <Section
        title="Sortiment"
        subtitle={`${plural(assortment.length, "Produkt", "Produkte")}${soldOut ? ` · ${num(soldOut)} ausverkauft` : ""}`}
        info="Die Produkte, in denen Mo im Konfigurator primär plant: alle Produkte mit dem Shopify-Tag plus die zusätzlichen Produkte. Mo sieht die Liste kompakt (Name, Kategorie, Preis, Stellfläche, Zubehör) und holt Details per Suche. Ausverkaufte Produkte empfiehlt Mo nicht."
      >
        <div className="flex flex-col gap-3">
          {unknownExtraIds.length > 0 && (
            <Callout tone="warning" compact>
              Nicht im Katalog gefunden: {unknownExtraIds.join(", ")} — entfernen oder den Katalog-Sync abwarten.
            </Callout>
          )}
          {assortment.length > 0 && soldOut > assortment.length / 3 && (
            <Callout tone="warning" compact>
              Ein großer Teil des Sortiments ist ausverkauft — Mo weicht dann auf andere Produkte aus.
            </Callout>
          )}
          <Card>
            <DataTable
              columns={columns}
              rows={assortment}
              rowKey={(r) => r.id}
              defaultSort={{ key: "name", dir: "asc" }}
              dense
              maxHeight="32rem"
              stickyHeader
              empty={
                <EmptyState
                  compact
                  plain
                  icon={<PackageSearch />}
                  title="Noch kein Konfigurator-Sortiment"
                  description={
                    <span className="inline-flex items-center gap-1">
                      Produkte in Shopify mit dem Tag „{saved.tag}“ versehen oder oben hinzufügen. Bis dahin wählt Mo aus dem ganzen Shop.
                      <InfoTip>Neue Tags kommen mit dem nächsten Katalog-Sync (nächtlich oder per Produkt-Webhook) an.</InfoTip>
                    </span>
                  }
                />
              }
            />
          </Card>
        </div>
      </Section>
    </div>
  );
}
