"use client";

// „Mo im Konfigurator“ + „Sortiment“ of the Konfigurator screen: the operator
// settings of the Home-Gym-Konfigurator (admin_settings 'configurator',
// configurator-core.mjs) — the guided consultation and the „Konfigurator-
// Rabatt“ (24.10.2026, default off) — and the curated assortment Mo works in.
// Saved together through POST /api/admin/konfigurator/settings; after a save
// the server render refreshes so the assortment list follows a changed tag or
// list. Under the assortment (2026-10-27): its product rules per row, the
// read-only rule registry „Produktregeln“ and the card „Showroom“ (own routes).

import * as React from "react";
import { useRouter } from "next/navigation";
import { BadgePercent, Dumbbell, ExternalLink, PackageSearch, Save, Store, Tag, X } from "lucide-react";
import {
  CONFIGURATOR_DISCOUNT_LIMITS,
  CONFIGURATOR_LIMITS,
  DEFAULT_CONFIGURATOR_TAG,
  RESERVED_DISCOUNT_CODE_MESSAGE,
  isDiscountEnded,
  normalizeDiscountCode,
  validateConfiguratorSettingsInput,
  type ConfiguratorDiscount,
  type ConfiguratorSettings,
} from "@/lib/configurator-core.mjs";
import { eur, num, plural } from "@/lib/admin-format.mjs";
import { isMoDiscountCode } from "@/lib/order-attribution.mjs";
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
import { ProductRulesCard } from "./ProductRulesCard";
import { ShowroomCard } from "./ShowroomCard";
import type { AssortmentRow, ProductRulesOverview, ShowroomCardData } from "./types";

type Focus = ConfiguratorSettings["focus"];
type DiscountTrigger = ConfiguratorDiscount["trigger"];

const FOCUS_OPTIONS = [
  { value: "prefer", label: "Sortiment bevorzugen" },
  { value: "only", label: "Nur Sortiment" },
] as const;

const STATE_OPTIONS = [
  { value: "on", label: "Aktiv" },
  { value: "off", label: "Aus" },
] as const;

const TRIGGER_OPTIONS = [
  { value: "start", label: "Nach dem Start der Beratung" },
  { value: "plan", label: "Beim ersten Produkt im Plan" },
] as const;

const DL = CONFIGURATOR_DISCOUNT_LIMITS;

