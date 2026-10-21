// „Wirkung“ of the Konfigurator screen (server component): the funnel from the
// first answer on the page to the order, the headline numbers, how visitors
// answered, where they came from (seal / partner link), which products Mo put
// into plans and the latest configurator consultations with a link into
// Gespräche. Data: configurator-store getConfiguratorKpis (kpi_events +
// mo_orders, pure DB). Ids and enums only — no names or texts of visitors.

import * as React from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { ConfiguratorKpis } from "@/lib/configurator-store";
import { configuratorFunnel, configuratorLabel } from "@/lib/configurator-core.mjs";
import { eur, num, ratio } from "@/lib/admin-format.mjs";
import { ADMIN_DATE_TIME_SHORT, formatAdmin } from "@/lib/admin-datetime.mjs";
import { adminTabHref } from "@/lib/admin-tabs.mjs";
import {
  BarList,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  InfoTip,
  Section,
  Stat,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui";
import { FunnelBars } from "../kpi/FunnelBars";
import { KpiSection } from "../kpi/KpiSection";

const STAGE_INFO: Record<string, string> = {
  started: "Sitzungen, die auf der Konfigurator-Seite mindestens eine Antwort gewählt haben (Widget-Ereignis configurator_started).",
  handover: "Klick auf „Mo berät mich“ — die Angaben gehen an Mo (configurator_handover).",
  chats: "Mo hat die Beratung mit den Angaben gestartet (serverseitig, configurator_chat_started). Weniger als „übergeben“, wenn der Chat nicht antworten konnte (z. B. Rate-Limit).",
  plans: "Mo hat mindestens einen Home-Gym-Plan gezeigt (show_gym_plan, serverseitig gezählt).",
  carts: "„Alles in den Warenkorb“ im Plan wurde geklickt und der Warenkorb hat die Produkte angenommen (configurator_cart_added).",
  orders: "Sitzungen mit einer Mo-zugeordneten, bezahlten Bestellung nach dem Konfigurator-Start (mo_orders; braucht die Analyse-Einwilligung im Shop für die Warenkorb-Markierung).",
};

const INFO = (
  <div className="flex flex-col gap-1.5">
    <p>
      Jede Stufe zählt Sitzungen für sich (ein Gerät, keine Person). Beim Übergeben startet das Widget einen neuen Chat —
      bei anonymen Besuchern mit neuer Sitzungs-ID —, deshalb ist jede Stufe einzeln gezählt und nicht strikt eine
      Teilmenge der vorigen.
    </p>
    <p>
      Seitenaufrufe zählen nur mit Analyse-Einwilligung im Shop. Bestellungen: nur Mo-markierte, bezahlte Bestellungen bis
      zum Ende des Zeitraums (docs/ORDER_ATTRIBUTION.md).
    </p>
  </div>
);

export function KonfiguratorKpis({
  kpis,
  rangeLabel,
  rangeControl,
}: {
  kpis: ConfiguratorKpis | null;
  rangeLabel: string;
  rangeControl: React.ReactNode;
}) {
  const s = kpis?.sessions;
  const f = s ? configuratorFunnel(s) : null;
  const empty = !kpis
    ? "Noch keine Daten."
    : s && s.started + s.handover + s.chats === 0
      ? "Im Zeitraum hat niemand den Konfigurator genutzt."
      : null;
  return (
    <Section
      title="Wirkung"
      subtitle={rangeLabel}
      info="Wie der Home-Gym-Konfigurator wirkt: vom ersten Klick auf der Seite über Mos Plan bis zur Bestellung."
      actions={rangeControl}
    >
      {s && f && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat
            label="Seitenaufrufe"
            value={num(s.viewed)}
            hint="nur mit Analyse-Einwilligung"
            info="Sitzungen, die die Konfigurator-Seite gesehen haben — das Widget sendet das nur mit Analyse-Einwilligung im Shop (configurator_viewed)."
          />
          <Stat
            label="An Mo übergeben"
            value={num(s.handover)}
            hint={f.handoverRate == null ? `${num(s.started)} begonnen` : `${ratio(f.handoverRate)} der Begonnenen`}
          />
          <Stat
            label="Plan erstellt"
            value={num(s.plans)}
            hint={`${num(kpis.plansShown)} Pläne · ${f.planRate == null ? "—" : ratio(f.planRate)} der Beratungen`}
          />
          <Stat
            label="Warenkorb"
            value={eur(kpis.cartValue, 0)}
            hint={`${num(kpis.cartAdds)} ${kpis.cartAdds === 1 ? "Mal" : "Mal"} · ${num(kpis.cartUnits)} Artikel`}
            info="Summe der Pläne, die mit „Alles in den Warenkorb“ in den Shop-Warenkorb gelegt wurden (Wert laut Plan beim Klick, ohne Versand)."
          />
          <Stat
            label="Bestellungen"
            value={num(kpis.orders)}
            hint={`${eur(kpis.revenue, 0)} Umsatz`}
            info="Mo-zugeordnete, bezahlte Bestellungen der Konfigurator-Sitzungen nach dem Start der Beratung."
          />
        </div>
      )}
      <div className="flex flex-col gap-6">
        <KpiSection id="konfigurator-funnel" title="Vom ersten Klick zur Bestellung" info={INFO} empty={empty}>
          {s && f && (
            <Card>
              <CardContent className="p-5">
                <FunnelBars
                  unit="Sitzungen"
                  highlightBiggestDrop
                  stages={f.stages.map((st) => ({ key: st.key, label: st.label, value: st.value, info: STAGE_INFO[st.key] }))}
                />
              </CardContent>
            </Card>
          )}
        </KpiSection>

        {kpis && !empty && (
          <>
            <KpiSection
              id="konfigurator-antworten"
              title="So antworten die Besucher"
              info="Die Angaben, mit denen Mo die Beratung gestartet hat (je Beratung einmal; Trainingsart und Wünsche sind Mehrfachangaben). Budget und Wünsche fragt Mo meist erst im Gespräch — hier zählen nur die Angaben, die schon auf der Seite gewählt waren."
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {kpis.distributions
                  // Budget and wishes are usually asked by Mo in the chat — a
                  // card with nothing but „ohne Angabe“ says nothing.
                  .filter((d) => d.rows.some((r) => r.count > 0 && r.key !== ""))
                  .map((d) => (
                    <Card key={d.key}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">{d.label}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <BarList rows={d.rows.map((r) => ({ key: r.key || "none", label: r.label, count: r.count }))} />
                      </CardContent>
                    </Card>
                  ))}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-1.5 text-sm">
                      Herkunft
                      <InfoTip>
                        Partner aus dem Link (?partner=mh|wh oder utm_source mit „menshealth“ / „womenshealth“) oder aus
                        der Einstellung der Landingpage im Theme.
                      </InfoTip>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <BarList rows={kpis.partners.map((p) => ({ key: p.key || "direct", label: p.label, count: p.count }))} />
                  </CardContent>
                </Card>
              </div>
            </KpiSection>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <KpiSection
                id="konfigurator-produkte"
                title="Produkte in Mos Plänen"
                info="Wie viele Beratungen das Produkt in mindestens einem Plan hatten (Top 12)."
                empty={kpis.topProducts.length === 0 ? "Noch kein Plan im Zeitraum." : null}
              >
                <Card>
                  <CardContent className="p-5">
                    <BarList
                      rows={kpis.topProducts.map((p) => ({
                        key: p.id,
                        label: p.inStock === false ? `${p.name} (ausverkauft)` : p.name,
                        count: p.count,
                      }))}
                    />
                  </CardContent>
                </Card>
              </KpiSection>
              <KpiSection
                id="konfigurator-chips"
                title="Antwort-Chips"
                info="Klicks auf Mos Antwort-Vorschläge im Chat, nach Thema der Frage."
                empty={kpis.chipTopics.length === 0 ? "Noch keine Chip-Klicks im Zeitraum." : null}
              >
                <Card>
                  <CardContent className="p-5">
                    <BarList rows={kpis.chipTopics.map((t) => ({ key: t.key, label: CHIP_TOPIC_LABELS[t.key] ?? t.key, count: t.count }))} />
                    <p className="mt-3 text-2xs text-muted-foreground">
                      {num(kpis.chipClicks)} Chip-Klicks · {num(kpis.planEdits)} Änderungen am Plan
                    </p>
                  </CardContent>
                </Card>
              </KpiSection>
            </div>

            <KpiSection
              id="konfigurator-sitzungen"
              title="Letzte Konfigurator-Beratungen"
              info="Die 12 neuesten Beratungen aus dem Konfigurator im Zeitraum, mit ihren Angaben. „Gespräch“ öffnet das Transkript in Gespräche."
              empty={kpis.recent.length === 0 ? "Keine Beratung im Zeitraum." : null}
            >
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Start</TableHead>
                      <TableHead>Angaben</TableHead>
                      <TableHead className="text-right">Pläne</TableHead>
                      <TableHead>Ergebnis</TableHead>
                      <TableHead className="text-right">Gespräch</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {kpis.recent.map((r) => (
                      <TableRow key={`${r.sessionId}-${r.startedAt}`}>
                        <TableCell className="whitespace-nowrap tabular-nums">
                          {formatAdmin(r.startedAt, ADMIN_DATE_TIME_SHORT)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{answersSummary(r.answers)}</TableCell>
                        <TableCell className="text-right tabular-nums">{num(r.plans)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {r.ordered ? (
                              <StatusBadge tone="success">Bestellt</StatusBadge>
                            ) : r.cart ? (
                              <StatusBadge tone="accent">Warenkorb</StatusBadge>
                            ) : r.plans > 0 ? (
                              <StatusBadge tone="info">Plan</StatusBadge>
                            ) : (
                              <StatusBadge tone="neutral">Beratung</StatusBadge>
                            )}
                            {r.answers.partner === "mh" || r.answers.partner === "wh" ? (
                              <StatusBadge tone="neutral" dot={false}>
                                {r.answers.partner === "mh" ? "Men's Health" : "Women's Health"}
                              </StatusBadge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {r.conversationId ? (
                            <Link
                              href={adminTabHref("gespraeche", { gid: String(r.conversationId) })}
                              className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                            >
                              öffnen <ExternalLink className="size-3" aria-hidden />
                            </Link>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </KpiSection>
          </>
        )}
      </div>
    </Section>
  );
}

const CHIP_TOPIC_LABELS: Record<string, string> = {
  budget: "Budget",
  wishes: "Wünsche",
  frequency: "Trainingshäufigkeit",
  space: "Platz / Raum",
  equipment: "Vorhandenes Equipment",
  other: "Sonstiges",
};

function answersSummary(a: Record<string, string>): string {
  const parts: string[] = [];
  const one = (key: string) => (a[key] ? configuratorLabel(key, a[key]) : "");
  const many = (key: string) =>
    (a[key] ?? "")
      .split(",")
      .map((id) => configuratorLabel(key, id.trim()))
      .filter(Boolean)
      .join(", ");
  for (const text of [one("persona"), one("location"), one("space"), many("training"), one("level"), one("goal"), one("budget")]) {
    if (text) parts.push(text);
  }
  return parts.join(" · ") || "—";
}
