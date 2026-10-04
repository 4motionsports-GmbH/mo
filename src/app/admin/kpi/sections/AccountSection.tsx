// Kundenkonto & Self-Service — sign-ins, GDPR export/erasure, summaries,
// contact form.

import type { AccountActivity } from "@/lib/kpi-store";
import { num } from "@/lib/admin-format.mjs";
import { Stat } from "../../ui";
import { Explain, KpiSection, StatGrid } from "../KpiSection";
import type { KpiRange } from "@/lib/kpi-range";
import { releaseNotesFor } from "@/lib/kpi-releases.mjs";

const INFO = (
  <Explain>
    <p>Shopify-Anmeldungen, DSGVO-Self-Service und Zusammenfassungen im Zeitraum.</p>
    <p>
      Pseudonyme Zähler (kpi_events bzw. KI-Verbrauchszeilen der Zusammenfassungen) — keine
      Personenbezüge. „Stille Erkennungen“ sind automatische Wieder-Anmeldungen bereits eingeloggter
      Shopify-Kund:innen (<code>prompt=none</code>). „Im Chat abgeschlossen“: seit dem 03.10.2026 zählt eine
      Anmeldung im Chat erst, wenn das Widget den Einmal-Code einlöst; „Codes abgelehnt“ sind abgelaufene,
      schon benutzte oder fremde Codes. Kontaktformular = akzeptierte Übermittlungen („Bestellung &
      Service“ = Grund order_support; „mit Sitzung“ = einer Chat-Sitzung zugeordnet, seit dem 04.10.2026);
      vergleichbar mit den <code>show_contact_form</code>-Aufrufen im Gespräche-Tab.
    </p>
  </Explain>
);

export function AccountSection({ activity, range }: { activity: AccountActivity | null; range: KpiRange }) {
  const empty =
    !activity ||
    (activity.signins === 0 &&
      activity.linkedSignins === 0 &&
      activity.exports === 0 &&
      activity.erasures === 0 &&
      activity.contactFormSubmissions === 0 &&
      activity.summaryDownloads === 0 &&
      activity.summaryEmails === 0);
  return (
    <KpiSection
      id="konto"
      title="Kundenkonto & Self-Service"
      info={INFO}
      notes={releaseNotesFor("konto", range)}
      empty={
        empty
          ? "Noch keine Konto-Aktivität im Zeitraum. Sign-in-, Export- und Lösch-Ereignisse werden ab dem Deploy dieser Version erfasst."
          : null
      }
    >
      {activity && !empty && (
        <StatGrid cols={6}>
          <Stat
            label="Anmeldungen"
            value={num(activity.signins)}
            hint={
              [
                `${num(activity.linkedSignins)} im Chat abgeschlossen`,
                activity.silentSignins > 0 && `${num(activity.silentSignins)} stille Erkennungen`,
                activity.refusedLinks > 0 && `${num(activity.refusedLinks)} Codes abgelehnt`,
              ]
                .filter(Boolean)
                .join(" · ") || undefined
            }
          />
          <Stat label="Zusammenfassung per E-Mail" value={num(activity.summaryEmails)} />
          <Stat label="Zusammenfassung (Download)" value={num(activity.summaryDownloads)} />
          <Stat
            label="Kontaktformular"
            value={num(activity.contactFormSubmissions)}
            hint={
              activity.contactFormSubmissions > 0
                ? `${num(activity.contactOrderSupport)} Bestellung & Service · ${num(activity.contactWithSession)} mit Sitzung`
                : undefined
            }
          />
          <Stat label="Datenexporte" value={num(activity.exports)} hint="Art. 15/20" />
          <Stat label="Löschungen" value={num(activity.erasures)} hint="Art. 17" />
        </StatGrid>
      )}
    </KpiSection>
  );
}
