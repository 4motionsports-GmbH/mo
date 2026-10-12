"use client";

// The set dialog of a review card ("Set erstellen…"): builds a set offer from
// the card's recommendations via the EXISTING bundle mechanism
// (/api/admin/bundles/create with campaignContactId — docs/BUNDLES.md).
//
// Final check first: on open it re-resolves the recommendations against the
// current catalog (/api/admin/catalog/availability). Available items are
// pre-selected; sold-out or vanished ones stay visible but greyed out and
// cannot be chosen. Each row carries the unit price, the stock (when Shopify
// tracks it) and a count (1…BUNDLE_QUANTITY_MAX, capped by the known stock).
// The empty price field shows the normal price (Σ price × count) greyed out —
// leaving it empty sells the set at that price; a lower price shows the
// saving the mail will advertise. A set replaces the card's discount code
// (offer-mode.mjs).

import * as React from "react";
import { money, num } from "@/lib/admin-format.mjs";
import { BUNDLE_QUANTITY_MAX, centsToMoney } from "@/lib/bundle-offer-core.mjs";
import { maxSetQuantity, stockLabel } from "@/lib/stock-level.mjs";
import {
  clampQuantity,
  setNormalPriceCents,
  setPriceCheck,
  setSelectionCheck,
  setUnits,
} from "@/lib/set-composer-core.mjs";
import { Button, Callout, Checkbox, Field, Input, Select, Skeleton, StatusBadge, cn } from "../../ui";
import { adminFetch } from "../../lib/admin-fetch";
import type { CampaignRecommendation } from "../types";

export interface SetItemChoice {
  /** The recommendation ref ("handle" or "handle~variantId"). */
  ref: string;
  quantity: number;
}

type CheckState = "loading" | "fresh" | "stale";

function eurFromCentsPlain(cents: number): string {
  return money(Number(centsToMoney(cents)), "EUR");
}

