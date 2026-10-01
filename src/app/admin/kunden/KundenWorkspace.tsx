"use client";

// The Kunden screen: the whole customer base as a server-side list on the
// left (search, views, filters, sort and page in the URL — every change is a
// router.push, the server renders the next page), the selected person's full
// detail (loaded on demand) on the right. Chat contact and Shopify status are
// visible on every row, so „mit Mo“ vs. „ohne Mo“ is one glance.

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { ListChecks, Megaphone, SlidersHorizontal, Users } from "lucide-react";
import type { CustomerListItem, CustomerBaseSummary } from "@/lib/customer-list-store";
import {
  CHURN_FILTERS,
  CONSENT_FILTERS,
  CUSTOMER_PAGE_SIZE,
  CUSTOMER_VIEWS,
  SEGMENT_FILTERS,
  SEGMENT_LABELS,
  SORT_LABELS,
  VALUE_FILTERS,
  activeCustomerFilterCount,
  customerFilterParams,
  defaultCustomerFilter,
  type CustomerFilter,
} from "@/lib/admin-customer-filter.mjs";
import { eurFromCents, num, relativeTime } from "@/lib/admin-format.mjs";
import {
  Button,
  Callout,
  Checkbox,
  Field,
  EmptyState,
  FilterBar,
  FilterGroup,
  InfoTip,
  Pagination,
  Popover,
  SearchInput,
  Select,
  Skeleton,
  SplitPane,
  Textarea,
  toast,
} from "../ui";
import { adminFetch, errorMessage } from "../lib/admin-fetch";
import { CustomerDetail } from "./CustomerDetail";
import { ChurnBadge, CONSENT_META, ConsentBadge, MoBadge, PersonaBadge, SegmentBadge, ShopBadge, VALUE_LABELS } from "./badges";
import { useCustomerDetail } from "./useCustomerDetail";

const SELECT_CLASS = "h-8 w-auto min-w-[8.5rem] py-0 pr-8 text-xs";

const CONSENT_FILTER_LABELS: Record<string, string> = {
  subscribed: CONSENT_META.subscribed.short,
  pending: CONSENT_META.pending.short,
  unsubscribed: CONSENT_META.unsubscribed.short,
  not_subscribed: CONSENT_META.not_subscribed.short,
  blocked: "Gesperrt",
};

function syncCustomerParam(id: number | null) {
  const url = new URL(window.location.href);
  if (id === null) url.searchParams.delete("customer");
  else url.searchParams.set("customer", String(id));
  window.history.replaceState(window.history.state, "", url.toString());
}

