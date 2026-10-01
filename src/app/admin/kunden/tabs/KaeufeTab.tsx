"use client";

// Käufe — the local copy of the person's Shopify orders (order ledger, 0062:
// kept current by webhooks and the nightly reconcile, with line items and
// discount codes). Before a person is mirrored, the cached per-e-mail history
// (refreshed on demand) is shown instead.

import * as React from "react";
import { RotateCcw, ShoppingBag } from "lucide-react";
import type { CustomerDetail } from "@/lib/customer-detail";
import type { LedgerOrder } from "@/lib/customer-orders-store";
import type { OrderHistory, OrderHistoryEntry } from "@/lib/shopify-orders";
import { ADMIN_DATE, formatAdmin } from "@/lib/admin-datetime.mjs";
import { money, num } from "@/lib/admin-format.mjs";
import {
  Button,
  DataTable,
  EmptyState,
  InfoTip,
  StatusBadge,
  toast,
  type DataTableColumn,
  type StatusTone,
} from "../../ui";
import { adminFetch } from "../../lib/admin-fetch";
import { useAsyncAction } from "../../lib/use-async-action";
import { useCustomerActions } from "../CustomerDetail";

const FINANCIAL_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  PAID: { label: "Bezahlt", tone: "success" },
  PARTIALLY_PAID: { label: "Teilw. bezahlt", tone: "warning" },
  PENDING: { label: "Ausstehend", tone: "warning" },
  AUTHORIZED: { label: "Autorisiert", tone: "info" },
  REFUNDED: { label: "Erstattet", tone: "neutral" },
  PARTIALLY_REFUNDED: { label: "Teilw. erstattet", tone: "neutral" },
  VOIDED: { label: "Storniert", tone: "destructive" },
  EXPIRED: { label: "Abgelaufen", tone: "neutral" },
};

function FinancialStatusBadge({ status }: { status: string | null }) {
  if (!status) return <StatusBadge tone="neutral">—</StatusBadge>;
  const meta = FINANCIAL_STATUS[status.toUpperCase()];
  return <StatusBadge tone={meta?.tone ?? "neutral"}>{meta?.label ?? status}</StatusBadge>;
}

const COLUMNS: DataTableColumn<OrderHistoryEntry>[] = [
  {
    key: "items",
    header: "Artikel",
    cell: (o) => (
      <div>
        <div className="font-medium">
          {o.items.length > 0
            ? o.items.map((it) => it.title ?? it.handle ?? "Artikel").join(", ")
            : "(keine Positionen)"}
        </div>
        <div className="text-xs text-muted-foreground">{o.name}</div>
      </div>
    ),
  },
  {
    key: "qty",
    header: "Menge",
    align: "right",
    width: "5rem",
    cell: (o) => {
      const qty = o.items.reduce((s, it) => s + it.quantity, 0);
      return qty ? num(qty) : "—";
    },
  },
  {
    key: "date",
    header: "Datum",
    width: "7rem",
    sortValue: (o) => o.createdAt,
    defaultDir: "desc",
    cell: (o) => formatAdmin(o.createdAt, ADMIN_DATE),
  },
  {
    key: "total",
    header: "Summe",
    align: "right",
    width: "7rem",
    sortValue: (o) => (o.totalAmount ? Number(o.totalAmount) : null),
    cell: (o) => (o.totalAmount ? money(o.totalAmount, o.currencyCode ?? "EUR") : "—"),
  },
  {
    key: "status",
    header: "Status",
    width: "8rem",
    cell: (o) => <FinancialStatusBadge status={o.financialStatus} />,
  },
];

const LEDGER_COLUMNS: DataTableColumn<LedgerOrder>[] = [
  {
    key: "items",
    header: "Artikel",
    cell: (o) => (
      <div>
        <div className="font-medium">
          {o.lineItems.length > 0
            ? o.lineItems.map((it) => `${it.quantity > 1 ? `${it.quantity}× ` : ""}${it.title}`).join(", ")
            : "(keine Positionen)"}
        </div>
        <div className="text-xs text-muted-foreground">
          {o.name}
          {o.discountCodes.length > 0 && <> · Code {o.discountCodes.join(", ")}</>}
          {o.cancelledAt && <> · storniert</>}
        </div>
      </div>
    ),
  },
  {
    key: "date",
    header: "Datum",
    width: "7rem",
    sortValue: (o) => o.processedAt,
    defaultDir: "desc",
    cell: (o) => formatAdmin(o.processedAt, ADMIN_DATE),
  },
  {
    key: "total",
    header: "Summe",
    align: "right",
    width: "7rem",
    sortValue: (o) => o.totalCents,
    cell: (o) => money(o.totalCents / 100, o.currency ?? "EUR"),
  },
  {
    key: "status",
    header: "Status",
    width: "8rem",
    cell: (o) => <FinancialStatusBadge status={o.financialStatus} />,
  },
];

