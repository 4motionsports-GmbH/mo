// „Umsatz durch Mo“ — the head of the revenue centre: the one hero figure (paid
// revenue of every Mo-attributed order in the period) against the period
// before, revenue over time stacked by tier, and the three tiles orders · Ø
// Bestellwert · Umsatz je 1 € KI-Kosten. Data: kpi/revenue-view (ledger live,
// Shopify code lookup cached). Definition: docs/ADMIN_DASHBOARD.md §5.1.

import type { KpiRange } from "@/lib/kpi-range";
import { germanDay, releaseNotesFor } from "@/lib/kpi-releases.mjs";
import { TIER_LABELS } from "@/lib/mo-revenue.mjs";
import { eur, money, num, plural } from "@/lib/admin-format.mjs";
import { ADMIN_DAY_MONTH, formatAdmin } from "@/lib/admin-datetime.mjs";
import {
  Callout,
  Card,
  CardContent,
  Disclosure,
  EmptyState,
  InfoTip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui";
import { RevenueOverTimeChart } from "../charts";
import { Explain, FreshnessBadge, KpiSection } from "../KpiSection";
import { DeltaPill, KpiTile } from "../KpiTile";
import { Sparkline } from "../Sparkline";
import { TIER_BG, TIER_COLOR, TIER_ORDER } from "../revenue-colors";
import type { RevenueView } from "../revenue-view";

function periodText(p: { from: string; to: string }): string {
  return `${germanDay(p.from)} – ${germanDay(p.to)}`;
}

export function UmsatzSection({ view, range }: { view: RevenueView | null; range: KpiRange }) {
  const windowDays = num(view?.attributionWindowDays ?? 30);
  const prev = view?.previous ?? null;
  const info = (
    <Explain>
      <p>
        Bezahlter Umsatz aller Bestellungen, die Mo zugeordnet sind: über die Mo-Markierung im Warenkorb (vom Widget
        gestempelt oder aus einem Mo-Link) oder über einen Mo-Rabattcode (<code>MS5-…</code>, <code>MK-…</code>). Erfasst
        per Shopify-Bestell-Webhook (<code>orders/create</code>, <code>orders/paid</code>); Bestellungen mit Mo-Code aus
        der Zeit vor der Webhook-Registrierung ergänzt ein Code-Abgleich bei Shopify. <strong>Jede Bestellung zählt genau
        einmal</strong> — auch wenn sie Code und Markierung trägt.
      </p>
      <p>
        Gezählt wird der tatsächlich bezahlte Bestellwert (inkl. MwSt., nach Teilerstattungen; nur Status PAID /
        PARTIALLY_REFUNDED). {view?.sessionAnchor
          ? `Zuordnungsfenster ${windowDays} Tage — bei der Widget-Markierung ab der letzten Produktberatung auf dem Gerät, bei Mo-Links in E-Mails ab der letzten Mail mit dieser Markierung, bei Set-Angeboten ab ihrer Erstellung.`
          : `Zuordnungsfenster ${windowDays} Tage ab der Erstellung der Markierung, bei Mo-Links in E-Mails ab der letzten Mail mit dieser Markierung.`}{" "}
        Unmarkierte Bestellungen werden nicht erfasst. Geräteübergreifende Käufe (Beratung am Handy, Kauf am Laptop)
        bleiben ohne E-Mail oder Code unsichtbar — eine physikalische Grenze, keine Messlücke.
      </p>
      <p>
        Vergleich: der gleich lange Zeitraum direkt davor{prev ? ` (${periodText(prev)})` : ""}, auf Basis der per Webhook
        erfassten Bestellungen. „Umsatz je 1 € KI-Kosten“ teilt den Umsatz durch die geschätzten KI-Kosten aller Aufrufe
        im Zeitraum (Abschnitt „KI-Kosten“) — Umsatz ist keine Marge, und ein Teil der Käufe wäre auch ohne Mo zustande
        gekommen.
      </p>
    </Explain>
  );

  if (!view) {
    return <KpiSection id="umsatz" title="Umsatz durch Mo" info={info} empty="Noch keine Daten." />;
  }

  const s = view.summary;
  const unresolved = view.unresolved.unknownToken + view.unresolved.outsideWindow;
  const cc = view.codeComplement;
  const notes = [
    ...releaseNotesFor("attribution", range),
    cc.orders > 0 &&
      `${plural(cc.orders, "Bestellung", "Bestellungen")} mit Mo-Code (${eur(cc.revenue)}) aus dem Shopify-Code-Abgleich ergänzt — vor der Webhook-Registrierung aufgegeben. Der Vergleich mit dem Vorzeitraum rechnet ohne sie.`,
    s.unrealised.orders > 0 &&
      `${plural(s.unrealised.orders, "erfasste Bestellung", "erfasste Bestellungen")} im Zeitraum (${eur(s.unrealised.revenue)}) sind (noch) nicht bezahlt und zählen nicht zum Umsatz.`,
    unresolved > 0 &&
      `${plural(unresolved, "markierte Bestellung", "markierte Bestellungen")} im Zeitraum ohne Zuordnung: ${num(view.unresolved.unknownToken)} mit unbekannter oder gelöschter Markierung, ${num(view.unresolved.outsideWindow)} außerhalb des Zuordnungsfensters — keiner Beratung zugeordnet (nicht in der Mo-Zuordnung gespeichert), nur gezählt.`,
    !cc.shopifyConfigured &&
      "Shopify ist nicht konfiguriert — Bestellungen mit Mo-Code aus der Zeit vor der Webhook-Registrierung können nicht ergänzt werden.",
    cc.shopifyConfigured && cc.unknown > 0 && `Bei ${num(cc.unknown)} Code(s) lieferte Shopify keine Antwort (nicht ergänzt).`,
    cc.sampled && "Der Shopify-Code-Abgleich prüft die 100 neuesten Codes.",
    s.otherCurrency > 0 &&
      `${plural(s.otherCurrency, "Bestellung", "Bestellungen")} in einer anderen Währung als ${s.currency} sind nicht umgerechnet und nicht enthalten.`,
  ];

  const against = "Vorzeitraum";
  const series = TIER_ORDER.map((key) => ({ key, label: TIER_LABELS[key], color: TIER_COLOR[key] }));
  const hasRevenue = s.orders > 0;

  return (
    <KpiSection
      id="umsatz"
      title="Umsatz durch Mo"
      info={info}
      badges={<FreshnessBadge fetchedAt={cc.fetchedAt} fromCache={cc.fromCache} />}
      notes={notes}
    >
      {!view.ingestionSeen && cc.orders === 0 && (
        <Callout tone="info" compact className="mb-4">
          Noch keine Bestellung über den Webhook erfasst. Voraussetzung: die Shopify-Webhooks <code>orders/create</code> +{" "}
          <code>orders/paid</code> sind auf <code>/api/webhooks/shopify</code> registriert (siehe docs/ORDER_ATTRIBUTION.md)
          — erfasst wird ab Registrierung, rückwirkend nicht.
        </Callout>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="flex flex-col gap-4 p-5">
            <div>
              <div className="text-xs font-medium text-muted-foreground">Bezahlter Umsatz · {range.label}</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-hero font-semibold tracking-tight text-foreground">{money(s.revenue, s.currency)}</span>
                <DeltaPill delta={view.deltas.revenue} against={against} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                <span>
                  {plural(s.orders, "Bestellung", "Bestellungen")} · Ø {s.aov == null ? "—" : money(s.aov, s.currency)}
                </span>
                {prev && (
                  <>
                    <span aria-hidden>·</span>
                    <span>
                      Vorzeitraum {money(prev.summary.revenue, s.currency)}
                    </span>
                    <InfoTip label="Welcher Vorzeitraum">
                      {periodText(prev)} — gleich lang wie der gewählte Zeitraum, direkt davor.
                    </InfoTip>
                  </>
                )}
              </div>
            </div>

            <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs" aria-label="Legende">
              {TIER_ORDER.map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <span className={`size-2.5 rounded-sm ${TIER_BG[t]}`} aria-hidden />
                  <span className="text-muted-foreground">{TIER_LABELS[t]}</span>
                  <strong className="font-semibold text-foreground">{money(s.byTier[t].revenue, s.currency)}</strong>
                </li>
              ))}
            </ul>

            {hasRevenue ? (
              <RevenueOverTimeChart buckets={view.series.buckets} weekly={view.series.weekly} series={series} />
            ) : (
              <EmptyState compact plain title="Keine zugeordnete, bezahlte Bestellung im Zeitraum." />
            )}

            {hasRevenue && (
              <Disclosure title="Werte als Tabelle" meta={view.series.weekly ? "je Woche" : "je Tag mit Umsatz"}>
                <Table className="text-xs [&_td]:tabular-nums">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{view.series.weekly ? "Woche ab" : "Tag"}</TableHead>
                      {TIER_ORDER.map((t) => (
                        <TableHead key={t} align="right">
                          {TIER_LABELS[t]}
                        </TableHead>
                      ))}
                      <TableHead align="right">Gesamt</TableHead>
                      <TableHead align="right">Bestellungen</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {view.series.buckets
                      .filter((b) => b.orders > 0)
                      .map((b) => (
                        <TableRow key={b.start}>
                          <TableCell>{formatAdmin(`${b.start}T12:00:00Z`, ADMIN_DAY_MONTH)}</TableCell>
                          {TIER_ORDER.map((t) => (
                            <TableCell key={t} align="right">
                              {b[t] > 0 ? money(b[t], s.currency) : "—"}
                            </TableCell>
                          ))}
                          <TableCell align="right" className="font-medium">
                            {money(b.total, s.currency)}
                          </TableCell>
                          <TableCell align="right">{num(b.orders)}</TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </Disclosure>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-1">
          <KpiTile
            label="Bestellungen"
            value={num(s.orders)}
            delta={view.deltas.orders}
            against={against}
            hint={prev ? `Vorzeitraum ${num(prev.summary.orders)}` : undefined}
            trend={
              hasRevenue ? (
                <Sparkline
                  points={view.orderPoints}
                  unit="orders"
                  label={
                    view.series.weekly || view.orderPoints.length < view.series.buckets.length
                      ? "Bestellungen je Woche"
                      : "Bestellungen je Tag"
                  }
                />
              ) : undefined
            }
          />
          <KpiTile
            label="Ø Bestellwert"
            value={s.aov == null ? "—" : money(s.aov, s.currency)}
            delta={view.deltas.aov}
            against={against}
            hint={
              prev?.summary.aov != null ? `Vorzeitraum ${money(prev.summary.aov, s.currency)}` : undefined
            }
          />
          <KpiTile
            label="Umsatz je 1 € KI-Kosten"
            info="Umsatz durch Mo geteilt durch die geschätzten KI-Kosten aller Aufrufe im Zeitraum (Chat, E-Mails, Analysen — Abschnitt „KI-Kosten“; ohne Porto). Umsatz ist keine Marge."
            value={view.roi == null ? "—" : money(view.roi, s.currency, 0)}
            delta={view.deltas.roi}
            against={against}
            hint={
              view.aiCost == null
                ? "keine KI-Kosten im Zeitraum erfasst"
                : `KI-Kosten im Zeitraum ${eur(view.aiCost)}`
            }
          />
        </div>
      </div>
    </KpiSection>
  );
}
