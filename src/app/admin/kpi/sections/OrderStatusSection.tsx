// Bestellstatus im Chat — the server's order_status_lookup events: how often
// get_order_status ran, with which outcome, for which topic, and how often the
// answer needed the short live read at Shopify (docs/CUSTOMER_ACCOUNT.md, „Order status in the chat“).

import type { OrderStatusKpis } from "@/lib/kpi-store";
import { num, ratio } from "@/lib/admin-format.mjs";
import { BarList, Stat } from "../../ui";
import { Explain, KpiSection, StatGrid, SubHeading } from "../KpiSection";

const INFO = (
  <Explain>
    <p>
      Bestellstatus-Abfragen von angemeldeten Kund:innen im Chat (Werkzeug <code>get_order_status</code>), gezählt
      vom Server (<code>order_status_lookup</code>, pseudonym — ohne Bestellnummer, Betrag oder Adresse).
    </p>
    <p>
      Aktiv mit <code>CHAT_ORDER_STATUS_ENABLED=true</code>; vorher nur für die Test-Kund:innen aus{" "}
      <code>CHAT_ORDER_STATUS_TEST_CUSTOMERS</code>. „Hauptbuch + Live“ heißt: die Antwort brauchte den kurzen
      Live-Abruf bei Shopify. „Hauptbuch hinterher“ und „Import unvollständig“ sind Fälle, in denen Mo lieber auf
      die Bestellseite verweist als „keine Bestellungen“ zu sagen.
    </p>
  </Explain>
);

const OUTCOME_LABELS: Record<string, string> = {
  ok: "Beantwortet",
  no_orders: "Keine Bestellungen",
  not_found: "Bestellnummer nicht gefunden",
  sign_in_required: "Nicht angemeldet",
  unavailable: "Nicht verfügbar (Fehler)",
  disabled: "Abgeschaltet",
  ledger_off: "Bestellabgleich aus",
  ledger_incomplete: "Import unvollständig",
  ledger_behind: "Hauptbuch hinterher",
};

const TOPIC_LABELS: Record<string, string> = {
  status: "Status",
  shipping: "Versand",
  return: "Rücksendung",
  cancellation: "Stornierung",
  refund: "Erstattung",
};

const SOURCE_LABELS: Record<string, string> = {
  ledger: "Nur Hauptbuch",
  "ledger+live": "Hauptbuch + Live",
};

export function OrderStatusSection({ kpis }: { kpis: OrderStatusKpis | null }) {
  const empty = !kpis ? "Noch keine Daten." : kpis.lookups === 0 ? "Keine Bestellstatus-Abfragen im Zeitraum." : null;
  const answered = kpis?.byOutcome.find((o) => o.outcome === "ok")?.count ?? 0;
  return (
    <KpiSection id="bestellstatus" title="Bestellstatus im Chat" info={INFO} empty={empty}>
      {kpis && kpis.lookups > 0 && (
        <>
          <StatGrid cols={3}>
            <Stat label="Abfragen" value={num(kpis.lookups)} />
            <Stat label="Sitzungen" value={num(kpis.sessions)} />
            <Stat
              label="Beantwortet"
              value={num(answered)}
              hint={`${ratio(answered / kpis.lookups)} der Abfragen`}
            />
          </StatGrid>

          <SubHeading>Ergebnis</SubHeading>
          <BarList
            rows={kpis.byOutcome.map((o) => ({
              key: o.outcome,
              label: OUTCOME_LABELS[o.outcome] ?? o.outcome,
              count: o.count,
            }))}
          />

          <SubHeading>Thema</SubHeading>
          <BarList
            rows={kpis.byTopic.map((t) => ({ key: t.topic, label: TOPIC_LABELS[t.topic] ?? t.topic, count: t.count }))}
          />

          {kpis.bySource.length > 0 && (
            <>
              <SubHeading>Quelle der Antwort</SubHeading>
              <BarList
                rows={kpis.bySource.map((s) => ({
                  key: s.source,
                  label: SOURCE_LABELS[s.source] ?? s.source,
                  count: s.count,
                }))}
              />
            </>
          )}
        </>
      )}
    </KpiSection>
  );
}
