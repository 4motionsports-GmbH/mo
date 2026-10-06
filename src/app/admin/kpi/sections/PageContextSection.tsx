// Seitenkontext auf Produktseiten (A3) — typed or spoken questions on a
// product page that carry the page's product (`context.source: "page"`):
// coverage, and — while a control group runs — the pre-registered comparison
// of the applied arm with the holdout on „andere Produkte geklickt (24 h)“.

import type { PageContextKpis } from "@/lib/kpi-store";
import type { KpiRange } from "@/lib/kpi-range";
import { releaseNotesFor } from "@/lib/kpi-releases.mjs";
import { num, ratio } from "@/lib/admin-format.mjs";
import { Callout, Stat, StatusBadge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../ui";
import { Explain, KpiSection, StatGrid, SubHeading } from "../KpiSection";

const INFO = (
  <Explain>
    <p>
      Fragen, die auf einer Produktseite getippt oder gesprochen wurden: das Widget schickt das Produkt der Seite mit
      (bei Kategorieseiten die Kategorie). Mo nutzt es nur mit <code>CHAT_PAGE_CONTEXT_ENABLED</code>; ein Teil der
      Sitzungen (<code>CHAT_PAGE_CONTEXT_HOLDOUT_PCT</code>) bekommt es absichtlich nicht — die Kontrollgruppe mit dem
      bisherigen Verhalten.
    </p>
    <p>
      Verglichen werden Sitzungen ab der ersten solchen Frage, 24 Stunden lang (Bestellungen 7 Tage), nur mit erkanntem
      Produkt, ohne „Zum Produkt“- oder Hinweis-Klick davor, mit dem vorab festgelegten Kontrollgruppen-Anteil und
      abgeschlossenem Zeitfenster. „Andere Produkte geklickt“ zählt keine Klicks auf die gerade offene Produktseite
      (<code>samePage</code>). Die Zielgröße je Gruppe wurde vorher festgelegt; gelesen wird das Ergebnis erst, wenn
      sie erreicht ist — mit 95-%-Intervall des Unterschieds.
    </p>
  </Explain>
);

function share(pcts: number[]): string {
  const real = pcts.filter((p) => p >= 0);
  if (real.length === 0) return "—";
  if (real.length > 1) return "gemischt";
  if (real[0] === 100) return "Seitenkontext aus";
  if (real[0] === 0) return "keine";
  return `${num(real[0])} %`;
}

export function PageContextSection({ kpis, range }: { kpis: PageContextKpis | null; range: KpiRange }) {
  const empty =
    !kpis || (kpis.sessions === 0 && kpis.collection.sessions === 0)
      ? "Noch keine Daten im Zeitraum — getippte Fragen tragen den Seitenkontext erst mit dem Widget vom 06.10.2026."
      : null;
  const hasControl = Boolean(kpis?.pcts.some((p) => p > 0 && p < 100));
  const arms = kpis?.arms;
  const excludedTotal = kpis ? Object.values(kpis.excluded).reduce((a, b) => a + b, 0) : 0;
  return (
    <KpiSection
      id="seitenkontext"
      title="Seitenkontext auf Produktseiten"
      info={INFO}
      empty={empty}
      notes={releaseNotesFor("seitenkontext", range)}
    >
      {kpis && !empty && (
        <>
          <StatGrid cols={4}>
            <Stat label="Sitzungen mit getippter Frage auf einer Produktseite" value={num(kpis.sessions)} />
            <Stat
              label="Produkt erkannt"
              value={kpis.sessions > 0 ? ratio(kpis.resolved / kpis.sessions) : "—"}
              hint={`DE ${num(kpis.byLocale.de.resolved)}/${num(kpis.byLocale.de.sessions)} · EN ${num(kpis.byLocale.en.resolved)}/${num(kpis.byLocale.en.sessions)}`}
            />
            <Stat label="Kontrollgruppe" value={share(kpis.pcts)} />
            <Stat
              label="Kategorieseiten"
              value={num(kpis.collection.sessions)}
              hint={`${num(kpis.collection.resolved)} erkannt`}
            />
          </StatGrid>
          {!hasControl && (
            <Callout tone="info" compact>
              Keine Kontrollgruppe in diesem Zeitraum — nur Abdeckung messbar.
            </Callout>
          )}
          {hasControl && !kpis.experiment && (
            <Callout tone="warning" compact>
              Eine Kontrollgruppe läuft, aber kein Experiment ist vorab festgelegt (PAGE_CONTEXT_EXPERIMENT) — kein
              Vergleich.
            </Callout>
          )}
          {hasControl && kpis.experiment && arms && (
            <>
              <SubHeading info="Nur die Vergleichsgruppe (siehe Erklärung oben). Ausgeschlossene Sitzungen stehen darunter.">
                Mit Seitenkontext vs. Kontrollgruppe
              </SubHeading>
              {kpis.primary && kpis.progress && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium">Andere Produkte geklickt (24 h):</span>
                  <span className="tabular-nums">
                    {kpis.primary.appliedRate == null ? "—" : ratio(kpis.primary.appliedRate)} vs.{" "}
                    {kpis.primary.holdoutRate == null ? "—" : ratio(kpis.primary.holdoutRate)}
                  </span>
                  {kpis.progress.reached ? (
                    <>
                      <StatusBadge tone="success" dot={false}>
                        belastbar
                      </StatusBadge>
                      <span className="tabular-nums text-muted-foreground">
                        95 %-Intervall {kpis.primary.ciLow == null ? "—" : ratio(kpis.primary.ciLow)} bis{" "}
                        {kpis.primary.ciHigh == null ? "—" : ratio(kpis.primary.ciHigh)} —{" "}
                        {kpis.primary.significant ? "Unterschied gesichert" : "kein gesicherter Unterschied"}
                      </span>
                    </>
                  ) : (
                    <StatusBadge tone="warning" dot={false}>
                      läuft ({num(kpis.progress.applied.n + kpis.progress.holdout.n)} /{" "}
                      {num(kpis.progress.applied.target + kpis.progress.holdout.target)})
                    </StatusBadge>
                  )}
                </div>
              )}
              <Table className="text-xs [&_td]:tabular-nums">
                <TableHeader>
                  <TableRow>
                    <TableHead>Gruppe</TableHead>
                    <TableHead align="right">Sitzungen</TableHead>
                    <TableHead align="right">Ohne beendete Antwort</TableHead>
                    <TableHead align="right">Andere Produkte geklickt</TableHead>
                    <TableHead align="right">Produkt geklickt</TableHead>
                    <TableHead align="right">Warenkorb</TableHead>
                    <TableHead align="right">Bestellt (7 T.)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(["applied", "holdout"] as const).map((k) => {
                    const a = arms[k] as Record<string, number>;
                    const r = (x: number) => (a.sessions > 0 ? ratio(x / a.sessions) : "—");
                    return (
                      <TableRow key={k}>
                        <TableCell className="font-medium">{k === "applied" ? "Mit Seitenkontext" : "Kontrollgruppe"}</TableCell>
                        <TableCell align="right">{num(a.sessions)}</TableCell>
                        <TableCell align="right">{r(a.unanswered)}</TableCell>
                        <TableCell align="right">{r(a.clickedOther)}</TableCell>
                        <TableCell align="right">{r(a.clicked)}</TableCell>
                        <TableCell align="right">{r(a.cart)}</TableCell>
                        <TableCell align="right">
                          {a.orderWindowClosed > 0 ? ratio(a.ordered / a.orderWindowClosed) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {excludedTotal > 0 && (
                <p className="text-2xs text-muted-foreground">
                  Ausgeschlossen: {num(kpis.excluded.otherShare)} anderer Zeitraum oder Anteil ·{" "}
                  {num(kpis.excluded.mixed)} gemischt · {num(kpis.excluded.unresolved)} Produkt nicht erkannt ·{" "}
                  {num(kpis.excluded.primed)} Klick davor · {num(kpis.excluded.windowOpen)} Zeitfenster offen
                </p>
              )}
            </>
          )}
        </>
      )}
    </KpiSection>
  );
}
