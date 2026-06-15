"use client";

// The merged "Kunden" workspace — one place for everything customer-related
// (the old Kunden + Marketing tabs combined). A compact, searchable, filterable
// LIST on the left; the selected customer's full detail (sub-tabbed
// CustomerProfileCard) on the right. Marketing is no longer a separate tab: it is
// a per-customer sub-tab, a filter preset ("DOI bestätigt", "beraten, nicht
// gekauft"), and the bulk-draft action below — preserving the one capability the
// old Marketing tab uniquely had (draft to many contacts at once).
//
// Scales to many clients: only ONE customer's detail renders at a time (vs. the
// old wall of giant cards), and search/filter narrow the list fast.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Sparkles, X } from "lucide-react";
import {
  Badge,
  type BadgeProps,
  Button,
  Card,
  Checkbox,
  Input,
  Label,
  Select,
  toast,
} from "./ui";
import {
  DISCOUNT_PERCENT_MIN,
  DISCOUNT_PERCENT_MAX,
  clampDiscountPercent,
} from "@/lib/discount-validation.mjs";
import { CustomerProfileCard, type CustomerProps } from "./CustomerProfileCard";
import { UnmatchedInboundQueue } from "./UnmatchedInboundQueue";
import {
  DEFAULT_FILTER,
  presetFilter,
  filterCustomers,
  isFilterActive,
  purchaseState,
  sendState,
  type CustomerFilterState,
} from "./customer-filter";

// Cap concurrent bulk-draft calls so a big selection can't open dozens of model
// runs at once (mirrors the old Marketing list).
const BULK_CONCURRENCY = 4;

type UnmatchedProps = React.ComponentProps<typeof UnmatchedInboundQueue>;

const MARKETING_BADGE: Record<
  CustomerProps["marketingStatus"],
  { label: string; variant: BadgeProps["variant"] } | null
> = {
  confirmed: { label: "Marketing", variant: "success" },
  pending: { label: "DOI offen", variant: "secondary" },
  unsubscribed: { label: "Abgemeldet", variant: "destructive" },
  none: null,
};

function relativeDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "heute";
  if (days === 1) return "gestern";
  if (days < 30) return `vor ${days} Tagen`;
  return d.toLocaleDateString("de-DE");
}

