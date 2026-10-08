// E-Mail-Capture-Funnel — Angebot → Formular → Marketing-Haken → DOI-Klick.

import type { EmailCaptureFunnel } from "@/lib/kpi-store";
import type { KpiRange } from "@/lib/kpi-range";
import { releaseNotesFor } from "@/lib/kpi-releases.mjs";
import { num, ratio } from "@/lib/admin-format.mjs";
import { BarList, Stat } from "../../ui";

import { FunnelBars } from "../FunnelBars";
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
  none: "Ohne Auslöser",
  other: "Anderer Wert",
};

const INFO = (
  <Explain>
    <p>
      Mo bietet die Chat-Zusammenfassung per E-Mail an: angeboten → Formular gesendet → Marketing-Haken
      gesetzt → Double-Opt-in bestätigt. Nur das Formular — das Popup nach der Anmeldung steht unter
      „Einwilligung nach der Anmeldung“ (seit dem 05.10.2026 getrennt; ältere Events über ihren Auslöser).
    </p>
    <p>
      Ereigniszählung im Zeitraum (nicht pro Sitzung verkettet): ein DOI-Klick, der ein Opt-in vom
      Vortag bestätigt, zählt im Zeitraum des Klicks. DOI-Quote = bestätigt ÷ „DOI-Mail verschickt“ — wer schon
      abonniert ist oder gesperrt ist, bekommt keine DOI-Mail und zählt nicht im Nenner; eine DOI-Mail, deren
      Versand fehlschlug oder übersprungen wurde, auch nicht („nicht verschickt“). Opt-ins aus der Zeit, bevor
      der Versand festgehalten wurde, zählen als verschickt. „Abgelehnt“ (Karte weggeklickt) meldet das Widget,
      einmal je Sitzung und Auslöser.
      Wirksam wird die Marketing-Einwilligung erst mit dem DOI-Klick.
    </p>
  </Explain>
);

const PENDING_INFO =
  "„Bestätigung schon unterwegs“: keine neue DOI-Mail, weil schon eine Bestätigung unterwegs ist — eine gültige DOI-Mail ging innerhalb der Sperrfrist raus (oder eine gleichzeitige Anfrage verschickt sie gerade), oder die Bestätigungsmail des Shops ist verschickt. Zählt nicht als „DOI-Mail verschickt“ und nicht im Nenner der DOI-Quote.";

export function EmailCaptureSection({ funnel, range }: { funnel: EmailCaptureFunnel | null; range: KpiRange }) {
  const empty = !funnel
    ? "Noch keine Daten."
    : funnel.askShown === 0 && funnel.submitted === 0
      ? "Noch keine Capture-Events im Zeitraum."
      : null;
  return (
    <KpiSection id="capture" title="E-Mail-Capture-Funnel" info={INFO} empty={empty} notes={releaseNotesFor("capture", range)}>
      {funnel && (
        <>
          <FunnelLayout
            chart={
              <FunnelBars
                stages={[
                  { label: "Angeboten", value: funnel.askShown },
                  { label: "Formular gesendet", value: funnel.submitted },
                  { label: "Marketing-Haken", value: funnel.marketingOptedIn },
                  { label: "DOI bestätigt", value: funnel.confirmed },
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
            <Stat
              label="Marketing-Haken"
              value={num(funnel.marketingOptedIn)}
              info={funnel.doiPending > 0 ? PENDING_INFO : undefined}
              hint={
                funnel.marketingOptedIn > 0
                  ? `${num(funnel.doiSent)} DOI-Mail verschickt${funnel.doiNotSent > 0 ? ` · ${num(funnel.doiNotSent)} nicht verschickt` : ""}${funnel.doiPending > 0 ? ` · ${num(funnel.doiPending)} Bestätigung schon unterwegs` : ""} · ${num(funnel.alreadySubscribed)} bereits abonniert${funnel.suppressed > 0 ? ` · ${num(funnel.suppressed)} gesperrt` : ""}`
                  : undefined
              }
            />
            <Stat
              label="DOI bestätigt"
              value={num(funnel.confirmed)}
              hint={funnel.doiRate == null ? undefined : `${ratio(funnel.doiRate)} der verschickten DOI-Mails`}
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
