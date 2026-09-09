// Gesprächsqualität — analysis coverage + quality/category distribution over
// the window (the same cached analysis columns the Gespräche tab reads).

import type { ConversationStats } from "@/lib/admin-conversations";
import { num, ratio } from "@/lib/admin-format.mjs";
import { BarList, Stat } from "../../ui";

import { ChartCard, Explain, KpiSection, StatGrid } from "../KpiSection";

const INFO = (
  <Explain>
    <p>Analyse-Abdeckung und Qualitäts-/Themenverteilung der analysierten Beratungen.</p>
    <p>
      Verteilungen umfassen nur Beratungen, die im Gespräche-Tab (einzeln oder per Bulk) analysiert
      wurden — die Abdeckung oben zeigt, wie repräsentativ das ist. Die Analyse läuft auf Abruf, nicht
      automatisch.
    </p>
  </Explain>
);

export function QualitySection({ stats }: { stats: ConversationStats | null }) {
  const coverage = stats && stats.total > 0 ? stats.analyzedCount / stats.total : null;
  const sum = (pred: (quality: string) => boolean) =>
    stats ? stats.qualities.filter((q) => pred(q.quality)).reduce((a, q) => a + q.count, 0) : 0;
  return (
    <KpiSection
      id="qualitaet"
      title="Gesprächsqualität (KI-Analyse)"
      info={INFO}
      empty={!stats || stats.total === 0 ? "Noch keine Beratungen im Zeitraum." : null}
    >
      {stats && (
        <>
          <StatGrid cols={3}>
            <Stat
              label="Analysiert"
              value={`${num(stats.analyzedCount)} / ${num(stats.total)}`}
              hint={coverage == null ? undefined : `${ratio(coverage)} Abdeckung`}
            />
            <Stat
              label="Problem-Signale"
              value={num(sum((q) => q === "unmet_need" || q === "dropped_off"))}
              hint="unerfüllter Bedarf + abgesprungen"
            />
            <Stat label="Gut gelöst" value={num(sum((q) => q === "handled_well"))} />
          </StatGrid>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ChartCard title="Qualität">
              <BarList
                rows={stats.qualities.map((q) => ({ key: q.quality, label: q.label, count: q.count }))}
                empty="Noch keine analysierten Beratungen."
              />
            </ChartCard>
            <ChartCard title="Themen (Kategorien)">
              <BarList
                rows={stats.categories.slice(0, 8).map((c) => ({ key: c.category, label: c.label, count: c.count }))}
                empty="Noch keine analysierten Beratungen."
              />
            </ChartCard>
          </div>
        </>
      )}
    </KpiSection>
  );
}
