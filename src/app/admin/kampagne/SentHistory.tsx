"use client";

// "Gesendet": the 30-day delivery strip (pure DB — redemption and revenue stay
// on the KPI screen with its Shopify cache), then the paged, searchable
// campaign send history with delivery-state chips, delivery state (Resend
// webhook signals), redemption status (looked up for the visible page only)
// and the retained content viewer. Data comes from GET /api/admin/campaign/history.

import * as React from "react";
import { ArrowRight, Eye, Mail } from "lucide-react";
import Link from "next/link";
import { ADMIN_DATE_TIME_SHORT, formatAdmin } from "@/lib/admin-datetime.mjs";
import { num, ratio } from "@/lib/admin-format.mjs";
import { pageCount } from "@/lib/admin-table.mjs";
import { HISTORY_DELIVERY_FILTERS } from "@/lib/campaign-desk-core.mjs";
import {
  Button,
  Callout,
  DataTable,
  EmptyState,
  FilterBar,
  FilterGroup,
  Input,
  Pagination,
  SearchInput,
  Stat,
  StatusBadge,
  Tooltip,
  cn,
  type DataTableColumn,
  type StatusTone,
} from "../ui";
import { adminFetch, errorMessage } from "../lib/admin-fetch";
import type { CampaignHistoryItemProps, CampaignSentSummaryProps, DeliveryFilter } from "./types";

interface HistoryPage {
  rows: CampaignHistoryItemProps[];
  total: number;
  page: number;
  pageSize: number;
}

export function deliveryState(h: CampaignHistoryItemProps): { label: string; tone: StatusTone; detail?: string } {
  if (h.sentVia === "copy") return { label: "Kopiert", tone: "neutral", detail: "Manuell kopiert — keine Zustelldaten." };
  if (h.bouncedAt) {
    return {
      label: "Bounce",
      tone: "destructive",
      detail: `${h.bounceType ?? "unbekannter Typ"} · ${formatAdmin(h.bouncedAt, ADMIN_DATE_TIME_SHORT)}`,
    };
  }
  if (h.complainedAt) return { label: "Beschwerde", tone: "warning", detail: formatAdmin(h.complainedAt, ADMIN_DATE_TIME_SHORT) };
  if (h.clickedAt) return { label: "Geklickt", tone: "accent", detail: `Erster Klick ${formatAdmin(h.clickedAt, ADMIN_DATE_TIME_SHORT)}` };
  if (h.deliveredAt) return { label: "Zugestellt", tone: "success", detail: formatAdmin(h.deliveredAt, ADMIN_DATE_TIME_SHORT) };
  return { label: "Gesendet", tone: "neutral", detail: "Noch keine Zustellbestätigung." };
}

/** The pure-DB 30-day strip above the table. */
function DeliveryStrip({ summary }: { summary: CampaignSentSummaryProps }) {
  const pctOf = (n: number, base: number) => (base > 0 ? ratio(n / base, 0) : "—");
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      <Stat size="sm" label={`Gesendet · ${num(summary.days)} Tage`} value={num(summary.sent)} />
      <Stat
        size="sm"
        label="Zugestellt"
        value={pctOf(summary.delivered, summary.sent)}
        hint={`${num(summary.delivered)} von ${num(summary.sent)}`}
        info="Anteil der Sendungen mit Zustellbestätigung (Resend-Webhook) an allen Sendungen der letzten 30 Tage."
      />
      <Stat
        size="sm"
        label="Geklickt"
        value={pctOf(summary.clicked, summary.tracked)}
        hint={`${num(summary.clicked)} von ${num(summary.tracked)} mit Link`}
        info="Erster Klick auf den getrackten Mo-Link, bezogen auf Sendungen, die einen solchen Link enthielten."
      />
      <Stat size="sm" label="Bounces (hart)" value={num(summary.bouncedHard)} />
      <Stat size="sm" label="Beschwerden" value={num(summary.complained)} />
      <Stat size="sm" label="Abmeldungen" value={num(summary.unsubscribed)} />
    </div>
  );
}