export function KundenWorkspace({
  customers,
  unmatched,
  assignTargets,
  bestandskundenCount,
  bestandskundenApproved,
  initialFilter,
}: {
  customers: CustomerProps[];
  unmatched: UnmatchedProps["messages"];
  assignTargets: UnmatchedProps["customers"];
  bestandskundenCount: number;
  bestandskundenApproved: boolean;
  /** Overview deep-link preset (?filter=) — seeds the filter on load. */
  initialFilter?: string;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<CustomerFilterState>(() => presetFilter(initialFilter));
  const [selectedId, setSelectedId] = useState<number | null>(customers[0]?.id ?? null);

  // Bulk-draft selection (confirmed-marketing customers only) + the shared depth.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkDepth, setBulkDepth] = useState(0);
  const [bulkBusy, setBulkBusy] = useState(false);

  const visible = useMemo(() => filterCustomers(customers, filter), [customers, filter]);
  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedId) ?? null,
    [customers, selectedId]
  );

  const set = <K extends keyof CustomerFilterState>(key: K, value: CustomerFilterState[K]) =>
    setFilter((f) => ({ ...f, [key]: value }));

  // Bulk select is offered only for marketing-confirmed customers (the draft
  // endpoint refuses the rest server-side anyway).
  const isSelectable = (c: CustomerProps) => c.marketingStatus === "confirmed";
  const selectableVisible = useMemo(() => visible.filter(isSelectable), [visible]);
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
  function clearSelection() {
    setSelected(new Set());
  }

  async function draftOne(customerId: number): Promise<void> {
    const res = await fetch("/api/admin/customers/marketing-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // regenerate:false → an existing open draft at this depth is reused
      // untouched; the server re-checks eligibility on every call.
      body: JSON.stringify({ customerId, discountPercent: bulkDepth, regenerate: false }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        (json as { error?: { message?: string } })?.error?.message ?? `Fehler (${res.status})`
      );
    }
  }

  // Per-customer draft calls through a small concurrency pool with a live progress
  // toast + a partial-failure summary. NOTHING is sent — each is only QUEUED as a
  // reviewable draft (visible in that customer's Marketing sub-tab).
  async function runBulkDraft() {
    const ids = [...selected].filter((id) => {
      const c = customers.find((x) => x.id === id);
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
        const c = customers.find((x) => x.id === id);
        try {
          await draftOne(id);
          ok += 1;
        } catch (e) {
          failures.push({
            email: c?.email ?? `#${id}`,
            message: e instanceof Error ? e.message : "Unbekannter Fehler",
          });
        } finally {
          done += 1;
          toast.update(progressId, { description: `${done} / ${total}` });
        }
      }
    }

    try {
      await Promise.all(Array.from({ length: Math.min(BULK_CONCURRENCY, total) }, () => worker()));
    } finally {
      toast.dismiss(progressId);
      if (failures.length === 0) {
        toast({
          variant: "success",
          title: "Entwürfe erstellt",
          description: `${ok} Entwurf/Entwürfe zur Prüfung erstellt — sichtbar im Marketing-Tab des Kunden.`,
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
      router.refresh();
    }
  }

  return (
    <div>
      {/* Global triage: received mail from an unknown address (not per-customer). */}
      <UnmatchedInboundQueue messages={unmatched} customers={assignTargets} />

      {/* ── Toolbar: search + filters ─────────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="min-w-[14rem] flex-1">
          <Label htmlFor="ms-search" className="mb-1 block text-xs text-muted-foreground">
            Suche (Name / E-Mail)
          </Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="ms-search"
              value={filter.query}
              onChange={(e) => set("query", e.target.value)}
              placeholder="z. B. müller oder @gmail"
              className="pl-8"
            />
          </div>
        </div>

        <FilterSelect
          label="Tier"
          value={filter.tier}
          onChange={(v) => set("tier", v as CustomerFilterState["tier"])}
          options={[
            ["all", "Alle"],
            ["3", "Tier 3 · angemeldet"],
            ["2", "Tier 2 · E-Mail"],
            ["1", "Tier 1 · anonym"],
          ]}
        />
        <FilterSelect
          label="Marketing"
          value={filter.marketing}
          onChange={(v) => set("marketing", v as CustomerFilterState["marketing"])}
          options={[
            ["all", "Alle"],
            ["confirmed", "DOI bestätigt"],
            ["pending", "DOI offen"],
            ["none", "Keine Einwilligung"],
            ["unsubscribed", "Abgemeldet"],
          ]}
        />
        <FilterSelect
          label="Kauf"
          value={filter.kauf}
          onChange={(v) => set("kauf", v as CustomerFilterState["kauf"])}
          options={[
            ["all", "Alle"],
            ["purchased", "Hat gekauft"],
            ["no_purchase", "Nicht gekauft"],
          ]}
        />
        <FilterSelect
          label="Versand"
          value={filter.send}
          onChange={(v) => set("send", v as CustomerFilterState["send"])}
          options={[
            ["all", "Alle"],
            ["draft", "Offener Entwurf"],
            ["sent", "Gesendet"],
            ["none", "Kein Entwurf"],
          ]}
        />
        <FilterSelect
          label="Sortierung"
          value={filter.sort}
          onChange={(v) => set("sort", v as CustomerFilterState["sort"])}
          options={[
            ["recent", "Zuletzt aktiv"],
            ["name", "Name A–Z"],
            ["first_seen", "Älteste zuerst"],
            ["sessions", "Meiste Sessions"],
          ]}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={filter.bestandskunde}
            onChange={(e) => set("bestandskunde", e.target.checked)}
          />
          Nur Bestandskunden (§7 Abs. 3) · {bestandskundenCount}
          {!bestandskundenApproved && (
            <Badge variant="warning" title="BESTANDSKUNDE_SENDS_APPROVED ist aus">
              Versand gesperrt
            </Badge>
          )}
        </label>
        <p className="text-sm text-muted-foreground">
          {visible.length === customers.length
            ? `${customers.length} Kund(en)`
            : `${visible.length} von ${customers.length}`}
        </p>
        {isFilterActive(filter) && (
          <Button variant="ghost" size="sm" onClick={() => setFilter({ ...DEFAULT_FILTER })}>
            <X /> Filter zurücksetzen
          </Button>
        )}
        {selectableVisible.length > 0 && (
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={allVisibleSelected}
              indeterminate={someVisibleSelected}
              onChange={toggleAllInFilter}
            />
            Alle bestätigten ({selectableVisible.length}) für Sammel-Entwurf
          </label>
        )}
      </div>

      {/* ── Master–detail ─────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        {/* Compact list */}
        <div className="max-h-[60vh] overflow-y-auto rounded-xl border border-border bg-card/40 p-1.5 lg:sticky lg:top-4 lg:max-h-[calc(100vh-7rem)]">
          {visible.length === 0 ? (
            <p className="px-2 py-4 text-sm text-muted-foreground">
              Keine Kunden für diese Suche/Filter.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {visible.map((c) => (
                <CustomerRow
                  key={c.id}
                  customer={c}
                  active={c.id === selectedId}
                  onSelect={() => setSelectedId(c.id)}
                  selectable={isSelectable(c)}
                  checked={selected.has(c.id)}
                  onCheckedChange={(next) => toggleOne(c.id, next)}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Detail — the selected customer (sub-tabbed). Keyed by id so switching
            customers gives a fresh card (no edit bleed / sub-tab carry-over). */}
        <div className="min-w-0">
          {selectedCustomer ? (
            <CustomerProfileCard key={selectedCustomer.id} customer={selectedCustomer} />
          ) : (
            <Card className="flex min-h-[12rem] items-center justify-center p-8 text-sm text-muted-foreground">
              Wähle links einen Kunden, um Profil, Käufe, Marketing &amp; mehr zu sehen.
            </Card>
          )}
        </div>
      </div>

      {/* Sticky bulk-draft bar (only with a selection). */}
      {selected.size > 0 && (
        <div className="sticky bottom-4 z-30 mt-4">
          <div
            role="region"
            aria-label="Sammel-Entwurf für ausgewählte Kund:innen"
            className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-border bg-popover/95 px-4 py-3 text-popover-foreground shadow-lg backdrop-blur"
          >
            <span className="text-sm font-semibold">{selected.size} ausgewählt</span>
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
                className="w-20"
              />
            </div>
            <p className="order-last w-full text-xs text-muted-foreground sm:order-none sm:w-auto sm:flex-1 sm:min-w-[12rem]">
              Erstellt je Kund:in einen Entwurf zur Prüfung — es wird{" "}
              <strong className="text-foreground">nichts gesendet</strong>.
            </p>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={clearSelection} disabled={bulkBusy}>
                <X /> Auswahl aufheben
              </Button>
              <Button onClick={runBulkDraft} disabled={bulkBusy}>
                <Sparkles /> {bulkBusy ? "Erstelle…" : "Entwürfe erstellen"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <div className="w-[10.5rem]">
      <Label className="mb-1 block text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
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
  customer: CustomerProps;
  active: boolean;
  onSelect: () => void;
  selectable: boolean;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
}) {
  const marketing = MARKETING_BADGE[customer.marketingStatus];
  const purchase = purchaseState(customer);
  const send = sendState(customer);

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
        className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${
          active
            ? "border-primary/40 bg-secondary"
            : "border-transparent hover:border-border hover:bg-secondary/60"
        }`}
      >
        {selectable && (
          <span
            className="mt-0.5"
            // The checkbox toggles bulk selection without changing the open detail.
            onClick={(e) => e.stopPropagation()}
          >
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
            <Badge variant={customer.identityTier === 3 ? "info" : "secondary"} className="shrink-0">
              T{customer.identityTier}
            </Badge>
          </div>
          {customer.name && (
            <div className="truncate text-xs text-muted-foreground">{customer.email}</div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {marketing && (
              <Badge variant={marketing.variant} className="text-[10px]">
                {marketing.label}
              </Badge>
            )}
            {purchase === "purchased" && (
              <Badge variant="secondary" className="text-[10px]">
                ✓ gekauft
              </Badge>
            )}
            {purchase === "no_purchase" && customer.marketingStatus === "confirmed" && (
              <Badge variant="accent" className="text-[10px]">
                ★ nicht gekauft
              </Badge>
            )}
            {send === "draft" && (
              <Badge variant="info" className="text-[10px]">
                Entwurf
              </Badge>
            )}
            {send === "sent" && (
              <Badge variant="success" className="text-[10px]">
                Gesendet
              </Badge>
            )}
          </div>
        </div>
        <span className="shrink-0 whitespace-nowrap pt-0.5 text-[11px] text-muted-foreground">
          {relativeDate(customer.lastSeenAt)}
        </span>
      </div>
    </li>
  );
}
