// Eingang — the learning loop of the operator inbox: per kind, how many
// items came up in the period, how many were acted on or dismissed (and why),
// and what happened in the 14 days after a decision. Descriptive only.

import type { InboxKpis } from "@/lib/inbox-store";
import { SIGNAL_KINDS } from "@/lib/customer-signals.mjs";
import { eurFromCents, num, ratio } from "@/lib/admin-format.mjs";
import { Card, CardContent, Stat, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../ui";
import { Explain, KpiSection, StatGrid } from "../KpiSection";

const INFO = (
  <Explain>
    <p>Hinweise im Eingang nach Art: wie oft sie entstanden, ob gehandelt oder verworfen wurde und was danach geschah.</p>
    <p>
      „Bestellung danach“ zählt Bestellungen innerhalb von 14 Tagen nach der Entscheidung. Das ist eine
      Beschreibung, kein Wirkungsnachweis — Personen, bei denen gehandelt wurde, unterscheiden sich von denen,
      bei denen nicht. Schwellen ändert ein Mensch, nie das System.
    </p>
  </Explain>
);

export function EingangSection({ kpis }: { kpis: InboxKpis | null }) {
  const empty = !kpis ? "Noch keine Daten." : kpis.totalCreated === 0 ? "Im Zeitraum sind keine Hinweise entstanden." : null;
  return (
    <KpiSection id="eingang" title="Eingang" info={INFO} empty={empty}>
      {kpis && (
        <>
          <StatGrid cols={3}>
            <Stat label="Hinweise" value={num(kpis.totalCreated)} hint="im Zeitraum entstanden" />
            <Stat label="Gehandelt" value={num(kpis.totalActed)} hint={ratio(kpis.totalCreated > 0 ? kpis.totalActed / kpis.totalCreated : null)} />
            <Stat label="KI-Vorschläge" value={num(kpis.suggestionsMade)} />
          </StatGrid>
          <Card className="mt-3">
            <CardContent className="p-0 pb-2">
              <Table className="text-xs [&_td]:tabular-nums">
                <TableHeader>
                  <TableRow>
                    <TableHead>Art</TableHead>
                    <TableHead align="right">Entstanden</TableHead>
                    <TableHead align="right">Gehandelt</TableHead>
                    <TableHead align="right">Verworfen</TableHead>
                    <TableHead align="right">Von selbst</TableHead>
                    <TableHead align="right">Bestellung danach (gehandelt)</TableHead>
                    <TableHead align="right">Umsatz danach</TableHead>
                    <TableHead>Häufigster Verwerfgrund</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {kpis.kinds.map((k) => (
                    <TableRow key={k.kind}>
                      <TableCell>{SIGNAL_KINDS[k.kind as keyof typeof SIGNAL_KINDS]?.label ?? k.kind}</TableCell>
                      <TableCell align="right">{num(k.created)}</TableCell>
                      <TableCell align="right">{num(k.acted)}</TableCell>
                      <TableCell align="right">{num(k.dismissed)}</TableCell>
                      <TableCell align="right">{num(k.closedBySelf)}</TableCell>
                      <TableCell align="right">
                        {k.acted > 0 ? `${num(k.ordersAfterActed)} (${ratio(k.ordersAfterActed / k.acted)})` : "—"}
                      </TableCell>
                      <TableCell align="right">{k.revenueAfterActedCents > 0 ? eurFromCents(k.revenueAfterActedCents) : "—"}</TableCell>
                      <TableCell>{k.topDismissReason ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </KpiSection>
  );
}
