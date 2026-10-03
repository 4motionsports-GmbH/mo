// Anmelde-Popup — the widget's sign-in ask for anonymous visitors (2026-10-01):
// shown → „Anmelden“ → signed in at Shopify → signed in in the chat, per
// session, plus „Später“ / weggeklickt and where sign-ins start.

import type { LoginGateFunnel } from "@/lib/kpi-store";
import { num, ratio } from "@/lib/admin-format.mjs";
import { Stat } from "../../ui";
import { StageFunnelChart } from "../charts";
import { Explain, FunnelLayout, KpiSection, StatGrid, SubHeading } from "../KpiSection";

const INFO = (
  <Explain>
    <p>
      Nach der ersten beantworteten Nachricht bittet das Widget anonyme Besucher:innen, sich anzumelden
      (einmal pro Sitzung, nie im Sprachmodus): Popup angezeigt → „Anmelden“ → bei Shopify angemeldet →
      im Chat angemeldet.
    </p>
    <p>
      Gezählt werden Sitzungen. Die ersten Stufen meldet das Widget (<code>login_gate_*</code>); „Bei
      Shopify angemeldet“ und „Im Chat angemeldet“ misst der Server in derselben Sitzung nach dem Klick
      (<code>account_signin_succeeded</code>, <code>account_signin_linked</code>). Erst die letzte Stufe zählt:
      seit dem 03.10.2026 gilt eine Anmeldung im Chat nur, wenn das Widget den Einmal-Code einlöst. „Später“
      pausiert das Popup 24 Stunden auf dem Gerät; „Weggeklickt“ (Esc, Klick daneben) nicht.
    </p>
  </Explain>
);

export function LoginGateSection({ funnel }: { funnel: LoginGateFunnel | null }) {
  const starts = funnel ? funnel.startsBySource.login_gate + funnel.startsBySource.other : 0;
  const empty = !funnel
    ? "Noch keine Daten."
    : funnel.shown === 0 && starts === 0
      ? "Noch keine Anmelde-Popup-Events im Zeitraum."
      : null;
  const r = funnel?.rates;
  return (
    <KpiSection
      id="anmelde-popup"
      title="Anmelde-Popup (anonyme Besucher:innen)"
      info={INFO}
      empty={empty}
      notes={[
        funnel != null &&
          funnel.rates.unlinked > 0 &&
          `${num(funnel.rates.unlinked)} Sitzungen haben sich bei Shopify angemeldet, aber nicht im Chat — das Widget löst den Einmal-Code nicht ein (Frontend-Aufgabe 1).`,
      ]}
    >
      {funnel && r && (
        <>
          <FunnelLayout
            chart={
              <StageFunnelChart
                stages={[
                  { name: "Angezeigt", value: funnel.shown },
                  { name: "„Anmelden“", value: funnel.clicked },
                  { name: "Bei Shopify", value: funnel.signedIn },
                  { name: "Im Chat", value: funnel.linked },
                ]}
              />
            }
          >
            <Stat label="Angezeigt" value={num(funnel.shown)} hint="Sitzungen" />
            <Stat
              label="„Anmelden“ geklickt"
              value={num(funnel.clicked)}
              hint={r.clickRate == null ? undefined : `${ratio(r.clickRate)} der Anzeigen`}
            />
            <Stat
              label="Bei Shopify angemeldet"
              value={num(funnel.signedIn)}
              hint={r.signInRate == null ? undefined : `${ratio(r.signInRate)} der Klicks`}
            />
            <Stat
              label="Im Chat angemeldet"
              value={num(funnel.linked)}
              hint={r.overallRate == null ? undefined : `${ratio(r.overallRate)} der Anzeigen`}
            />
            <Stat
              label="„Später“"
              value={num(funnel.declined)}
              hint={r.declineRate == null ? "24 h pausiert" : `${ratio(r.declineRate)} · 24 h pausiert`}
            />
            <Stat
              label="Weggeklickt"
              value={num(funnel.dismissed)}
              hint={r.dismissRate == null ? undefined : `${ratio(r.dismissRate)} der Anzeigen`}
            />
          </FunnelLayout>

          <SubHeading info="Alle Anmeldestarts im Zeitraum nach Herkunft (account_signin_started, Feld source vom Widget).">
            Anmeldestarts nach Herkunft
          </SubHeading>
          <StatGrid cols={2}>
            <Stat label="Aus dem Popup" value={num(funnel.startsBySource.login_gate)} />
            <Stat label="Begrüßung oder Kopfzeile" value={num(funnel.startsBySource.other)} />
          </StatGrid>
        </>
      )}
    </KpiSection>
  );
}
