// „Wie der Umsatz entstand“ — the split of „Umsatz durch Mo“ by HOW each order
// came about: the three tiers as one part-to-whole bar, then every channel with
// orders, revenue, share and Ø Bestellwert, grouped under its tier, and the
// cross-cut „mit Mo-Rabattcode“ (inside the rows above, never on top). Every
// order sits in exactly one row (precedence in lib/mo-revenue.mjs).

import { REVENUE_CHANNELS, TIER_LABELS } from "@/lib/mo-revenue.mjs";
import { money, num, ratio } from "@/lib/admin-format.mjs";
import {
  Card,
  CardContent,
  InfoTip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  cn,
} from "../../ui";
import { Explain, KpiSection } from "../KpiSection";
import { TIER_BG, TIER_ORDER } from "../revenue-colors";
import type { RevenueView } from "../revenue-view";
import type { RevenueSeriesKey } from "../revenue-series";

const INFO = (
  <Explain>
    <p>
      Jede Bestellung aus „Umsatz durch Mo“ steht in genau einer Zeile — die Zeilen ergeben zusammen den Umsatz. Der Weg
      folgt einer festen Reihenfolge: ein eingelöster Mo-Rabattcode geht vor (<code>MK-</code> → Kampagne,{" "}
      <code>MS5-</code> → persönliche Marketing-E-Mail), dann der Mo-Link, über den gekauft wurde (Set-Angebot,
      Marketing-E-Mail, Zusammenfassung), dann die Widget-Markierung mit der Frage, ob ein Produkt aus der Beratung
      gekauft wurde.
    </p>
    <p>
      Die drei Stufen sind die der Bestell-Zuordnung: „Beraten & gekauft“ und „Beraten, anderes gekauft“ (Warenkorb vom
      Widget markiert) sowie „Direkt über Mo“ (Mo-Link oder Mo-Code). „Mit Mo-Rabattcode“ ist ein Querschnitt über die
      Zeilen — dieselben Bestellungen, nicht zusätzlich.
    </p>
  </Explain>
);

const GROUPS: Array<{ label: string; tiers: RevenueSeriesKey[] }> = [
  { label: "Beratung im Chat", tiers: ["assisted", "influenced"] },
  { label: "Direkt über Mo", tiers: ["direct"] },
];

