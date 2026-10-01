// Mo-Effekt — do customers who talked to Mo buy differently from comparable
// customers who never did? The no-Mo figures are re-weighted to the Mo
// group's value-tier mix (lib/mo-effect.mjs). Plus: customers whose first chat
// came before their first order, and where today's subscribers come from.
// Pure DB, period-independent. Correlation, not causation — said in the InfoTip.

import type { MoEffectKpis } from "@/lib/customer-list-store";
import { CONSENT_SOURCE_GROUP_LABELS, computeMoEffect, consentSourceGroup } from "@/lib/mo-effect.mjs";
import { eurFromCents, num, ratio } from "@/lib/admin-format.mjs";
import {
  BarList,
  Callout,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  InfoTip,
  Stat,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui";
import { Explain, KpiSection, LifetimeBadge, StatGrid } from "../KpiSection";

const VALUE_LABELS: Record<string, string> = {
  klein: "Kleinteile",
  komponente: "Komponenten",
  grossgeraet: "Großgeräte",
  unbekannt: "Unbekannt",
};

const INFO = (
  <Explain>
    <p>
      Vergleicht Kund:innen mit mindestens einer Bestellung, die mit Mo gesprochen haben, mit Kund:innen ohne
      Gespräch. Die Werte „ohne Mo (vergleichbar)“ sind auf dieselbe Mischung der Wertstufen umgerechnet wie die
      Mo-Gruppe — so wird ein Großgeräte-Käufer mit einem Großgeräte-Käufer verglichen.
    </p>
    <p>
      Das ist ein Zusammenhang, kein Beweis: Wer mit Mo spricht, ist oft ohnehin interessierter (Selektionseffekt).
      „Über Mo gewonnen“ zählt Kund:innen, deren erstes Gespräch vor der ersten Bestellung lag.
    </p>
  </Explain>
);

function liftText(v: number | null): string | undefined {
  if (v == null) return undefined;
  const sign = v > 0 ? "+" : "";
  return `${sign}${ratio(v)} ggü. vergleichbar ohne Mo`;
}

export function MoEffektSection({ kpis }: { kpis: MoEffectKpis | null }) {
  const effect = kpis ? computeMoEffect(kpis.rows) : null;
  const empty = !kpis ? "Noch keine Daten." : effect && effect.mo.n + effect.withoutMo.n === 0 ? "Noch keine Bestellungen." : null;
  const sources = new Map<string, number>();
  for (const s of kpis?.subscribersBySource ?? []) {
    const g = consentSourceGroup(s.source);
    sources.set(g, (sources.get(g) ?? 0) + s.n);
  }
  const dash = "—";
  return (
    <KpiSection id="mo-effekt" title="Mo-Effekt" info={INFO} badges={<LifetimeBadge />} empty={empty}>
      {kpis && effect && (
        <>
          {!effect.enough && (
            <Callout tone="info" className="mb-4">
              Noch wenige Kund:innen in einer der Gruppen — die Werte schwanken stark.
            </Callout>
          )}
          <StatGrid cols={4}>
            <Stat
              label="Bestellungen je Kunde (Mo)"
              value={effect.mo.avgOrders == null ? dash : num(effect.mo.avgOrders, 2)}
              hint={liftText(effect.lift?.avgOrders ?? null)}
            />
            <Stat
              label="Ø Bestellwert (Mo)"
              value={eurFromCents(effect.mo.aovCents)}
              hint={liftText(effect.lift?.aovCents ?? null)}
            />
            <Stat
              label="Wiederkaufquote (Mo)"
              value={ratio(effect.mo.repurchaseRate)}
              hint={liftText(effect.lift?.repurchaseRate ?? null)}
            />
            <Stat
              label="Über Mo gewonnen"
              value={num(kpis.wonByMo.n)}
              hint={`${eurFromCents(kpis.wonByMo.revenueCents)} Umsatz seitdem`}
            />
          </StatGrid>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
                  Nach Wertstufe
                  <InfoTip>Kund:innen mit Bestellung je Wertstufe, mit und ohne Mo-Gespräch.</InfoTip>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 pb-2">
                <Table className="text-xs [&_td]:tabular-nums [&_td]:whitespace-nowrap">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Wertstufe</TableHead>
                      <TableHead align="right">Kund:innen (Mo / ohne)</TableHead>
                      <TableHead align="right">Bestellungen je Kunde</TableHead>
                      <TableHead align="right">Ø Bestellwert</TableHead>
                      <TableHead align="right">Wiederkauf</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {effect.tiers.map((t) => (
                      <TableRow key={t.tier}>
                        <TableCell className="font-medium">{VALUE_LABELS[t.tier] ?? t.tier}</TableCell>
                        <TableCell align="right">
                          {num(t.mo.n)} / {num(t.withoutMo.n)}
                        </TableCell>
                        <TableCell align="right">
                          {t.mo.avgOrders == null ? dash : num(t.mo.avgOrders, 2)} /{" "}
                          {t.withoutMo.avgOrders == null ? dash : num(t.withoutMo.avgOrders, 2)}
                        </TableCell>
                        <TableCell align="right">
                          {eurFromCents(t.mo.aovCents)} / {eurFromCents(t.withoutMo.aovCents)}
                        </TableCell>
                        <TableCell align="right">
                          {ratio(t.mo.repurchaseRate)} / {ratio(t.withoutMo.repurchaseRate)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {effect.withoutMoMatched && (
                      <TableRow>
                        <TableCell className="font-medium">Gesamt (vergleichbar)</TableCell>
                        <TableCell align="right">
                          {num(effect.mo.n)} / {num(effect.withoutMoMatched.n)}
                        </TableCell>
                        <TableCell align="right">
                          {effect.mo.avgOrders == null ? dash : num(effect.mo.avgOrders, 2)} /{" "}
                          {effect.withoutMoMatched.avgOrders == null ? dash : num(effect.withoutMoMatched.avgOrders, 2)}
                        </TableCell>
                        <TableCell align="right">
                          {eurFromCents(effect.mo.aovCents)} / {eurFromCents(effect.withoutMoMatched.aovCents)}
                        </TableCell>
                        <TableCell align="right">
                          {ratio(effect.mo.repurchaseRate)} / {ratio(effect.withoutMoMatched.repurchaseRate)}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
                  Abonnent:innen nach Herkunft
                  <InfoTip>Wo die heute gültige Einwilligung erteilt wurde — zeigt Mos Beitrag zum Wachstum der Liste.</InfoTip>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <BarList
                  rows={(["shopify", "mo", "admin", "sonstige"] as const)
                    .filter((g) => (sources.get(g) ?? 0) > 0)
                    .map((g) => ({ key: g, label: CONSENT_SOURCE_GROUP_LABELS[g], count: sources.get(g) ?? 0 }))}
                />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </KpiSection>
  );
}
