// Bundle-Angebote — created offers, lifecycle, clicks on the offer link, and
// the orders through a Set link (channel „Set-Angebot“ of „Umsatz durch Mo“).

import type { BundleKpis } from "@/lib/bundle-offers-store";
import { money, num, ratio } from "@/lib/admin-format.mjs";
import { Stat } from "../../ui";
import { Explain, KpiSection, StatGrid } from "../KpiSection";

const INFO = (
  <Explain>
    <p>
      Persönliche Set-Angebote (unlisted Shopify-Produkte): erstellt, Lebenszyklus und Klicks auf den
      Angebots-Link.
    </p>
    <p>
      Klicks stammen vom getrackten Angebots-Link (<code>bundle_offer_clicked</code>). „Über Set-Link gekauft“
      sind die Bestellungen des Wegs „Set-Angebot“ aus „Umsatz durch Mo“: der Warenkorb-Link des Angebots trägt die
      Mo-Markierung, gezählt im Zuordnungsfenster ab der Erstellung des Angebots. Einem einzelnen Angebot wird ein
      Kauf nicht zugeordnet (kein Bestellsignal je Angebot gespeichert); hat die Bestellung einen Kampagnen-Code, zählt
      sie unter „Kampagne“.
    </p>
  </Explain>
);

export function BundleSection({
  kpis,
  purchases,
}: {
  kpis: BundleKpis | null;
  /** Orders of the channel „Set-Angebot“ in the period (revenue centre). */
  purchases: { orders: number; revenue: number; currency: string } | null;
}) {
  const empty = !kpis
    ? "Noch keine Daten."
    : kpis.created.total === 0 && kpis.clicks === 0 && kpis.activeNow === 0 && !purchases?.orders
      ? "Noch keine Bundle-Angebote im Zeitraum."
      : null;
  return (
    <KpiSection id="bundles" title="Bundle-Angebote" info={INFO} empty={empty}>
      {kpis && (
        <StatGrid cols={4}>
          <Stat
            label="Über Set-Link gekauft"
            value={purchases ? money(purchases.revenue, purchases.currency) : "—"}
            hint={purchases ? `${num(purchases.orders)} bezahlte Bestellung(en) im Zeitraum` : undefined}
          />
          <Stat
            label="Erstellt"
            value={num(kpis.created.total)}
            hint={`${num(kpis.created.active)} aktiv · ${num(kpis.created.expired)} abgelaufen · ${num(kpis.created.failed)} fehlgeschlagen`}
          />
          <Stat
            label="Klicks auf Angebot"
            value={num(kpis.clicks)}
            hint={`${num(kpis.clickedOffers)} Angebot(e) geklickt`}
          />
          <Stat
            label="Ø Rabatt-Tiefe"
            value={ratio(kpis.avgDiscountPct)}
            hint={`vs. Summe der Einzelpreise · ${num(kpis.activeNow)} aktuell aktiv`}
          />
        </StatGrid>
      )}
    </KpiSection>
  );
}
