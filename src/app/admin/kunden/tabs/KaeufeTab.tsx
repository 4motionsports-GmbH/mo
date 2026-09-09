"use client";

// Käufe — the cached Shopify purchase history (refreshed on demand and by the
// daily customer-refresh cron).

import * as React from "react";
import { RotateCcw, ShoppingBag } from "lucide-react";
import type { CustomerDetail } from "@/lib/customer-detail";
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

export function KaeufeTab({ customer }: { customer: CustomerDetail }) {
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
