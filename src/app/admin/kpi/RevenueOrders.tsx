"use client";

// „Was genau passiert ist“ — every Mo-attributed order of the period as one
// row: when, which order, how it came about (channel in its tier colour), the
// story (consulted when, bought how long after, how much of the basket came
// from the consultation), the products (those from the consultation marked),
// the amount, and links to the customer and the conversation. Filter chips per
// channel, sortable, paged. Plain data from kpi/revenue-view; no fetching.

import * as React from "react";
import Link from "next/link";
import { Check, MessageSquare, UserRound } from "lucide-react";
import { ADMIN_DATE_PADDED, ADMIN_TIME, formatAdmin } from "@/lib/admin-datetime.mjs";
import { money, num, ratio } from "@/lib/admin-format.mjs";
import { REVENUE_CHANNELS, drillInsights } from "@/lib/mo-revenue.mjs";
import {
  DataTable,
  Pagination,
  StatusBadge,
  ToggleChips,
  Tooltip,
  buttonVariants,
  cn,
  type DataTableColumn,
} from "../ui";
import { TIER_BG } from "./revenue-colors";
import type { RevenueDrillRow } from "./revenue-view";

const CHANNEL_LABEL = new Map(REVENUE_CHANNELS.map((c) => [c.key, c.label]));
const PAGE_SIZE = 10;

function statusLabel(row: RevenueDrillRow): string | null {
  if (row.realised) return row.financialStatus?.toUpperCase() === "PARTIALLY_REFUNDED" ? "teilerstattet" : null;
  const s = (row.financialStatus ?? "").toUpperCase();
  if (s === "PENDING" || s === "AUTHORIZED") return "noch nicht bezahlt";
  if (s === "REFUNDED") return "erstattet";
  if (s === "VOIDED") return "storniert";
  return "nicht bezahlt";
}

export function RevenueOrders({ rows, truncated }: { rows: RevenueDrillRow[]; truncated: boolean }) {
  const channels = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.channel, (counts.get(r.channel) ?? 0) + 1);
    return REVENUE_CHANNELS.filter((c) => counts.has(c.key)).map((c) => ({
      value: c.key,
      tier: c.tier,
      label: (
        <span className="inline-flex items-center gap-1.5">
          <span className={cn("size-2 rounded-sm", TIER_BG[c.tier])} aria-hidden />
          {c.short}
          <span className="tabular-nums text-muted-foreground">{num(counts.get(c.key) ?? 0)}</span>
        </span>
      ),
    }));
  }, [rows]);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [page, setPage] = React.useState(1);
  const pageSize = PAGE_SIZE;
  const [sort, setSort] = React.useState<{ key: string; dir: "asc" | "desc" } | null>({ key: "date", dir: "desc" });

  const filtered = React.useMemo(
    () => (selected.length === 0 ? rows : rows.filter((r) => selected.includes(r.channel))),
    [rows, selected]
  );
  const sorted = React.useMemo(() => {
    if (!sort) return filtered;
    const dir = sort.dir === "asc" ? 1 : -1;
    const value = (r: RevenueDrillRow) =>
      sort.key === "amount" ? (r.amount ?? -1) : Date.parse(r.date ?? "") || 0;
    return [...filtered].sort((a, b) => (value(a) - value(b)) * dir);
  }, [filtered, sort]);
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pageCount);
  const visible = sorted.slice((current - 1) * pageSize, current * pageSize);

  const columns: DataTableColumn<RevenueDrillRow>[] = [
    {
      key: "date",
      header: "Datum",
      sortValue: (r) => Date.parse(r.date ?? "") || 0,
      defaultDir: "desc",
      width: "7.5rem",
      cell: (r) => (
        <span className="flex flex-col leading-tight">
          <span className="tabular-nums text-foreground">{formatAdmin(r.date, ADMIN_DATE_PADDED)}</span>
          <span className="text-2xs tabular-nums text-muted-foreground">{formatAdmin(r.date, ADMIN_TIME, "")}</span>
        </span>
      ),
    },
    {
      key: "order",
      header: "Bestellung · Weg",
      cell: (r) => {
        const status = statusLabel(r);
        return (
          <span className="flex min-w-0 flex-col gap-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold text-foreground">{r.orderName ?? "ohne Nummer"}</span>
              {r.moCodes.map((c) => (
                <code key={c} className="rounded bg-surface-2 px-1 py-0.5 text-2xs text-muted-foreground">
                  {c}
                </code>
              ))}
              {status && (
                <StatusBadge tone={r.realised ? "neutral" : "warning"} dot={false}>
                  {status}
                </StatusBadge>
              )}
              {r.origin === "shopify_code" && (
                <StatusBadge tone="info" dot={false}>
                  Code-Abgleich
                </StatusBadge>
              )}
            </span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={cn("size-2 shrink-0 rounded-sm", TIER_BG[r.tier])} aria-hidden />
              {CHANNEL_LABEL.get(r.channel) ?? r.channel}
            </span>
          </span>
        );
      },
    },
    {
      key: "story",
      header: "Was passiert ist",
      hideBelow: "md",
      cell: (r) => (
        <span className="flex min-w-48 flex-col gap-0.5 text-xs leading-snug">
          <span className="text-foreground">{r.story.lead}</span>
          {(r.story.lag || r.story.match) && (
            <span className="text-muted-foreground">{[r.story.lag, r.story.match].filter(Boolean).join(" · ")}</span>
          )}
          {/* Below xl the products sit here instead of in their own column. */}
          {r.lines.length > 0 && (
            <span className="mt-1.5 block xl:hidden">
              <Products lines={r.lines} />
            </span>
          )}
        </span>
      ),
    },
    {
      key: "products",
      header: "Produkte",
      hideBelow: "xl",
      cell: (r) => <Products lines={r.lines} />,
    },
    {
      key: "amount",
      header: "Betrag",
      align: "right",
      sortValue: (r) => r.amount ?? -1,
      defaultDir: "desc",
      width: "7rem",
      cell: (r) => (
        <span
          className={cn(
            "whitespace-nowrap font-semibold tabular-nums",
            r.realised ? "text-foreground" : "text-muted-foreground line-through decoration-muted-foreground/60"
          )}
        >
          {money(r.amount, r.currency)}
        </span>
      ),
    },
    {
      key: "links",
      header: <span className="sr-only">Öffnen</span>,
      align: "right",
      width: "5.5rem",
      cell: (r) => (
        <span className="inline-flex items-center justify-end gap-0.5">
          <RowLink
            href={r.customerId != null ? `/admin?tab=kunden&customer=${r.customerId}` : null}
            label={r.customerId != null ? "Kunde öffnen" : "Kein Kundenkonto verknüpft"}
            icon={<UserRound />}
          />
          <RowLink
            href={r.conversationId != null ? `/admin?tab=gespraeche&gid=${r.conversationId}` : null}
            label={r.conversationId != null ? "Gespräch öffnen" : "Kein Gespräch zugeordnet"}
            icon={<MessageSquare />}
          />
        </span>
      ),
    },
  ];

  const insights = React.useMemo(() => drillInsights(rows), [rows]);

  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-lg border border-border bg-surface-2/60 px-4 py-3 sm:grid-cols-3">
        <Insight
          label="Vom Chat bis zum Kauf"
          value={
            insights.medianDaysToOrder == null
              ? "—"
              : insights.medianDaysToOrder === 0
                ? "am selben Tag"
                : `${num(insights.medianDaysToOrder, 1)} ${insights.medianDaysToOrder === 1 ? "Tag" : "Tage"}`
          }
          hint={`Median · ${num(insights.ordersWithChat)} Bestellungen mit Chat davor`}
        />
        <Insight
          label="Produkt aus der Beratung im Warenkorb"
          value={
            insights.consultingOrders > 0
              ? ratio(insights.withConsultedProduct / insights.consultingOrders, 0)
              : "—"
          }
          hint={`${num(insights.withConsultedProduct)} von ${num(insights.consultingOrders)} Bestellungen nach Beratung`}
        />
        <Insight
          label="Mit Kundenkonto verknüpft"
          value={rows.length > 0 ? ratio(rows.filter((r) => r.customerId != null).length / rows.length, 0) : "—"}
          hint={`${num(rows.filter((r) => r.conversationId != null).length)} von ${num(rows.length)} mit Gespräch`}
        />
      </dl>
      {channels.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <ToggleChips
            label="Nach Weg filtern"
            options={channels}
            value={selected}
            onChange={(v) => {
              setSelected(v);
              setPage(1);
            }}
          />
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setSelected([]);
                setPage(1);
              }}
              className="text-xs text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Alle Wege
            </button>
          )}
        </div>
      )}
      <DataTable
        columns={columns}
        rows={visible}
        rowKey={(r) => r.key}
        clientSort={false}
        sort={sort}
        onSortChange={(next) => {
          setSort(next);
          setPage(1);
        }}
        stickyHeader={false}
        caption="Mo-zugeordnete Bestellungen im Zeitraum"
        footer={
          sorted.length > PAGE_SIZE ? (
            <Pagination
              page={current}
              pageCount={pageCount}
              onPageChange={setPage}
              total={sorted.length}
              pageSize={pageSize}
              itemLabel="Bestellungen"
            />
          ) : undefined
        }
      />
      {truncated && (
        <p className="text-2xs text-muted-foreground">
          Die Liste zeigt die neuesten 500 Bestellungen des Zeitraums; Summen und Aufteilung oben zählen alle.
        </p>
      )}
    </div>
  );
}