export function KaeufeTab({ customer }: { customer: CustomerDetail }) {
  if (customer.ordersTotal > 0 || customer.shopifySyncedAt) return <LedgerOrders customer={customer} />;
  return <CachedPurchases customer={customer} />;
}

function LedgerOrders({ customer }: { customer: CustomerDetail }) {
  const f = customer.figures;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-sm font-semibold text-foreground">
        Bestellungen
        <InfoTip>
          Kopie der Shopify-Bestellungen dieser Person (Bestellnummer, Datum, Artikel, Summe,
          Rabattcode). Neue Bestellungen kommen per Webhook sofort dazu, nächtlich wird abgeglichen.
          Empfehlungen schließen bereits Gekauftes aus.
        </InfoTip>
        {f && f.ordersCount > 0 && (
          <span className="text-xs font-normal text-muted-foreground">
            · {num(f.ordersCount)} bezahlt · {money(f.totalSpentCents / 100, "EUR")}
            {f.aovCents != null && <> · Ø {money(f.aovCents / 100, "EUR")}</>}
          </span>
        )}
      </div>
      <DataTable
        columns={LEDGER_COLUMNS}
        rows={customer.orders}
        rowKey={(o) => o.shopifyOrderId}
        defaultSort={{ key: "date", dir: "desc" }}
        dense
        empty={<EmptyState compact plain icon={<ShoppingBag />} title="Noch keine Bestellungen." />}
        footer={
          customer.ordersTotal > customer.orders.length ? (
            <span className="text-2xs text-muted-foreground">
              Die neuesten {num(customer.orders.length)} von {num(customer.ordersTotal)} Bestellungen.
            </span>
          ) : undefined
        }
      />
    </div>
  );
}

function CachedPurchases({ customer }: { customer: CustomerDetail }) {
  const { refresh } = useCustomerActions();
  const [purchases, setPurchases] = React.useState<OrderHistory | null>(customer.purchaseSummary);
  const [updatedAt, setUpdatedAt] = React.useState(customer.purchaseSummaryUpdatedAt);

  const reloadPurchases = useAsyncAction(
    () =>
      adminFetch<{ purchaseSummary?: OrderHistory }>("/api/admin/customers/purchases", {
        body: { customerId: customer.id },
      }),
    {
      errorToast: "Käufe konnten nicht geladen werden",
      onSuccess: (json) => {
        if (json.purchaseSummary) {
          setPurchases(json.purchaseSummary);
          setUpdatedAt(new Date().toISOString());
        }
        toast({ variant: "success", title: "Käufe aktualisiert", description: customer.email });
        refresh();
      },
    }
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          Kaufhistorie (Shopify)
          <InfoTip>
            Zwischengespeicherte Bestellungen unter dieser E-Mail-Adresse. Wird täglich automatisch
            und hier auf Knopfdruck aus Shopify aktualisiert; Empfehlungen schließen bereits
            Gekauftes aus.
          </InfoTip>
          <span className="text-xs font-normal text-muted-foreground">
            {updatedAt ? `· Stand ${formatAdmin(updatedAt, ADMIN_DATE)}` : "· noch nicht geladen"}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void reloadPurchases.run()}
          loading={reloadPurchases.pending}
        >
          <RotateCcw /> Käufe aktualisieren
        </Button>
      </div>

      {!purchases ? (
        <EmptyState
          compact
          icon={<ShoppingBag />}
          title="Noch keine Kaufhistorie geladen"
          description="„Käufe aktualisieren“ holt die Bestellungen aus Shopify."
        />
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={purchases.orders}
          rowKey={(o) => `${o.name}-${o.createdAt}`}
          defaultSort={{ key: "date", dir: "desc" }}
          dense
          empty={
            <EmptyState
              compact
              plain
              icon={<ShoppingBag />}
              title="Keine Bestellungen unter dieser E-Mail gefunden."
            />
          }
          footer={
            purchases.truncated ? (
              <span className="text-2xs text-muted-foreground">
                Liste gekürzt — nur die neuesten Bestellungen.
              </span>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
