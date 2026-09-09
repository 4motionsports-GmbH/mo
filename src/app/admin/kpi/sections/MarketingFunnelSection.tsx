// Marketing funnel: sent → clicked → converted (unique code redeemed).
// Lifetime aggregate, Shopify-dependent (cached).

import type { Cached } from "@/lib/kpi-cache";
import type { MarketingFunnel } from "@/lib/marketing-store";
import { num, ratio } from "@/lib/admin-format.mjs";
import { Stat } from "../../ui";
import { StageFunnelChart } from "../charts";
import { Explain, FreshnessBadge, FunnelLayout, KpiSection, LifetimeBadge } from "../KpiSection";

const MARKETING_FUNNEL_DISPLAY_CAP = 100;

const INFO = (
  <Explain>
    <p>Versendete Marketing-E-Mails: gesendet → geklickt → eingelöst (persönlicher Code verwendet).</p>
    <p>
      „Geklickt“ zählt E-Mails, deren Warenkorb-Link (über die getrackte Weiterleitung{" "}
      <code>/api/r/&lt;token&gt;</code>) mindestens einmal angeklickt wurde — kein Tracking-Pixel, nur
      der bewusst geklickte Link. „Eingelöst“ prüft per Shopify (<code>read_orders</code>), ob der{" "}
      <strong>einmalige persönliche Code</strong> der jeweiligen E-Mail in einer echten Bestellung
      verwendet wurde; die Einlösungsrate bezieht sich auf die geprüften Codes mit Shopify-Antwort
      (nicht auf alle Sends — die Prüfung ist auf die neuesten Codes begrenzt).
    </p>
  </Explain>
);

export function MarketingFunnelSection({ cached }: { cached: Cached<MarketingFunnel | null> }) {
  const funnel = cached.value;
  const empty = !funnel
    ? "Noch keine Daten."
    : funnel.sent === 0
      ? "Noch keine Marketing-E-Mails versendet."
      : null;
  return (
    <KpiSection
      id="marketing-funnel"
      title="Marketing-Funnel"
      info={INFO}
      badges={
        <>
          <LifetimeBadge />
          <FreshnessBadge fetchedAt={cached.fetchedAt} fromCache={cached.fromCache} />
        </>
      }
      empty={empty}
      notes={
        funnel
          ? [
              !funnel.shopifyConfigured &&
                "Shopify ist nicht konfiguriert — die Einlösung kann nicht berechnet werden.",
              funnel.shopifyConfigured &&
                funnel.redemptionUnknown > 0 &&
                `Bei ${num(funnel.redemptionUnknown)} Code(s) lieferte Shopify keine Antwort (als „unbekannt“ gewertet).`,
              funnel.sampled &&
                `Einlösungsprüfung auf die ${MARKETING_FUNNEL_DISPLAY_CAP} neuesten Codes begrenzt.`,
            ]
          : []
      }
    >
      {funnel && (
        <FunnelLayout
          chart={
            <StageFunnelChart
              stages={[
                { name: "Gesendet", value: funnel.sent },
                { name: "Geklickt", value: funnel.clicked },
                ...(funnel.shopifyConfigured ? [{ name: "Eingelöst", value: funnel.converted }] : []),
              ]}
            />
          }
        >
          <Stat label="Gesendet" value={num(funnel.sent)} />
          <Stat
            label="Geklickt"
            value={num(funnel.clicked)}
            hint={funnel.clickRate == null ? undefined : `${ratio(funnel.clickRate)} Klickrate`}
          />
          <Stat
            label="Eingelöst (Code verwendet)"
            value={funnel.shopifyConfigured ? num(funnel.converted) : "—"}
            hint={
              funnel.shopifyConfigured && funnel.conversionRate != null
                ? `${ratio(funnel.conversionRate)} der geprüften Codes`
                : undefined
            }
          />
        </FunnelLayout>
      )}
    </KpiSection>
  );
}
