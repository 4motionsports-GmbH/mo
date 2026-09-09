// Physical mail (Pingen): how many letters went out and what postage cost.
// Lifetime aggregate (period-independent).

import type { PhysicalLetterStats } from "@/lib/physical-letters-store";
import { eur, num } from "@/lib/admin-format.mjs";
import { Stat } from "../../ui";
import { Explain, KpiSection, LifetimeBadge, StatGrid } from "../KpiSection";

const INFO = (
  <Explain>
    <p>Versendete Briefe (Pingen → Deutsche Post) und die angefallenen Portokosten.</p>
    <p>
      Kosten je Brief stammen aus dem von Pingen gemeldeten Preis; wo (noch) kein Preis vorliegt (z. B.
      Staging), wird ein konfigurierbarer Standard angesetzt (<code>PINGEN_LETTER_COST_CENTS</code>,
      Standard 106 = 1,06 €). Gezählt werden an Pingen übergebene Briefe (fehlgeschlagene Übermittlungen
      zählen nicht).
    </p>
  </Explain>
);

export function PhysicalMailSection({ stats }: { stats: PhysicalLetterStats }) {
  const totalEur = stats.totalCostCents / 100;
  const avgEur = stats.totalSent > 0 ? totalEur / stats.totalSent : 0;
  return (
    <KpiSection
      id="post"
      title="Postversand (Brief)"
      info={INFO}
      badges={<LifetimeBadge />}
      empty={stats.totalSent === 0 ? "Noch keine Briefe versendet." : null}
    >
      <StatGrid cols={3}>
        <Stat label="Versendete Briefe" value={num(stats.totalSent)} />
        <Stat label="Portokosten gesamt" value={eur(totalEur)} />
        <Stat label="Ø Kosten / Brief" value={eur(avgEur)} />
      </StatGrid>
    </KpiSection>
  );
}
