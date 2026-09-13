"use client";

// The review column („Prüfung“) of the desk: blocks separated by hairlines —
// Prüfpunkte (the precomputed verdict with one fix action per check),
// Empfehlungen (thumbnails, prices, remove, „+ Produkt“), Angebot (Rabatt
// depth + Set line), Text (Sprache, Modus — the two settings that
// regenerate), Hero (only when the campaign design has a hero), Kaufhistorie
// (collapsed, with the recommendation basis) and Kontakt (facts + Verlauf).
// Explanations sit in InfoTips; every mutation goes through the desk hook.

import * as React from "react";
import { AlertTriangle, CircleCheck, ExternalLink, History, Info, Plus, X } from "lucide-react";
import { ADMIN_DATE, ADMIN_DATE_TIME_SHORT, formatAdmin } from "@/lib/admin-datetime.mjs";
import { eur, eurFromCents, money, num, plural } from "@/lib/admin-format.mjs";
import { campaignSegmentByKey } from "@/lib/campaign-segments.mjs";
import { DISCOUNT_PERCENT_MAX, clampDiscountPercent } from "@/lib/discount-validation.mjs";
import { abGroupOf } from "@/lib/campaign-review-checks.mjs";
import {
  Button,
  CatalogProductPicker,
  DescriptionItem,
  DescriptionList,
  Disclosure,
  IconButton,
  InfoTip,
  Input,
  SegmentedControl,
  Sheet,
  StatusBadge,
  Tooltip,
  cn,
  toast,
} from "../ui";
import { EmailTextModeToggle } from "../EmailTextModeToggle";
import { LanguageToggle, OptInBadge, SegmentBadge } from "./badges";
import { HeroBlock } from "./sections/HeroBlock";
import { BundleSection } from "./sections/BundleSection";
import { PurchaseHistorySection } from "./sections/PurchaseHistorySection";
import { optInShort, type CampaignQueueItemProps } from "./types";
import type { CampaignActions, ReviewCheck, ReviewVerdict } from "./useCampaignActions";

const DISCOUNT_STEPS = ["0", "5", "10", "15", "20"] as const;

function BlockHeader({
  title,
  meta,
  info,
  actions,
}: {
  title: string;
  meta?: React.ReactNode;
  info?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5">
      <span className="whitespace-nowrap text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </span>
      {meta !== undefined && meta !== null && (
        <span className="min-w-0 truncate text-2xs text-muted-foreground tabular-nums">· {meta}</span>
      )}
      {info && <InfoTip>{info}</InfoTip>}
      {actions && <span className="ml-auto flex items-center gap-1">{actions}</span>}
    </div>
  );
}

const LEVEL_ICON = {
  blocked: <AlertTriangle className="size-3.5 text-destructive" aria-label="Blockiert" />,
  hint: <AlertTriangle className="size-3.5 text-warning" aria-label="Hinweis" />,
  info: <Info className="size-3.5 text-muted-foreground" aria-label="Info" />,
} as const;

const FIX_LABEL: Record<NonNullable<ReviewCheck["fix"]>, string> = {
  skip: "Überspringen",
  regenerate: "Neu generieren",
  narrow_basis: "Basis anpassen",
  swap_products: "Produkt tauschen",
  rebuild_bundle: "Set neu erstellen",
  generate_hero: "Hero erzeugen",
  shorten_subject: "Betreff kürzen",
};

