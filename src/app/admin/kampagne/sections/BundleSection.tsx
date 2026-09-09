"use client";

// Per-card bundle-offer section: shows the attached active set (price, "statt"
// when genuinely cheaper, expiry, archive), or a small composer that creates a
// set from the card's recommended products via the EXISTING bundle mechanism
// (/api/admin/bundles/create with campaignContactId — docs/BUNDLES.md).

import * as React from "react";
import { ADMIN_DATE, formatAdmin } from "@/lib/admin-datetime.mjs";
import { money } from "@/lib/admin-format.mjs";
import { Button, Checkbox, Input } from "../../ui";
import type { CampaignBundle, CampaignRecommendation } from "../types";

export function BundleSection({
  bundle,
  recommendations,
  shopifyConfigured,
  busy,
  creating,
  onCreate,
  onArchive,
}: {
  bundle: CampaignBundle | null;
  recommendations: CampaignRecommendation[];
  shopifyConfigured: boolean;
  busy: boolean;
  creating: boolean;
  onCreate: (productIds: string[], priceOverride: string) => void;
  onArchive: () => void;
}) {
  const [selected, setSelected] = React.useState<Set<string>>(
    () => new Set(recommendations.map((r) => r.id))
  );
  const [priceOverride, setPriceOverride] = React.useState("");
  // Re-seed the composer when the card (its recommendations) changes.
  const recKey = recommendations.map((r) => r.id).join("|");
  React.useEffect(() => {
    setSelected(new Set(recommendations.map((r) => r.id)));
    setPriceOverride("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recKey]);

  if (bundle) {
    const price = Number(bundle.bundlePrice);
    const sum = Number(bundle.componentsSum);
    return (
      <div className="rounded-md border border-border px-2.5 py-2 text-xs">
        <div className="font-medium">{bundle.title}</div>
        <div className="text-muted-foreground">{bundle.components.join(" + ")}</div>
        <div className="mt-1 tabular-nums">
          {Number.isFinite(price) ? money(price, bundle.currency || "EUR") : bundle.bundlePrice}
          {Number.isFinite(price) && Number.isFinite(sum) && price < sum && (
            <span className="text-muted-foreground"> (statt {money(sum, bundle.currency || "EUR")})</span>
          )}
          {bundle.expiresAt ? (
            <span className="text-muted-foreground"> · läuft ab {formatAdmin(bundle.expiresAt, ADMIN_DATE)}</span>
          ) : null}
        </div>
        <Button variant="outline" size="sm" className="mt-2" onClick={onArchive} disabled={busy}>
          Set entfernen (archivieren)
        </Button>
      </div>
    );
  }

  if (!shopifyConfigured || recommendations.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        {shopifyConfigured
          ? "Keine Empfehlungen, aus denen ein Set gebaut werden könnte."
          : "Shopify nicht konfiguriert — keine Set-Angebote möglich."}
      </div>
    );
  }

  return (
    <div className="space-y-1.5 text-xs">
      {recommendations.map((r) => (
        <label key={r.id} className="flex cursor-pointer items-center gap-1.5">
          <Checkbox
            className="size-3.5"
            checked={selected.has(r.id)}
            disabled={busy}
            onChange={(e) => {
              setSelected((prevSelected) => {
                const nextSelected = new Set(prevSelected);
                if (e.target.checked) nextSelected.add(r.id);
                else nextSelected.delete(r.id);
                return nextSelected;
              });
            }}
          />
          <span className="truncate">{r.name}</span>
        </label>
      ))}
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <Input
          type="text"
          inputMode="decimal"
          placeholder="Set-Preis € (optional)"
          value={priceOverride}
          onChange={(e) => setPriceOverride(e.target.value)}
          className="h-8 w-40 text-xs"
          aria-label="Set-Preis (optional, sonst Summe der Einzelpreise)"
          disabled={busy}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => onCreate([...selected], priceOverride)}
          disabled={busy || selected.size === 0}
          loading={creating}
        >
          Set aus Empfehlungen erstellen
        </Button>
      </div>
      <p className="text-muted-foreground">
        Erstellt ein echtes (unlisted) Shopify-Set; der Text wird automatisch neu generiert und
        der Angebots-Block beim Versand angehängt.
      </p>
    </div>
  );
}
