"use client";

// "Gesendet": paged, searchable campaign send history with delivery state
// (Resend webhook signals), redemption status (looked up for the visible page
// only) and the retained content viewer. Data comes from
// GET /api/admin/campaign/history.

import * as React from "react";
import { Eye, Mail } from "lucide-react";
import { ADMIN_DATE_TIME_SHORT, formatAdmin } from "@/lib/admin-datetime.mjs";
import { pageCount } from "@/lib/admin-table.mjs";
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
  StatusBadge,
  Tooltip,
  type DataTableColumn,
  type StatusTone,
} from "../ui";
import { adminFetch, errorMessage } from "../lib/admin-fetch";
import type { CampaignHistoryItemProps } from "./types";

interface HistoryPage {
  rows: CampaignHistoryItemProps[];
  total: number;
  page: number;
  pageSize: number;
}

function deliveryState(h: CampaignHistoryItemProps): { label: string; tone: StatusTone; detail?: string } {
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

export function SentHistory({
  initialTotal,
  viewBusy,
  onView,
}: {
  initialTotal: number;
  viewBusy: boolean;
  onView: (h: CampaignHistoryItemProps) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
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
  }, [debounced, from, to, page, pageSize]);

  const activeFilters = (debounced ? 1 : 0) + (from ? 1 : 0) + (to ? 1 : 0);
  const total = data?.total ?? initialTotal;
  const rows = data?.rows ?? [];

  const columns: DataTableColumn<CampaignHistoryItemProps>[] = [
    { key: "email", header: "Empfänger", cell: (h) => <span className="font-medium">{h.email}</span> },
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
      <FilterBar
        activeCount={activeFilters}
        onReset={() => {
          setQuery("");
          setFrom("");
          setTo("");
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
