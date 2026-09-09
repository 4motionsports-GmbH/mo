// Wissen (Q&A) — queue state, throughput, answer latency, scan backlog.

import type { QaKpis } from "@/lib/qa-store";
import { hours, num } from "@/lib/admin-format.mjs";
import { Stat } from "../../ui";
import { Explain, KpiSection, StatGrid } from "../KpiSection";

const INFO = (
  <Explain>
    <p>Wissenslücken aus Beratungen: gefunden → beantwortet → veröffentlicht — Durchsatz im Zeitraum.</p>
    <p>
      „Lücken gefunden“ = im Zeitraum erstellte Queue-Einträge (der Scan läuft auf Abruf im
      Wissen-Tab). Die Latenz misst vom Entwurf bis zur Operator-Antwort bzw. Veröffentlichung (Median
      über die im Zeitraum beantworteten/veröffentlichten Einträge). Ob Mo eine veröffentlichte Antwort
      tatsächlich verwendet hat, wird nicht gemessen.
    </p>
  </Explain>
);

export function QaSection({ kpis }: { kpis: QaKpis | null }) {
  const totalQueue = kpis
    ? kpis.queue.open + kpis.queue.answered + kpis.queue.published + kpis.queue.dismissed
    : 0;
  const empty = !kpis
    ? "Noch keine Daten."
    : totalQueue === 0 && kpis.scanBacklog === 0
      ? "Noch keine Q&A-Einträge."
      : null;
  return (
    <KpiSection id="wissen" title="Wissen (Q&A-Queue)" info={INFO} empty={empty}>
      {kpis && (
        <>
          <StatGrid cols={4}>
            <Stat label="Lücken gefunden" value={num(kpis.createdInWindow)} hint="im Zeitraum" />
            <Stat label="Veröffentlicht" value={num(kpis.publishedInWindow)} hint="im Zeitraum" />
            <Stat label="Median bis Antwort" value={hours(kpis.medianHoursToAnswer)} />
            <Stat label="Median bis Veröffentlichung" value={hours(kpis.medianHoursToPublish)} />
          </StatGrid>
          <StatGrid cols={4} className="mt-3">
            <Stat label="Offen" value={num(kpis.queue.open)} hint="gesamt" />
            <Stat label="Beantwortet" value={num(kpis.queue.answered)} hint="gesamt" />
            <Stat label="Veröffentlicht" value={num(kpis.queue.published)} hint="gesamt" />
            <Stat
              label="Scan-Backlog"
              value={num(kpis.scanBacklog)}
              hint="geeignete, noch nicht gescannte Beratungen"
            />
          </StatGrid>
        </>
      )}
    </KpiSection>
  );
}