function Insight({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="truncate text-2xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tracking-tight text-foreground">{value}</dd>
      <dd className="truncate text-2xs text-muted-foreground">{hint}</dd>
    </div>
  );
}

function Products({ lines }: { lines: RevenueDrillRow["lines"] }) {
  if (lines.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  const shown = lines.slice(0, 3);
  return (
    <ul className="flex max-w-xs flex-col gap-0.5 text-xs">
      {shown.map((l, i) => (
        <li key={i} className="flex min-w-0 items-center gap-1.5">
          {l.consulted ? (
            <Tooltip content="Kam in der Beratung vor">
              <span tabIndex={0} className="inline-flex text-accent" aria-label="Aus der Beratung">
                <Check className="size-3.5" aria-hidden />
              </span>
            </Tooltip>
          ) : (
            <span className="inline-block size-3.5 shrink-0" aria-hidden />
          )}
          <span className={cn("truncate", l.consulted ? "font-medium text-foreground" : "text-muted-foreground")}>
            {l.quantity > 1 ? `${num(l.quantity)}× ` : ""}
            {l.title}
          </span>
        </li>
      ))}
      {lines.length > shown.length && (
        <li className="pl-5 text-2xs text-muted-foreground">+ {num(lines.length - shown.length)} weitere</li>
      )}
    </ul>
  );
}

function RowLink({ href, label, icon }: { href: string | null; label: string; icon: React.ReactNode }) {
  const cls = cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "text-muted-foreground hover:text-foreground");
  return (
    <Tooltip content={label}>
      {href ? (
        <Link href={href} aria-label={label} className={cls}>
          {icon}
        </Link>
      ) : (
        <span aria-label={label} tabIndex={0} className={cn(cls, "cursor-default opacity-35 hover:bg-transparent")}>
          {icon}
        </span>
      )}
    </Tooltip>
  );
}