export function KundenWorkspace({
  filter,
  items,
  total,
  summary,
  importDone,
  syncEnabled,
  personas,
  campaigns,
  initialCustomerId,
}: {
  filter: CustomerFilter;
  items: CustomerListItem[];
  total: number;
  summary: CustomerBaseSummary | null;
  /** The first Shopify import has finished. */
  importDone: boolean;
  /** SHOPIFY_CUSTOMER_SYNC_ENABLED. */
  syncEnabled: boolean;
  personas: Array<{ key: string; label: string }>;
  /** Campaigns that take recipients (not ended), the Einzelansprache first. */
  campaigns: Array<{ id: number; name: string; kind: string }>;
  /** ?customer= deep link — the customer to open on load. */
  initialCustomerId: number | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = React.useTransition();
  const [query, setQuery] = React.useState(filter.q);
  const [moreOpen, setMoreOpen] = React.useState(false);
  // Filters behind „Weitere Filter“ that deviate from the selected view.
  const viewBase = { ...defaultCustomerFilter(), ...(CUSTOMER_VIEWS[filter.view]?.set ?? {}) } as CustomerFilter;
  const moreCount = (["mo", "value", "persona", "shop", "churn"] as const).filter((k) => filter[k] !== viewBase[k]).length;
  const [selectedId, setSelectedId] = React.useState<number | null>(initialCustomerId ?? items[0]?.id ?? null);
  // Bulk: pick several people and put them into a campaign (consent is checked per person).
  const [picking, setPicking] = React.useState(false);
  const [picked, setPicked] = React.useState<Set<number>>(() => new Set());
  const [addOpen, setAddOpen] = React.useState(false);
  const [target, setTarget] = React.useState<string>(campaigns[0] ? String(campaigns[0].id) : "");
  const [note, setNote] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const pageIds = items.map((c) => c.id);
  const pickedOnPage = pageIds.filter((id) => picked.has(id)).length;
  const togglePick = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const togglePage = () =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (pickedOnPage === pageIds.length) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  async function addPicked() {
    setAdding(true);
    try {
      const res = await adminFetch<{ added: number; alreadyIn: number; noConsent: number; blocked: number; notFound: number }>(
        "/api/admin/campaigns/add-recipients",
        { body: { campaignId: target ? Number(target) : undefined, customerIds: [...picked], adminNote: note.trim() || undefined } }
      );
      const skipped = res.noConsent + res.blocked + res.notFound;
      toast({
        variant: res.added + res.alreadyIn > 0 ? "success" : "warning",
        title: `${num(res.added)} hinzugefügt`,
        description: [
          res.alreadyIn > 0 ? `${num(res.alreadyIn)} waren schon dabei` : null,
          skipped > 0 ? `${num(skipped)} übersprungen (keine Einwilligung oder gesperrt)` : null,
        ]
          .filter(Boolean)
          .join(" · ") || undefined,
      });
      setAddOpen(false);
      setPicked(new Set());
      setNote("");
      setPicking(false);
    } catch (e) {
      toast({ variant: "error", title: "Hinzufügen fehlgeschlagen", description: errorMessage(e) });
    } finally {
      setAdding(false);
    }
  }
  const { customer: detail, loading, error, reload } = useCustomerDetail(selectedId);

  const navigate = React.useCallback(
    (next: CustomerFilter) => {
      const sp = customerFilterParams(next);
      sp.set("tab", "kunden");
      if (selectedId !== null) sp.set("customer", String(selectedId));
      startTransition(() => router.push(`${pathname}?${sp.toString()}`, { scroll: false }));
    },
    [pathname, router, selectedId]
  );
  const set = <K extends keyof CustomerFilter>(key: K, value: CustomerFilter[K]) =>
    navigate({ ...filter, [key]: value, page: 1 });

  // Search as you type (debounced) — the server filters.
  React.useEffect(() => {
    if (query.trim() === filter.q) return;
    const handle = setTimeout(() => navigate({ ...filter, q: query.trim(), page: 1 }), 350);
    return () => clearTimeout(handle);
  }, [query, filter, navigate]);

  const setView = (view: string) => {
    const base = defaultCustomerFilter();
    navigate({ ...base, ...(CUSTOMER_VIEWS[view]?.set ?? {}), view, q: filter.q, sort: (CUSTOMER_VIEWS[view]?.set?.sort as CustomerFilter["sort"]) ?? filter.sort });
  };

  const refresh = React.useCallback(() => {
    reload();
    router.refresh();
  }, [reload, router]);

  const selectCustomer = (id: number) => {
    setSelectedId(id);
    syncCustomerParam(id);
  };

  const pageCount = Math.max(1, Math.ceil(total / CUSTOMER_PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      {summary && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          {[
            ["alle", "Kunden", summary.total],
            ["interessenten", "Interessenten", summary.leads],
            ["mo", "mit Mo", summary.withMo],
            ["einwilligung", "mit Einwilligung", summary.subscribed],
            ["aufgaben", "mit offenen Aufgaben", summary.withOpenTasks],
          ].map(([view, label, value]) => (
            <button
              key={view as string}
              type="button"
              onClick={() => setView(view as string)}
              className="rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <strong className="tabular-nums">{num(value as number)}</strong>{" "}
              <span className="text-muted-foreground hover:text-foreground">{label as string}</span>
            </button>
          ))}
          <InfoTip>
            Der Kundenstamm umfasst alle Shopify-Kund:innen und alle Personen, die Mo ihre E-Mail
            gegeben haben — eine Person, ein Eintrag. Kennzahlen wie Lebenszyklus und
            Abwanderungsrisiko werden nächtlich aus den Bestellungen berechnet.
          </InfoTip>
        </div>
      )}

      {!importDone && (
        <Callout tone="info" title="Shopify-Kundenstamm noch nicht übernommen">
          {syncEnabled
            ? "Die Liste zeigt bisher nur Personen aus Mo und dem früheren Newsletter-Abgleich. Den vollständigen Import startest du unter Einstellungen → Shopify-Abgleich."
            : "Der Abgleich mit Shopify ist ausgeschaltet (SHOPIFY_CUSTOMER_SYNC_ENABLED). Bis dahin zeigt die Liste nur Personen aus Mo und dem früheren Newsletter-Abgleich."}
        </Callout>
      )}

      <FilterBar
        activeCount={activeCustomerFilterCount(filter)}
        onReset={() => navigate({ ...defaultCustomerFilter(), view: filter.view, ...(CUSTOMER_VIEWS[filter.view]?.set ?? {}) })}
        end={
          <>
            <FilterGroup label="Sortierung" htmlFor="k-sort">
              <Select id="k-sort" value={filter.sort} onChange={(e) => set("sort", e.target.value as CustomerFilter["sort"])} className={SELECT_CLASS}>
                {Object.entries(SORT_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
            </FilterGroup>
            <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
              {pending ? "Lädt…" : `${num(total)} ${total === 1 ? "Person" : "Personen"}`}
            </span>
          </>
        }
      >
        <SearchInput
          id="ms-search"
          value={query}
          onValueChange={setQuery}
          placeholder="Name oder E-Mail"
          shortcut="/"
          size="sm"
          containerClassName="w-56"
          aria-label="Kunden suchen (Name oder E-Mail)"
        />
        <FilterGroup label="Ansicht" htmlFor="k-view">
          <Select id="k-view" value={filter.view} onChange={(e) => setView(e.target.value)} className={SELECT_CLASS}>
            {Object.entries(CUSTOMER_VIEWS).map(([key, v]) => (
              <option key={key} value={key}>
                {v.label}
              </option>
            ))}
          </Select>
        </FilterGroup>
        <FilterGroup label="Einwilligung" htmlFor="k-consent">
          <Select id="k-consent" value={filter.consent ?? ""} onChange={(e) => set("consent", e.target.value || null)} className={SELECT_CLASS}>
            <option value="">Alle</option>
            {CONSENT_FILTERS.map((c) => (
              <option key={c} value={c}>
                {CONSENT_FILTER_LABELS[c]}
              </option>
            ))}
          </Select>
        </FilterGroup>
        <FilterGroup label="Lebenszyklus" htmlFor="k-seg">
          <Select id="k-seg" value={filter.segment ?? ""} onChange={(e) => set("segment", e.target.value || null)} className={SELECT_CLASS}>
            <option value="">Alle</option>
            {SEGMENT_FILTERS.map((s) => (
              <option key={s} value={s}>
                {SEGMENT_LABELS[s]}
              </option>
            ))}
          </Select>
        </FilterGroup>
        <Popover
          open={moreOpen}
          onOpenChange={setMoreOpen}
          label="Weitere Filter"
          align="start"
          trigger={
            <Button variant="outline" size="sm">
              <SlidersHorizontal aria-hidden />
              Weitere Filter
              {moreCount > 0 && <span className="tabular-nums">({moreCount})</span>}
            </Button>
          }
        >
          <div className="flex w-72 flex-col gap-2">
            <FilterGroup className="grid grid-cols-[6.5rem_minmax(0,1fr)]" label="Mo" htmlFor="k-mo">
              <Select id="k-mo" value={filter.mo} onChange={(e) => set("mo", e.target.value as CustomerFilter["mo"])} className={SELECT_CLASS}>
                <option value="any">Alle</option>
                <option value="yes">Mit Mo gesprochen</option>
                <option value="no">Noch ohne Mo</option>
              </Select>
            </FilterGroup>
            <FilterGroup className="grid grid-cols-[6.5rem_minmax(0,1fr)]" label="Wert" htmlFor="k-value">
              <Select id="k-value" value={filter.value ?? ""} onChange={(e) => set("value", e.target.value || null)} className={SELECT_CLASS}>
                <option value="">Alle</option>
                {VALUE_FILTERS.map((v) => (
                  <option key={v} value={v}>
                    {VALUE_LABELS[v]}
                  </option>
                ))}
              </Select>
            </FilterGroup>
            <FilterGroup className="grid grid-cols-[6.5rem_minmax(0,1fr)]" label="Persona" htmlFor="k-persona">
              <Select id="k-persona" value={filter.persona ?? ""} onChange={(e) => set("persona", e.target.value || null)} className={SELECT_CLASS}>
                <option value="">Alle</option>
                {personas.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
                <option value="unknown">Ohne Persona</option>
              </Select>
            </FilterGroup>
            <FilterGroup className="grid grid-cols-[6.5rem_minmax(0,1fr)]" label="Shop" htmlFor="k-shop">
              <Select id="k-shop" value={filter.shop} onChange={(e) => set("shop", e.target.value as CustomerFilter["shop"])} className={SELECT_CLASS}>
                <option value="any">Alle</option>
                <option value="shopify">Shopify-Kunden</option>
                <option value="lead">Interessenten</option>
              </Select>
            </FilterGroup>
            <FilterGroup className="grid grid-cols-[6.5rem_minmax(0,1fr)]" label="Abwanderung" htmlFor="k-churn">
              <Select id="k-churn" value={filter.churn ?? ""} onChange={(e) => set("churn", e.target.value || null)} className={SELECT_CLASS}>
                <option value="">Alle</option>
                {CHURN_FILTERS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </FilterGroup>
          </div>
        </Popover>
      </FilterBar>

      <SplitPane
        listWidth="md"
        listLabel="Kundenliste"
        stickyTopClassName="lg:top-[4.5rem] lg:max-h-[calc(100vh-5.5rem)]"
        list={
          <div className="flex max-h-full flex-col rounded-lg border border-border bg-card" aria-busy={pending}>
            {items.length > 0 && (
              <div className="flex min-h-10 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
                {picking ? (
                  <>
                    <Checkbox
                      aria-label="Alle auf dieser Seite auswählen"
                      checked={pickedOnPage > 0 && pickedOnPage === pageIds.length}
                      indeterminate={pickedOnPage > 0 && pickedOnPage < pageIds.length}
                      onChange={togglePage}
                    />
                    <span className="tabular-nums text-muted-foreground">{num(picked.size)} ausgewählt</span>
                    <Popover
                      open={addOpen}
                      onOpenChange={setAddOpen}
                      label="Zur Kampagne hinzufügen"
                      align="start"
                      trigger={
                        <Button size="xs" disabled={picked.size === 0 || campaigns.length === 0}>
                          <Megaphone aria-hidden /> Zur Kampagne…
                        </Button>
                      }
                    >
                      <div className="flex w-72 flex-col gap-3">
                        <div className="flex items-center gap-1 text-sm font-semibold">
                          {num(picked.size)} Personen hinzufügen
                          <InfoTip>
                            Nur Personen mit Einwilligung in E-Mail-Werbung und ohne Sperre kommen in die Kampagne; die
                            übrigen werden übersprungen. Die Entwürfe entstehen im Prüftisch („Vorbereiten…“) — es wird
                            nichts gesendet.
                          </InfoTip>
                        </div>
                        <Field label="Kampagne" htmlFor="k-add-campaign">
                          <Select id="k-add-campaign" value={target} onChange={(e) => setTarget(e.target.value)}>
                            {campaigns.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Notiz für den KI-Texter (optional)" htmlFor="k-add-note">
                          <Textarea
                            id="k-add-note"
                            rows={3}
                            value={note}
                            maxLength={2000}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="z. B. „Nachfrage zum Rack, Zubehör für Klimmzüge anbieten“"
                          />
                        </Field>
                        <div className="flex justify-end">
                          <Button size="sm" onClick={() => void addPicked()} loading={adding} disabled={picked.size === 0}>
                            Hinzufügen
                          </Button>
                        </div>
                      </div>
                    </Popover>
                    <Button
                      size="xs"
                      variant="ghost"
                      className="ml-auto"
                      onClick={() => {
                        setPicking(false);
                        setPicked(new Set());
                      }}
                    >
                      Fertig
                    </Button>
                  </>
                ) : (
                  <Button size="xs" variant="ghost" className="ml-auto text-muted-foreground" onClick={() => setPicking(true)}>
                    <ListChecks aria-hidden /> Auswählen
                  </Button>
                )}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {items.length === 0 ? (
                <EmptyState
                  plain
                  compact
                  icon={<Users />}
                  title={total === 0 && filter.view === "alle" && !filter.q ? "Noch keine Kunden" : "Keine Kunden für diese Suche/Filter."}
                  description={
                    total === 0 && filter.view === "alle" && !filter.q
                      ? "Kunden kommen aus dem Shopify-Abgleich und aus Mo, sobald jemand seine E-Mail mit Einwilligung hinterlässt."
                      : undefined
                  }
                  action={
                    activeCustomerFilterCount(filter) > 0 || filter.view !== "alle" ? (
                      <Button variant="outline" size="sm" onClick={() => navigate(defaultCustomerFilter())}>
                        Filter zurücksetzen
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {items.map((c) => (
                    <CustomerRow
                      key={c.id}
                      customer={c}
                      active={c.id === selectedId}
                      onSelect={() => selectCustomer(c.id)}
                      picking={picking}
                      picked={picked.has(c.id)}
                      onPick={() => togglePick(c.id)}
                    />
                  ))}
                </ul>
              )}
            </div>
            {total > CUSTOMER_PAGE_SIZE && (
              <div className="border-t border-border px-3 py-2">
                <Pagination
                  compact
                  page={filter.page}
                  pageCount={pageCount}
                  total={total}
                  pageSize={CUSTOMER_PAGE_SIZE}
                  itemLabel="Kunden"
                  onPageChange={(page) => navigate({ ...filter, page })}
                />
              </div>
            )}
          </div>
        }
        detail={
          selectedId === null ? (
            <EmptyState
              icon={<Users />}
              title="Kunde auswählen"
              description="Wähle links eine Person, um Überblick, Aktivität, Käufe, Gespräche, Marketing, Korrespondenz und Brief zu sehen."
              className="min-h-[16rem]"
            />
          ) : error ? (
            <Callout
              tone="destructive"
              title="Kunde konnte nicht geladen werden"
              action={
                <Button variant="outline" size="sm" onClick={reload}>
                  Erneut versuchen
                </Button>
              }
            >
              {error}
            </Callout>
          ) : detail ? (
            <CustomerDetail
              key={detail.id}
              customer={detail}
              onRefresh={refresh}
              onErased={() => {
                setSelectedId(null);
                const url = new URL(window.location.href);
                url.searchParams.delete("customer");
                router.replace(url.pathname + url.search, { scroll: false });
              }}
              reloading={loading}
            />
          ) : (
            <DetailSkeleton />
          )
        }
      />
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card p-5" aria-busy="true" aria-label="Kunde wird geladen">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="mt-2 h-3.5 w-72" />
        </div>
        <Skeleton className="h-5 w-24" />
      </div>
      <div className="mt-5 flex gap-4 border-b border-border pb-2">
        {[1, 2, 3, 4, 5, 6, 7].map((i) => (
          <Skeleton key={i} className="h-3.5 w-16" />
        ))}
      </div>
      <Skeleton className="mt-5 h-24 w-full" />
    </div>
  );
}

function CustomerRow({
  customer: c,
  active,
  onSelect,
  picking,
  picked,
  onPick,
}: {
  customer: CustomerListItem;
  active: boolean;
  onSelect: () => void;
  picking: boolean;
  picked: boolean;
  onPick: () => void;
}) {
  return (
    <li className="flex items-start gap-1">
      {picking && (
        <Checkbox
          className="ml-2 mt-3"
          checked={picked}
          onChange={onPick}
          aria-label={`${c.name ?? c.email} auswählen`}
        />
      )}
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        className={`flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
          active ? "bg-accent-soft" : "hover:bg-secondary/70"
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{c.name ?? c.email}</span>
            {c.openTasks > 0 && (
              <span className="size-1.5 shrink-0 rounded-full bg-warning" aria-label={`${c.openTasks} offene Aufgaben`} />
            )}
            <span className="ml-auto shrink-0 whitespace-nowrap text-2xs text-muted-foreground">
              {c.lastActivityAt ? relativeTime(c.lastActivityAt) : "—"}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate">{c.name ? c.email : " "}</span>
            {c.ordersCount > 0 && (
              <span className="ml-auto shrink-0 tabular-nums">
                {num(c.ordersCount)} × · {eurFromCents(c.totalSpentCents)}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <ShopBadge isShopify={c.isShopifyCustomer} />
            <MoBadge conversations={c.conversationsCount} />
            <ConsentBadge state={c.consentState} blockReason={c.blockReason} />
            <SegmentBadge segment={c.lifecycleSegment} />
            <ChurnBadge risk={c.churnRisk} />
            <PersonaBadge persona={c.personaLabel} />
          </div>
        </div>
      </button>
    </li>
  );
}
