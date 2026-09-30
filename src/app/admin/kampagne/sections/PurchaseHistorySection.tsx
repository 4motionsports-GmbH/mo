"use client";

// Purchase history with the recommendation-basis selection: every purchased
// item that maps to a CURRENT catalog product gets a checkbox (all selected by
// default = the whole history is the basis). Changing the selection shows an
// apply button that recomputes the recommendations from the selected purchases
// and regenerates the text in one round-trip; the selection is persisted on
// the draft so later regenerates keep it. The snapshot holds only the newest
// orders — a coverage line says so, since the contact's Umsatz is lifetime.

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { ADMIN_DATE, formatAdmin } from "@/lib/admin-datetime.mjs";
import { money, num, plural } from "@/lib/admin-format.mjs";
import {
  PURCHASE_SUMMARY_MAX_ITEMS_PER_ORDER,
  PURCHASE_SUMMARY_MAX_ORDERS,
  purchaseHistoryCoverage,
} from "@/lib/campaign-desk-core.mjs";
import { Button, Checkbox, InfoTip } from "../../ui";
import type { CampaignPurchaseSummary } from "../types";

export function PurchaseHistorySection({
  summary,
  ordersCount,
  appliedSelection,
  busy,
  applying,
  onApply,
}: {
  summary: CampaignPurchaseSummary | null;
  /** Lifetime order count of the contact (Shopify, last sync). */
  ordersCount: number;
  appliedSelection: string[] | null;
  busy: boolean;
  applying: boolean;
  onApply: (selection: string[] | null) => void;
}) {
  // All selectable product ids (catalog-matched purchases), first-seen order.
  const selectableIds = React.useMemo(() => {
    const ids: string[] = [];
    for (const o of summary?.orders ?? []) {
      for (const i of o.items) {
        if (i.productId && !ids.includes(i.productId)) ids.push(i.productId);
      }
    }
    return ids;
  }, [summary]);

  // The selection as APPLIED on the draft, clipped to what's selectable
  // (null = all). Local checkbox state seeds from it and re-seeds after an
  // apply round-trip patches the card.
  const appliedIds = React.useMemo(
    () =>
      appliedSelection === null
        ? selectableIds
        : selectableIds.filter((id) => appliedSelection.includes(id)),
    [appliedSelection, selectableIds]
  );
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set(appliedIds));
  const appliedKey = appliedIds.join("|");
  React.useEffect(() => {
    setSelected(new Set(appliedIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedKey]);

  const dirty = selected.size !== appliedIds.length || appliedIds.some((id) => !selected.has(id));
  const allSelected = selectableIds.length > 0 && selected.size === selectableIds.length;

  // Drafts saved before the selection feature lack the productId field
  // entirely — a regenerate refreshes the snapshot and enables the checkboxes.
  const legacySummary =
    selectableIds.length === 0 &&
    (summary?.orders ?? []).some((o) => o.items.some((i) => !("productId" in i)));
  // Items that don't map to a current catalog product (greyed, no checkbox).
  const hasUnmatched =
    !legacySummary && (summary?.orders ?? []).some((o) => o.items.some((i) => !i.productId));

  const coverage = React.useMemo(
    () => purchaseHistoryCoverage(summary, ordersCount),
    [summary, ordersCount]
  );

  const toggle = (productId: string, checked: boolean) => {
    setSelected((prevSelected) => {
      const nextSelected = new Set(prevSelected);
      if (checked) nextSelected.add(productId);
      else nextSelected.delete(productId);
      return nextSelected;
    });
  };

  return (
    <div className="text-sm">
      {selectableIds.length > 1 && (
        <label className="mb-1.5 flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox
            className="size-3.5"
            checked={allSelected}
            indeterminate={selected.size > 0 && !allSelected}
            disabled={busy}
            onChange={(e) => setSelected(e.target.checked ? new Set(selectableIds) : new Set())}
          />
          Alle Käufe als Basis
          <InfoTip>
            Ausgewählte Käufe sind die Basis für Empfehlungen und Text. Abwählen, was für diese
            E-Mail nicht relevant ist; die Auswahl wird am Entwurf gespeichert.
          </InfoTip>
        </label>
      )}
      {coverage.partial && coverage.shown > 0 && (
        <p className="mb-1.5 flex items-center gap-1 text-xs text-muted-foreground">
          {coverage.total !== null
            ? `Letzte ${num(coverage.shown)} von ${plural(coverage.total, "Bestellung", "Bestellungen")}`
            : `Nur die letzten ${plural(coverage.shown, "Bestellung", "Bestellungen")}`}
          <InfoTip>
            Der Entwurf speichert nur die neuesten {num(PURCHASE_SUMMARY_MAX_ORDERS)} Bestellungen
            (je bis zu {num(PURCHASE_SUMMARY_MAX_ITEMS_PER_ORDER)} Artikel) als Überblick. „Umsatz“
            im Kontakt-Block ist der Gesamtwert aller Bestellungen laut Shopify (Stand letzter
            Sync) — die Summe der Bestellungen hier weicht deshalb davon ab.
          </InfoTip>
        </p>
      )}
      {summary && summary.orders.length > 0 ? (
        <ul className="space-y-1.5">
          {summary.orders.map((o, orderIdx) => (
            <li key={o.name} className="rounded-md border border-border px-2.5 py-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  {o.name} · {formatAdmin(o.createdAt, ADMIN_DATE)}
                </span>
                <span className="tabular-nums">
                  {o.totalAmount ? money(o.totalAmount, o.currencyCode ?? "EUR") : ""}
                </span>
              </div>
              <div className="mt-0.5 space-y-0.5">
                {o.items.map((i, idx) =>
                  i.productId ? (
                    <label key={idx} className="flex cursor-pointer items-start gap-1.5 text-xs">
                      <Checkbox
                        className="mt-px size-3.5"
                        checked={selected.has(i.productId)}
                        disabled={busy}
                        onChange={(e) => toggle(i.productId as string, e.target.checked)}
                      />
                      <span>
                        {num(i.quantity)}× {i.title ?? "?"}
                      </span>
                    </label>
                  ) : (
                    <div key={idx} className="ps-5 text-xs text-muted-foreground">
                      {num(i.quantity)}× {i.title ?? "?"}
                    </div>
                  )
                )}
                {coverage.hiddenItems[orderIdx] > 0 && (
                  <div className="ps-5 text-xs text-muted-foreground">
                    +{" "}
                    {plural(coverage.hiddenItems[orderIdx], "weiterer Artikel", "weitere Artikel")}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-xs text-muted-foreground">Keine Bestelldetails verfügbar.</div>
      )}
      {selectableIds.length > 0 && appliedSelection !== null && !dirty && (
        <p className="mt-1 text-xs text-muted-foreground">
          Empfehlungsbasis: {num(appliedIds.length)} von {num(selectableIds.length)} Käufen ausgewählt.
        </p>
      )}
      {hasUnmatched && (
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          Grau = nicht als Basis wählbar
          <InfoTip>
            Diese Artikel haben keinen Treffer im aktuellen Produktkatalog — das Produkt wurde
            entfernt, archiviert oder nicht veröffentlicht, oder es ist kein Shop-Produkt
            (z. B. Gutschein, manuelle Position). Sie bleiben als Kaufhistorie sichtbar;
            Empfehlungen werden aber aus dem Katalog berechnet, deshalb können sie nicht als
            Basis dienen.
          </InfoTip>
        </p>
      )}
      {legacySummary && (
        <p className="mt-1 text-xs text-muted-foreground">
          Kaufauswahl wird nach „Neu generieren“ verfügbar.
        </p>
      )}
      {dirty && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            onClick={() => onApply(allSelected ? null : [...selected])}
            disabled={busy || selected.size === 0}
            loading={applying}
          >
            <RefreshCw /> Empfehlungen &amp; Text neu erzeugen
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set(appliedIds))} disabled={busy}>
            Verwerfen
          </Button>
          {selected.size === 0 && (
            <span className="text-xs text-warning">Mindestens einen Kauf auswählen.</span>
          )}
        </div>
      )}
    </div>
  );
}
