// E-Mail-Capture-Funnel — Angebot → Formular → Marketing-Haken → DOI-Klick.

import type { EmailCaptureFunnel } from "@/lib/kpi-store";
import { num, ratio } from "@/lib/admin-format.mjs";
import { BarList, Stat } from "../../ui";

import { StageFunnelChart } from "../charts";
import { Explain, FunnelLayout, KpiSection, SubHeading } from "../KpiSection";

// German labels for the offer_email_summary trigger enum (lib/tools.ts) + the
// two server-emitted fallbacks ("unspecified" from api/chat, "unknown" when the
// event carried no trigger at all).
const TRIGGER_LABELS: Record<string, string> = {
  recommendation_accepted: "Empfehlung angenommen",
  comparison_delivered: "Vergleich geliefert",
  consideration_pause: "Bedenkpause",
  buying_intent: "Kaufabsicht",
  checkout_intent: "Checkout-Absicht",
  unspecified: "Ohne Angabe",
  unknown: "Ohne Trigger",
};

const INFO = (
  <Explain>
    <p>
      Mo bietet die Chat-Zusammenfassung per E-Mail an: angeboten → Formular gesendet → Marketing-Haken
      gesetzt → Double-Opt-in bestätigt.
    </p>
    <p>
      Ereigniszählung im Zeitraum (nicht pro Sitzung verkettet): ein DOI-Klick, der ein Opt-in vom
      Vortag bestätigt, zählt im Zeitraum des Klicks. „Abgelehnt“ (Karte weggeklickt) wird vom Widget
      gemeldet. Wirksam wird die Marketing-Einwilligung erst mit dem DOI-Klick.
    </p>
  </Explain>
);

export function EmailCaptureSection({ funnel }: { funnel: EmailCaptureFunnel | null }) {
  const empty = !funnel
    ? "Noch keine Daten."
    : funnel.askShown === 0 && funnel.submitted === 0
      ? "Noch keine Capture-Events im Zeitraum."
      : null;
  return (
    <KpiSection id="capture" title="E-Mail-Capture-Funnel" info={INFO} empty={empty}>
      {funnel && (
        <>
          <FunnelLayout
            chart={
              <StageFunnelChart
                stages={[
                  { name: "Angeboten", value: funnel.askShown },
                  { name: "Formular gesendet", value: funnel.submitted },
                  { name: "Marketing-Haken", value: funnel.marketingOptedIn },
                  { name: "DOI bestätigt", value: funnel.confirmed },
                ]}
              />
            }
          >
            <Stat label="Angeboten" value={num(funnel.askShown)} />
            <Stat
              label="Formular gesendet"
              value={num(funnel.submitted)}
              hint={funnel.submitRate == null ? undefined : `${ratio(funnel.submitRate)} der Angebote`}
            />
            <Stat label="Marketing-Haken" value={num(funnel.marketingOptedIn)} />
            <Stat
              label="DOI bestätigt"
              value={num(funnel.confirmed)}
              hint={funnel.doiRate == null ? undefined : `${ratio(funnel.doiRate)} der Opt-ins`}
            />
            <Stat label="Abgelehnt" value={num(funnel.declined)} hint="Karte weggeklickt (Widget)" />
          </FunnelLayout>

          {funnel.asksByTrigger.length > 0 && (
            <>
              <SubHeading>Angebote nach Auslöser</SubHeading>
              <BarList
                rows={funnel.asksByTrigger.map((t) => ({
                  key: t.trigger,
                  label: TRIGGER_LABELS[t.trigger] ?? t.trigger,
                  count: t.count,
                }))}
              />
            </>
          )}
        </>
      )}
    </KpiSection>
  );
}