export function ReviewColumn({
  item,
  checks,
  verdict,
  actions,
  shopifyConfigured,
  heroDesignActive,
  heroDesignName,
  heroGenerationConfigured,
  minSendIntervalDays,
  onFocusSubject,
  onHistory,
}: {
  item: CampaignQueueItemProps;
  checks: ReviewCheck[];
  verdict: ReviewVerdict;
  actions: CampaignActions;
  shopifyConfigured: boolean;
  heroDesignActive: boolean;
  heroDesignName: string | null;
  heroGenerationConfigured: boolean;
  minSendIntervalDays: number;
  onFocusSubject: () => void;
  onHistory: () => void;
}) {
  const id = item.contactId;
  const busy = actions.busyOf(id);
  const locked = busy !== null && busy !== "regen";
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [customDiscount, setCustomDiscount] = React.useState<string | null>(null);
  const [bundleOpen, setBundleOpen] = React.useState(false);
  const [purchaseOpen, setPurchaseOpen] = React.useState(item.purchaseSelectedIds !== null);
  const heroRef = React.useRef<{ generate: () => void } | null>(null);

  // A new card resets the transient editors.
  React.useEffect(() => {
    setPickerOpen(false);
    setCustomDiscount(null);
    setBundleOpen(false);
    setPurchaseOpen(item.purchaseSelectedIds !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const runFix = (check: ReviewCheck) => {
    switch (check.fix) {
      case "skip":
        void actions.skip(id);
        break;
      case "regenerate":
        actions.regenerate(id);
        break;
      case "narrow_basis":
        setPurchaseOpen(true);
        break;
      case "swap_products":
        setPickerOpen(true);
        break;
      case "rebuild_bundle":
        if (item.bundle) void actions.archiveBundle(id);
        setBundleOpen(true);
        break;
      case "generate_hero":
        heroRef.current?.generate();
        break;
      case "shorten_subject":
        onFocusSubject();
        break;
      default:
        break;
    }
  };

  const recIds = item.recommendations.map((r) => r.id);
  const discountValue = DISCOUNT_STEPS.includes(String(item.discountPercent) as (typeof DISCOUNT_STEPS)[number])
    ? String(item.discountPercent)
    : "custom";
  const segment = item.segment ? campaignSegmentByKey(item.segment) : null;
  const frequency = checks.find((c) => c.key === "frequency_cap");
  const untilIso = typeof frequency?.meta?.untilIso === "string" ? frequency.meta.untilIso : null;

  return (
    <div className="flex min-h-0 flex-col divide-y divide-border overflow-y-auto rounded-lg border border-border bg-card text-sm lg:h-full">
      {/* Prüfpunkte */}
      <section className="px-3 py-2.5">
        <BlockHeader
          title="Prüfpunkte"
          info="Vorab geprüft, was der Server beim Senden ablehnen würde (blockiert) und was vor dem Senden einen Blick wert ist (Hinweis). Die Rabatt-Prüfung ist dieselbe Regel wie im Versandpfad."
        />
        <div className="mb-1.5">
          <StatusBadge
            tone={verdict === "ready" ? "success" : verdict === "hints" ? "warning" : "destructive"}
            icon={verdict === "ready" ? <CircleCheck /> : <AlertTriangle />}
          >
            {verdict === "ready"
              ? "Bereit — keine Hinweise"
              : verdict === "hints"
                ? plural(checks.filter((c) => c.level === "hint").length, "Hinweis", "Hinweise")
                : "Blockiert"}
          </StatusBadge>
        </div>
        {checks.length > 0 && (
          <ul className="space-y-1">
            {checks.map((c) => (
              <li key={c.key} className="flex items-start gap-1.5 text-xs">
                <span className="mt-0.5 shrink-0">{LEVEL_ICON[c.level]}</span>
                <span className="min-w-0 flex-1">
                  <span className={cn("font-medium", c.level === "info" && "font-normal text-muted-foreground")}>
                    {c.title}
                  </span>
                  {c.key === "frequency_cap" && untilIso && (
                    <span className="text-muted-foreground"> · bis {formatAdmin(untilIso, ADMIN_DATE)}</span>
                  )}
                  {c.detail && <InfoTip className="ml-1">{c.detail}</InfoTip>}
                </span>
                {c.fix && (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="-my-1 h-6 shrink-0 px-1.5 text-accent"
                    disabled={locked || (c.fix === "generate_hero" && !heroGenerationConfigured)}
                    onClick={() => runFix(c)}
                  >
                    {FIX_LABEL[c.fix]}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Empfehlungen */}
      <section className="px-3 py-2.5">
        <BlockHeader
          title="Empfehlungen"
          meta={num(item.recommendations.length)}
          info="Änderungen werden sofort gespeichert, ein angehängtes Set wird angepasst und der Text automatisch neu generiert."
          actions={
            <Button
              variant="ghost"
              size="xs"
              className="-my-1 h-6 px-1.5"
              aria-pressed={pickerOpen}
              disabled={locked}
              onClick={() => setPickerOpen((v) => !v)}
            >
              <Plus /> Produkt
            </Button>
          }
        />
        {item.recommendations.length === 0 ? (
          <div className="text-xs text-muted-foreground">Keine.</div>
        ) : (
          <ul className="space-y-1">
            {item.recommendations.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-xs">
                {r.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.imageUrl}
                    alt=""
                    className="size-8 shrink-0 rounded-md border border-border bg-white object-contain"
                    onError={(e) => {
                      e.currentTarget.style.visibility = "hidden";
                    }}
                  />
                ) : (
                  <span className="size-8 shrink-0 rounded-md border border-dashed border-border bg-surface-2" aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                  {r.url ? (
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex max-w-full items-center gap-1 truncate underline-offset-2 hover:underline"
                    >
                      <span className="truncate">{r.name}</span>
                      <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                    </a>
                  ) : (
                    <span className="block truncate">{r.name}</span>
                  )}
                  {r.available === false ? (
                    <StatusBadge tone="warning" className="mt-0.5">
                      Ausverkauft
                    </StatusBadge>
                  ) : r.available === null ? (
                    <StatusBadge tone="warning" className="mt-0.5">
                      Nicht im Katalog
                    </StatusBadge>
                  ) : null}
                </span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {r.price !== null ? eur(r.price) : ""}
                </span>
                <IconButton
                  label={`${r.name} entfernen`}
                  size="icon-sm"
                  className="-my-1 shrink-0 text-muted-foreground hover:text-destructive"
                  disabled={locked || item.recommendations.length <= 1}
                  onClick={() => void actions.updateRecommendations(id, recIds.filter((x) => x !== r.id))}
                >
                  <X />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        {pickerOpen && (
          <div className="mt-2">
            <CatalogProductPicker
              placeholder="Produkt hinzufügen (tippen)…"
              ariaLabel="Produkt für Empfehlung suchen"
              maxResults={6}
              showThumbnails
              onSelect={(hit, variant) => {
                const ref = variant?.variantId ? `${hit.productId}~${variant.variantId}` : hit.productId;
                if (locked || recIds.includes(ref)) return;
                void actions.updateRecommendations(id, [...recIds, ref]);
                setPickerOpen(false);
              }}
              isSelected={(hit, variant) =>
                recIds.includes(variant?.variantId ? `${hit.productId}~${variant.variantId}` : hit.productId)
              }
              disableReason={(hit, variant) => {
                if (locked) return "Speichert…";
                if (variant ? !variant.available : !hit.inStock) return "Ausverkauft";
                return null;
              }}
              onError={(err) =>
                toast({ variant: "error", title: "Katalogsuche fehlgeschlagen", description: err.message })
              }
            />
          </div>
        )}
      </section>

      {/* Angebot */}
      <section className="px-3 py-2.5">
        <BlockHeader
          title="Angebot"
          info={
            item.discountPercent > 0
              ? `Aktuell ${item.discountPercent} % — der echte MK-Code wird beim Senden erzeugt${
                  item.discountExpiresAt
                    ? ` (voraussichtlich gültig bis ${formatAdmin(item.discountExpiresAt, ADMIN_DATE)})`
                    : ""
                }. Eine Änderung generiert den Text automatisch neu.`
              : "Kein Rabatt. Eine Änderung generiert den Text automatisch neu; Code und Rabattzeile werden beim Versand angehängt."
          }
        />
        <div className="flex flex-col gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-12 shrink-0 font-medium text-muted-foreground">Rabatt</span>
            <SegmentedControl
              label="Rabatt-Tiefe"
              value={discountValue}
              disabled={locked}
              onChange={(v) => {
                if (v === "custom") {
                  setCustomDiscount(String(item.discountPercent));
                  return;
                }
                setCustomDiscount(null);
                void actions.setDiscount(id, Number(v));
              }}
              options={[
                ...DISCOUNT_STEPS.map((v) => ({ value: v as string, label: `${v} %` })),
                { value: "custom", label: discountValue === "custom" ? `${item.discountPercent} %` : "…" },
              ]}
            />
            {customDiscount !== null && (
              <form
                className="flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  const depth = clampDiscountPercent(customDiscount);
                  setCustomDiscount(null);
                  void actions.setDiscount(id, depth);
                }}
              >
                <Input
                  type="number"
                  min={0}
                  max={DISCOUNT_PERCENT_MAX}
                  value={customDiscount}
                  onChange={(e) => setCustomDiscount(e.target.value)}
                  className="h-7 w-16 text-xs"
                  aria-label="Rabatt-Tiefe in Prozent"
                  autoFocus
                />
                <Button type="submit" variant="outline" size="xs" disabled={locked}>
                  Übernehmen
                </Button>
              </form>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-12 shrink-0 font-medium text-muted-foreground">Set</span>
            {item.bundle ? (
              <>
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{item.bundle.title}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {" · "}
                    {Number.isFinite(Number(item.bundle.bundlePrice))
                      ? money(Number(item.bundle.bundlePrice), item.bundle.currency || "EUR")
                      : item.bundle.bundlePrice}
                    {Number(item.bundle.bundlePrice) < Number(item.bundle.componentsSum) &&
                      ` statt ${money(Number(item.bundle.componentsSum), item.bundle.currency || "EUR")}`}
                    {item.bundle.expiresAt ? ` · bis ${formatAdmin(item.bundle.expiresAt, ADMIN_DATE)}` : ""}
                  </span>
                </span>
                <Tooltip content={item.bundle.components.join(" + ")}>
                  <span tabIndex={0} className="text-muted-foreground">
                    <Info className="size-3.5" aria-label="Bestandteile" />
                  </span>
                </Tooltip>
                <Button
                  variant="ghost"
                  size="xs"
                  className="-my-1 h-6 px-1.5"
                  disabled={locked}
                  loading={busy === "bundle"}
                  onClick={() => void actions.archiveBundle(id)}
                >
                  Entfernen
                </Button>
              </>
            ) : (
              <Tooltip
                content={
                  !shopifyConfigured
                    ? "Shopify nicht konfiguriert — keine Set-Angebote möglich."
                    : "Keine Empfehlungen, aus denen ein Set gebaut werden könnte."
                }
                disabled={shopifyConfigured && item.recommendations.length > 0}
              >
                <span className="inline-flex">
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={locked || !shopifyConfigured || item.recommendations.length === 0}
                    onClick={() => setBundleOpen(true)}
                  >
                    Set erstellen…
                  </Button>
                </span>
              </Tooltip>
            )}
          </div>
        </div>
      </section>

      {/* Text */}
      <section className="px-3 py-2.5">
        <BlockHeader
          title="Text"
          info="Sprache und Textmodus (wie viel Fließtext die KI über den Produktkacheln schreibt) werden am Kontakt bzw. am Entwurf gespeichert; eine Änderung generiert den Text automatisch neu. Produktbilder-Raster, Mo-Hinweis, Rabattzeile und Abmelde-/Impressum-Footer werden beim Versand automatisch angehängt."
        />
        <div className="flex flex-col gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-12 shrink-0 font-medium text-muted-foreground">Sprache</span>
            <LanguageToggle
              language={item.language}
              overridden={item.languageOverride !== null}
              disabled={locked}
              onSelect={(lang) => void actions.setLanguage(id, lang)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-12 shrink-0 font-medium text-muted-foreground">Modus</span>
            <EmailTextModeToggle
              value={item.textMode}
              disabled={locked}
              onSelect={(mode) => actions.setTextMode(id, mode)}
            />
          </div>
        </div>
      </section>

      {/* Hero */}
      {heroDesignActive && (
        <section className="px-3 py-2.5">
          <HeroBlock
            ref={heroRef}
            item={item}
            designName={heroDesignName}
            generationConfigured={heroGenerationConfigured}
            locked={locked}
            onChange={(hero) => actions.setHero(id, hero)}
            onBusy={(generating) => actions.setHeroBusy(id, generating)}
          />
        </section>
      )}

      {/* Kaufhistorie */}
      <section className="px-3 py-1">
        <Disclosure
          framed={false}
          open={purchaseOpen}
          onOpenChange={setPurchaseOpen}
          title={<span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">Kaufhistorie</span>}
          meta={
            (item.purchaseSummary?.orders.length ?? 0) > 0
              ? `${plural(item.purchaseSummary?.orders.length ?? 0, "Bestellung", "Bestellungen")} · Basis: ${
                  item.purchaseSelectedIds === null ? "alle" : `${num(item.purchaseSelectedIds.length)} Käufe`
                }`
              : "keine"
          }
        >
          <PurchaseHistorySection
            summary={item.purchaseSummary}
            appliedSelection={item.purchaseSelectedIds}
            busy={locked}
            applying={busy === "selection" || busy === "regen"}
            onApply={(selection) => actions.applyPurchaseSelection(id, selection)}
          />
        </Disclosure>
      </section>

      {/* Kontakt */}
      <section className="px-3 py-2.5">
        <BlockHeader
          title="Kontakt"
          actions={
            <Button variant="ghost" size="xs" className="-my-1 h-6 px-1.5" onClick={onHistory}>
              <History /> Verlauf
            </Button>
          }
        />
        <DescriptionList columns={1} className="gap-y-2">
          <DescriptionItem
            label="Opt-in"
            info="Einwilligungsnachweis aus Shopify. Nur Double-Opt-in (DOI) ist ohne weitere Freigabe versendbar; Single-Opt-in und Unbekannt werden blockiert, solange CAMPAIGN_ALLOW_SINGLE_OPT_IN nicht gesetzt ist."
          >
            <span className="flex flex-wrap items-center gap-1.5 text-xs">
              <OptInBadge level={item.optInLevel} blocked={checks.some((c) => c.key === "opt_in")} />
              <span className="text-muted-foreground">{optInShort(item.optInLevel)}</span>
            </span>
          </DescriptionItem>
          <DescriptionItem label="Segment" info={segment?.reason ?? "Kein Kaufdatum bekannt — unverändertes Verhalten."}>
            <span className="flex flex-wrap items-center gap-1.5 text-xs">
              <SegmentBadge segment={item.segment} days={item.segmentDays} />
              {!segment && <span className="text-muted-foreground">Unbekannt</span>}
            </span>
          </DescriptionItem>
          <DescriptionItem
            label="Letzte Mail"
            info={
              minSendIntervalDays > 0
                ? `Neueste Sendung an diese Adresse über beide Kanäle (Kampagne und Kunden-Marketing). Sperrfrist: ${minSendIntervalDays} Tage (MARKETING_MIN_SEND_INTERVAL_DAYS).`
                : "Neueste Sendung an diese Adresse über beide Kanäle (Kampagne und Kunden-Marketing). Keine Sperrfrist konfiguriert."
            }
          >
            <span className="text-xs">
              {item.lastSendAt ? formatAdmin(item.lastSendAt, ADMIN_DATE_TIME_SHORT) : "noch nie"}
              {untilIso && <span className="text-destructive"> · Sperrfrist bis {formatAdmin(untilIso, ADMIN_DATE)}</span>}
            </span>
          </DescriptionItem>
          <DescriptionItem
            label="A/B-Gruppe"
            info="A/B-Test für den KI-Hero: gerade Kontakt-IDs mit Hero senden, ungerade ohne — der KPI-Bereich vergleicht beide Gruppen. Der Versand stempelt, was tatsächlich verschickt wurde."
          >
            <span className="text-xs">
              {abGroupOf(id) === "A" ? "A — mit KI-Hero" : "B — ohne Hero"}
            </span>
          </DescriptionItem>
          <DescriptionItem label="Umsatz">
            <span className="text-xs tabular-nums">
              {plural(item.ordersCount, "Bestellung", "Bestellungen")} · {eurFromCents(item.totalSpentCents)}
            </span>
          </DescriptionItem>
        </DescriptionList>
      </section>

      <Sheet
        open={bundleOpen}
        onOpenChange={setBundleOpen}
        title="Set-Angebot erstellen"
        description="Erstellt ein echtes (unlisted) Shopify-Set aus den Empfehlungen; der Text wird automatisch neu generiert und der Angebots-Block beim Versand angehängt."
        size="sm"
      >
        <BundleSection
          bundle={null}
          recommendations={item.recommendations}
          shopifyConfigured={shopifyConfigured}
          busy={locked}
          creating={busy === "bundle"}
          onCreate={(ids, price) => {
            void actions.createBundle(id, ids, price).then((ok) => ok && setBundleOpen(false));
          }}
          onArchive={() => void actions.archiveBundle(id)}
        />
      </Sheet>
    </div>
  );
}
