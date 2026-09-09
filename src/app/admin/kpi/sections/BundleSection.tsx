// Bundle-Angebote — created offers, lifecycle, clicks on the offer link.

import type { BundleKpis } from "@/lib/bundle-offers-store";
import { num, ratio } from "@/lib/admin-format.mjs";
import { Stat } from "../../ui";
import { Explain, KpiSection, StatGrid } from "../KpiSection";

const INFO = (
  <Explain>
    <p>
      Persönliche Set-Angebote (unlisted Shopify-Produkte): erstellt, Lebenszyklus und Klicks auf den
      Angebots-Link.
    </p>
    <p>
      Klicks stammen vom getrackten Angebots-Link (<code>bundle_offer_clicked</code>). Ein{" "}
      <strong>Kauf</strong> eines Bundles wird bewusst <strong>nicht</strong> zugerechnet — es gibt kein
      zuverlässig gespeichertes Bestellsignal je Angebot (keine erfundene Zuordnung; siehe
      Umsatz-Abschnitt).
    </p>
  </Explain>
);

export function BundleSection({ kpis }: { kpis: BundleKpis | null }) {
  const empty = !kpis
    ? "Noch keine Daten."
    : kpis.created.total === 0 && kpis.clicks === 0 && kpis.activeNow === 0
      ? "Noch keine Bundle-Angebote im Zeitraum."
      : null;
  return (
    <KpiSection id="bundles" title="Bundle-Angebote" info={INFO} empty={empty}>
      {kpis && (
        <StatGrid cols={4}>
          <Stat
            label="Erstellt"
            value={num(kpis.created.total)}
            hint={`${num(kpis.created.active)} aktiv · ${num(kpis.created.expired)} abgelaufen · ${num(kpis.created.failed)} fehlgeschlagen`}
          />
          <Stat label="Aktuell aktiv" value={num(kpis.activeNow)} hint="unabhängig vom Zeitraum" />
          <Stat
            label="Klicks auf Angebot"
            value={num(kpis.clicks)}
            hint={`${num(kpis.clickedOffers)} Angebot(e) geklickt`}
          />
          <Stat label="Ø Rabatt-Tiefe" value={ratio(kpis.avgDiscountPct)} hint="vs. Summe der Einzelpreise" />
        </StatGrid>
      )}
    </KpiSection>
  );
}
