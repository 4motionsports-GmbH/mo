// Kampagnen-Funnel (MK-) — Shopify-subscriber channel: sent → clicked →
// redeemed, language split, delivery, plus the hero A/B and lifecycle-segment
// breakdown tables (both stay as decided).

import type { Cached } from "@/lib/kpi-cache";
import { CAMPAIGN_KPI_MAX_CODES, type CampaignBreakdownRow, type CampaignKpis } from "@/lib/campaign-store";
import { eur, num, plural, ratio } from "@/lib/admin-format.mjs";
import {
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
import { StageFunnelChart } from "../charts";
import { Explain, FreshnessBadge, FunnelLayout, KpiSection } from "../KpiSection";

const INFO = (
  <Explain>
    <p>Kampagnen-E-Mails (MK-Codes): gesendet → CTA geklickt → Code eingelöst.</p>
    <p>
      „Geklickt“ zählt Sends, deren getrackter Promo-CTA (<code>/api/r/&lt;token&gt;</code>)
      mindestens einmal angeklickt wurde — Sends vor Migration 0041 und Kopier-Sends tragen keinen
      Link und können nicht als geklickt zählen (Basis: getrackte Sends). „Eingelöst“ prüft per
      Shopify, ob der einmalige MK-Code der jeweiligen E-Mail verwendet wurde; die Rate bezieht sich
      auf die geprüften Codes mit Antwort.
    </p>
    <p>
      „Zugestellt / Bounces“ kommt aus dem Resend-Webhook (harte Bounces und Beschwerden sperren die
      Adresse dauerhaft). „Set geklickt“ und „Abgemeldet“ gelten für Sends ab Migration 0054; die
      Abmeldung wird den Kampagnen-Mails der letzten 30 Tage an diese Adresse zugeordnet. Bewertungen
      sind absichtlich anonym und lassen sich keiner Variante zuordnen. Für einen fairen Hero-Vergleich
      brauchen beide Gruppen Sends — der Kampagnen-Workspace zeigt je Kontakt die A/B-Gruppe an
      (gerade Kontakt-ID: mit Hero, ungerade: ohne).
    </p>
  </Explain>
);

export function CampaignSection({ cached }: { cached: Cached<CampaignKpis | null> }) {
  const kpis = cached.value;
  const empty = !kpis
    ? "Noch keine Daten."
    : kpis.sent === 0
      ? "Noch keine Kampagnen-E-Mails im Zeitraum."
      : null;
  return (
    <KpiSection
      id="kampagne"
      title="Kampagnen-Funnel (Shopify-Subscriber)"
      info={INFO}
      badges={<FreshnessBadge fetchedAt={cached.fetchedAt} fromCache={cached.fromCache} />}
      empty={empty}
      notes={
        kpis
          ? [
              !kpis.shopifyConfigured &&
                "Shopify ist nicht konfiguriert — die Einlösung kann nicht berechnet werden.",
              kpis.shopifyConfigured &&
                kpis.redemptionUnknown > 0 &&
                `Bei ${num(kpis.redemptionUnknown)} Code(s) lieferte Shopify keine Antwort (nicht gezählt).`,
              kpis.sampled && `Einlösungsprüfung auf die ${CAMPAIGN_KPI_MAX_CODES} neuesten Codes begrenzt.`,
            ]
          : []
      }
    >
      {kpis && (
        <>
          <FunnelLayout
            chart={
              <StageFunnelChart
                stages={[
                  { name: "Gesendet", value: kpis.sent },
                  { name: "Geklickt", value: kpis.clicked },
                  ...(kpis.shopifyConfigured ? [{ name: "Eingelöst", value: kpis.converted }] : []),
                ]}
              />
            }
          >
            <Stat
              label="Gesendet"
              value={num(kpis.sent)}
              hint={`${num(kpis.sentViaEmail)} per E-Mail · ${num(kpis.sentViaCopy)} kopiert`}
            />
            <Stat
              label="Geklickt"
              value={num(kpis.clicked)}
              hint={
                kpis.clickRate == null
                  ? "noch keine getrackten Sends"
                  : `${ratio(kpis.clickRate)} von ${num(kpis.trackedSends)} getrackten`
              }
            />
            <Stat
              label="Eingelöst (MK-Code)"
              value={kpis.shopifyConfigured ? num(kpis.converted) : "—"}
              hint={
                kpis.shopifyConfigured && kpis.conversionRate != null
                  ? `${ratio(kpis.conversionRate)} der geprüften Codes`
                  : undefined
              }
            />
            <Stat
              label="Sprache"
              value={`${num(kpis.byLanguage.de)} DE · ${num(kpis.byLanguage.en)} EN`}
              hint={
                kpis.byLanguage.unknown > 0
                  ? `${num(kpis.byLanguage.unknown)} unbekannt (Kontakt gelöscht)`
                  : undefined
              }
            />
            <Stat
              label="Set geklickt"
              value={kpis.bundleSends > 0 ? num(kpis.bundleClicked) : "—"}
              hint={
                kpis.bundleSends > 0
                  ? `${ratio(kpis.bundleClicked / kpis.bundleSends)} der ${num(kpis.bundleSends)} Sends mit Set`
                  : "kein Set-Angebot im Zeitraum"
              }
            />
            <Stat
              label="Umsatz (MK-Codes)"
              value={kpis.shopifyConfigured ? eur(kpis.revenueEur) : "—"}
              hint={
                kpis.shopifyConfigured && kpis.sent > 0
                  ? `${eur(kpis.revenueEur / kpis.sent)} je Send · geprüfte Codes`
                  : undefined
              }
            />
            <Stat
              label="Zugestellt / Bounces"
              value={`${num(kpis.delivered)} / ${num(kpis.bounced)}`}
              hint={
                kpis.delivered + kpis.bounced === 0
                  ? "keine Zustellmeldungen (Resend-Webhook?)"
                  : `${num(kpis.bouncedHard)} hart · ${plural(kpis.complained, "Beschwerde", "Beschwerden")}`
              }
            />
            <Stat
              label="Abgemeldet"
              value={num(kpis.unsubscribed)}
              hint={kpis.sent > 0 ? `${ratio(kpis.unsubscribed / kpis.sent)} der Sends (30 Tage)` : undefined}
            />
            <Stat
              label="Bewertung"
              value={kpis.ratings.average != null ? `${num(kpis.ratings.average, 1)} / 5` : "—"}
              hint={`${plural(kpis.ratings.count, "Klick-Bewertung", "Klick-Bewertungen")} (anonym)`}
            />
          </FunnelLayout>

          <div className="mt-4 flex flex-col gap-4">
            <CampaignBreakdownTable
              title="Hero-Vergleich: lohnt sich das KI-Bild?"
              info="Derselbe Funnel je Hero-Variante der versendeten Mail — mit den Hero-Kosten der jeweiligen Kontakte (Prompt, Renders, Prüfung)."
              rows={kpis.byHeroVariant}
              labelFor={heroVariantLabel}
              withCost
              shopifyConfigured={kpis.shopifyConfigured}
            />
            <CampaignBreakdownTable
              title="Nach Lebenszyklus-Segment"
              info="Derselbe Funnel je Segment (Zeit seit dem letzten Kauf)."
              rows={kpis.bySegment}
              labelFor={segmentLabel}
              withCost={false}
              shopifyConfigured={kpis.shopifyConfigured}
            />
          </div>
        </>
      )}
    </KpiSection>
  );
}

function heroVariantLabel(key: string): string {
  switch (key) {
    case "ai":
      return "Mit KI-Hero (individuell)";
    case "default":
      return "Standard-Hero";
    case "none":
      return "Ohne Hero (klassisch / kopiert)";
    default:
      return "Unbekannt (vor Migration 0054)";
  }
}

function segmentLabel(key: string): string {
  return key === "unbekannt" ? "Unbekannt" : key;
}

/** The per-variant / per-segment funnel table shared by the campaign section. */
function CampaignBreakdownTable({
  title,
  info,
  rows,
  labelFor,
  withCost,
  shopifyConfigured,
}: {
  title: string;
  info: string;
  rows: CampaignBreakdownRow[];
  labelFor: (key: string) => string;
  withCost: boolean;
  shopifyConfigured: boolean;
}) {
  if (rows.length === 0) return null;
  const dash = "—";
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
          {title}
          <InfoTip panelClassName="max-w-md">{info}</InfoTip>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 pb-2">
        <Table className="text-xs [&_td]:tabular-nums">
          <TableHeader>
            <TableRow>
              <TableHead>Variante</TableHead>
              <TableHead align="right">Gesendet</TableHead>
              <TableHead align="right">Klickrate</TableHead>
              <TableHead align="right">Set geklickt</TableHead>
              <TableHead align="right">Eingelöst</TableHead>
              <TableHead align="right">Umsatz</TableHead>
              <TableHead align="right">Umsatz / Send</TableHead>
              {withCost && <TableHead align="right">Hero-Kosten</TableHead>}
              {withCost && <TableHead align="right">Kosten / Send</TableHead>}
              <TableHead align="right">Abgemeldet</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell className="font-medium">{labelFor(r.key)}</TableCell>
                <TableCell align="right">{num(r.sent)}</TableCell>
                <TableCell align="right">
                  {r.clickRate == null ? dash : `${ratio(r.clickRate)} (${num(r.clicked)}/${num(r.trackedSends)})`}
                </TableCell>
                <TableCell align="right">
                  {r.bundleSends > 0 ? `${num(r.bundleClicked)}/${num(r.bundleSends)}` : dash}
                </TableCell>
                <TableCell align="right">
                  {!shopifyConfigured || r.conversionRate == null
                    ? dash
                    : `${ratio(r.conversionRate)} (${num(r.converted)}/${num(r.codesChecked)})`}
                </TableCell>
                <TableCell align="right">{shopifyConfigured ? eur(r.revenueEur) : dash}</TableCell>
                <TableCell align="right">
                  {shopifyConfigured && r.sent > 0 ? eur(r.revenueEur / r.sent) : dash}
                </TableCell>
                {withCost && (
                  <TableCell align="right">{r.heroCostEur != null ? eur(r.heroCostEur) : dash}</TableCell>
                )}
                {withCost && (
                  <TableCell align="right">
                    {r.heroCostEur != null && r.sent > 0 ? eur(r.heroCostEur / r.sent) : dash}
                  </TableCell>
                )}
                <TableCell align="right">{num(r.unsubscribed)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
