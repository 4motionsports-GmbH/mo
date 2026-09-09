// Mo-attributed orders (webhook ingest) — the tiered attribution pipeline:
// orders/create + orders/paid webhooks push every Mo-marked order into
// mo_orders; a plain DB aggregate — no Shopify calls, no caps, no sampling.
// docs/ORDER_ATTRIBUTION.md.

import type { MoAttributionKpis } from "@/lib/mo-orders-store";
import { money, num } from "@/lib/admin-format.mjs";
import { Callout, Stat } from "../../ui";
import { Explain, KpiSection, StatGrid } from "../KpiSection";

export function AttributionSection({ attribution }: { attribution: MoAttributionKpis | null }) {
  const info = (
    <Explain>
      <p>
        Bestellungen mit Mo-Markierung (Warenkorb-Attribut oder Mo-Rabattcode), per Shopify-Webhook
        erfasst.
      </p>
      <p>
        Erfasst werden <strong>ausschließlich</strong> Bestellungen mit Mo-Markierung: dem opaken
        Warenkorb-Attribut <code>attributes[_mo]</code> (von Mo-Links oder dem Widget-Stempel gesetzt,
        Zuordnungsfenster {num(attribution?.attributionWindowDays ?? 0)} Tage) oder einem
        Mo-Rabattcode. Unmarkierte Bestellungen werden <strong>gar nicht gespeichert</strong>{" "}
        (Datenminimierung); die Zeilen sind pseudonym (keine Kundendaten). Geräteübergreifende Käufe
        (Beratung am Handy, Kauf am Laptop) bleiben ohne E-Mail/Code unsichtbar — physikalische Grenze,
        keine Messlücke.
      </p>
    </Explain>
  );
  return (
    <KpiSection
      id="umsatz-webhook"
      title="Mo-zugeordneter Umsatz (Bestell-Webhook)"
      info={info}
      empty={attribution ? null : "Noch keine Daten."}
      notes={[
        attribution != null &&
          attribution.unrealisedOrders > 0 &&
          `${num(attribution.unrealisedOrders)} erfasste Bestellung(en) im Zeitraum sind (noch) nicht bezahlt und zählen nicht zum Umsatz.`,
      ]}
    >
      {attribution && !attribution.ingestionSeen ? (
        <Callout tone="info" compact>
          Noch keine Bestellung über den Webhook erfasst. Voraussetzung: die Shopify-Webhooks{" "}
          <code>orders/create</code> + <code>orders/paid</code> sind auf{" "}
          <code>/api/webhooks/shopify</code> registriert (siehe docs/ORDER_ATTRIBUTION.md) — erfasst
          wird ab Registrierung, rückwirkend nicht.
        </Callout>
      ) : (
        attribution && (
          <StatGrid cols={3}>
            <Stat
              label="Direkt"
              value={money(attribution.direct.revenueAmount, attribution.currency)}
              hint={`${num(attribution.direct.orderCount)} Bestellung(en)`}
              info="Bestellungen über einen von Mo gebauten Kauf-Weg: ein eingelöster Mo-Rabattcode (MS5-/MK-) oder ein von Mo verschickter Warenkorb-Link (Zusammenfassung, Marketing-E-Mail, Bundle). Nur bezahlte Bestellungen (PAID/PARTIALLY_REFUNDED)."
            />
            <Stat
              label="Beraten & gekauft"
              value={money(attribution.assisted.revenueAmount, attribution.currency)}
              hint={`${num(attribution.assisted.orderCount)} Bestellung(en)`}
              info="Der Warenkorb trug die Session-Markierung des Widgets UND mindestens ein gekauftes Produkt wurde in dieser Beratung besprochen/ausgewählt — auch wenn es manuell über die Suche in den Warenkorb gelegt wurde."
            />
            <Stat
              label="Beraten, anderes gekauft"
              value={money(attribution.influenced.revenueAmount, attribution.currency)}
              hint={`${num(attribution.influenced.orderCount)} Bestellung(en)`}
              info="Session-Markierung vorhanden, aber kein gekauftes Produkt stammt aus der Beratung — Mo hat beraten, gekauft wurde etwas anderes."
            />
          </StatGrid>
        )
      )}
    </KpiSection>
  );
}
