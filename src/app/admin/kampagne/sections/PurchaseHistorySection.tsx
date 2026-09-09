"use client";

// Purchase history with the recommendation-basis selection: every purchased
// item that maps to a CURRENT catalog product gets a checkbox (all selected by
// default = the whole history is the basis). Changing the selection shows an
// apply button that recomputes the recommendations from the selected purchases
// and regenerates the text in one round-trip; the selection is persisted on
// the draft so later regenerates keep it.

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { ADMIN_DATE, formatAdmin } from "@/lib/admin-datetime.mjs";
import { money, num } from "@/lib/admin-format.mjs";
import { Button, Checkbox, InfoTip } from "../../ui";
import type { CampaignPurchaseSummary } from "../types";

export function PurchaseHistorySection({
  summary,
  appliedSelection,
  busy,
  applying,
  onApply,
}: {
  summary: CampaignPurchaseSummary | null;
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
      {summary && summary.orders.length > 0 ? (
        <ul className="space-y-1.5">
          {summary.orders.map((o) => (
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
