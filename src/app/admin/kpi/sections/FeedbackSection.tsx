// Feedback — volume + tier split.

import type { FeedbackKpis } from "@/lib/feedback-store";
import { num, ratio } from "@/lib/admin-format.mjs";
import { BarList, Stat } from "../../ui";

import { Explain, KpiSection, StatGrid, SubHeading } from "../KpiSection";

const INFO = (
  <Explain>
    <p>Freitext-Feedback aus dem Widget — Volumen im Zeitraum.</p>
    <p>
      Reines Volumen — die Inhalte stehen im Feedback-Tab. Der Kundentyp ist die
      Widget-Selbstauskunft (telemetriegradig, nicht verbindlich).
    </p>
  </Explain>
);

export function FeedbackSection({ kpis }: { kpis: FeedbackKpis | null }) {
  const empty = !kpis ? "Noch keine Daten." : kpis.total === 0 ? "Kein Feedback im Zeitraum." : null;
  return (
    <KpiSection id="feedback" title="Feedback" info={INFO} empty={empty}>
      {kpis && (
        <>
          <StatGrid cols={3}>
            <Stat label="Eingegangen" value={num(kpis.total)} />
            <Stat
              label="Mit Gesprächsbezug"
              value={num(kpis.withConversation)}
              hint={kpis.total > 0 ? ratio(kpis.withConversation / kpis.total) : undefined}
            />
            <Stat label="Mit Kontakt-E-Mail" value={num(kpis.withEmail)} hint="antwortbar" />
          </StatGrid>
          {kpis.byTier.length > 0 && (
            <>
              <SubHeading>Nach Kundentyp</SubHeading>
              <BarList rows={kpis.byTier.map((t) => ({ key: t.tier, label: t.tier, count: t.count }))} />
            </>
          )}
        </>
      )}
    </KpiSection>
  );
}
