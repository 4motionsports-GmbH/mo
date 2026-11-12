"use client";

// „Empfänger“ of a Rundmail's „Versand“ tab: every recipient — sent, not sent
// (with the reason) or still pending — 50 per page, searched by name or
// e-mail, filtered (Alle / Gesendet / Zugestellt / Geklickt / Bestellt /
// Bounce / Beschwerde / Abgemeldet / Nicht gesendet + Grund) and sorted by
// sent time, clicks or revenue ON THE SERVER (GET /api/admin/rundmail/recipients,
// lib/rundmail-analytics-store.ts). The status chips are the „Gesendet“ list's
// (recipientState). A row opens the recipient's sheet; the name links to the
// Kunden profile. „Als CSV exportieren“ downloads the whole current
// selection (GET /api/admin/rundmail/export, audit-logged).

import * as React from "react";
import Link from "next/link";
import { Download, Users } from "lucide-react";
import { ADMIN_DATE_TIME_SHORT, formatAdmin } from "@/lib/admin-datetime.mjs";
import { eurFromCents, num } from "@/lib/admin-format.mjs";
import { pageCount } from "@/lib/admin-table.mjs";
import { adminTabHref } from "@/lib/admin-tabs.mjs";
import {
  RECIPIENT_FILTERS,
  RECIPIENT_PAGE_SIZE,
  notSentReasonLabel,
  parseNotSentReason,
  recipientName,
  recipientState,
  type AnalyticsUrlState,
  type RecipientFilter,
  type RecipientSort,
} from "@/lib/rundmail-analytics.mjs";
import type { RundmailRecipientRow } from "@/lib/rundmail-analytics-store";
import {
  Button,
  Callout,
  DataTable,
  EmptyState,
  FilterBar,
  FilterGroup,
  Pagination,
  SearchInput,
  Section,
  Select,
  StatusBadge,
  Tooltip,
  buttonVariants,
  cn,
  type DataTableColumn,
} from "../ui";
import { adminFetch, errorMessage } from "../lib/admin-fetch";

interface RecipientPage {
  rows: RundmailRecipientRow[];
  total: number;
  page: number;
  pageSize: number;
}

const time = (value: string | null) => (value ? formatAdmin(value, ADMIN_DATE_TIME_SHORT) : "—");

