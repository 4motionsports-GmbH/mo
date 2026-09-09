// Consent-gate funnel: shown → accepted, plus decline/dismiss split and the
// chat vs. sign-in surface breakdown. Widget-emitted events — measures the UI,
// not the DOI.

import type { ConsentGateCounts, ConsentGateFunnel } from "@/lib/kpi-store";
import { num, ratio } from "@/lib/admin-format.mjs";
import { Stat } from "../../ui";
import { StageFunnelChart } from "../charts";
import { Explain, FunnelLayout, KpiSection, StatGrid, SubHeading } from "../KpiSection";

const INFO = (
  <Explain>
    <p>
      Das Einwilligungs-Gate im Chat und die Opt-in-Karte bei der Anmeldung: angezeigt → akzeptiert
      („Ja, Angebote aktivieren“).
    </p>
    <p>
      Alle vier Events sendet das Widget (<code>consent_gate_shown</code> / <code>_accepted</code> /{" "}
      <code>_declined</code> / <code>_dismissed</code>, mit <code>surface: chat|signin</code>) —
      gemessen wird die Oberfläche, nicht die bestätigte Anmeldung: ein „Akzeptiert“ wird erst mit dem
      Klick auf den Double-Opt-in-Link zur wirksamen Marketing-Einwilligung (siehe
      E-Mail-Capture-Funnel in der Event-Übersicht). Events ohne <code>surface</code> zählen nur in
      den Gesamtwerten.
    </p>
  </Explain>
);

export function ConsentGateSection({ funnel }: { funnel: ConsentGateFunnel | null }) {
  const acceptRate = funnel && funnel.total.shown > 0 ? funnel.total.accepted / funnel.total.shown : null;
  const empty = !funnel
    ? "Noch keine Daten."
    : funnel.total.shown === 0
      ? "Noch keine Consent-Gate-Events im Zeitraum."
      : null;
  return (
    <KpiSection id="consent" title="Consent-Gate-Funnel (Marketing-Opt-in)" info={INFO} empty={empty}>
      {funnel && (
        <>
          <FunnelLayout
            chart={
              <StageFunnelChart
                stages={[
                  { name: "Angezeigt", value: funnel.total.shown },
                  { name: "Akzeptiert", value: funnel.total.accepted },
                ]}
              />
            }
          >
            <Stat label="Angezeigt" value={num(funnel.total.shown)} />
            <Stat
              label="Akzeptiert"
              value={num(funnel.total.accepted)}
              hint={acceptRate == null ? undefined : `${ratio(acceptRate)} Akzeptanzrate`}
            />
            <Stat label="Abgelehnt" value={num(funnel.total.declined)} />
            <Stat label="Weggeklickt" value={num(funnel.total.dismissed)} />
          </FunnelLayout>

          <SubHeading>Nach Oberfläche</SubHeading>
          <StatGrid cols={2}>
            <SurfaceGateStat label="Chat-Gate (anonym)" counts={funnel.bySurface.chat} />
            <SurfaceGateStat label="Bei Anmeldung (eingeloggt)" counts={funnel.bySurface.signin} />
          </StatGrid>
        </>
      )}
    </KpiSection>
  );
}

function SurfaceGateStat({ label, counts }: { label: string; counts: ConsentGateCounts }) {
  const rate = counts.shown > 0 ? counts.accepted / counts.shown : null;
  return (
    <Stat
      label={label}
      value={`${num(counts.accepted)} / ${num(counts.shown)}`}
      hint={
        rate == null
          ? "akzeptiert / angezeigt"
          : `${ratio(rate)} Akzeptanzrate · ${num(counts.declined)} abgelehnt · ${num(counts.dismissed)} weggeklickt`
      }
    />
  );
}
