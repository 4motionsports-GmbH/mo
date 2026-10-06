// „Vom Chat zur Bestellung“ — the journey funnel per session: Beratung →
// Produkt gezeigt → Produkt angeklickt → Warenkorb / Kasse → Bestellt, nested,
// with the step conversions and the largest drop, plus every chat session with
// an order (cart click or not), revenue per consultation and the raw click
// volume (formerly „In-Chat-Klicks“ of the core metrics). Data:
// lib/kpi-journey-store over the pure lib/kpi-journey.mjs. §5.4.

import type { JourneyCounts } from "@/lib/kpi-journey-store";
import { journeyFunnel } from "@/lib/kpi-journey.mjs";
import { eur, num, ratio } from "@/lib/admin-format.mjs";
import { Card, CardContent, Stat } from "../../ui";
import { FunnelBars } from "../FunnelBars";
import { Explain, KpiSection } from "../KpiSection";

const INFO = (
  <Explain>
    <p>
      Sitzungen mit einem im Zeitraum begonnenen Chat, Schritt für Schritt bis zur Bestellung. Jeder Schritt ist eine
      Teilmenge des vorigen, die Prozente sind echte Übergänge: „weiter“ = Anteil des vorigen Schritts, rechts = Anteil
      aller Beratungen. Ab dem ersten Chat der Sitzung bis zum Ende des Zeitraums.
    </p>
    <p>
      „Produkt gezeigt“ = Mo hat in den Chats der Sitzung mindestens ein Produkt gezeigt, verglichen oder vorgeschlagen.
      Klicks kommen aus der Widget-Telemetrie (Produkt-/CTA-Klicks: <code>%product%click%</code> /{" "}
      <code>%cta%click%</code>; Warenkorb: <code>%cart%</code> / <code>%checkout%</code>). „Bestellt“ = eine
      Mo-zugeordnete, bezahlte Bestellung der Sitzung (Abschnitt „Umsatz durch Mo“). Wer ohne Warenkorb-Klick im Chat
      bestellt — über die Suche, später, über einen Mail-Link —, fehlt im letzten Schritt, zählt aber unter „Beratung →
      Bestellung“.
    </p>
    <p>
      Grenzen: Bestellungen nach dem Zeitraumende zählen nicht (die letzten Tage sind unvollständig); ohne
      Analyse-Einwilligung im Shop sendet das Widget keine Klicks und markiert keinen Warenkorb; eine Sitzung ist ein
      Gerät, kein Besuch.
    </p>
  </Explain>
);

export function JourneySection({ counts }: { counts: JourneyCounts | null }) {
  const f = counts ? journeyFunnel(counts) : null;
  const empty = !counts ? "Noch keine Daten." : counts.chats === 0 ? "Keine Beratung im Zeitraum." : null;
  return (
    <KpiSection id="journey" title="Vom Chat zur Bestellung" info={INFO} empty={empty}>
      {counts && f && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardContent className="p-5">
              <FunnelBars
                unit="Sitzungen"
                highlightBiggestDrop
                stages={f.stages.map((s) => ({ key: s.key, label: s.label, value: s.value, info: s.detail }))}
              />
            </CardContent>
          </Card>
          <div className="grid grid-cols-1 content-start gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <Stat
              label="Beratung → Bestellung"
              value={f.chatToOrderRate == null ? "—" : ratio(f.chatToOrderRate)}
              hint={`${num(f.orderedAny)} von ${num(f.stages[0].value)} Sitzungen · ${num(f.orderedWithoutCart)} ohne Warenkorb-Klick im Chat`}
              info="Sitzungen mit Beratung im Zeitraum, die danach eine Mo-zugeordnete, bezahlte Bestellung hatten — egal ob über den Warenkorb-Knopf im Chat, die Suche oder einen Mail-Link."
            />
            <Stat
              label="Umsatz je Beratung"
              value={f.revenuePerChat == null ? "—" : eur(f.revenuePerChat)}
              hint={`${eur(f.revenue)} aus ${num(f.orderedOrders)} ${f.orderedOrders === 1 ? "Bestellung" : "Bestellungen"} dieser Sitzungen`}
              info="Bezahlter, Mo-zugeordneter Umsatz der Sitzungen mit Beratung im Zeitraum, geteilt durch alle diese Sitzungen. Enthält nur Bestellungen derselben Sitzung — „Umsatz durch Mo“ oben zählt auch Kampagnen-Codes und Set-Angebote ohne Chat."
            />
            <Stat
              label="Klicks im Chat"
              value={`${num(counts.productClicks)} · ${num(counts.cartClicks)}`}
              hint={`Produkt-/CTA-Klicks · Warenkorb-Klicks (Ereignisse, alle Sitzungen)${
                f.stages[0].value > 0 ? ` · ${num(counts.productClicks / f.stages[0].value, 2)} je Beratung` : ""
              }`}
            />
          </div>
        </div>
      )}
    </KpiSection>
  );
}