export function UmsatzWegeSection({ view }: { view: RevenueView | null }) {
  if (!view) return <KpiSection id="umsatz-wege" title="Wie der Umsatz entstand" info={INFO} empty="Noch keine Daten." />;
  const s = view.summary;
  const cur = s.currency;
  const total = s.revenue;
  const channels = s.byChannel.filter((c) => c.key !== "sonstig" || c.orders > 0);
  const detail = new Map(REVENUE_CHANNELS.map((c) => [c.key, c.detail]));

  return (
    <KpiSection
      id="umsatz-wege"
      title="Wie der Umsatz entstand"
      info={INFO}
      empty={s.orders === 0 ? "Keine zugeordnete, bezahlte Bestellung im Zeitraum." : null}
    >
      <Card>
        <CardContent className="flex flex-col gap-5 p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {TIER_ORDER.map((t) => {
              const v = s.byTier[t];
              return (
                <div key={t} className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className={cn("size-2.5 rounded-sm", TIER_BG[t])} aria-hidden />
                    {TIER_LABELS[t]}
                  </span>
                  <span className="text-xl font-semibold tracking-tight text-foreground">{money(v.revenue, cur)}</span>
                  <span className="text-2xs text-muted-foreground">
                    {total > 0 ? ratio(v.revenue / total) : "—"} · {num(v.orders)}{" "}
                    {v.orders === 1 ? "Bestellung" : "Bestellungen"}
                  </span>
                </div>
              );
            })}
          </div>

          <MixBar view={view} />

          <div className="-mx-5 border-t border-border">
            <Table className="text-sm [&_td]:tabular-nums">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Weg</TableHead>
                  <TableHead align="right">Bestellungen</TableHead>
                  <TableHead align="right">Umsatz</TableHead>
                  <TableHead className="w-[22%] min-w-36 whitespace-nowrap">Anteil am Umsatz</TableHead>
                  <TableHead align="right" className="whitespace-nowrap pr-5">
                    Ø Bestellwert
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {GROUPS.map((g) => {
                  const rows = channels.filter((c) => g.tiers.includes(c.tier as RevenueSeriesKey));
                  const orders = rows.reduce((a, r) => a + r.orders, 0);
                  const revenue = rows.reduce((a, r) => a + r.revenue, 0);
                  return [
                    <TableRow key={g.label} className="bg-surface-2/60 hover:bg-surface-2/60">
                      <TableCell className="pl-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {g.label}
                      </TableCell>
                      <TableCell align="right" className="text-xs font-semibold text-muted-foreground">
                        {num(orders)}
                      </TableCell>
                      <TableCell align="right" className="text-xs font-semibold text-muted-foreground">
                        {money(revenue, cur)}
                      </TableCell>
                      <TableCell className="text-xs font-semibold text-muted-foreground">
                        {total > 0 ? ratio(revenue / total) : "—"}
                      </TableCell>
                      <TableCell align="right" className="pr-5 text-xs font-semibold text-muted-foreground">
                        {orders > 0 ? money(revenue / orders, cur) : "—"}
                      </TableCell>
                    </TableRow>,
                    ...rows.map((c) => (
                      <TableRow key={c.key} className={cn(c.orders === 0 && "text-muted-foreground")}>
                        <TableCell className="pl-5">
                          <span className="flex items-center gap-2 whitespace-nowrap">
                            <span
                              className={cn("size-2.5 shrink-0 rounded-sm", TIER_BG[c.tier as RevenueSeriesKey])}
                              aria-hidden
                            />
                            <span className={cn("font-medium", c.orders === 0 && "font-normal")}>{c.label}</span>
                            <InfoTip label={`Was „${c.label}“ zählt`}>{detail.get(c.key)}</InfoTip>
                          </span>
                        </TableCell>
                        <TableCell align="right">{num(c.orders)}</TableCell>
                        <TableCell align="right" className={cn(c.orders > 0 && "font-semibold text-foreground")}>
                          {money(c.revenue, cur)}
                        </TableCell>
                        <TableCell>
                          <ShareBar share={c.share} tier={c.tier as RevenueSeriesKey} />
                        </TableCell>
                        <TableCell align="right" className="pr-5">
                          {c.aov == null ? "—" : money(c.aov, cur)}
                        </TableCell>
                      </TableRow>
                    )),
                  ];
                })}
                <TableRow className="hover:bg-transparent">
                  <TableCell className="pl-5">
                    <span className="flex items-center gap-1.5 whitespace-nowrap text-muted-foreground">
                      davon mit Mo-Rabattcode (MS5-/MK-)
                      <InfoTip label="Wie Rabattcodes gezählt werden">
                        Bestellungen, die einen einmaligen Mo-Code eingelöst haben — sie stehen schon in den Zeilen
                        oben (Kampagne bzw. persönliche Marketing-E-Mail) und werden nicht zusätzlich gezählt. Trägt eine
                        Bestellung Code und Markierung, zählt sie einmal, unter ihrem Code; eine Bestellung, die der
                        Shopify-Code-Abgleich findet und die auch per Webhook erfasst ist, ebenfalls nur einmal.
                      </InfoTip>
                    </span>
                  </TableCell>
                  <TableCell align="right" className="text-muted-foreground">
                    {num(s.withMoCode.orders)}
                  </TableCell>
                  <TableCell align="right" className="text-muted-foreground">
                    {money(s.withMoCode.revenue, cur)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {total > 0 ? ratio(s.withMoCode.revenue / total) : "—"}
                  </TableCell>
                  <TableCell align="right" className="pr-5 text-muted-foreground">
                    {s.withMoCode.orders > 0 ? money(s.withMoCode.revenue / s.withMoCode.orders, cur) : "—"}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </KpiSection>
  );
}

/** The tiers as one part-to-whole bar (2 px surface gaps, tooltip per segment). */
function MixBar({ view }: { view: RevenueView }) {
  const s = view.summary;
  const parts = TIER_ORDER.filter((t) => s.byTier[t].revenue > 0).map((t) => ({
    t,
    v: s.byTier[t],
    share: s.revenue > 0 ? s.byTier[t].revenue / s.revenue : 0,
  }));
  if (parts.length === 0) return null;
  return (
    <div
      className="grid h-5 w-full gap-0.5"
      style={{ gridTemplateColumns: parts.map((p) => `${Math.max(p.share, 0.005)}fr`).join(" ") }}
      aria-label="Anteile am Umsatz nach Stufe"
      role="group"
    >
      {parts.map((p, i) => (
        <Tooltip key={p.t} content={`${TIER_LABELS[p.t]}: ${money(p.v.revenue, s.currency)} · ${ratio(p.share)}`}>
          <span
            tabIndex={0}
            aria-label={`${TIER_LABELS[p.t]}: ${money(p.v.revenue, s.currency)}, ${ratio(p.share)}`}
            className={cn(
              "block h-full w-full transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              TIER_BG[p.t],
              i === 0 && "rounded-l-sm",
              i === parts.length - 1 && "rounded-r-sm"
            )}
          />
        </Tooltip>
      ))}
    </div>
  );
}

/** A share as a thin bar in its tier colour on a muted track, with the number. */
function ShareBar({ share, tier }: { share: number | null; tier: RevenueSeriesKey }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-2 flex-1 overflow-hidden rounded-sm bg-muted" aria-hidden>
        <span className={cn("block h-full rounded-r-sm", TIER_BG[tier])} style={{ width: `${(share ?? 0) * 100}%` }} />
      </span>
      <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {share == null ? "—" : ratio(share)}
      </span>
    </span>
  );
}
