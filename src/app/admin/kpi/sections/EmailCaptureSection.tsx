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
    <p>
      „Bestätigung schon unterwegs“: Für die Adresse war eine gültige DOI-Mail gerade erst verschickt (innerhalb
      der Sperrfrist, Standard 30 Minuten) oder wurde von einer gleichzeitigen Anfrage verschickt — Mo schickt
      keine zweite. „Shop-Bestätigung unterwegs“: Die Bestätigungsmail des Shops zu einer Newsletter-Anmeldung
      dort ist noch offen — Mo schickt keine eigene. Beide zählen nicht im Nenner der DOI-Quote.
    </p>
  </Explain>
);

/** „N DOI-Mail verschickt · … “ under „Marketing-Haken“ — zero buckets except „bereits abonniert“ are left out. */
function optInHint(f: EmailCaptureFunnel): string {
  const parts = [`${num(f.doiSent)} DOI-Mail verschickt`];
  if (f.doiNotSent > 0) parts.push(`${num(f.doiNotSent)} nicht verschickt`);
  if (f.doiPending > 0) parts.push(`${num(f.doiPending)} Bestätigung schon unterwegs`);
  if (f.shopifyPending > 0) parts.push(`${num(f.shopifyPending)} Shop-Bestätigung unterwegs`);
  parts.push(`${num(f.alreadySubscribed)} bereits abonniert`);
  if (f.suppressed > 0) parts.push(`${num(f.suppressed)} gesperrt`);
  return parts.join(" · ");
}

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
              hint={funnel.marketingOptedIn > 0 ? optInHint(funnel) : undefined}
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
