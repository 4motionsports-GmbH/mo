// Recommendation → purchase loop — ROI figure for the subset of customers who
// gave their e-mail. Lifetime aggregate, Shopify-dependent (cached).

import type { Cached } from "@/lib/kpi-cache";
import type { RecommendationLoopResult } from "@/lib/kpi-recommendation-loop";
import { num, ratio } from "@/lib/admin-format.mjs";
import { Callout, Stat } from "../../ui";
import { StageFunnelChart } from "../charts";
import { Explain, FreshnessBadge, FunnelLayout, KpiSection, LifetimeBadge } from "../KpiSection";

const INFO = (
  <Explain>
    <p>
      ROI-Kennwert für die Teilmenge der Kund:innen, die ihre E-Mail angegeben haben — KEINE
      site-weite Conversion-Rate.
    </p>
    <p>
      ⚠️ Aussagekraft begrenzt: erfasst <strong>nur</strong> Nutzer, die eine E-Mail angegeben{" "}
      <strong>und</strong> der Verarbeitung zugestimmt haben — also eine Minderheit aller Chatter und
      nicht alle Käufer. Produkt-Zuordnung erfolgt über normalisierte Shopify-Handles;
      umbenannte/archivierte Produkte können fehlen.
    </p>
  </Explain>
);

export function LoopSection({ cached }: { cached: Cached<RecommendationLoopResult | null> }) {
  const loop = cached.value;
  return (
    <KpiSection
      id="empfehlung-kauf"
      title="Empfehlung → Kauf (nur Kund:innen mit E-Mail-Angabe)"
      info={INFO}
      badges={
        <>
          <LifetimeBadge />
          <FreshnessBadge fetchedAt={cached.fetchedAt} fromCache={cached.fromCache} />
        </>
      }
      empty={loop ? null : "Noch keine Daten."}
      notes={
        loop?.shopifyConfigured
          ? [
              loop.purchaseUnknown > 0 &&
                `Bei ${num(loop.purchaseUnknown)} Kontakt(en) lieferte Shopify keine Antwort (als „unbekannt“ gewertet).`,
              loop.sampled && "Stichprobe auf die 100 neuesten Kontakte begrenzt.",
            ]
          : []
      }
    >
      {loop && !loop.shopifyConfigured ? (
        <Callout tone="warning" compact>
          Shopify ist nicht konfiguriert — die Kauf-Zuordnung kann nicht berechnet werden.
        </Callout>
      ) : (
        loop && (
          <>
            <Callout tone="warning" compact>
              Nur Kund:innen, die ihre E-Mail angegeben haben — also eine Minderheit aller
              Chat-Nutzer:innen. Diese Zahl ist <strong>keine</strong> site-weite Conversion-Rate.
            </Callout>

            <div className="mt-3 flex flex-wrap items-baseline gap-3">
              <span className="text-3xl font-bold tabular-nums text-foreground">
                {ratio(loop.recommendationToPurchaseRate)}
              </span>
              <span className="text-sm text-muted-foreground">
                der Käufer:innen <strong>mit E-Mail-Angabe</strong> kauften ein zuvor empfohlenes Produkt
              </span>
            </div>

            <div className="mt-4">
              <FunnelLayout
                chart={
                  <StageFunnelChart
                    stages={[
                      { name: "Kontakte geprüft", value: loop.contactsExamined },
                      { name: "mit Empfehlung", value: loop.withRecommendation },
                      { name: "mit Kauf", value: loop.withPurchase },
                      { name: "Kauf = Empfehlung", value: loop.withRecommendedPurchase },
                    ]}
                  />
                }
              >
                <Stat label="Kontakte geprüft" value={num(loop.contactsExamined)} />
                <Stat label="mit Empfehlung" value={num(loop.withRecommendation)} />
                <Stat label="mit Kauf" value={num(loop.withPurchase)} />
                <Stat label="Kauf = Empfehlung" value={num(loop.withRecommendedPurchase)} />
              </FunnelLayout>
            </div>
          </>
        )
      )}
    </KpiSection>
  );
}
