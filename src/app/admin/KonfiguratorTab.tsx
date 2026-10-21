// „Konfigurator“ (server component): the Home-Gym-Konfigurator of the Men's
// Health / Women's Health cooperation (docs/CONFIGURATOR.md). Fetches once and
// hands plain props on:
//   - „Wirkung“ — the funnel from the first answer to the order, the answers,
//     the partners, the products of Mo's plans and the latest configurator
//     consultations (configurator-store getConfiguratorKpis, pure DB, never
//     cached), for the ?kpiRange= period (7d / 30d / 90d, like the KPI screen);
//   - „Mo im Konfigurator“ + „Sortiment“ — the operator settings
//     (admin_settings 'configurator') and the curated assortment resolved
//     against the live catalog, edited in the client KonfiguratorWorkspace.

import { resolveKpiRange } from "@/lib/kpi-range";
import {
  getConfiguratorKpis,
  getConfiguratorSettings,
  loadConfiguratorAssortment,
} from "@/lib/configurator-store";
import { KonfiguratorRange, KonfiguratorWorkspace } from "./lazy";
import { Callout } from "./ui";
import { KonfiguratorKpis } from "./konfigurator/KonfiguratorKpis";
import type { AssortmentRow } from "./konfigurator/types";

export async function KonfiguratorTab({ dbReady, kpiRange }: { dbReady: boolean; kpiRange?: string }) {
  const range = resolveKpiRange({ kpiRange: kpiRange === "7d" || kpiRange === "90d" ? kpiRange : "30d" });
  const settings = await getConfiguratorSettings();
  const [assortment, kpis] = await Promise.all([
    loadConfiguratorAssortment(settings),
    dbReady ? getConfiguratorKpis(range) : Promise.resolve(null),
  ]);
  const rows: AssortmentRow[] = assortment.products.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    price: p.salePrice ?? p.price,
    priceMin: p.priceMin ?? null,
    priceMax: p.priceMax ?? null,
    inStock: p.inStock,
    image: p.images?.[0] ?? null,
    url: p.shopifyUrl || null,
    viaTag: assortment.via[p.id]?.tag ?? false,
    viaList: assortment.via[p.id]?.list ?? false,
  }));

  return (
    <div className="flex flex-col gap-8">
      {!dbReady && (
        <Callout tone="warning">
          Keine Datenbank konfiguriert (DATABASE_URL) — keine Kennzahlen, und die Einstellungen können nicht
          gespeichert werden. Es gelten die Standardwerte.
        </Callout>
      )}
      <KonfiguratorKpis
        kpis={kpis}
        rangeLabel={range.label}
        rangeControl={<KonfiguratorRange preset={range.preset === "7d" || range.preset === "90d" ? range.preset : "30d"} />}
      />
      <KonfiguratorWorkspace
        dbReady={dbReady}
        initialSettings={settings}
        assortment={rows}
        unknownExtraIds={assortment.unknownExtraIds}
      />
    </div>
  );
}
