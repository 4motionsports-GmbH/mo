// Home-Gym-Konfigurator (Men's Health / Women's Health) on the KPI screen — the
// funnel's headline numbers and the money, for any KPI period, with a link to
// the Konfigurator screen for the detail (answers, plan products, latest
// consultations). Data: configurator-store getConfiguratorSummary (pure DB,
// never cached). The orders are the same as the row „davon über den
// Home-Gym-Konfigurator“ in „Wie der Umsatz entstand“ (docs/CONFIGURATOR.md §6).

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { ConfiguratorSummary } from "@/lib/configurator-store";
import type { KpiRange } from "@/lib/kpi-range";
import { configuratorFunnel } from "@/lib/configurator-core.mjs";
import { releaseNotesFor } from "@/lib/kpi-releases.mjs";
import { eur, num, ratio } from "@/lib/admin-format.mjs";
import { Stat, buttonVariants } from "../../ui";
import { KpiSection, StatGrid } from "../KpiSection";
import { CART_INFO, FUNNEL_INFO, ORDERS_INFO, STAGE_INFO } from "../../konfigurator/KonfiguratorKpis";

export function KonfiguratorSection({
  summary,
  range,
  href,
}: {
  summary: ConfiguratorSummary | null;
  range: KpiRange;
  /** The Konfigurator screen for (about) this period. */
  href: string;
}) {
  const s = summary?.sessions;
  const f = s ? configuratorFunnel(s) : null;
  const empty = !summary
    ? "Noch keine Daten."
    : s && s.started + s.handover + s.chats + s.plans + s.carts + s.orders === 0
      ? "Im Zeitraum hat niemand den Konfigurator genutzt."
      : null;
  return (
    <KpiSection
      id="konfigurator"
      title="Home-Gym-Konfigurator"
      info={FUNNEL_INFO}
      empty={empty}
      notes={releaseNotesFor("konfigurator", range)}
      actions={
        <Link href={href} className={buttonVariants({ variant: "ghost", size: "xs" })}>
          <ExternalLink /> Im Konfigurator öffnen
        </Link>
      }
    >
      {summary && s && f && !empty && (
        <StatGrid cols={4}>
          <Stat
            label="An Mo übergeben"
            value={num(s.handover)}
            hint={f.handoverRate == null ? `${num(s.started)} begonnen` : `${ratio(f.handoverRate)} der Begonnenen`}
            info={STAGE_INFO.handover}
          />
          <Stat
            label="Plan erstellt"
            value={num(s.plans)}
            hint={`${num(summary.plansShown)} Pläne · ${num(summary.optionsPicked)} Auswahlen · ${f.planRate == null ? "—" : ratio(f.planRate)} der Beratungen`}
            info={STAGE_INFO.plans}
          />
          <Stat
            label="Warenkorb"
            value={eur(summary.cartValue, 0)}
            hint={`${num(s.carts)} Sitzungen · ${num(summary.cartUnits)} Artikel`}
            info={CART_INFO}
          />
          <Stat
            label="Bestellungen"
            value={num(summary.orders)}
            hint={`${eur(summary.revenue, 0)} · in „Umsatz durch Mo“ enthalten`}
            info={ORDERS_INFO}
          />
        </StatGrid>
      )}
    </KpiSection>
  );
}
