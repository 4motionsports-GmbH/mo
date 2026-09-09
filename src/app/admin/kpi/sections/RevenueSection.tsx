// Revenue attributed to Mo — orders that redeemed a unique Mo marketing code.
// The ONLY honestly-measurable revenue signal via Shopify read_orders; cart
// links carry no marker and are deliberately NOT counted here (they are
// measured by the webhook attribution section).

import type { Cached } from "@/lib/kpi-cache";
import { REVENUE_MAX_CODES, type MoRevenue } from "@/lib/kpi-revenue-store";
import { money, num } from "@/lib/admin-format.mjs";
import { Callout, Stat } from "../../ui";
import { Explain, FreshnessBadge, KpiSection, StatGrid } from "../KpiSection";

const INFO = (
  <Explain>
    <p>Bestellungen, die einen einmaligen, von Mo verschickten Rabattcode eingelöst haben.</p>
    <p>
      „Umsatz über Mo-Rabattcodes“ zählt <strong>ausschließlich</strong> Bestellungen, die einen{" "}
      <strong>einmaligen, von Mo verschickten Rabattcode</strong> (<code>MS5-…</code>, aus der
      personalisierten Marketing-E-Mail) eingelöst haben — geprüft per Shopify (
      <code>read_orders</code>) über das Bestellfeld <code>discount_code</code>, gezählt wird der
      tatsächlich bezahlte Bestellwert (<code>currentTotalPrice</code>, nur Status PAID /
      PARTIALLY_REFUNDED). Käufe über Warenkorb-Links (In-Chat-Checkout, Zusammenfassungs-E-Mail,
      Bundles) zählen hier bewusst NICHT — sie werden seit der Attributions-Runde separat im Abschnitt
      „Mo-zugeordneter Umsatz (Bestell-Webhook)“ gemessen.
    </p>
  </Explain>
);

export function RevenueSection({ cached }: { cached: Cached<MoRevenue | null> }) {
  const revenue = cached.value;
  return (
    <KpiSection
      id="umsatz-codes"
      title="Umsatz über Mo-Rabattcodes"
      info={INFO}
      badges={<FreshnessBadge fetchedAt={cached.fetchedAt} fromCache={cached.fromCache} />}
      empty={revenue ? null : "Noch keine Daten."}
      notes={
        revenue
          ? [
              revenue.redemptionUnknown > 0 &&
                `Bei ${num(revenue.redemptionUnknown)} Code(s) lieferte Shopify keine Antwort (nicht gezählt).`,
              revenue.sampled && `Auf die ${REVENUE_MAX_CODES} neuesten Codes begrenzt.`,
            ]
          : []
      }
    >
      {revenue && !revenue.shopifyConfigured ? (
        <Callout tone="warning" compact>
          Shopify ist nicht konfiguriert — der Umsatz kann nicht berechnet werden.
        </Callout>
      ) : (
        revenue && (
          <StatGrid cols={3}>
            <Stat
              label="Umsatz über Mo-Rabattcodes"
              value={money(revenue.revenueAmount, revenue.currency)}
              hint={`${num(revenue.orderCount)} Bestellung(en) im Zeitraum`}
              info="Summe der tatsächlich bezahlten Bestellsummen (Shopify currentTotalPrice, Status PAID/PARTIALLY_REFUNDED) aller Bestellungen, die einen einmaligen, von Mo verschickten Rabattcode (MS5-…) eingelöst haben. Warenkorb-Links ohne Code sind nicht zurechenbar und zählen nicht."
            />
            <Stat
              label="Bestellungen mit Mo-Code"
              value={num(revenue.orderCount)}
              hint="eingelöste, bezahlte Bestellungen"
            />
            <Stat
              label="Geprüfte Codes"
              value={num(revenue.codesChecked)}
              hint={`${num(revenue.codesInScope)} versendete Codes im Zeitraum`}
            />
          </StatGrid>
        )
      )}
    </KpiSection>
  );
}
