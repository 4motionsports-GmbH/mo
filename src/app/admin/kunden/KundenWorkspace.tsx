"use client";

// The Kunden screen: a slim, searchable/filterable list of every customer on
// the left; the selected person's full detail (loaded on demand) on the right.
// Bulk action: queue a reviewable marketing draft for many DOI-confirmed
// customers at once (nothing is sent).

import * as React from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Users, X } from "lucide-react";
import type { CustomerListRow } from "@/lib/customer-store";
import type { UnmatchedInboundMessage } from "@/lib/email-messages-store";
import {
  DEFAULT_FILTER,
  activeFilterCount,
  filterCustomers,
  presetFilter,
  sendState,
  type CustomerFilterState,
} from "@/lib/admin-customer-filter.mjs";
import {
  DISCOUNT_PERCENT_MIN,
  DISCOUNT_PERCENT_MAX,
  clampDiscountPercent,
} from "@/lib/discount-validation.mjs";
import { DEFAULT_EMAIL_TEXT_MODE } from "@/lib/email-text-mode.mjs";
import { ADMIN_DATE, formatAdmin } from "@/lib/admin-datetime.mjs";
import { num, plural } from "@/lib/admin-format.mjs";
import {
  Button,
  Callout,
  Checkbox,
  EmptyState,
  FilterBar,
  FilterGroup,
  InfoTip,
  Input,
  Label,
  SearchInput,
  Select,
  Skeleton,
  SplitPane,
  toast,
} from "../ui";
import { adminFetch, errorMessage } from "../lib/admin-fetch";
import { EmailTextModeToggle, type EmailTextModeValue } from "../EmailTextModeToggle";
import { CustomerDetail } from "./CustomerDetail";
import { UnmatchedInboundQueue } from "./UnmatchedInboundQueue";
import { MarketingStatusBadge, PurchaseBadge, SendBadge, TierBadge } from "./badges";
import { useCustomerDetail } from "./useCustomerDetail";

// Cap concurrent bulk-draft calls so a big selection can't open dozens of model
// runs at once.
const BULK_CONCURRENCY = 4;

function relativeDay(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return "heute";
  if (days === 1) return "gestern";
  if (days < 30) return `vor ${days} Tagen`;
  return formatAdmin(iso, ADMIN_DATE);
}

function syncCustomerParam(id: number | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (id === null) url.searchParams.delete("customer");
  else url.searchParams.set("customer", String(id));
  window.history.replaceState(window.history.state, "", url.toString());
}

const SELECT_CLASS = "h-8 w-auto min-w-[9rem] py-0 pr-8 text-xs";

