// Kundenkonto & Self-Service — sign-ins, GDPR export/erasure, summaries,
// contact form.

import type { AccountActivity } from "@/lib/kpi-store";
import { num } from "@/lib/admin-format.mjs";
import { Stat } from "../../ui";
import { Explain, KpiSection, StatGrid } from "../KpiSection";

const INFO = (
  <Explain>
    <p>Shopify-Anmeldungen, DSGVO-Self-Service und Zusammenfassungen im Zeitraum.</p>
    <p>
      Pseudonyme Zähler (kpi_events bzw. KI-Verbrauchszeilen der Zusammenfassungen) — keine
      Personenbezüge. „Stille Erkennungen“ sind automatische Wieder-Anmeldungen bereits eingeloggter
      Shopify-Kund:innen (<code>prompt=none</code>). Kontaktformular = akzeptierte Übermittlungen;
      vergleichbar mit den <code>show_contact_form</code>-Aufrufen im Gespräche-Tab.
    </p>
  </Explain>
);

export function AccountSection({ activity }: { activity: AccountActivity | null }) {
  const empty =
    !activity ||
    (activity.signins === 0 &&
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
            hint={activity.silentSignins > 0 ? `${num(activity.silentSignins)} stille Erkennungen` : undefined}
          />
          <Stat label="Zusammenfassung per E-Mail" value={num(activity.summaryEmails)} />
          <Stat label="Zusammenfassung (Download)" value={num(activity.summaryDownloads)} />
          <Stat label="Kontaktformular" value={num(activity.contactFormSubmissions)} />
          <Stat label="Datenexporte" value={num(activity.exports)} hint="Art. 15/20" />
          <Stat label="Löschungen" value={num(activity.erasures)} hint="Art. 17" />
        </StatGrid>
      )}
    </KpiSection>
  );
}
