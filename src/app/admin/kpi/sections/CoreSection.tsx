// Beratungen (formerly „Kern-Metriken“) — volume and engagement of the chats in
// the period, chats per day, the chat and capture languages (formerly the
// section „Sprachen (DE/EN)“) and the raw event table (collapsed). The in-chat
// clicks moved into „Vom Chat zur Bestellung“; the status donut was removed
// (its „Konvertiert“ came only from the retired MS5- conversion sweep).

import type { CoreMetrics, LocaleCount, LocaleSplit } from "@/lib/kpi-store";
import type { KpiRange } from "@/lib/kpi-range";
import { num, ratio } from "@/lib/admin-format.mjs";
import { ADMIN_DATE_PADDED, formatAdmin } from "@/lib/admin-datetime.mjs";
import { discontinuedWidgetEvent } from "@/lib/kpi-widget-events.mjs";
import {
  BarList,
  Disclosure,
  InfoTip,
  Stat,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui";
import { ChatsPerDayChart } from "../charts";
import { ChartCard, Explain, KpiSection, StatGrid } from "../KpiSection";

const LOCALE_LABELS: Record<string, string> = {
  de: "Deutsch",
  en: "Englisch",
  unknown: "Unbekannt (vor Erfassung)",
};

const LOCALE_INFO = (
  <Explain>
    <p>Beratungen nach gewählter Chat-Sprache und E-Mail-Angaben nach Capture-Sprache.</p>
    <p>
      Die Chat-Sprache wird seit Migration 0041 pro Beratung gespeichert (letzter Turn zählt); ältere
      Beratungen erscheinen als „Unbekannt“. Capture-Sprache seit Migration 0030.
    </p>
  </Explain>
);

export function CoreSection({
  core,
  locales,
  range,
}: {
  core: CoreMetrics | null;
  locales: LocaleSplit | null;
  range: KpiRange;
}) {
  return (
    <KpiSection
      id="kern"
      title="Beratungen"
      info="Beratungen im gewählten Zeitraum: Volumen, Länge, Abbrüche, Engagement und Sprachen — jede Zahl direkt aus der Datenbank. Wie viele davon zu Produkten, Klicks und Bestellungen führen, zeigt „Vom Chat zur Bestellung“."
      empty={core ? null : "Noch keine Daten."}
    >
      {core && (
        <>
          <StatGrid cols={4}>
            <Stat
              label="Chats gesamt"
              value={num(core.totalChats)}
              hint={`Ø ${num(core.avgMessagesPerChat, 1)} Nachrichten je Chat`}
            />
            <Stat
              label="Reichweite (Sitzungen)"
              value={num(core.sessionsWithTelemetry)}
              hint={`mit irgendeinem Widget-Event · ${num(core.openedSessions)} öffneten den Chat`}
              info="Sitzungen mit irgendeinem Widget-Event im Zeitraum — auch ohne Öffnen (die Launcher-Animation, Hinweise und Popups senden ohne Klick)."
            />
            <Stat
              label="Abgebrochen"
              value={`${num(core.status.abandoned)} · ${ratio(core.abandonedRate)}`}
              hint="status='abandoned' (Beratung ohne Abschluss)"
            />
            <Stat
              label="Geöffnet → geschrieben"
              value={ratio(core.engagementRate)}
              hint={`${num(core.wroteSessions)} von ${num(core.openedSessions)} Sitzungen mit geöffnetem Chat`}
              info="Sitzungen, in denen die Person selbst geschrieben hat (message_sent), geteilt durch Sitzungen, die den Chat geöffnet haben (chat_opened). Bis 04.10.2026 stand hier „Chats ÷ alle Sitzungen mit Telemetrie“ — das zählte auch Geräte, die den Chat nie geöffnet hatten (die Launcher-Animation sendet ohne Öffnen), und Begrüßungen ohne Nachricht."
            />
          </StatGrid>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <ChartCard className="lg:col-span-2" title={`Chats pro Tag · ${range.label}`}>
              <ChatsPerDayChart data={core.chatsByDay} />
            </ChartCard>
            <ChartCard title="Sprachen" info={LOCALE_INFO}>
              <div className="flex flex-col gap-4">
                <div>
                  <h5 className="mb-1.5 text-xs font-medium text-muted-foreground">Chats</h5>
                  <LocaleBars counts={locales?.chats ?? []} />
                </div>
                <div>
                  <h5 className="mb-1.5 text-xs font-medium text-muted-foreground">E-Mail-Angaben</h5>
                  <LocaleBars counts={locales?.captures ?? []} />
                </div>
              </div>
            </ChartCard>
          </div>

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
                          <EventName event={e.event} />
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

/** An event name; a retired widget event says so instead of reading as a drop. */
function EventName({ event }: { event: string }) {
  const retired = discontinuedWidgetEvent(event);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{event}</code>
      {retired && (
        <>
          <StatusBadge tone="neutral" dot={false}>
            eingestellt
          </StatusBadge>
          <InfoTip label={`Warum ${event} eingestellt ist`}>
            Sendet das Widget seit dem {formatAdmin(`${retired.since}T12:00:00Z`, ADMIN_DATE_PADDED)} nicht mehr
            ({retired.note}) — der Rückgang auf null ist gewollt.
          </InfoTip>
        </>
      )}
    </span>
  );
}

function LocaleBars({ counts }: { counts: LocaleCount[] }) {
  const total = counts.reduce((a, c) => a + c.count, 0);
  return (
    <BarList
      empty="Keine im Zeitraum."
      rows={counts.map((c) => ({
        key: c.locale,
        label: LOCALE_LABELS[c.locale] ?? c.locale,
        count: c.count,
        hint: total > 0 ? ratio(c.count / total) : undefined,
      }))}
    />
  );
}
