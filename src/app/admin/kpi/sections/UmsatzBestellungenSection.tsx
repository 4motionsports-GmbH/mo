// „Was genau passiert ist“ — the drill-down of „Umsatz durch Mo“: every
// attributed order of the period with its story and links (client island
// kpi/RevenueOrders). Includes the unpaid ledger orders (struck through, not in
// the totals) and the coded orders the Shopify lookup added.

import { Explain, KpiSection } from "../KpiSection";
import { RevenueOrders } from "../RevenueOrders";
import type { RevenueView } from "../revenue-view";

const INFO = (
  <Explain>
    <p>
      Jede Mo-zugeordnete Bestellung des Zeitraums: Datum, Bestellnummer, eingelöster Mo-Code, der Weg (in der Farbe
      seiner Stufe), was passiert ist und die gekauften Produkte — ein Häkchen markiert die, die in der Beratung der
      Sitzung vorkamen (gezeigt, verglichen oder ausgewählt, bis zur Bestellung).
    </p>
    <p>
      „Beraten am“ ist die letzte Chat-Nachricht der Sitzung vor der Bestellung; die Links öffnen die Kundin oder den
      Kunden (wenn ein Kundenkonto verknüpft ist) und dieses Gespräch. Nicht bezahlte Bestellungen sind durchgestrichen und
      zählen nicht zum Umsatz. „Code-Abgleich“: per Shopify gefunden, nicht per Webhook erfasst — ohne Produkte und Links.
      Auf dieser Seite stehen keine Namen oder E-Mail-Adressen.
    </p>
  </Explain>
);

export function UmsatzBestellungenSection({ view }: { view: RevenueView | null }) {
  const empty = !view
    ? "Noch keine Daten."
    : view.rows.length === 0
      ? "Keine zugeordnete Bestellung im Zeitraum."
      : null;
  return (
    <KpiSection id="umsatz-bestellungen" title="Was genau passiert ist" info={INFO} empty={empty}>
      {view && view.rows.length > 0 && <RevenueOrders rows={view.rows} truncated={view.detailsTruncated} />}
    </KpiSection>
  );
}
