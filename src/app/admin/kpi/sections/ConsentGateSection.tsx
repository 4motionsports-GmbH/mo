// Einwilligung nach der Anmeldung — the consent popup the widget shows signed-in
// customers who have not decided yet: shown → accepted, plus decline/dismiss.
// Widget-emitted events (surface "signin") — measures the UI, not the DOI. The
// anonymous chat gate (surface "chat") was retired with the widget of
// 2026-10-01; its old events stay visible while they fall in the period.

import type { ConsentGateCounts, ConsentGateFunnel } from "@/lib/kpi-store";
import { RETIRED_CONSENT_GATE_SURFACES } from "@/lib/kpi-widget-events.mjs";
import { formatAdmin, ADMIN_DATE_PADDED } from "@/lib/admin-datetime.mjs";
import { num, ratio } from "@/lib/admin-format.mjs";
import { Stat } from "../../ui";
import { StageFunnelChart } from "../charts";
import { Explain, FunnelLayout, KpiSection, StatGrid, SubHeading } from "../KpiSection";

const INFO = (
  <Explain>
    <p>
      Nach der Anmeldung fragt das Widget Kund:innen, die noch nicht entschieden haben, nach der
      Marketing-Einwilligung (Popup, Text aus <code>/api/consent-copy?surface=signin</code>): angezeigt →
      akzeptiert („Ja, Angebote aktivieren“). Wer im Shop schon angemeldet ist, wird nicht gefragt.
    </p>
    <p>
      Alle vier Events sendet das Widget (<code>consent_gate_shown</code> / <code>_accepted</code> /{" "}
      <code>_declined</code> / <code>_dismissed</code>, <code>surface: signin</code>) — gemessen wird die
      Oberfläche, nicht die bestätigte Anmeldung. Getrennt von den anderen Opt-in-Wegen (E-Mail-Capture,
      Shop). Das anonyme Chat-Gate (<code>surface: chat</code>) zeigt das Widget seit dem 01.10.2026 nicht
      mehr — das Anmelde-Popup hat es ersetzt.
    </p>
  </Explain>
);

const CHAT_RETIRED = formatAdmin(`${RETIRED_CONSENT_GATE_SURFACES.chat}T12:00:00Z`, ADMIN_DATE_PADDED);

export function ConsentGateSection({ funnel }: { funnel: ConsentGateFunnel | null }) {
  const signin = funnel?.bySurface.signin;
  const chat = funnel?.bySurface.chat;
  const acceptRate = signin && signin.shown > 0 ? signin.accepted / signin.shown : null;
  const withoutSurface = funnel && signin && chat ? funnel.total.shown - signin.shown - chat.shown : 0;
  const empty = !funnel
    ? "Noch keine Daten."
    : funnel.total.shown === 0
      ? "Noch keine Einwilligungs-Popup-Events im Zeitraum."
      : null;
  return (
    <KpiSection
      id="consent"
      title="Einwilligung nach der Anmeldung (Marketing-Opt-in)"
      info={INFO}
      empty={empty}
      notes={[withoutSurface > 0 && `${num(withoutSurface)} Anzeigen ohne surface-Angabe zählen in keiner Oberfläche.`]}
    >
      {funnel && signin && chat && (
        <>
          <FunnelLayout
            chart={
              <StageFunnelChart
                stages={[
                  { name: "Angezeigt", value: signin.shown },
                  { name: "Akzeptiert", value: signin.accepted },
                ]}
              />
            }
          >
            <Stat label="Angezeigt" value={num(signin.shown)} />
            <Stat
              label="Akzeptiert"
              value={num(signin.accepted)}
              hint={acceptRate == null ? undefined : `${ratio(acceptRate)} Akzeptanzrate`}
            />
            <Stat label="Abgelehnt" value={num(signin.declined)} />
            <Stat label="Weggeklickt" value={num(signin.dismissed)} />
          </FunnelLayout>

          {chat.shown > 0 && (
            <>
              <SubHeading info={`Das Widget zeigt das anonyme Chat-Gate seit dem ${CHAT_RETIRED} nicht mehr; hier stehen nur ältere Events im Zeitraum.`}>
                Chat-Gate (anonym) — eingestellt
              </SubHeading>
              <StatGrid cols={2}>
                <SurfaceGateStat label="Chat-Gate (anonym)" counts={chat} />
              </StatGrid>
            </>
          )}
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
