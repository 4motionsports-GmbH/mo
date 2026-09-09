// Kern-Metriken — headline stats, chats per day, status split, in-chat clicks
// and the raw event table (collapsed).

import type { CoreMetrics } from "@/lib/kpi-store";
import type { KpiRange } from "@/lib/kpi-range";
import { num, ratio } from "@/lib/admin-format.mjs";
import {
  Disclosure,
  Stat,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui";
import { ChatsPerDayChart, StatusSplitChart } from "../charts";
import { ChartCard, Explain, KpiSection, StatGrid, SubHeading } from "../KpiSection";

const STATUS_INFO = (
  <Explain>
    <p>
      „Konvertiert“ setzt der tägliche Conversion-Sweep: der einmalige Mo-Rabattcode (MS5-…) der aus
      dieser Beratung entstandenen Marketing-E-Mail wurde in einer echten Bestellung eingelöst —
      dieselbe ehrliche Zuordnung wie beim Umsatz-Abschnitt. Käufe ohne Mo-Code sind nicht
      zurechenbar und erscheinen hier nicht; „Konvertiert“ ist eine Untergrenze.
    </p>
  </Explain>
);

const CLICKS_INFO = (
  <Explain>
    <p>
      Klick-Signale werden anhand der Event-Namen aus der Widget-Telemetrie gemustert (Produkt/CTA:{" "}
      <code>%product%click%</code> / <code>%cta%click%</code>; Warenkorb: <code>%cart%</code> /{" "}
      <code>%checkout%</code>). Die vollständige Event-Übersicht zeigt die Rohdaten.
    </p>
  </Explain>
);

export function CoreSection({ core, range }: { core: CoreMetrics | null; range: KpiRange }) {
  return (
    <KpiSection
      id="kern"
      title="Kern-Metriken"
      info="Beratungen im gewählten Zeitraum: Volumen, Länge, Abbrüche und Engagement — jede Zahl direkt aus der Datenbank."
      empty={core ? null : "Noch keine Daten."}
    >
      {core && (
        <>
          <StatGrid cols={4}>
            <Stat label="Chats gesamt" value={num(core.totalChats)} />
            <Stat label="Ø Nachrichten / Chat" value={num(core.avgMessagesPerChat, 1)} />
            <Stat
              label="Abgebrochen"
              value={`${num(core.status.abandoned)} · ${ratio(core.abandonedRate)}`}
              hint="status='abandoned' (Beratung ohne Abschluss)"
            />
            <Stat
              label="Engagement"
              value={ratio(core.engagementRate)}
              hint="Chats mit Nachricht ÷ Sessions mit Telemetrie"
            />
          </StatGrid>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <ChartCard className="lg:col-span-2" title={`Chats pro Tag · ${range.label}`}>
              <ChatsPerDayChart data={core.chatsByDay} />
            </ChartCard>
            <ChartCard title="Status-Verteilung" info={STATUS_INFO}>
              <StatusSplitChart
                active={core.status.active}
                abandoned={core.status.abandoned}
                converted={core.status.converted}
              />
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <LegendDot color="var(--muted-foreground)" label="Aktiv" value={core.status.active} />
                <LegendDot color="var(--warning)" label="Abgebrochen" value={core.status.abandoned} />
                <LegendDot color="var(--success)" label="Konvertiert" value={core.status.converted} />
              </div>
            </ChartCard>
          </div>

          <SubHeading info={CLICKS_INFO}>In-Chat-Klicks (Buttons im Chat)</SubHeading>
          <StatGrid cols={3}>
            <Stat
              label="Produkt-/CTA-Klicks"
              value={num(core.productCtaClicks)}
              hint={`${num(core.productCtaRatePerChat, 2)} pro Chat`}
            />
            <Stat
              label="Add-to-Cart-Klicks"
              value={num(core.addToCartClicks)}
              hint={`${num(core.addToCartRatePerChat, 2)} pro Chat`}
            />
            <Stat label="Sessions mit Telemetrie" value={num(core.sessionsWithTelemetry)} />
          </StatGrid>

          {core.topEvents.length > 0 && (
            <div className="mt-4">
              <Disclosure title="Event-Übersicht (Top 20)" meta={`${num(core.topEvents.length)} Events`}>
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Event</TableHead>
                      <TableHead align="right">Anzahl</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {core.topEvents.map((e) => (
                      <TableRow key={e.event}>
                        <TableCell>
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{e.event}</code>
                        </TableCell>
                        <TableCell align="right" className="tabular-nums">
                          {num(e.count)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Disclosure>
            </div>
          )}
        </>
      )}
    </KpiSection>
  );
}

function LegendDot({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} aria-hidden />
      {label}: <strong className="text-foreground">{num(value)}</strong>
    </span>
  );
}