export function RundmailRecipients({
  campaignId,
  state,
  update,
  version,
  counts,
  reasons,
  onOpen,
}: {
  campaignId: number;
  state: AnalyticsUrlState;
  update: (patch: Partial<AnalyticsUrlState>) => void;
  /** Bumped by „Aktualisieren“ — reload the page. */
  version: number;
  /** Totals per filter chip (null = not known yet). */
  counts: Record<RecipientFilter, number | null>;
  /** Not sent, per reason (getMailingStats.skippedByReason). */
  reasons: Record<string, number>;
  onOpen: (contactId: number) => void;
}) {
  const [query, setQuery] = React.useState(state.q);
  const [data, setData] = React.useState<RecipientPage | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [retry, setRetry] = React.useState(0);

  // The search reaches the server (and the URL) 300 ms after the last key.
  React.useEffect(() => {
    const q = query.replace(/\s+/g, " ").trim();
    if (q === state.q) return;
    const handle = setTimeout(() => update({ q, page: 1 }), 300);
    return () => clearTimeout(handle);
  }, [query, state.q, update]);

  const { window: windowKey, filter, reason, q, sort, dir, page } = state;
  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const sp = new URLSearchParams({ campaignId: String(campaignId), window: windowKey, filter, sort, dir, page: String(page) });
    if (filter === "not_sent" && reason) sp.set("reason", reason);
    if (q) sp.set("q", q);
    adminFetch<RecipientPage>(`/api/admin/rundmail/recipients?${sp.toString()}`, { signal: controller.signal })
      .then((json) => {
        if (controller.signal.aborted) return;
        setData(json);
        setError(null);
        setLoading(false);
        // A page past the end (an old link, a narrowed filter) came back as page 1.
        if (json.page !== page) update({ page: json.page });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(err));
        setLoading(false);
      });
    return () => controller.abort();
  }, [campaignId, windowKey, filter, reason, q, sort, dir, page, version, retry, update]);

  const exportHref = React.useMemo(() => {
    const sp = new URLSearchParams({ campaignId: String(campaignId), window: windowKey, filter });
    if (filter === "not_sent" && reason) sp.set("reason", reason);
    if (q) sp.set("q", q);
    return `/api/admin/rundmail/export?${sp.toString()}`;
  }, [campaignId, windowKey, filter, reason, q]);

  const reasonOptions = Object.entries(reasons)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const activeFilters = (q ? 1 : 0) + (filter !== "all" ? 1 : 0);
  const total = data?.total ?? 0;
  const rows = data?.rows ?? [];

  const columns: DataTableColumn<RundmailRecipientRow>[] = [
    {
      key: "person",
      header: "Person",
      cell: (r) => {
        const name = recipientName(r);
        const label = name || r.email;
        return (
          <div className="min-w-0 max-w-[22rem]">
            <div className="truncate font-medium">
              {r.customerId ? (
                <Link
                  href={adminTabHref("kunden", { customer: String(r.customerId) })}
                  onClick={(e) => e.stopPropagation()}
                  className="underline-offset-2 hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {label}
                </Link>
              ) : (
                label
              )}
            </div>
            {name && <div className="truncate text-xs text-muted-foreground">{r.email}</div>}
          </div>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      width: "10rem",
      cell: (r) => {
        const chip = recipientState(r);
        const notSent = chip.key === "not_sent" || chip.key === "failed";
        return (
          <div className="min-w-0 leading-tight">
            <Tooltip content={chip.detail ?? ""} disabled={!chip.detail}>
              <StatusBadge tone={chip.tone} tabIndex={0}>
                {chip.label}
              </StatusBadge>
            </Tooltip>
            {notSent && chip.detail && <div className="mt-0.5 truncate text-2xs text-muted-foreground">{chip.detail}</div>}
          </div>
        );
      },
    },
    {
      key: "sent",
      header: "Gesendet",
      width: "8.5rem",
      sortValue: (r) => r.sentAt,
      defaultDir: "desc",
      cell: (r) => <span className="tabular-nums text-muted-foreground">{time(r.sentAt)}</span>,
    },
    {
      key: "delivered",
      header: "Zugestellt",
      width: "8.5rem",
      hideBelow: "xl",
      cell: (r) => <span className="tabular-nums text-muted-foreground">{time(r.deliveredAt)}</span>,
    },
    {
      key: "clicks",
      header: "Klicks",
      width: "8rem",
      sortValue: (r) => r.clicks,
      defaultDir: "desc",
      cell: (r) =>
        r.clicks > 0 ? (
          <div className="leading-tight">
            <span className="font-medium tabular-nums">{num(r.clicks)}</span>
            {r.clickedAt && <div className="text-2xs tabular-nums text-muted-foreground">ab {time(r.clickedAt)}</div>}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "revenue",
      header: "Bestellungen",
      width: "11rem",
      sortValue: (r) => r.revenueCents,
      defaultDir: "desc",
      cell: (r) =>
        r.orders > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="tabular-nums">
              <span className="font-medium">{num(r.orders)}</span> · {eurFromCents(r.revenueCents)}
            </span>
            {r.codeOrders > 0 && (
              <StatusBadge tone="success" dot={false}>
                mit Code
              </StatusBadge>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "unsubscribed",
      header: "Abgemeldet",
      width: "8.5rem",
      hideBelow: "xl",
      cell: (r) => <span className="tabular-nums text-muted-foreground">{time(r.unsubscribedAt)}</span>,
    },
  ];

  return (
    <Section
      level={3}
      title="Empfänger"
      info={
        <>
          Jede Person dieser Rundmail — gesendet, nicht gesendet (mit Grund) oder noch offen. Suche nach Name oder E-Mail,
          Filter und Sortierung gelten für alle Empfänger:innen, nicht nur diese Seite. „Bestellungen“ sind die für diese
          Rundmail gezählten im gewählten Zeitraum (siehe „Wie Bestellungen zählen“). Eine Zeile öffnet die Details, der Name
          das Kundenprofil. „Als CSV exportieren“ lädt die ganze aktuelle Auswahl herunter (für Excel: Semikolon, UTF-8,
          Berliner Zeit) — der Export wird protokolliert.
        </>
      }
      actions={
        <a href={exportHref} download className={buttonVariants({ variant: "outline", size: "sm" })}>
          <Download aria-hidden /> Als CSV exportieren
        </a>
      }
    >
      <div className="flex flex-col gap-3">
        <FilterBar
          activeCount={activeFilters}
          onReset={() => {
            setQuery("");
            update({ q: "", filter: "all", reason: null, page: 1 });
          }}
        >
          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder="Name oder E-Mail"
            size="sm"
            containerClassName="w-60"
            aria-label="Empfänger:innen durchsuchen"
          />
          <div role="radiogroup" aria-label="Empfänger:innen filtern" className="flex flex-wrap items-center gap-1">
            {RECIPIENT_FILTERS.map((f) => {
              const active = filter === f.key;
              const count = counts[f.key as RecipientFilter];
              return (
                <button
                  key={f.key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => update({ filter: f.key as RecipientFilter, reason: null, page: 1 })}
                  className={cn(
                    "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "border-accent/40 bg-accent-soft text-accent"
                      : "border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  {f.label}
                  {count != null && <span className="tabular-nums opacity-70">{num(count)}</span>}
                </button>
              );
            })}
          </div>
          {filter === "not_sent" && reasonOptions.length > 0 && (
            <FilterGroup label="Grund" htmlFor={`rundmail-reason-${campaignId}`}>
              <Select
                id={`rundmail-reason-${campaignId}`}
                value={reason ?? ""}
                onChange={(e) => update({ reason: parseNotSentReason(e.target.value), page: 1 })}
                className="h-8 w-auto py-0 pr-8 text-xs"
              >
                <option value="">Alle Gründe</option>
                {reasonOptions.map(([key, n]) => (
                  <option key={key} value={key}>
                    {notSentReasonLabel(key)} ({num(n)})
                  </option>
                ))}
              </Select>
            </FilterGroup>
          )}
        </FilterBar>

        {error && (
          <Callout
            tone="destructive"
            compact
            action={
              <Button variant="outline" size="xs" onClick={() => setRetry((n) => n + 1)}>
                Erneut laden
              </Button>
            }
          >
            {error}
          </Callout>
        )}

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.contactId}
          sort={{ key: sort, dir }}
          onSortChange={(next) => {
            if (!next || !["sent", "clicks", "revenue"].includes(next.key)) return;
            update({ sort: next.key as RecipientSort, dir: next.dir, page: 1 });
          }}
          clientSort={false}
          loading={loading && !data}
          loadingRows={8}
          dense
          onRowClick={(r) => onOpen(r.contactId)}
          selectedKey={state.recipient}
          className={cn(loading && data ? "opacity-70 transition-opacity" : undefined)}
          caption="Empfänger:innen der Rundmail"
          empty={
            <EmptyState
              compact
              plain
              icon={<Users />}
              title={activeFilters ? "Keine Empfänger:innen für diese Auswahl." : "Noch keine Empfänger:innen."}
            />
          }
          footer={
            <Pagination
              page={data?.page ?? page}
              pageCount={pageCount(total, RECIPIENT_PAGE_SIZE)}
              onPageChange={(p) => update({ page: p })}
              total={total}
              pageSize={RECIPIENT_PAGE_SIZE}
              itemLabel="Empfänger:innen"
            />
          }
        />
      </div>
    </Section>
  );
}
