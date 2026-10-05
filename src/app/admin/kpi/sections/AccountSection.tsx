// Kundenkonto & Self-Service — sign-ins, GDPR export/erasure, summaries,
// contact form.

import type { AccountActivity } from "@/lib/kpi-store";
import { num, ratio } from "@/lib/admin-format.mjs";
import { Callout, Stat } from "../../ui";
import { Explain, KpiSection, StatGrid, SubHeading } from "../KpiSection";
import type { KpiRange } from "@/lib/kpi-range";
import { releaseNotesFor } from "@/lib/kpi-releases.mjs";

const SHOP_INFO =
  "Wer im Shop angemeldet ist, wird beim Öffnen des Chats über die App Proxy (whoami) erkannt. „Erkannt“ = Sitzungen, die noch nicht angemeldet waren; „Angemeldet“ = davon ohne Klick im Chat angemeldet (Code eingelöst); „Mit Chat-Token“ = erkannte Kund:innen, die sich früher schon im Chat angemeldet hatten; „Ohne Code“ = erkannt, aber nicht angemeldet: Regel aus (APP_PROXY_SIGNIN_ENABLED), kein Nachweis (ohne Chat-Token, solange der Shop-Login allein nicht reicht), Personenwechsel im selben Browser (die vorige Anmeldung endet) oder ein Fehler. Sitzungen, keine Klicks.";

const INFO = (
  <Explain>
    <p>Shopify-Anmeldungen, DSGVO-Self-Service und Zusammenfassungen im Zeitraum.</p>
    <p>
      Pseudonyme Zähler (kpi_events bzw. KI-Verbrauchszeilen der Zusammenfassungen) — keine
      Personenbezüge. „Im Chat angemeldet“ zählt Sitzungen, nicht Klicks: seit dem 03.10.2026 zählt eine
      Anmeldung im Chat erst, wenn das Widget den Einmal-Code einlöst. „Über „Anmelden““ = Anmeldung im
      Chat; „über Shop-Login“ = vom Shop erkannt (App Proxy) — nur neue Anmeldungen; „bereits angemeldet
      (bestätigt)“ = ein neuer Tab einer schon angemeldeten Sitzung. „Shopify-Anmeldungen“ sind die
      erfolgreichen Anmeldungen bei Shopify, „still“ automatische Wieder-Anmeldungen bereits eingeloggter
      Kund:innen (<code>prompt=none</code>); „Codes abgelehnt“ sind abgelaufene, schon benutzte oder fremde
      Codes. Kontaktformular = akzeptierte Übermittlungen („Bestellung & Service“ = Grund order_support;
      „mit Sitzung“ = einer Chat-Sitzung zugeordnet, seit dem 04.10.2026); vergleichbar mit den{" "}
      <code>show_contact_form</code>-Aufrufen im Gespräche-Tab.
    </p>
  </Explain>
);

export function AccountSection({ activity, range }: { activity: AccountActivity | null; range: KpiRange }) {
  const shop = activity?.shopRecognition;
  const linked = activity?.linkedSessions;
  const showShop = Boolean(shop && linked && (shop.recognised > 0 || linked.shop > 0));
  const empty =
    !activity ||
    (activity.signins === 0 &&
      activity.linkedSignins === 0 &&
      activity.exports === 0 &&
      activity.erasures === 0 &&
      activity.contactFormSubmissions === 0 &&
      activity.summaryDownloads === 0 &&
      activity.summaryEmails === 0 &&
      !showShop);
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
      {activity && linked && !empty && (
        <StatGrid cols={6}>
          <Stat
            label="Im Chat angemeldet"
            value={num(linked.signin + linked.shop)}
            hint={
              [
                `${num(linked.signin)} über „Anmelden“`,
                linked.shop > 0 && `${num(linked.shop)} über Shop-Login`,
                linked.renewedOnly > 0 && `${num(linked.renewedOnly)} bereits angemeldet (bestätigt)`,
                `${num(activity.signins)} Shopify-Anmeldungen${activity.silentSignins > 0 ? ` (${num(activity.silentSignins)} still)` : ""}`,
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
      {shop && linked && showShop && (
        <>
          <SubHeading info={SHOP_INFO}>Shop-Login-Erkennung (App Proxy)</SubHeading>
          {shop.rates.alarm && (
            <Callout tone="warning" compact>
              Von {num(shop.withCode)} Sitzungen mit Shop-Code hat das Widget {num(shop.rates.unlinked)} nicht
              eingelöst ({ratio(shop.rates.unlinkedShare)}). Typisch für ein altes Widget (Drift) oder Störungen beim
              Einlösen: <code>npm run verify:widget</code> ausführen; meldet es keinen zulässigen Build mit
              Code-Einlösung, APP_PROXY_SIGNIN_ENABLED=false setzen und neu deployen.
            </Callout>
          )}
          <StatGrid cols={4}>
            <Stat
              label="Erkannt"
              value={num(shop.recognisedNew)}
              hint={
                shop.recognised > shop.recognisedNew
                  ? `+${num(shop.recognised - shop.recognisedNew)} bereits angemeldet`
                  : undefined
              }
            />
            <Stat
              label="Angemeldet"
              value={num(linked.shop)}
              hint={shop.rates.redeemRate == null ? undefined : `${ratio(shop.rates.redeemRate)} Codes eingelöst`}
            />
            <Stat
              label="Mit Chat-Token"
              value={num(shop.withToken)}
              hint={shop.rates.tokenShare == null ? undefined : `${ratio(shop.rates.tokenShare)} der Erkannten`}
            />
            <Stat
              label="Ohne Code"
              value={num(shop.flagOff + shop.noProof + shop.handover + shop.codeFailed)}
              hint={`${num(shop.flagOff)} Regel aus · ${num(shop.noProof)} ohne Nachweis · ${num(shop.handover)} Personenwechsel · ${num(shop.codeFailed)} Fehler`}
            />
          </StatGrid>
        </>
      )}
    </KpiSection>
  );
}