export function KonfiguratorWorkspace({
  dbReady,
  initialSettings,
  assortment,
  unknownExtraIds,
  rulesOverview,
  showroom,
}: {
  dbReady: boolean;
  initialSettings: ConfiguratorSettings;
  assortment: AssortmentRow[];
  unknownExtraIds: string[];
  rulesOverview: ProductRulesOverview;
  showroom: ShowroomCardData;
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
  // „Konfigurator-Rabatt“
  const [discount, setDiscount] = React.useState<ConfiguratorDiscount>(initialSettings.discount);
  const setD = <K extends keyof ConfiguratorDiscount>(key: K, value: ConfiguratorDiscount[K]) =>
    setDiscount((d) => ({ ...d, [key]: value }));

  const draft = { enabled, tag, focus, notes, extraProductIds: extra.map((e) => e.id), discount };
  const parsed = validateConfiguratorSettingsInput(draft);
  const savedDiscount = saved.discount;
  const discountDirty =
    discount.enabled !== savedDiscount.enabled ||
    discount.code.trim() !== savedDiscount.code ||
    discount.title.trim() !== savedDiscount.title ||
    discount.text.trim() !== savedDiscount.text ||
    discount.terms.trim() !== savedDiscount.terms ||
    discount.trigger !== savedDiscount.trigger ||
    discount.endsOn !== savedDiscount.endsOn;
  const dirty =
    enabled !== saved.enabled ||
    tag.trim() !== saved.tag ||
    focus !== saved.focus ||
    notes.trim() !== saved.notes ||
    draft.extraProductIds.join(",") !== saved.extraProductIds.join(",") ||
    discountDirty;
  // Field-level hints of the discount (the full message stays next to „Speichern“).
  const codeReserved = isMoDiscountCode(discount.code);
  const codeInvalid = discount.code.trim() !== "" && !normalizeDiscountCode(discount.code);
  const need = (value: string) => discount.enabled && value.trim() === "";
  // „Gültig bis“ over (Europe/Berlin): the page and Mo no longer show it.
  const endedDraft = isDiscountEnded(discount.endsOn);
  const savedEnded = saved.discount.enabled && isDiscountEnded(saved.discount.endsOn);

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
        setDiscount(next.discount);
        // The page reads the offer through the settings cache (60 s) plus the response's max-age (60 s).
        const discountChanged = JSON.stringify(next.discount) !== JSON.stringify(saved.discount);
        toast({
          variant: "success",
          title: "Gespeichert",
          description: next.enabled
            ? discountChanged
              ? "Mo nutzt die neuen Einstellungen spätestens nach einer Minute, die Seite nach etwa zwei Minuten."
              : "Mo nutzt die neuen Einstellungen spätestens nach einer Minute."
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
          {/* Capped below xl so price, status, rules and the shop link fit at 1024 px. */}
          <div className="min-w-0 max-w-[26rem] xl:max-w-none">
            <div className="truncate font-medium">{r.name}</div>
            <div className="truncate font-mono text-2xs text-muted-foreground">{r.id}</div>
          </div>
        </div>
      ),
    },
    // From xl on: below, the rules column needs the room (the id line names the product).
    { key: "category", header: "Kategorie", sortValue: (r) => r.category, hideBelow: "xl", cell: (r) => r.category },
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
      key: "rules",
      header: "Regeln",
      sortValue: (r) => r.rules.length + (r.showroom ? 1 : 0) + (r.ruleMetafield ? 1 : 0),
      defaultDir: "desc",
      cell: (r) =>
        r.rules.length || r.showroom || r.ruleMetafield ? (
          <div className="flex flex-wrap gap-1">
            {r.rules.map((label) => (
              <StatusBadge key={label} tone="info" dot={false}>
                {label}
              </StatusBadge>
            ))}
            {r.ruleMetafield && (
              <StatusBadge tone="neutral" dot={false}>
                Metafeld
              </StatusBadge>
            )}
            {r.showroom && (
              <StatusBadge tone="accent" dot={false} icon={<Store />}>
                Showroom
              </StatusBadge>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
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
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!disabled && dirty && parsed.ok) void save.run();
          }}
        >
          {!dbReady && (
            <Callout tone="warning" compact>
              Keine Datenbank konfiguriert — die Einstellungen können nicht gespeichert werden.
            </Callout>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Dumbbell className="size-4" aria-hidden /> Beratung
                {saved.enabled ? <StatusBadge tone="success">Aktiv</StatusBadge> : <StatusBadge tone="neutral">Aus</StatusBadge>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
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
                          <li key={e.id} className="max-w-full">
                            <span className="inline-flex h-7 max-w-full items-center gap-1 rounded-full border border-border bg-surface-2 pl-2.5 pr-1 text-xs">
                              <span className="min-w-0 max-w-[16rem] truncate">{e.title ?? e.id}</span>
                              <button
                                type="button"
                                className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
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
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                <BadgePercent className="size-4" aria-hidden /> Konfigurator-Rabatt
                {savedEnded ? (
                  <StatusBadge tone="warning">Abgelaufen</StatusBadge>
                ) : saved.discount.enabled ? (
                  <StatusBadge tone="success">Aktiv</StatusBadge>
                ) : (
                  <StatusBadge tone="neutral">Aus</StatusBadge>
                )}
                <InfoTip panelClassName="max-w-md">
                  Ein Rabatt für Besucher des Konfigurators: Die Seite zeigt ihn als Pop-up (mit „Code kopieren“ und „Rabatt
                  aktivieren“) und danach als Hinweis über dem Plan; Mo nennt ihn, wenn es um Preis, Budget oder den Warenkorb
                  geht. Standard: Aus. Den Code zuerst in Shopify unter Rabatte anlegen — genau dieser Code, derselbe Wert und
                  dieselben Bedingungen wie hier. Mo legt keinen Code an und prüft ihn nicht; abgezogen wird er von Shopify an
                  der Kasse.
                </InfoTip>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {discount.enabled && !enabled && (
                <Callout tone="warning" compact className="mb-4">
                  Der Rabatt erscheint erst, wenn „Geführte Beratung“ aktiv ist.
                </Callout>
              )}
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <Field
                  label="Konfigurator-Rabatt"
                  info="Aktiv: Die Konfigurator-Seite zeigt das Pop-up, und Mo kennt den Rabatt. Aus: kein Pop-up, Mo erwähnt keinen Konfigurator-Rabatt. Eine Änderung erreicht die Seite nach spätestens etwa zwei Minuten."
                >
                  <SegmentedControl
                    label="Konfigurator-Rabatt"
                    value={discount.enabled ? "on" : "off"}
                    options={STATE_OPTIONS}
                    onChange={(v) => setD("enabled", v === "on")}
                    disabled={disabled}
                  />
                </Field>
                <Field
                  label="Zeitpunkt"
                  info="„Nach dem Start der Beratung“: etwa eine Sekunde nach „Weiter – Mo berät mich“. „Beim ersten Produkt im Plan“: sobald das erste Produkt im Plan auf der Seite landet. Das Pop-up kommt je Browser und Code nur einmal; danach bleibt der Hinweis über dem Plan."
                >
                  <SegmentedControl<DiscountTrigger>
                    label="Zeitpunkt"
                    value={discount.trigger}
                    options={TRIGGER_OPTIONS}
                    onChange={(v) => setD("trigger", v)}
                    disabled={disabled}
                    className="max-w-full flex-wrap"
                  />
                </Field>
                <Field
                  label="Rabattcode"
                  required={discount.enabled}
                  info={`Muss in Shopify unter Rabatte genau so angelegt sein — mit demselben Wert und denselben Bedingungen wie unten beschrieben. ${DL.codeMin}–${DL.codeMax} Zeichen: Buchstaben, Ziffern, „-“ und „_“. „Rabatt aktivieren“ auf der Seite hinterlegt den Code über motionsports.de/discount/<Code> für die Kasse. Nicht mit MK- oder MS5- beginnen: Diese Anfänge stehen für Mos eigene Einmal-Codes, die Bestell-Zuordnung zählt jede Bestellung damit als Mos.`}
                  error={
                    codeReserved
                      ? RESERVED_DISCOUNT_CODE_MESSAGE
                      : codeInvalid
                        ? `${DL.codeMin}–${DL.codeMax} Zeichen: nur Buchstaben, Ziffern, „-“ und „_“.`
                        : need(discount.code)
                          ? "Zum Aktivieren nötig."
                          : undefined
                  }
                >
                  <Input
                    value={discount.code}
                    onChange={(e) => setD("code", e.target.value)}
                    disabled={disabled}
                    maxLength={DL.codeMax}
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono"
                    placeholder="z. B. HOMEGYM5"
                  />
                </Field>
                <Field
                  label="Überschrift"
                  required={discount.enabled}
                  info="Die große Zeile im Pop-up und im Hinweis über dem Plan."
                  hint={`${num(discount.title.length)} / ${num(DL.titleMax)} Zeichen`}
                  error={need(discount.title) ? "Zum Aktivieren nötig." : undefined}
                >
                  <Input
                    value={discount.title}
                    onChange={(e) => setD("title", e.target.value)}
                    disabled={disabled}
                    maxLength={DL.titleMax}
                    placeholder="z. B. 5 % auf deinen Home-Gym-Plan"
                  />
                </Field>
                <Field
                  label="Text"
                  info="Der Satz im Pop-up unter der Überschrift (optional)."
                  hint={`${num(discount.text.length)} / ${num(DL.textMax)} Zeichen`}
                  className="lg:col-span-2"
                >
                  <Textarea
                    rows={2}
                    value={discount.text}
                    onChange={(e) => setD("text", e.target.value)}
                    disabled={disabled}
                    maxLength={DL.textMax}
                    placeholder="z. B. Als Dankeschön fürs Planen mit Mo: 5 % auf deine Bestellung."
                  />
                </Field>
                <Field
                  label="Bedingungen"
                  required={discount.enabled}
                  info="Klein unter dem Text im Pop-up und im Hinweis über dem Plan; Mo nennt sie zusammen mit dem Code und verspricht nie mehr. Preisangaben: Die Bedingungen vollständig angeben — Mindestbestellwert, Laufzeit, ausgenommene Produkte, ob mit anderen Rabatten kombinierbar."
                  hint={`${num(discount.terms.length)} / ${num(DL.termsMax)} Zeichen`}
                  error={need(discount.terms) ? "Zum Aktivieren nötig." : undefined}
                  className="lg:col-span-2"
                >
                  <Textarea
                    rows={2}
                    value={discount.terms}
                    onChange={(e) => setD("terms", e.target.value)}
                    disabled={disabled}
                    maxLength={DL.termsMax}
                    placeholder="z. B. Ab 500 € Bestellwert, bis 31.12.2026, nicht mit anderen Rabatten kombinierbar."
                  />
                </Field>
                <Field
                  label="Gültig bis"
                  info="Optional: der letzte Tag des Rabatts (deutsche Zeit) — dasselbe Enddatum wie in Shopify und in den Bedingungen. Ab 0 Uhr am Tag danach zeigen die Seite und Mo den Rabatt nicht mehr, auch wenn er hier aktiv bleibt. Leer: ohne Enddatum (dann von Hand auf „Aus“ stellen)."
                  hint={endedDraft ? "Abgelaufen — die Seite und Mo zeigen den Rabatt nicht mehr." : undefined}
                >
                  <Input
                    type="date"
                    value={discount.endsOn}
                    onChange={(e) => setD("endsOn", e.target.value)}
                    disabled={disabled}
                    className="max-w-[12rem]"
                  />
                </Field>
                {(discount.title.trim() || discount.code.trim()) && (
                  <div className="lg:col-span-2">
                    <DiscountPreview discount={discount} />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="sm" loading={save.pending} disabled={!dbReady || !dirty || !parsed.ok}>
              <Save /> Speichern
            </Button>
            {dirty && parsed.ok && <span className="text-xs text-muted-foreground">Ungespeicherte Änderungen</span>}
            {dirty && !parsed.ok && (
              <span className="text-xs text-destructive" role="status">
                {parsed.message}
              </span>
            )}
          </div>
        </form>
      </Section>

      <Section
        title="Sortiment"
        subtitle={`${plural(assortment.length, "Produkt", "Produkte")}${soldOut ? ` · ${num(soldOut)} ausverkauft` : ""}`}
        info="Die Produkte, in denen Mo im Konfigurator primär plant: alle Produkte mit dem Shopify-Tag plus die zusätzlichen Produkte. Mo sieht die Liste kompakt (Name, Kategorie, Preis, Stellfläche, Zubehör, Produktregeln, Showroom) und holt Details per Suche. Ausverkaufte Produkte empfiehlt Mo nicht. „Regeln“: was für das Produkt gilt — z. B. „paarweise“ (Menge 2, 4, …), „1 m²/Stk“ (Bodenschutz, gerechnet auf die Raumfläche), „Metafeld“ (eigene Regel aus Shopify), „Showroom“ (dort ausgestellt)."
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
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
            <ProductRulesCard overview={rulesOverview} />
            <ShowroomCard dbReady={dbReady} initial={showroom} />
          </div>
        </div>
      </Section>
    </div>
  );
}

/** How the page's pop-up reads — simplified, in the admin's tokens (the page has its own design). */
function DiscountPreview({ discount }: { discount: ConfiguratorDiscount }) {
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        Vorschau
        <InfoTip>
          Vereinfacht — auf der Seite im Design des Konfigurators, mit „Code kopieren“, „Rabatt aktivieren“ und einem
          Schließen-Knopf; danach als schmaler Hinweis über dem Plan.
        </InfoTip>
      </figcaption>
      <div className="max-w-md rounded-lg border border-border bg-surface-2 p-4">
        <div className="text-2xs font-semibold uppercase tracking-wide text-accent">Dein Konfigurator-Vorteil</div>
        <div className="mt-1 text-base font-semibold text-foreground">{discount.title.trim() || "Überschrift"}</div>
        {discount.text.trim() && <p className="mt-1 text-sm text-foreground">{discount.text.trim()}</p>}
        <div className="mt-3 inline-flex items-center rounded-md border border-dashed border-border bg-card px-3 py-1.5 font-mono text-sm text-foreground">
          {discount.code.trim() || "CODE"}
        </div>
        {discount.terms.trim() && <p className="mt-3 text-2xs text-muted-foreground">{discount.terms.trim()}</p>}
      </div>
    </figure>
  );
}