export function BundleSection({
  recommendations,
  shopifyConfigured,
  busy,
  creating,
  discountPercent,
  onCreate,
}: {
  recommendations: CampaignRecommendation[];
  shopifyConfigured: boolean;
  busy: boolean;
  creating: boolean;
  /** The card's current code depth — a set replaces it. */
  discountPercent: number;
  onCreate: (items: SetItemChoice[], priceOverride: string) => void;
}) {
  const recKey = recommendations.map((r) => r.id).join("|");
  const [rows, setRows] = React.useState<CampaignRecommendation[]>(recommendations);
  const [check, setCheck] = React.useState<CheckState>("loading");
  const [chosen, setChosen] = React.useState<Map<string, number>>(new Map());
  const [priceOverride, setPriceOverride] = React.useState("");

  // Final availability check against the current catalog; the desk's list may
  // be hours old. Falls back to that list when the check fails.
  React.useEffect(() => {
    let cancelled = false;
    const seed = (list: CampaignRecommendation[], state: CheckState) => {
      if (cancelled) return;
      setRows(list);
      setCheck(state);
      setChosen(new Map(list.filter((r) => r.available === true).map((r) => [r.id, 1])));
      setPriceOverride("");
    };
    if (recommendations.length === 0) {
      seed([], "fresh");
      return;
    }
    setCheck("loading");
    adminFetch<{ items?: CampaignRecommendation[] }>("/api/admin/catalog/availability", {
      body: { refs: recommendations.map((r) => r.id) },
    })
      .then((json) => seed(Array.isArray(json.items) ? json.items : recommendations, "fresh"))
      .catch(() => seed(recommendations, "stale"));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recKey]);

  const chosenRows = rows
    .filter((r) => r.available === true && chosen.has(r.id))
    .map((r) => ({ ref: r.id, price: r.price, quantity: chosen.get(r.id) ?? 1 }));
  const normalCents = setNormalPriceCents(chosenRows);
  const priceCheck = setPriceCheck({ normalCents, input: priceOverride });
  const selection = setSelectionCheck(chosenRows);
  const unavailableCount = rows.filter((r) => r.available !== true).length;

  if (!shopifyConfigured) {
    return <Callout tone="warning">Shopify nicht konfiguriert — keine Set-Angebote möglich.</Callout>;
  }
  if (recommendations.length === 0) {
    return <Callout tone="info">Keine Empfehlungen, aus denen ein Set gebaut werden könnte.</Callout>;
  }

  const toggle = (id: string, on: boolean) =>
    setChosen((prev) => {
      const next = new Map(prev);
      if (on) next.set(id, next.get(id) ?? 1);
      else next.delete(id);
      return next;
    });
  const setQuantity = (id: string, quantity: number) =>
    setChosen((prev) => new Map(prev).set(id, clampQuantity(quantity)));

  const priceLine = (() => {
    switch (priceCheck.kind) {
      case "saving":
        return (
          <span className="text-success">
            Ersparnis {eurFromCentsPlain(priceCheck.savingCents)} ({num(priceCheck.savingPct)} %) — die Mail zeigt den
            Normalpreis durchgestrichen.
          </span>
        );
      case "no_saving":
        return <span className="text-warning">Kein Preisvorteil — die Mail zeigt dann weder Streichpreis noch Ersparnis.</span>;
      case "invalid":
        return <span className="text-destructive">Kein gültiger Betrag (z. B. 159,90).</span>;
      case "unknown":
        return <span className="text-muted-foreground">Normalpreis unbekannt — Ersparnis wird beim Erstellen berechnet.</span>;
      default:
        return null;
    }
  })();

  return (
    <div className="flex flex-col gap-3 text-sm">
      {discountPercent > 0 && (
        <Callout tone="info">
          Ein Set ersetzt den Rabattcode: Die Mail zeigt dann nur das Set, der Code ({num(discountPercent)} %) entfällt.
        </Callout>
      )}
      {check === "stale" && (
        <Callout tone="warning">Verfügbarkeit konnte nicht neu geprüft werden — Stand der Seite. Shopify prüft beim Erstellen erneut.</Callout>
      )}

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {check === "loading"
            ? "Prüfe Verfügbarkeit im Katalog…"
            : unavailableCount > 0
              ? `${num(unavailableCount)} von ${num(rows.length)} nicht verfügbar — ausgegraut`
              : "Alle Empfehlungen verfügbar"}
        </span>
        <span className="tabular-nums">{num(setUnits(chosenRows))} Stück gewählt</span>
      </div>

      {check === "loading" ? (
        <div className="space-y-2" aria-busy>
          {recommendations.map((r) => (
            <Skeleton key={r.id} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {rows.map((r) => {
            const available = r.available === true;
            const isChosen = available && chosen.has(r.id);
            const quantity = chosen.get(r.id) ?? 1;
            const maxQty = maxSetQuantity(r.unitStock, BUNDLE_QUANTITY_MAX);
            const stockText = stockLabel(r);
            const lineCents = isChosen && r.price != null ? setNormalPriceCents([{ price: r.price, quantity }]) : null;
            return (
              <li
                key={r.id}
                className={cn("flex items-center gap-2.5 px-2.5 py-2", !available && "bg-surface-2 text-muted-foreground")}
              >
                <Checkbox
                  className="size-4 shrink-0"
                  checked={isChosen}
                  disabled={busy || !available}
                  onChange={(e) => toggle(r.id, e.target.checked)}
                  aria-label={`${r.name} ins Set`}
                />
                {r.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.imageUrl}
                    alt=""
                    className={cn(
                      "size-10 shrink-0 rounded-md border border-border bg-white object-contain",
                      !available && "opacity-40 grayscale"
                    )}
                    onError={(e) => {
                      e.currentTarget.style.visibility = "hidden";
                    }}
                  />
                ) : (
                  <span className="size-10 shrink-0 rounded-md border border-dashed border-border bg-surface-2" aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-xs", available ? "font-medium" : "line-through")}>{r.name}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-2xs text-muted-foreground">
                    {r.price != null && <span className="tabular-nums">{money(r.price, "EUR")}</span>}
                    {available ? (
                      stockText && (
                        <span className={cn("tabular-nums", r.unitStock != null && quantity >= r.unitStock && "text-warning")}>
                          · {stockText}
                        </span>
                      )
                    ) : (
                      <StatusBadge tone="warning">{stockText ?? "Nicht verfügbar"}</StatusBadge>
                    )}
                  </span>
                </span>
                <div className="w-[4.5rem] shrink-0">
                  <Select
                    value={String(quantity)}
                    onChange={(e) => setQuantity(r.id, Number(e.target.value))}
                    disabled={busy || !isChosen}
                    aria-label={`Anzahl ${r.name}`}
                    className="h-8 pr-7 text-xs"
                  >
                    {Array.from({ length: maxQty }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n}×
                      </option>
                    ))}
                  </Select>
                </div>
                <span className="w-20 shrink-0 text-right text-xs tabular-nums">
                  {lineCents != null ? eurFromCentsPlain(lineCents) : ""}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-end justify-between gap-3 border-t border-border pt-3">
        <Field
          label="Set-Preis"
          info="Leer lassen = das Set kostet den Normalpreis (Summe der Einzelpreise × Anzahl, grau im Feld) — dann zeigt die Mail keinen Streichpreis. Ein niedrigerer Preis wird in der Mail als Ersparnis gegenüber dem Normalpreis hervorgehoben."
          className="w-44"
        >
          <Input
            type="text"
            inputMode="decimal"
            placeholder={normalCents != null ? eurFromCentsPlain(normalCents) : "Set-Preis €"}
            value={priceOverride}
            onChange={(e) => setPriceOverride(e.target.value)}
            className="h-9 tabular-nums"
            disabled={busy || check === "loading"}
          />
        </Field>
        <div className="text-right text-xs">
          <div className="text-muted-foreground">Normalpreis</div>
          <div className="text-base font-semibold tabular-nums">
            {normalCents != null ? eurFromCentsPlain(normalCents) : "—"}
          </div>
        </div>
      </div>
      {priceLine && <div className="-mt-1 text-xs">{priceLine}</div>}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {!selection.ok && check !== "loading" && <span className="mr-auto text-xs text-muted-foreground">{selection.reason}</span>}
        <Button
          onClick={() =>
            onCreate(
              chosenRows.map((r) => ({ ref: r.ref, quantity: clampQuantity(r.quantity) })),
              priceCheck.kind === "empty" ? "" : priceOverride.trim()
            )
          }
          disabled={busy || check === "loading" || !selection.ok || priceCheck.kind === "invalid"}
          loading={creating}
        >
          Set erstellen
        </Button>
      </div>
    </div>
  );
}