export function SentHistory({
  initialTotal,
  summary,
  viewBusy,
  onView,
}: {
  initialTotal: number;
  summary: CampaignSentSummaryProps | null;
  viewBusy: boolean;
  onView: (h: CampaignHistoryItemProps) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [delivery, setDelivery] = React.useState<DeliveryFilter>("all");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [data, setData] = React.useState<HistoryPage | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const handle = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(handle);
  }, [query]);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const sp = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (debounced) sp.set("q", debounced);
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    if (delivery !== "all") sp.set("delivery", delivery);
    adminFetch<HistoryPage>(`/api/admin/campaign/history?${sp.toString()}`, { signal: controller.signal })
      .then((json) => {
        if (controller.signal.aborted) return;
        setData(json);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(err));
        setLoading(false);
      });
    return () => controller.abort();
  }, [debounced, from, to, delivery, page, pageSize]);

  const activeFilters = (debounced ? 1 : 0) + (from ? 1 : 0) + (to ? 1 : 0) + (delivery !== "all" ? 1 : 0);
  const total = data?.total ?? initialTotal;
  const rows = data?.rows ?? [];

  const columns: DataTableColumn<CampaignHistoryItemProps>[] = [
    {
      key: "email",
      header: "Empfänger",
      cell: (h) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="font-medium">{h.email}</span>
          {h.isTest && (
            <StatusBadge tone="accent" dot={false}>
              Test
            </StatusBadge>
          )}
        </span>
      ),
    },
    {
      key: "subject",
      header: "Betreff",
      cell: (h) => <span className="block max-w-[22rem] truncate text-muted-foreground">{h.subject ?? "—"}</span>,
    },
    {
      key: "delivery",
      header: "Zustellung",
      width: "8rem",
      cell: (h) => {
        const state = deliveryState(h);
        return (
          <Tooltip content={state.detail ?? ""} disabled={!state.detail}>
            <StatusBadge tone={state.tone} tabIndex={0}>
              {state.label}
            </StatusBadge>
          </Tooltip>
        );
      },
    },
    {
      key: "code",
      header: "Code",
      width: "9rem",
      cell: (h) => (h.discountCode ? <code className="text-xs">{h.discountCode}</code> : "—"),
    },
    {
      key: "redeemed",
      header: "Eingelöst",
      width: "6rem",
      align: "center",
      cell: (h) =>
        h.discountCode === null ? (
          <span className="text-muted-foreground">—</span>
        ) : h.redeemed === null ? (
          <Tooltip content="Einlösung unbekannt (Shopify nicht erreichbar oder nicht konfiguriert).">
            <span tabIndex={0} className="text-muted-foreground">?</span>
          </Tooltip>
        ) : h.redeemed ? (
          <StatusBadge tone="success" dot={false}>ja</StatusBadge>
        ) : (
          <span className="text-muted-foreground">nein</span>
        ),
    },
    {
      key: "hero",
      header: "Hero",
      width: "6rem",
      hideBelow: "xl",
      cell: (h) => <span className="text-xs text-muted-foreground">{h.heroVariant ?? "—"}</span>,
    },
    {
      key: "sentAt",
      header: "Gesendet",
      width: "9rem",
      cell: (h) => <span className="text-muted-foreground tabular-nums">{formatAdmin(h.sentAt, ADMIN_DATE_TIME_SHORT)}</span>,
    },
    {
      key: "content",
      header: "",
      width: "7rem",
      align: "right",
      cell: (h) =>
        h.hasContent ? (
          <Button variant="outline" size="xs" disabled={viewBusy} onClick={() => onView(h)}>
            <Eye /> Ansehen
          </Button>
        ) : (
          <Tooltip content="Für diesen Versand wurde kein Inhalt gespeichert (vor Einführung der Speicherung gesendet).">
            <span tabIndex={0} className="text-xs text-muted-foreground">—</span>
          </Tooltip>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {summary && (
        <div className="flex flex-col gap-2">
          <DeliveryStrip summary={summary} />
          <Link
            href="/admin?tab=kpi#kpi-marketing"
            className="inline-flex w-fit items-center gap-1 text-xs text-accent underline-offset-2 hover:underline"
          >
            Kampagnen-Funnel mit Einlösungen und Umsatz im KPI-Bereich <ArrowRight className="size-3" aria-hidden />
          </Link>
        </div>
      )}
      <FilterBar
        activeCount={activeFilters}
        onReset={() => {
          setQuery("");
          setFrom("");
          setTo("");
          setDelivery("all");
          setPage(1);
        }}
      >
        <SearchInput
          value={query}
          onValueChange={(v) => {
            setQuery(v);
            setPage(1);
          }}
          placeholder="Empfänger oder Betreff"
          size="sm"
          containerClassName="w-64"
          aria-label="Gesendete E-Mails durchsuchen"
        />
        <div role="radiogroup" aria-label="Zustellung filtern" className="flex flex-wrap items-center gap-1">
          {HISTORY_DELIVERY_FILTERS.map((f) => {
            const active = delivery === f.key;
            return (
              <button
                key={f.key}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => {
                  setDelivery(f.key as DeliveryFilter);
                  setPage(1);
                }}
                className={cn(
                  "inline-flex h-7 items-center rounded-md border px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-accent/40 bg-accent-soft text-accent"
                    : "border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        <FilterGroup label="Von" htmlFor="campaign-history-from">
          <Input
            id="campaign-history-from"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
            className="h-8 w-auto text-xs"
          />
        </FilterGroup>
        <FilterGroup label="Bis" htmlFor="campaign-history-to">
          <Input
            id="campaign-history-to"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
            className="h-8 w-auto text-xs"
          />
        </FilterGroup>
      </FilterBar>

      {error && (
        <Callout tone="destructive" compact action={<Button variant="outline" size="xs" onClick={() => setPage((p) => p)}>Erneut laden</Button>}>
          {error}
        </Callout>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(h) => h.id}
        clientSort={false}
        loading={loading && !data}
        dense
        empty={
          <EmptyState
            compact
            plain
            icon={<Mail />}
            title={activeFilters ? "Keine Sendungen für diese Suche." : "Noch keine Kampagnen-E-Mails gesendet."}
          />
        }
        footer={
          <Pagination
            page={data?.page ?? page}
            pageCount={pageCount(total, pageSize)}
            onPageChange={setPage}
            total={total}
            pageSize={pageSize}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            itemLabel="Sendungen"
          />
        }
      />
    </div>
  );
}