export function KundenWorkspace({
  customers,
  unmatched,
  initialFilter,
  initialCustomerId,
}: {
  customers: CustomerListRow[];
  unmatched: UnmatchedInboundMessage[];
  /** Übersicht deep-link preset (?filter=) — seeds the filter on load. */
  initialFilter?: string;
  /** ?customer= deep link — the customer to open on load. */
  initialCustomerId: number | null;
}) {
  const router = useRouter();
  const [filter, setFilter] = React.useState<CustomerFilterState>(() =>
    presetFilter(initialFilter)
  );
  const visible = React.useMemo(() => filterCustomers(customers, filter), [customers, filter]);
  const [selectedId, setSelectedId] = React.useState<number | null>(() => {
    if (initialCustomerId !== null && customers.some((c) => c.id === initialCustomerId)) {
      return initialCustomerId;
    }
    return filterCustomers(customers, presetFilter(initialFilter))[0]?.id ?? null;
  });
  const { customer: detail, loading, error, reload } = useCustomerDetail(selectedId);
  const refresh = React.useCallback(() => {
    reload();
    router.refresh();
  }, [reload, router]);

  const selectCustomer = (id: number) => {
    setSelectedId(id);
    syncCustomerParam(id);
  };

  const set = <K extends keyof CustomerFilterState>(key: K, value: CustomerFilterState[K]) =>
    setFilter((f) => ({ ...f, [key]: value }));

  // ── Bulk draft (DOI-confirmed customers only) ─────────────────────────────
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [bulkDepth, setBulkDepth] = React.useState(0);
  const [bulkTextMode, setBulkTextMode] = React.useState<EmailTextModeValue>(
    DEFAULT_EMAIL_TEXT_MODE as EmailTextModeValue
  );
  const [bulkBusy, setBulkBusy] = React.useState(false);

  const isSelectable = (c: CustomerListRow) => c.marketingStatus === "confirmed";
  const selectableVisible = React.useMemo(() => visible.filter(isSelectable), [visible]);
  const selectedVisibleCount = selectableVisible.filter((c) => selected.has(c.id)).length;
  const allVisibleSelected =
    selectableVisible.length > 0 && selectedVisibleCount === selectableVisible.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;

  function toggleOne(id: number, next: boolean) {
    setSelected((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(id);
      else copy.delete(id);
      return copy;
    });
  }
  function toggleAllInFilter() {
    setSelected((prev) => {
      const copy = new Set(prev);
      if (allVisibleSelected) for (const c of selectableVisible) copy.delete(c.id);
      else for (const c of selectableVisible) copy.add(c.id);
      return copy;
    });
  }
  const clearSelection = () => setSelected(new Set());

  // Per-customer draft calls through a small concurrency pool with a live
  // progress toast + a partial-failure summary. NOTHING is sent — each is only
  // QUEUED as a reviewable draft (visible in that customer's Marketing sub-tab).
  async function runBulkDraft() {
    const byId = new Map(customers.map((c) => [c.id, c]));
    const ids = [...selected].filter((id) => {
      const c = byId.get(id);
      return c != null && isSelectable(c);
    });
    if (ids.length === 0 || bulkBusy) return;

    setBulkBusy(true);
    const total = ids.length;
    let done = 0;
    let ok = 0;
    const failures: Array<{ email: string; message: string }> = [];
    const progressId = toast({
      variant: "info",
      title: "Entwürfe werden erstellt…",
      description: `0 / ${total}`,
      duration: 0,
    });

    const queue = [...ids];
    async function worker() {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        try {
          // regenerate:false → an existing open draft at this depth + mode is
          // reused untouched; the server re-checks eligibility on every call.
          await adminFetch("/api/admin/customers/marketing-draft", {
            body: {
              customerId: id,
              discountPercent: bulkDepth,
              textMode: bulkTextMode,
              regenerate: false,
            },
          });
          ok += 1;
        } catch (e) {
          failures.push({ email: byId.get(id)?.email ?? `#${id}`, message: errorMessage(e) });
        } finally {
          done += 1;
          toast.update(progressId, { description: `${done} / ${total}` });
        }
      }
    }

    try {
      await Promise.all(
        Array.from({ length: Math.min(BULK_CONCURRENCY, total) }, () => worker())
      );
    } finally {
      toast.dismiss(progressId);
      if (failures.length === 0) {
        toast({
          variant: "success",
          title: "Entwürfe erstellt",
          description: `${plural(ok, "Entwurf", "Entwürfe")} zur Prüfung erstellt — sichtbar im Marketing-Tab des Kunden.`,
        });
      } else if (ok === 0) {
        toast({
          variant: "error",
          title: "Keine Entwürfe erstellt",
          description: `Alle ${total} fehlgeschlagen — z. B. ${failures[0].email}: ${failures[0].message}`,
        });
      } else {
        toast({
          variant: "warning",
          title: "Teilweise erstellt",
          description: `${ok} von ${total} erstellt, ${failures.length} fehlgeschlagen (z. B. ${failures[0].email}: ${failures[0].message}).`,
        });
      }
      clearSelection();
      setBulkBusy(false);
      refresh();
    }
  }

  const assignTargets = React.useMemo(
    () => customers.map((c) => ({ id: c.id, email: c.email })),
    [customers]
  );

  return (
    <div className="flex flex-col gap-4">
      <UnmatchedInboundQueue messages={unmatched} customers={assignTargets} />

      <FilterBar
        activeCount={activeFilterCount(filter)}
        onReset={() => setFilter({ ...DEFAULT_FILTER })}
        end={
          <span className="text-xs text-muted-foreground tabular-nums">
            {visible.length === customers.length
              ? plural(customers.length, "Kunde", "Kunden")
              : `${num(visible.length)} von ${num(customers.length)}`}
          </span>
        }
      >
        <SearchInput
          id="ms-search"
          value={filter.query}
          onValueChange={(v) => set("query", v)}
          placeholder="Name oder E-Mail"
          shortcut="/"
          size="sm"
          containerClassName="w-60"
          aria-label="Kunden suchen (Name oder E-Mail)"
        />
        <FilterGroup label="Tier" htmlFor="ms-filter-tier">
          <Select
            id="ms-filter-tier"
            value={filter.tier}
            onChange={(e) => set("tier", e.target.value as CustomerFilterState["tier"])}
            className={SELECT_CLASS}
          >
            <option value="all">Alle</option>
            <option value="3">Tier 3 · angemeldet</option>
            <option value="2">Tier 2 · E-Mail</option>
            <option value="1">Tier 1 · anonym</option>
          </Select>
        </FilterGroup>
        <FilterGroup label="Marketing" htmlFor="ms-filter-marketing">
          <Select
            id="ms-filter-marketing"
            value={filter.marketing}
            onChange={(e) => set("marketing", e.target.value as CustomerFilterState["marketing"])}
            className={SELECT_CLASS}
          >
            <option value="all">Alle</option>
            <option value="confirmed">DOI bestätigt</option>
            <option value="pending">DOI offen</option>
            <option value="none">Keine Einwilligung</option>
            <option value="unsubscribed">Abgemeldet</option>
          </Select>
        </FilterGroup>
        <FilterGroup label="Kauf" htmlFor="ms-filter-kauf">
          <Select
            id="ms-filter-kauf"
            value={filter.kauf}
            onChange={(e) => set("kauf", e.target.value as CustomerFilterState["kauf"])}
            className={SELECT_CLASS}
          >
            <option value="all">Alle</option>
            <option value="purchased">Hat gekauft</option>
            <option value="no_purchase">Nicht gekauft</option>
          </Select>
        </FilterGroup>
        <FilterGroup label="Versand" htmlFor="ms-filter-send">
          <Select
            id="ms-filter-send"
            value={filter.send}
            onChange={(e) => set("send", e.target.value as CustomerFilterState["send"])}
            className={SELECT_CLASS}
          >
            <option value="all">Alle</option>
            <option value="draft">Offener Entwurf</option>
            <option value="sent">Gesendet</option>
            <option value="none">Kein Entwurf</option>
          </Select>
        </FilterGroup>
        <FilterGroup label="Sortierung" htmlFor="ms-filter-sort">
          <Select
            id="ms-filter-sort"
            value={filter.sort}
            onChange={(e) => set("sort", e.target.value as CustomerFilterState["sort"])}
            className={SELECT_CLASS}
          >
            <option value="recent">Zuletzt aktiv</option>
            <option value="name">Name A–Z</option>
            <option value="first_seen">Älteste zuerst</option>
            <option value="sessions">Meiste Beratungen</option>
          </Select>
        </FilterGroup>
      </FilterBar>

      <SplitPane
        listWidth="md"
        listLabel="Kundenliste"
        stickyTopClassName="lg:top-[4.5rem] lg:max-h-[calc(100vh-5.5rem)]"
        list={
          <div className="flex max-h-full flex-col rounded-lg border border-border bg-card">
            {selectableVisible.length > 0 && (
              <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
                <label className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    checked={allVisibleSelected}
                    indeterminate={someVisibleSelected}
                    onChange={toggleAllInFilter}
                  />
                  <span>Alle {num(selectableVisible.length)} bestätigten auswählen</span>
                </label>
                <InfoTip>
                  Wählt alle sichtbaren Kunden mit bestätigter Marketing-Einwilligung für den
                  Sammel-Entwurf aus. Die Leiste unten erstellt dann je Kunde einen Entwurf zur
                  Prüfung — es wird nichts gesendet.
                </InfoTip>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {customers.length === 0 ? (
                <EmptyState
                  plain
                  compact
                  icon={<Users />}
                  title="Noch keine Kunden"
                  description="Ein Kunde entsteht, sobald jemand im Chat seine E-Mail-Adresse mit Einwilligung hinterlässt — anonyme Sessions bleiben unverknüpft."
                />
              ) : visible.length === 0 ? (
                <EmptyState
                  plain
                  compact
                  title="Keine Kunden für diese Suche/Filter."
                  action={
                    <Button variant="outline" size="sm" onClick={() => setFilter({ ...DEFAULT_FILTER })}>
                      Filter zurücksetzen
                    </Button>
                  }
                />
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {visible.map((c) => (
                    <CustomerRow
                      key={c.id}
                      customer={c}
                      active={c.id === selectedId}
                      onSelect={() => selectCustomer(c.id)}
                      selectable={isSelectable(c)}
                      checked={selected.has(c.id)}
                      onCheckedChange={(next) => toggleOne(c.id, next)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </div>
        }
        detail={
          selectedId === null ? (
            <EmptyState
              icon={<Users />}
              title="Kunde auswählen"
              description="Wähle links einen Kunden, um Profil, Beratungen, Käufe, Marketing, Korrespondenz und Brief zu sehen."
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
              reloading={loading}
            />
          ) : (
            <DetailSkeleton />
          )
        }
      />

      {/* Sticky bulk-draft bar (only with a selection). */}
      {selected.size > 0 && (
        <div className="sticky bottom-4 z-30">
          <div
            role="region"
            aria-label="Sammel-Entwurf für ausgewählte Kund:innen"
            className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-border bg-popover/95 px-4 py-3 text-popover-foreground shadow-lg backdrop-blur"
          >
            <span className="text-sm font-semibold tabular-nums">
              {num(selected.size)} ausgewählt
            </span>
            <div className="flex items-center gap-2">
              <Label htmlFor="ms-bulk-depth" className="text-xs text-muted-foreground">
                Rabatt (%)
              </Label>
              <Input
                id="ms-bulk-depth"
                type="number"
                inputMode="numeric"
                min={DISCOUNT_PERCENT_MIN}
                max={DISCOUNT_PERCENT_MAX}
                step={1}
                value={bulkDepth}
                disabled={bulkBusy}
                onChange={(e) => setBulkDepth(clampDiscountPercent(e.target.valueAsNumber))}
                className="h-8 w-20"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Textmodus</Label>
              <EmailTextModeToggle
                value={bulkTextMode}
                disabled={bulkBusy}
                onSelect={setBulkTextMode}
              />
            </div>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              Erstellt Entwürfe zur Prüfung — es wird nichts gesendet.
              <InfoTip>
                Je ausgewählter Kund:in wird ein Entwurf mit diesem Rabatt und Textmodus erzeugt und
                im Marketing-Tab des Kunden zur Prüfung abgelegt. Ein bestehender offener Entwurf
                bleibt unverändert.
              </InfoTip>
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={clearSelection} disabled={bulkBusy}>
                <X /> Auswahl aufheben
              </Button>
              <Button onClick={runBulkDraft} loading={bulkBusy}>
                <Sparkles /> Entwürfe erstellen
              </Button>
            </div>
          </div>
        </div>
      )}
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
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton key={i} className="h-3.5 w-16" />
        ))}
      </div>
      <Skeleton className="mt-5 h-24 w-full" />
    </div>
  );
}

function CustomerRow({
  customer,
  active,
  onSelect,
  selectable,
  checked,
  onCheckedChange,
}: {
  customer: CustomerListRow;
  active: boolean;
  onSelect: () => void;
  selectable: boolean;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
}) {
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
        aria-pressed={active}
        className={`flex cursor-pointer items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
          active ? "bg-accent-soft" : "hover:bg-secondary/70"
        }`}
      >
        {selectable && (
          <span className="mt-0.5" onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={checked}
              onChange={(e) => onCheckedChange(e.target.checked)}
              aria-label={`${customer.email} für Sammel-Entwurf auswählen`}
            />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{customer.name ?? customer.email}</span>
            <span className="ml-auto shrink-0 whitespace-nowrap text-2xs text-muted-foreground">
              {relativeDay(customer.lastSeenAt)}
            </span>
          </div>
          {customer.name && (
            <div className="truncate text-xs text-muted-foreground">{customer.email}</div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <TierBadge tier={customer.identityTier} />
            <MarketingStatusBadge status={customer.marketingStatus} />
            <PurchaseBadge state={customer.purchaseState} marketingStatus={customer.marketingStatus} />
            <SendBadge state={sendState(customer)} />
          </div>
        </div>
      </div>
    </li>
  );
}
