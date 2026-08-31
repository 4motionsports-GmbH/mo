// KPI tab (server-rendered). Re-skinned onto the Session-A admin design system
// (themed Cards + tokens) with Recharts visuals. The server component still owns
// ALL aggregation — every number comes from the same kpi-store / kpi-persona /
// kpi-recommendation-loop / marketing-store / ai-usage-store getters as before,
// fetched once on the server and handed to the charts as plain props. The charts
// (./KpiCharts) are the only client islands; no KPI is fetched or recomputed in
// the browser. Every KPI keeps its honesty caveat inline.

import {
  getAccountActivity,
  getConsentGateFunnel,
  getCoreMetrics,
  getEmailCaptureFunnel,
  getLocaleSplit,
  type AccountActivity,
  type ConsentGateCounts,
  type ConsentGateFunnel,
  type CoreMetrics,
  type EmailCaptureFunnel,
  type LocaleCount,
  type LocaleSplit,
} from "@/lib/kpi-store";
import { getPersonaInsights, type PersonaInsight } from "@/lib/kpi-persona";
import {
  getRecommendationLoop,
  type RecommendationLoopResult,
} from "@/lib/kpi-recommendation-loop";
import { getMarketingFunnel, type MarketingFunnel } from "@/lib/marketing-store";
import {
  getCampaignKpis,
  CAMPAIGN_KPI_MAX_CODES,
  type CampaignKpis,
} from "@/lib/campaign-store";
import { getBundleKpis, type BundleKpis } from "@/lib/bundle-offers-store";
import { getQaKpis, type QaKpis } from "@/lib/qa-store";
import { getFeedbackKpis, type FeedbackKpis } from "@/lib/feedback-store";
import { getConversationStats, type ConversationStats } from "@/lib/admin-conversations";
import { getCachedTopQuestionsMap } from "@/lib/kpi-top-questions";
import { getAiCostMetrics, type AiCostMetrics } from "@/lib/ai-usage-store";
import { getPhysicalLetterStats, type PhysicalLetterStats } from "@/lib/physical-letters-store";
import { getMoRevenue, REVENUE_MAX_CODES, type MoRevenue } from "@/lib/kpi-revenue-store";
import { getMoAttributionKpis, type MoAttributionKpis } from "@/lib/mo-orders-store";
import type { KpiRange } from "@/lib/kpi-range";
import { KpiTopQuestions } from "./KpiTopQuestions";
import { KpiDateRangePicker } from "./KpiDateRangePicker";
import { Card, CardContent, CardHeader, CardTitle, Section, Stat, Caveat } from "./ui";
import {
  ChatsPerDayChart,
  StatusSplitChart,
  PersonaDistributionChart,
  StageFunnelChart,
} from "./KpiCharts";
import {
  ADMIN_DATE,
  formatAdmin,
} from "@/lib/admin-datetime.mjs";

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function num(n: number, digits = 1): string {
  return n.toLocaleString("de-DE", { maximumFractionDigits: digits });
}

// EUR with up to 4 decimals — per-consultation costs are fractions of a cent.
function eur(n: number, digits = 4): string {
  return n.toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: digits,
  });
}

// Money in a given currency, 2 decimals — for the revenue headline. Falls back
// to the raw amount + code if the currency isn't a valid ISO code.
function money(n: number, currency: string): string {
  try {
    return n.toLocaleString("de-DE", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    });
  } catch {
    return `${num(n, 2)} ${currency}`;
  }
}

function dateLabel(iso: string | null): string {
  return formatAdmin(iso, ADMIN_DATE);
}

const MARKETING_FUNNEL_DISPLAY_CAP = 100;

export async function KpiTab({ dbReady, range }: { dbReady: boolean; range: KpiRange }) {
  if (!dbReady) {
    return (
      <Banner tone="warn">
        Keine Datenbank konfiguriert (DATABASE_URL) — es können keine KPIs
        berechnet werden.
      </Banner>
    );
  }

  // The period (date picker) applies to every section ABOVE the "Gesamtwerte"
  // divider (all bounded by created_at / sent_at / order date). The marketing
  // funnel, personas, recommendation-loop and physical-mail figures are
  // lifecycle/cohort/lifetime aggregates and are shown period-independent.
  const [
    core,
    revenue,
    attribution,
    aiCost,
    personas,
    loop,
    funnel,
    gateFunnel,
    captureFunnel,
    campaign,
    bundles,
    qa,
    feedback,
    quality,
    locales,
    account,
    cachedQuestions,
    letterStats,
  ] = await Promise.all([
    getCoreMetrics(range),
    getMoRevenue(range),
    getMoAttributionKpis(range),
    getAiCostMetrics(range),
    getPersonaInsights(5),
    getRecommendationLoop(),
    getMarketingFunnel(),
    getConsentGateFunnel(range),
    getEmailCaptureFunnel(range),
    getCampaignKpis(range),
    getBundleKpis(range),
    getQaKpis(range),
    getFeedbackKpis(range),
    getConversationStats(range.from, range.to),
    getLocaleSplit(range),
    getAccountActivity(range),
    getCachedTopQuestionsMap(),
    getPhysicalLetterStats(),
  ]);

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-2">
        <KpiDateRangePicker
          preset={range.preset}
          from={range.from}
          to={range.to}
          label={range.label}
        />
        <p className="text-[11px] text-muted-foreground/80">
          Der Zeitraum filtert <strong>alle Abschnitte</strong> bis zur
          Markierung „Gesamtwerte“. Marketing-Funnel, Persona-Insights,
          Empfehlung→Kauf und Postversand sind Gesamtwerte
          (zeitraumunabhängig).
        </p>
      </div>

      <CoreSection core={core} range={range} />
      <LocaleSection locales={locales} range={range} />
      <QualitySection stats={quality} range={range} />
      <ConsentGateSection funnel={gateFunnel} range={range} />
      <EmailCaptureSection funnel={captureFunnel} range={range} />
      <RevenueSection revenue={revenue} range={range} />
      <AttributionSection attribution={attribution} range={range} />
      <CampaignSection kpis={campaign} range={range} />
      <BundleSection kpis={bundles} range={range} />
      <QaSection kpis={qa} range={range} />
      <FeedbackSection kpis={feedback} range={range} />
      <AccountSection activity={account} range={range} />
      <AiCostSection cost={aiCost} range={range} />

      <p className="-mb-6 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
        Gesamtwerte (vom Zeitraum unabhängig)
      </p>
      <PhysicalMailCostSection stats={letterStats} />
      <MarketingFunnelSection funnel={funnel} />
      <PersonaSection personas={personas} cachedQuestions={cachedQuestions} />
      <LoopSection loop={loop} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Core metrics — headline stat cards + chats-per-day + status split
// ---------------------------------------------------------------------------

function CoreSection({ core, range }: { core: CoreMetrics | null; range: KpiRange }) {
  if (!core) {
    return (
      <Section title="Kern-Metriken" subtitle={`Zeitraum: ${range.label}.`}>
        <Banner tone="info">Noch keine Daten.</Banner>
      </Section>
    );
  }

  return (
    <Section title="Kern-Metriken" subtitle={`Zeitraum: ${range.label}.`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Chats gesamt" value={num(core.totalChats, 0)} />
        <Stat label="Ø Nachrichten / Chat" value={num(core.avgMessagesPerChat, 1)} />
        <Stat
          label="Abgebrochen"
          value={`${num(core.status.abandoned, 0)} · ${pct(core.abandonedRate)}`}
          hint="status='abandoned' (Beratung ohne Abschluss)"
        />
        <Stat
          label="Engagement"
          value={core.engagementRate == null ? "—" : pct(core.engagementRate)}
          hint="Chats mit Nachricht ÷ Sessions mit Telemetrie"
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Chats pro Tag · {range.label}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ChatsPerDayChart data={core.chatsByDay} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Status-Verteilung</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
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
          </CardContent>
        </Card>
      </div>
      <Caveat>
        „Konvertiert“ setzt der tägliche Conversion-Sweep: der einmalige
        Mo-Rabattcode (MS5-…) der aus dieser Beratung entstandenen
        Marketing-E-Mail wurde in einer echten Bestellung eingelöst — dieselbe
        ehrliche Zuordnung wie beim Umsatz-Abschnitt. Käufe ohne Mo-Code sind
        nicht zurechenbar und erscheinen hier nicht; „Konvertiert“ ist eine
        Untergrenze.
      </Caveat>

      <h4 className="mt-6 mb-2 text-sm font-medium text-foreground">
        In-Chat-Klicks (Buttons im Chat)
      </h4>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label="Produkt-/CTA-Klicks"
          value={`${num(core.productCtaClicks, 0)}`}
          hint={`${num(core.productCtaRatePerChat, 2)} pro Chat`}
        />
        <Stat
          label="Add-to-Cart-Klicks"
          value={`${num(core.addToCartClicks, 0)}`}
          hint={`${num(core.addToCartRatePerChat, 2)} pro Chat`}
        />
        <Stat label="Sessions mit Telemetrie" value={num(core.sessionsWithTelemetry, 0)} />
      </div>
      <Caveat>
        Klick-Signale werden anhand der Event-Namen aus der Widget-Telemetrie
        gemustert (Produkt/CTA: <code>%product%click%</code> / <code>%cta%click%</code>;
        Warenkorb: <code>%cart%</code> / <code>%checkout%</code>). Die vollständige
        Event-Übersicht zeigt die Rohdaten.
      </Caveat>

      {core.topEvents.length > 0 && (
        <>
          <h4 className="mt-6 mb-2 text-sm font-medium text-foreground">
            Event-Übersicht (Top 20)
          </h4>
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <Th>Event</Th>
                    <Th align="right">Anzahl</Th>
                  </tr>
                </thead>
                <tbody>
                  {core.topEvents.map((e) => (
                    <tr key={e.event}>
                      <Td>
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                          {e.event}
                        </code>
                      </Td>
                      <Td align="right">{num(e.count, 0)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Consent-gate funnel (v4): shown → accepted, plus decline/dismiss split and
// the chat vs. sign-in surface breakdown. Widget-emitted events (the backend
// only sees the accept as an opt-in POST) — measures the UI, not the DOI.
// ---------------------------------------------------------------------------

function ConsentGateSection({
  funnel,
  range,
}: {
  funnel: ConsentGateFunnel | null;
  range: KpiRange;
}) {
  const acceptRate =
    funnel && funnel.total.shown > 0 ? funnel.total.accepted / funnel.total.shown : null;
  const stages = funnel
    ? [
        { name: "Angezeigt", value: funnel.total.shown },
        { name: "Akzeptiert", value: funnel.total.accepted },
      ]
    : [];

  return (
    <Section
      title="Consent-Gate-Funnel (Marketing-Opt-in)"
      subtitle={`Das Einwilligungs-Gate im Chat und die Opt-in-Karte bei der Anmeldung: angezeigt → akzeptiert („Ja, Angebote aktivieren") — Zeitraum: ${range.label}.`}
    >
      {!funnel ? (
        <Banner tone="info">Noch keine Daten.</Banner>
      ) : funnel.total.shown === 0 ? (
        <Banner tone="info">Noch keine Consent-Gate-Events im Zeitraum.</Banner>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="p-4">
                <StageFunnelChart stages={stages} />
              </CardContent>
            </Card>
            <div className="grid grid-cols-2 content-start gap-3">
              <Stat label="Angezeigt" value={num(funnel.total.shown, 0)} />
              <Stat
                label="Akzeptiert"
                value={num(funnel.total.accepted, 0)}
                hint={acceptRate == null ? undefined : `${pct(acceptRate)} Akzeptanzrate`}
              />
              <Stat label="Abgelehnt" value={num(funnel.total.declined, 0)} />
              <Stat label="Weggeklickt" value={num(funnel.total.dismissed, 0)} />
            </div>
          </div>

          <h4 className="mt-4 mb-2 text-sm font-medium text-foreground">
            Nach Oberfläche
          </h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SurfaceGateStat label="Chat-Gate (anonym)" counts={funnel.bySurface.chat} />
            <SurfaceGateStat
              label="Bei Anmeldung (eingeloggt)"
              counts={funnel.bySurface.signin}
            />
          </div>

          <Caveat>
            Alle vier Events sendet das Widget (<code>consent_gate_shown</code> /{" "}
            <code>_accepted</code> / <code>_declined</code> /{" "}
            <code>_dismissed</code>, mit <code>surface: chat|signin</code>) —
            gemessen wird die Oberfläche, nicht die bestätigte Anmeldung: ein
            „Akzeptiert&ldquo; wird erst mit dem Klick auf den Double-Opt-in-Link zur
            wirksamen Marketing-Einwilligung (siehe E-Mail-Capture-Funnel in der
            Event-Übersicht). Events ohne <code>surface</code> zählen nur in den
            Gesamtwerten.
          </Caveat>
        </>
      )}
    </Section>
  );
}

function SurfaceGateStat({ label, counts }: { label: string; counts: ConsentGateCounts }) {
  const rate = counts.shown > 0 ? counts.accepted / counts.shown : null;
  return (
    <Stat
      label={label}
      value={`${num(counts.accepted, 0)} / ${num(counts.shown, 0)}`}
      hint={
        rate == null
          ? "akzeptiert / angezeigt"
          : `${pct(rate)} Akzeptanzrate · ${num(counts.declined, 0)} abgelehnt · ${num(counts.dismissed, 0)} weggeklickt`
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Revenue attributed to Mo — orders that redeemed a unique Mo marketing code.
// The ONLY honestly-measurable revenue signal: a Mo-minted single-use code on a
// real order (verified via Shopify read_orders). Cart links carry no marker and
// are deliberately NOT counted (see lib/kpi-revenue-store + docs).
// ---------------------------------------------------------------------------

function RevenueSection({ revenue, range }: { revenue: MoRevenue | null; range: KpiRange }) {
  return (
    <Section
      title="Umsatz über Mo-Rabattcodes"
      subtitle={`Bestellungen, die einen einmaligen, von Mo verschickten Rabattcode eingelöst haben — Zeitraum: ${range.label}.`}
    >
      {!revenue ? (
        <Banner tone="info">Noch keine Daten.</Banner>
      ) : !revenue.shopifyConfigured ? (
        <Banner tone="warn">
          Shopify ist nicht konfiguriert — der Umsatz kann nicht berechnet werden.
        </Banner>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat
              label="Umsatz über Mo-Rabattcodes"
              value={money(revenue.revenueAmount, revenue.currency)}
              hint={`${num(revenue.orderCount, 0)} Bestellung(en) im Zeitraum`}
              tooltip="Summe der tatsächlich bezahlten Bestellsummen (Shopify currentTotalPrice, Status PAID/PARTIALLY_REFUNDED) aller Bestellungen, die einen einmaligen, von Mo verschickten Rabattcode (MS5-…) eingelöst haben. Warenkorb-Links ohne Code sind nicht zurechenbar und zählen nicht."
            />
            <Stat
              label="Bestellungen mit Mo-Code"
              value={num(revenue.orderCount, 0)}
              hint="eingelöste, bezahlte Bestellungen"
            />
            <Stat
              label="Geprüfte Codes"
              value={num(revenue.codesChecked, 0)}
              hint={`${num(revenue.codesInScope, 0)} versendete Codes im Zeitraum`}
            />
          </div>

          <Caveat>
            „Umsatz über Mo-Rabattcodes“ zählt <strong>ausschließlich</strong>{" "}
            Bestellungen, die einen <strong>einmaligen, von Mo verschickten
            Rabattcode</strong> (<code>MS5-…</code>, aus der personalisierten
            Marketing-E-Mail) eingelöst haben — geprüft per Shopify
            (<code>read_orders</code>) über das Bestellfeld{" "}
            <code>discount_code</code>, gezählt wird der tatsächlich bezahlte
            Bestellwert (<code>currentTotalPrice</code>, nur Status PAID /
            PARTIALLY_REFUNDED). Käufe über Warenkorb-Links (In-Chat-Checkout,
            Zusammenfassungs-E-Mail, Bundles) zählen hier bewusst NICHT — sie
            werden seit der Attributions-Runde separat im Abschnitt
            „Mo-zugeordneter Umsatz (Bestell-Webhook)“ gemessen.
            {revenue.redemptionUnknown > 0 &&
              ` Bei ${num(revenue.redemptionUnknown, 0)} Code(s) lieferte Shopify keine Antwort (nicht gezählt).`}
            {revenue.sampled &&
              ` Auf die ${REVENUE_MAX_CODES} neuesten Codes begrenzt.`}
          </Caveat>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Mo-attributed orders (webhook ingest) — the tiered attribution pipeline:
// orders/create + orders/paid webhooks push every Mo-marked order (cart-
// attribute token and/or Mo code) into mo_orders; this section is a plain DB
// aggregate — no Shopify calls, no caps, no sampling. docs/ORDER_ATTRIBUTION.md.
// ---------------------------------------------------------------------------

function AttributionSection({
  attribution,
  range,
}: {
  attribution: MoAttributionKpis | null;
  range: KpiRange;
}) {
  return (
    <Section
      title="Mo-zugeordneter Umsatz (Bestell-Webhook)"
      subtitle={`Bestellungen mit Mo-Markierung (Warenkorb-Attribut oder Mo-Rabattcode), per Shopify-Webhook erfasst — Zeitraum: ${range.label}.`}
    >
      {!attribution ? (
        <Banner tone="info">Noch keine Daten.</Banner>
      ) : !attribution.ingestionSeen ? (
        <Banner tone="info">
          Noch keine Bestellung über den Webhook erfasst. Voraussetzung: die
          Shopify-Webhooks <code>orders/create</code> + <code>orders/paid</code>{" "}
          sind auf <code>/api/webhooks/shopify</code> registriert (siehe
          docs/ORDER_ATTRIBUTION.md) — erfasst wird ab Registrierung, rückwirkend
          nicht.
        </Banner>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat
              label="Direkt"
              value={money(attribution.direct.revenueAmount, attribution.currency)}
              hint={`${num(attribution.direct.orderCount, 0)} Bestellung(en)`}
              tooltip="Bestellungen über einen von Mo gebauten Kauf-Weg: ein eingelöster Mo-Rabattcode (MS5-/MK-) oder ein von Mo verschickter Warenkorb-Link (Zusammenfassung, Marketing-E-Mail, Bundle). Nur bezahlte Bestellungen (PAID/PARTIALLY_REFUNDED)."
            />
            <Stat
              label="Beraten & gekauft"
              value={money(attribution.assisted.revenueAmount, attribution.currency)}
              hint={`${num(attribution.assisted.orderCount, 0)} Bestellung(en)`}
              tooltip="Der Warenkorb trug die Session-Markierung des Widgets UND mindestens ein gekauftes Produkt wurde in dieser Beratung besprochen/ausgewählt — auch wenn es manuell über die Suche in den Warenkorb gelegt wurde."
            />
            <Stat
              label="Beraten, anderes gekauft"
              value={money(attribution.influenced.revenueAmount, attribution.currency)}
              hint={`${num(attribution.influenced.orderCount, 0)} Bestellung(en)`}
              tooltip="Session-Markierung vorhanden, aber kein gekauftes Produkt stammt aus der Beratung — Mo hat beraten, gekauft wurde etwas anderes."
            />
          </div>

          <Caveat>
            Erfasst werden <strong>ausschließlich</strong> Bestellungen mit
            Mo-Markierung: dem opaken Warenkorb-Attribut{" "}
            <code>attributes[_mo]</code> (von Mo-Links oder dem Widget-Stempel
            gesetzt, Zuordnungsfenster{" "}
            {num(attribution.attributionWindowDays, 0)} Tage) oder einem
            Mo-Rabattcode. Unmarkierte Bestellungen werden{" "}
            <strong>gar nicht gespeichert</strong> (Datenminimierung); die
            Zeilen sind pseudonym (keine Kundendaten). Geräteübergreifende
            Käufe (Beratung am Handy, Kauf am Laptop) bleiben ohne E-Mail/Code
            unsichtbar — physikalische Grenze, keine Messlücke.
            {attribution.unrealisedOrders > 0 &&
              ` ${num(attribution.unrealisedOrders, 0)} erfasste Bestellung(en) im Zeitraum sind (noch) nicht bezahlt und zählen nicht zum Umsatz.`}
          </Caveat>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// AI cost: average cost per consultation (EUR) + total spend, chat vs admin
// ---------------------------------------------------------------------------

function AiCostSection({ cost, range }: { cost: AiCostMetrics | null; range: KpiRange }) {
  return (
    <Section
      title="KI-Kosten"
      subtitle={`Geschätzte KI-Kosten (EUR) aus erfassten Token-Verbräuchen pro Modell — Zeitraum: ${range.label}.`}
    >
      {!cost || cost.capturedSince == null ? (
        <Banner tone="info">
          Noch keine KI-Verbrauchsdaten erfasst. Die Erfassung beginnt mit dem
          Deploy dieser Version — danach erscheinen hier die Kosten.
        </Banner>
      ) : (
        <>
          <p className="mb-3 text-xs text-muted-foreground">
            ab {dateLabel(cost.capturedSince)} erfasst
            {cost.estimated && " · enthält geschätzte Werte"}
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat
              label="Ø Kosten / Beratung"
              value={cost.consultationCount > 0 ? eur(cost.avgCostPerConsultationEur) : "—"}
              hint={`${num(cost.consultationCount, 0)} Beratungen mit Token-Erfassung`}
            />
            <Stat
              label="Median / Beratung"
              value={cost.consultationCount > 0 ? eur(cost.medianCostPerConsultationEur) : "—"}
            />
            <Stat
              label="Gesamtausgaben"
              value={eur(cost.totalSpendEur, 2)}
              hint="alle KI-Aufrufe im Zeitraum"
            />
          </div>

          <h4 className="mt-4 mb-2 text-sm font-medium text-foreground">Aufteilung</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Stat
              label="Chat (inkl. Embeddings & Sprachausgabe)"
              value={eur(cost.chatSpendEur, 2)}
              hint="Beratungs-Chat + Produktsuche + TTS"
            />
            <Stat
              label="Dashboard / Admin"
              value={eur(cost.adminSpendEur, 2)}
              hint="E-Mail-Entwürfe, Profile, Analysen, Wissen"
            />
          </div>

          {cost.perCallSite.length > 0 && (
            <>
              <h4 className="mt-4 mb-2 text-sm font-medium text-foreground">
                Nach Einsatzort
              </h4>
              <Card>
                <CardContent className="p-4">
                  <BarList
                    rows={cost.perCallSite.map((s) => ({
                      key: s.callSite,
                      label: CALL_SITE_LABELS[s.callSite] ?? s.callSite,
                      count: s.spendEur,
                      display: eur(s.spendEur, 2),
                    }))}
                  />
                </CardContent>
              </Card>
            </>
          )}

          <h4 className="mt-4 mb-2 text-sm font-medium text-foreground">
            Prompt-Caching (Chat)
          </h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat
              label="Cache-Trefferquote"
              value={cost.cache.hitRate == null ? "—" : pct(cost.cache.hitRate)}
              hint="gelesene Cache-Tokens ÷ Chat-Input-Tokens"
            />
            <Stat
              label="Ersparnis (netto)"
              value={eur(cost.cache.savedEur, 2)}
              hint="Lese-Rabatt minus Schreib-Aufschlag"
            />
            <Stat
              label="Cache-Tokens"
              value={`${num(cost.cache.readTokens, 0)} gelesen`}
              hint={`${num(cost.cache.writeTokens, 0)} geschrieben`}
            />
          </div>

          <Caveat>
            Kosten werden aus den vom Anbieter gemeldeten Token-Zahlen je Modell
            berechnet (Preistabelle in USD pro Mio. Tokens, überschreibbar via
            <code> MODEL_PRICES_JSON</code>; EUR-Umrechnung via
            <code> USD_EUR_RATE</code>, Standard 0,92). „Ø Kosten / Beratung“ zählt
            nur den Chat-Verbrauch je Konversation. Embeddings (Produktsuche) sind
            kostenseitig Rauschen, werden aber ehrlich mitgezählt. Für die
            Sprachausgabe (TTS) zählt die Spalte Input-Tokens{" "}
            <strong>Zeichen</strong> statt Tokens (Abrechnung je Zeichen).
            Cache-Lesen kostet 0,1×, Cache-Schreiben 1,25× des Input-Preises —
            die Ersparnis ist der Netto-Effekt gegenüber denselben Aufrufen ohne
            Caching
            {cost.estimated &&
              "; einzelne Werte sind geschätzt, wenn der Anbieter keine Token-Zahl liefert"}.
          </Caveat>
        </>
      )}
    </Section>
  );
}

/** German labels for the ai_usage call sites (lib/ai-usage-store AiCallSite). */
const CALL_SITE_LABELS: Record<string, string> = {
  chat: "Beratungs-Chat",
  embeddings: "Embeddings (Produktsuche)",
  tts: "Sprachausgabe (TTS)",
  summary_email: "Zusammenfassungs-E-Mail",
  summary_download: "Zusammenfassung (Download)",
  marketing_draft: "Marketing-Entwürfe",
  campaign_draft: "Kampagnen-Entwürfe",
  customer_profile: "Kundenprofile",
  top_questions: "Top-Fragen (Personas)",
  conversation_analysis: "Gesprächsanalyse",
  conversation_insights: "Insights-Rollup",
  analytics_report: "Komplettanalyse",
  qa_draft: "Wissen: Entwürfe",
  qa_translate: "Wissen: Übersetzung",
  bundle_suggestions: "Bundle-Vorschläge",
};

// ---------------------------------------------------------------------------
// Physical mail (Pingen): how many letters went out and what postage cost.
// ---------------------------------------------------------------------------
function PhysicalMailCostSection({ stats }: { stats: PhysicalLetterStats }) {
  const totalEur = stats.totalCostCents / 100;
  const avgEur = stats.totalSent > 0 ? totalEur / stats.totalSent : 0;
  return (
    <Section
      title="Postversand (Brief)"
      subtitle="Versendete Briefe (Pingen → Deutsche Post) und die angefallenen Portokosten."
    >
      {stats.totalSent === 0 ? (
        <Banner tone="info">Noch keine Briefe versendet.</Banner>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="Versendete Briefe" value={num(stats.totalSent, 0)} />
            <Stat label="Portokosten gesamt" value={eur(totalEur, 2)} />
            <Stat label="Ø Kosten / Brief" value={eur(avgEur, 2)} />
          </div>
          <Caveat>
            Kosten je Brief stammen aus dem von Pingen gemeldeten Preis; wo (noch)
            kein Preis vorliegt (z. B. Staging), wird ein konfigurierbarer Standard
            angesetzt (<code>PINGEN_LETTER_COST_CENTS</code>, Standard 106 = 1,06 €).
            Gezählt werden an Pingen übergebene Briefe (fehlgeschlagene Übermittlungen
            zählen nicht).
          </Caveat>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Marketing funnel: sent → clicked → converted (unique code redeemed)
// ---------------------------------------------------------------------------

function MarketingFunnelSection({ funnel }: { funnel: MarketingFunnel | null }) {
  const stages = funnel
    ? [
        { name: "Gesendet", value: funnel.sent },
        { name: "Geklickt", value: funnel.clicked },
        ...(funnel.shopifyConfigured
          ? [{ name: "Eingelöst", value: funnel.converted }]
          : []),
      ]
    : [];

  return (
    <Section
      title="Marketing-Funnel"
      subtitle="Versendete Marketing-E-Mails: gesendet → geklickt → eingelöst (persönlicher Code verwendet)."
    >
      {!funnel ? (
        <Banner tone="info">Noch keine Daten.</Banner>
      ) : funnel.sent === 0 ? (
        <Banner tone="info">Noch keine Marketing-E-Mails versendet.</Banner>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="p-4">
                <StageFunnelChart stages={stages} />
              </CardContent>
            </Card>
            <div className="grid grid-cols-2 content-start gap-3">
              <Stat label="Gesendet" value={num(funnel.sent, 0)} />
              <Stat
                label="Geklickt"
                value={num(funnel.clicked, 0)}
                hint={funnel.clickRate == null ? undefined : `${pct(funnel.clickRate)} Klickrate`}
              />
              <Stat
                label="Eingelöst (Code verwendet)"
                value={funnel.shopifyConfigured ? num(funnel.converted, 0) : "—"}
                hint={
                  funnel.shopifyConfigured && funnel.conversionRate != null
                    ? `${pct(funnel.conversionRate)} der geprüften Codes`
                    : undefined
                }
              />
            </div>
          </div>

          <Caveat>
            „Geklickt“ zählt E-Mails, deren Warenkorb-Link (über die getrackte
            Weiterleitung <code>/api/r/&lt;token&gt;</code>) mindestens einmal
            angeklickt wurde — kein Tracking-Pixel, nur der bewusst geklickte Link.
            „Eingelöst“ prüft per Shopify (<code>read_orders</code>), ob der
            <strong> einmalige persönliche Code</strong> der jeweiligen E-Mail in
            einer echten Bestellung verwendet wurde; die Einlösungsrate bezieht
            sich auf die geprüften Codes mit Shopify-Antwort (nicht auf alle
            Sends — die Prüfung ist auf die neuesten Codes begrenzt).
            {!funnel.shopifyConfigured &&
              " Shopify ist nicht konfiguriert — die Einlösung kann nicht berechnet werden."}
            {funnel.shopifyConfigured &&
              funnel.redemptionUnknown > 0 &&
              ` Bei ${num(funnel.redemptionUnknown, 0)} Code(s) lieferte Shopify keine Antwort (als „unbekannt" gewertet).`}
            {funnel.sampled &&
              ` Einlösungsprüfung auf die ${MARKETING_FUNNEL_DISPLAY_CAP} neuesten Codes begrenzt.`}
          </Caveat>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// 2. Persona insights — distribution chart + per-persona detail
// ---------------------------------------------------------------------------

function PersonaSection({
  personas,
  cachedQuestions,
}: {
  personas: PersonaInsight[] | null;
  cachedQuestions: Map<string, import("@/lib/kpi-top-questions").TopQuestionsSummary>;
}) {
  return (
    <Section
      title="Persona-Insights"
      subtitle="Gruppiert nach abgeleitetem Persona-Archetyp."
    >
      {!personas || personas.length === 0 ? (
        <Banner tone="info">Noch keine klassifizierten Konversationen.</Banner>
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Verteilung (Chats je Persona)</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <PersonaDistributionChart
                data={personas.map((p) => ({ name: p.personaDisplay, value: p.chatCount }))}
              />
            </CardContent>
          </Card>

          {personas.map((p) => (
            <Card key={p.personaLabel}>
              <CardContent className="p-4">
                <div className="flex items-baseline justify-between">
                  <strong className="text-sm">{p.personaDisplay}</strong>
                  <span className="text-xs text-muted-foreground">
                    {num(p.chatCount, 0)} Chats
                  </span>
                </div>

                <h5 className="mt-3 mb-1 text-xs font-medium text-muted-foreground">
                  Lieblingsprodukte (am häufigsten empfohlen)
                </h5>
                {p.favoriteProducts.length === 0 ? (
                  <Caveat>Keine Produktempfehlungen erfasst.</Caveat>
                ) : (
                  <FavoriteBars favorites={p.favoriteProducts} />
                )}

                <KpiTopQuestions
                  personaLabel={p.personaLabel}
                  initial={cachedQuestions.get(p.personaLabel) ?? null}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </Section>
  );
}

function FavoriteBars({
  favorites,
}: {
  favorites: Array<{ productId: string; name: string; count: number }>;
}) {
  const max = Math.max(1, ...favorites.map((f) => f.count));
  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {favorites.map((f) => (
        <div key={f.productId} className="flex items-center gap-2">
          <div
            className="basis-[45%] truncate text-xs text-muted-foreground"
            title={f.name}
          >
            {f.name}
          </div>
          <div className="h-3.5 flex-1 rounded bg-muted">
            <div
              className="h-full rounded bg-accent"
              style={{ width: `${(f.count / max) * 100}%` }}
            />
          </div>
          <div className="basis-7 text-right text-xs text-muted-foreground">{f.count}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Recommendation → purchase loop
// ---------------------------------------------------------------------------

function LoopSection({ loop }: { loop: RecommendationLoopResult | null }) {
  const stages = loop
    ? [
        { name: "Kontakte geprüft", value: loop.contactsExamined },
        { name: "mit Empfehlung", value: loop.withRecommendation },
        { name: "mit Kauf", value: loop.withPurchase },
        { name: "Kauf = Empfehlung", value: loop.withRecommendedPurchase },
      ]
    : [];

  return (
    <Section
      title="Empfehlung → Kauf (nur Kund:innen mit E-Mail-Angabe)"
      subtitle="ROI-Kennwert für die Teilmenge der Kund:innen, die ihre E-Mail angegeben haben — KEINE site-weite Conversion-Rate."
    >
      {!loop ? (
        <Banner tone="info">Noch keine Daten.</Banner>
      ) : !loop.shopifyConfigured ? (
        <Banner tone="warn">
          Shopify ist nicht konfiguriert — die Kauf-Zuordnung kann nicht berechnet
          werden.
        </Banner>
      ) : (
        <>
          <Banner tone="warn">
            Nur Kund:innen, die ihre E-Mail angegeben haben — also eine Minderheit
            aller Chat-Nutzer:innen. Diese Zahl ist <strong>keine</strong>{" "}
            site-weite Conversion-Rate.
          </Banner>

          <div className="mt-3 flex flex-wrap items-baseline gap-3">
            <span className="text-3xl font-bold text-foreground">
              {loop.recommendationToPurchaseRate == null
                ? "—"
                : pct(loop.recommendationToPurchaseRate)}
            </span>
            <span className="text-sm text-muted-foreground">
              der Käufer:innen <strong>mit E-Mail-Angabe</strong> kauften ein zuvor
              empfohlenes Produkt
            </span>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="p-4">
                <StageFunnelChart stages={stages} />
              </CardContent>
            </Card>
            <div className="grid grid-cols-2 content-start gap-3">
              <Stat label="Kontakte geprüft" value={num(loop.contactsExamined, 0)} />
              <Stat label="mit Empfehlung" value={num(loop.withRecommendation, 0)} />
              <Stat label="mit Kauf" value={num(loop.withPurchase, 0)} />
              <Stat label="Kauf = Empfehlung" value={num(loop.withRecommendedPurchase, 0)} />
            </div>
          </div>

          <Caveat>
            ⚠️ Aussagekraft begrenzt: erfasst <strong>nur</strong> Nutzer, die eine
            E-Mail angegeben <strong>und</strong> der Verarbeitung zugestimmt haben
            — also eine Minderheit aller Chatter und nicht alle Käufer. Produkt-Zuordnung
            erfolgt über normalisierte Shopify-Handles; umbenannte/archivierte Produkte
            können fehlen.
            {loop.purchaseUnknown > 0 &&
              ` Bei ${loop.purchaseUnknown} Kontakt(en) lieferte Shopify keine Antwort (als „unbekannt" gewertet).`}
            {loop.sampled && " Stichprobe auf die 100 neuesten Kontakte begrenzt."}
          </Caveat>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Sprachen (DE/EN) — chats by conversations.locale, captures by capture locale
// ---------------------------------------------------------------------------

const LOCALE_LABELS: Record<string, string> = {
  de: "Deutsch",
  en: "Englisch",
  unknown: "Unbekannt (vor Erfassung)",
};

function LocaleSection({ locales, range }: { locales: LocaleSplit | null; range: KpiRange }) {
  return (
    <Section
      title="Sprachen (DE/EN)"
      subtitle={`Beratungen nach gewählter Chat-Sprache und E-Mail-Angaben nach Capture-Sprache — Zeitraum: ${range.label}.`}
    >
      {!locales || (locales.chats.length === 0 && locales.captures.length === 0) ? (
        <Banner tone="info">Noch keine Daten im Zeitraum.</Banner>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Chats nach Sprache</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <LocaleBars counts={locales.chats} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">E-Mail-Angaben nach Sprache</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <LocaleBars counts={locales.captures} />
              </CardContent>
            </Card>
          </div>
          <Caveat>
            Die Chat-Sprache wird seit Migration 0041 pro Beratung gespeichert
            (letzter Turn zählt); ältere Beratungen erscheinen als „Unbekannt“.
            Capture-Sprache seit Migration 0030.
          </Caveat>
        </>
      )}
    </Section>
  );
}

function LocaleBars({ counts }: { counts: LocaleCount[] }) {
  if (counts.length === 0) {
    return <p className="text-xs text-muted-foreground">Noch keine Daten.</p>;
  }
  const total = counts.reduce((a, c) => a + c.count, 0);
  return (
    <BarList
      rows={counts.map((c) => ({
        key: c.locale,
        label: LOCALE_LABELS[c.locale] ?? c.locale,
        count: c.count,
        hint: total > 0 ? pct(c.count / total) : undefined,
      }))}
    />
  );
}

// ---------------------------------------------------------------------------
// Gesprächsqualität — analysis coverage + quality/category distribution over
// the window (the same cached analysis columns the Gespräche tab reads; the
// distributions cover only conversations an operator has analysed).
// ---------------------------------------------------------------------------

function QualitySection({ stats, range }: { stats: ConversationStats | null; range: KpiRange }) {
  const coverage =
    stats && stats.total > 0 ? stats.analyzedCount / stats.total : null;
  return (
    <Section
      title="Gesprächsqualität (KI-Analyse)"
      subtitle={`Analyse-Abdeckung und Qualitäts-/Themenverteilung der analysierten Beratungen — Zeitraum: ${range.label}.`}
    >
      {!stats || stats.total === 0 ? (
        <Banner tone="info">Noch keine Beratungen im Zeitraum.</Banner>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat
              label="Analysiert"
              value={`${num(stats.analyzedCount, 0)} / ${num(stats.total, 0)}`}
              hint={coverage == null ? undefined : `${pct(coverage)} Abdeckung`}
            />
            <Stat
              label="Problem-Signale"
              value={num(
                stats.qualities
                  .filter((q) => q.quality === "unmet_need" || q.quality === "dropped_off")
                  .reduce((a, q) => a + q.count, 0),
                0
              )}
              hint="unerfüllter Bedarf + abgesprungen"
            />
            <Stat
              label="Gut gelöst"
              value={num(
                stats.qualities
                  .filter((q) => q.quality === "handled_well")
                  .reduce((a, q) => a + q.count, 0),
                0
              )}
            />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Qualität</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <BarList
                  rows={stats.qualities.map((q) => ({
                    key: q.quality,
                    label: q.label,
                    count: q.count,
                  }))}
                  empty="Noch keine analysierten Beratungen."
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Themen (Kategorien)</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <BarList
                  rows={stats.categories.slice(0, 8).map((c) => ({
                    key: c.category,
                    label: c.label,
                    count: c.count,
                  }))}
                  empty="Noch keine analysierten Beratungen."
                />
              </CardContent>
            </Card>
          </div>
          <Caveat>
            Verteilungen umfassen nur Beratungen, die im Gespräche-Tab (einzeln
            oder per Bulk) analysiert wurden — die Abdeckung oben zeigt, wie
            repräsentativ das ist. Die Analyse läuft auf Abruf, nicht
            automatisch.
          </Caveat>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// E-Mail-Capture-Funnel — Angebot → Formular → Marketing-Haken → DOI-Klick
// ---------------------------------------------------------------------------

// German labels for the offer_email_summary trigger enum (lib/tools.ts) + the
// two server-emitted fallbacks ("unspecified" from api/chat, "unknown" when the
// event carried no trigger at all).
const TRIGGER_LABELS: Record<string, string> = {
  recommendation_accepted: "Empfehlung angenommen",
  comparison_delivered: "Vergleich geliefert",
  consideration_pause: "Bedenkpause",
  buying_intent: "Kaufabsicht",
  checkout_intent: "Checkout-Absicht",
  unspecified: "Ohne Angabe",
  unknown: "Ohne Trigger",
};

function EmailCaptureSection({
  funnel,
  range,
}: {
  funnel: EmailCaptureFunnel | null;
  range: KpiRange;
}) {
  const stages = funnel
    ? [
        { name: "Angeboten", value: funnel.askShown },
        { name: "Formular gesendet", value: funnel.submitted },
        { name: "Marketing-Haken", value: funnel.marketingOptedIn },
        { name: "DOI bestätigt", value: funnel.confirmed },
      ]
    : [];
  return (
    <Section
      title="E-Mail-Capture-Funnel"
      subtitle={`Mo bietet die Chat-Zusammenfassung per E-Mail an: angeboten → Formular gesendet → Marketing-Haken gesetzt → Double-Opt-in bestätigt — Zeitraum: ${range.label}.`}
    >
      {!funnel ? (
        <Banner tone="info">Noch keine Daten.</Banner>
      ) : funnel.askShown === 0 && funnel.submitted === 0 ? (
        <Banner tone="info">Noch keine Capture-Events im Zeitraum.</Banner>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="p-4">
                <StageFunnelChart stages={stages} />
              </CardContent>
            </Card>
            <div className="grid grid-cols-2 content-start gap-3">
              <Stat label="Angeboten" value={num(funnel.askShown, 0)} />
              <Stat
                label="Formular gesendet"
                value={num(funnel.submitted, 0)}
                hint={funnel.submitRate == null ? undefined : `${pct(funnel.submitRate)} der Angebote`}
              />
              <Stat label="Marketing-Haken" value={num(funnel.marketingOptedIn, 0)} />
              <Stat
                label="DOI bestätigt"
                value={num(funnel.confirmed, 0)}
                hint={funnel.doiRate == null ? undefined : `${pct(funnel.doiRate)} der Opt-ins`}
              />
            </div>
          </div>

          {funnel.asksByTrigger.length > 0 && (
            <>
              <h4 className="mt-4 mb-2 text-sm font-medium text-foreground">
                Angebote nach Auslöser
              </h4>
              <BarList
                rows={funnel.asksByTrigger.map((t) => ({
                  key: t.trigger,
                  label: TRIGGER_LABELS[t.trigger] ?? t.trigger,
                  count: t.count,
                }))}
              />
            </>
          )}

          <Caveat>
            Ereigniszählung im Zeitraum (nicht pro Sitzung verkettet): ein
            DOI-Klick, der ein Opt-in vom Vortag bestätigt, zählt im Zeitraum
            des Klicks. „Abgelehnt“ (Karte weggeklickt):{" "}
            <strong>{num(funnel.declined, 0)}</strong> — vom Widget gemeldet.
            Wirksam wird die Marketing-Einwilligung erst mit dem DOI-Klick.
          </Caveat>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Kampagnen-Funnel (MK-) — Shopify-Subscriber-Kanal: gesendet → geklickt →
// eingelöst, plus Sprachaufteilung. Klicks über den getrackten Promo-CTA
// (migration 0041); Einlösung über den einmaligen MK- Code.
// ---------------------------------------------------------------------------

function CampaignSection({ kpis, range }: { kpis: CampaignKpis | null; range: KpiRange }) {
  const stages = kpis
    ? [
        { name: "Gesendet", value: kpis.sent },
        { name: "Geklickt", value: kpis.clicked },
        ...(kpis.shopifyConfigured ? [{ name: "Eingelöst", value: kpis.converted }] : []),
      ]
    : [];
  return (
    <Section
      title="Kampagnen-Funnel (Shopify-Subscriber)"
      subtitle={`Kampagnen-E-Mails (MK-Codes): gesendet → CTA geklickt → Code eingelöst — Zeitraum: ${range.label}.`}
    >
      {!kpis ? (
        <Banner tone="info">Noch keine Daten.</Banner>
      ) : kpis.sent === 0 ? (
        <Banner tone="info">Noch keine Kampagnen-E-Mails im Zeitraum.</Banner>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="p-4">
                <StageFunnelChart stages={stages} />
              </CardContent>
            </Card>
            <div className="grid grid-cols-2 content-start gap-3">
              <Stat
                label="Gesendet"
                value={num(kpis.sent, 0)}
                hint={`${num(kpis.sentViaEmail, 0)} per E-Mail · ${num(kpis.sentViaCopy, 0)} kopiert`}
              />
              <Stat
                label="Geklickt"
                value={num(kpis.clicked, 0)}
                hint={
                  kpis.clickRate == null
                    ? "noch keine getrackten Sends"
                    : `${pct(kpis.clickRate)} von ${num(kpis.trackedSends, 0)} getrackten`
                }
              />
              <Stat
                label="Eingelöst (MK-Code)"
                value={kpis.shopifyConfigured ? num(kpis.converted, 0) : "—"}
                hint={
                  kpis.shopifyConfigured && kpis.conversionRate != null
                    ? `${pct(kpis.conversionRate)} der geprüften Codes`
                    : undefined
                }
              />
              <Stat
                label="Sprache"
                value={`${num(kpis.byLanguage.de, 0)} DE · ${num(kpis.byLanguage.en, 0)} EN`}
                hint={
                  kpis.byLanguage.unknown > 0
                    ? `${num(kpis.byLanguage.unknown, 0)} unbekannt (Kontakt gelöscht)`
                    : undefined
                }
              />
            </div>
          </div>
          <Caveat>
            „Geklickt“ zählt Sends, deren getrackter Promo-CTA
            (<code>/api/r/&lt;token&gt;</code>) mindestens einmal angeklickt wurde
            — Sends vor Migration 0041 und Kopier-Sends tragen keinen Link und
            können nicht als geklickt zählen (Basis: getrackte Sends).
            „Eingelöst“ prüft per Shopify, ob der einmalige MK-Code der
            jeweiligen E-Mail verwendet wurde; die Rate bezieht sich auf die
            geprüften Codes mit Antwort.
            {!kpis.shopifyConfigured &&
              " Shopify ist nicht konfiguriert — die Einlösung kann nicht berechnet werden."}
            {kpis.shopifyConfigured &&
              kpis.redemptionUnknown > 0 &&
              ` Bei ${num(kpis.redemptionUnknown, 0)} Code(s) lieferte Shopify keine Antwort (nicht gezählt).`}
            {kpis.sampled &&
              ` Einlösungsprüfung auf die ${CAMPAIGN_KPI_MAX_CODES} neuesten Codes begrenzt.`}
          </Caveat>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Bundle-Angebote — erstellte Angebote, Lebenszyklus, Klicks auf den Link
// ---------------------------------------------------------------------------

function BundleSection({ kpis, range }: { kpis: BundleKpis | null; range: KpiRange }) {
  return (
    <Section
      title="Bundle-Angebote"
      subtitle={`Persönliche Set-Angebote (unlisted Shopify-Produkte): erstellt, Lebenszyklus und Klicks auf den Angebots-Link — Zeitraum: ${range.label}.`}
    >
      {!kpis ? (
        <Banner tone="info">Noch keine Daten.</Banner>
      ) : kpis.created.total === 0 && kpis.clicks === 0 && kpis.activeNow === 0 ? (
        <Banner tone="info">Noch keine Bundle-Angebote im Zeitraum.</Banner>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="Erstellt"
              value={num(kpis.created.total, 0)}
              hint={`${num(kpis.created.active, 0)} aktiv · ${num(kpis.created.expired, 0)} abgelaufen · ${num(kpis.created.failed, 0)} fehlgeschlagen`}
            />
            <Stat label="Aktuell aktiv" value={num(kpis.activeNow, 0)} hint="unabhängig vom Zeitraum" />
            <Stat
              label="Klicks auf Angebot"
              value={num(kpis.clicks, 0)}
              hint={`${num(kpis.clickedOffers, 0)} Angebot(e) geklickt`}
            />
            <Stat
              label="Ø Rabatt-Tiefe"
              value={kpis.avgDiscountPct == null ? "—" : pct(kpis.avgDiscountPct)}
              hint="vs. Summe der Einzelpreise"
            />
          </div>
          <Caveat>
            Klicks stammen vom getrackten Angebots-Link
            (<code>bundle_offer_clicked</code>). Ein <strong>Kauf</strong> eines
            Bundles wird bewusst <strong>nicht</strong> zugerechnet — es gibt
            kein zuverlässig gespeichertes Bestellsignal je Angebot (keine
            erfundene Zuordnung; siehe Umsatz-Abschnitt).
          </Caveat>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Wissen (Q&A) — Queue-Zustand, Durchsatz, Antwort-Latenz, Scan-Backlog
// ---------------------------------------------------------------------------

function hours(n: number | null): string {
  if (n == null) return "—";
  if (n >= 48) return `${(n / 24).toLocaleString("de-DE", { maximumFractionDigits: 1 })} Tage`;
  return `${n.toLocaleString("de-DE", { maximumFractionDigits: 1 })} Std.`;
}

function QaSection({ kpis, range }: { kpis: QaKpis | null; range: KpiRange }) {
  const totalQueue =
    kpis == null
      ? 0
      : kpis.queue.open + kpis.queue.answered + kpis.queue.published + kpis.queue.dismissed;
  return (
    <Section
      title="Wissen (Q&A-Queue)"
      subtitle={`Wissenslücken aus Beratungen: gefunden → beantwortet → veröffentlicht — Durchsatz im Zeitraum: ${range.label}.`}
    >
      {!kpis ? (
        <Banner tone="info">Noch keine Daten.</Banner>
      ) : totalQueue === 0 && kpis.scanBacklog === 0 ? (
        <Banner tone="info">Noch keine Q&A-Einträge.</Banner>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="Lücken gefunden"
              value={num(kpis.createdInWindow, 0)}
              hint="im Zeitraum"
            />
            <Stat
              label="Veröffentlicht"
              value={num(kpis.publishedInWindow, 0)}
              hint="im Zeitraum"
            />
            <Stat label="Median bis Antwort" value={hours(kpis.medianHoursToAnswer)} />
            <Stat label="Median bis Veröffentlichung" value={hours(kpis.medianHoursToPublish)} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Offen" value={num(kpis.queue.open, 0)} hint="gesamt" />
            <Stat label="Beantwortet" value={num(kpis.queue.answered, 0)} hint="gesamt" />
            <Stat label="Veröffentlicht" value={num(kpis.queue.published, 0)} hint="gesamt" />
            <Stat
              label="Scan-Backlog"
              value={num(kpis.scanBacklog, 0)}
              hint="geeignete, noch nicht gescannte Beratungen"
            />
          </div>
          <Caveat>
            „Lücken gefunden“ = im Zeitraum erstellte Queue-Einträge (der Scan
            läuft auf Abruf im Wissen-Tab). Die Latenz misst vom Entwurf bis zur
            Operator-Antwort bzw. Veröffentlichung (Median über die im Zeitraum
            beantworteten/veröffentlichten Einträge). Ob Mo eine veröffentlichte
            Antwort tatsächlich verwendet hat, wird nicht gemessen.
          </Caveat>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Feedback — Volumen + Tier-Aufteilung
// ---------------------------------------------------------------------------

function FeedbackSection({ kpis, range }: { kpis: FeedbackKpis | null; range: KpiRange }) {
  return (
    <Section
      title="Feedback"
      subtitle={`Freitext-Feedback aus dem Widget — Volumen im Zeitraum: ${range.label}.`}
    >
      {!kpis ? (
        <Banner tone="info">Noch keine Daten.</Banner>
      ) : kpis.total === 0 ? (
        <Banner tone="info">Kein Feedback im Zeitraum.</Banner>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="Eingegangen" value={num(kpis.total, 0)} />
            <Stat
              label="Mit Gesprächsbezug"
              value={num(kpis.withConversation, 0)}
              hint={kpis.total > 0 ? pct(kpis.withConversation / kpis.total) : undefined}
            />
            <Stat
              label="Mit Kontakt-E-Mail"
              value={num(kpis.withEmail, 0)}
              hint="antwortbar"
            />
          </div>
          {kpis.byTier.length > 0 && (
            <>
              <h4 className="mt-4 mb-2 text-sm font-medium text-foreground">Nach Kundentyp</h4>
              <BarList
                rows={kpis.byTier.map((t) => ({ key: t.tier, label: t.tier, count: t.count }))}
              />
            </>
          )}
          <Caveat>
            Reines Volumen — die Inhalte stehen im Feedback-Tab. Der Kundentyp
            ist die Widget-Selbstauskunft (telemetriegradig, nicht verbindlich).
          </Caveat>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Kundenkonto & Self-Service — Sign-ins, Export/Löschung, Zusammenfassungen,
// Kontaktformular
// ---------------------------------------------------------------------------

function AccountSection({
  activity,
  range,
}: {
  activity: AccountActivity | null;
  range: KpiRange;
}) {
  const empty =
    !activity ||
    (activity.signins === 0 &&
      activity.exports === 0 &&
      activity.erasures === 0 &&
      activity.contactFormSubmissions === 0 &&
      activity.summaryDownloads === 0 &&
      activity.summaryEmails === 0);
  return (
    <Section
      title="Kundenkonto & Self-Service"
      subtitle={`Shopify-Anmeldungen, DSGVO-Self-Service und Zusammenfassungen — Zeitraum: ${range.label}.`}
    >
      {empty ? (
        <Banner tone="info">
          Noch keine Konto-Aktivität im Zeitraum. Sign-in-, Export- und
          Lösch-Ereignisse werden ab dem Deploy dieser Version erfasst.
        </Banner>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat
              label="Anmeldungen"
              value={num(activity.signins, 0)}
              hint={
                activity.silentSignins > 0
                  ? `${num(activity.silentSignins, 0)} stille Erkennungen`
                  : undefined
              }
            />
            <Stat label="Zusammenfassung per E-Mail" value={num(activity.summaryEmails, 0)} />
            <Stat label="Zusammenfassung (Download)" value={num(activity.summaryDownloads, 0)} />
            <Stat label="Kontaktformular" value={num(activity.contactFormSubmissions, 0)} />
            <Stat label="Datenexporte" value={num(activity.exports, 0)} hint="Art. 15/20" />
            <Stat label="Löschungen" value={num(activity.erasures, 0)} hint="Art. 17" />
          </div>
          <Caveat>
            Pseudonyme Zähler (kpi_events bzw. KI-Verbrauchszeilen der
            Zusammenfassungen) — keine Personenbezüge. „Stille Erkennungen“ sind
            automatische Wieder-Anmeldungen bereits eingeloggter
            Shopify-Kund:innen (<code>prompt=none</code>). Kontaktformular =
            akzeptierte Übermittlungen; vergleichbar mit den{" "}
            <code>show_contact_form</code>-Aufrufen im Gespräche-Tab.
          </Caveat>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Shared presentational bits — themed via the admin design tokens.
// Section / Stat / Caveat now live in ./ui/stat so the Overview tab reuses them.
// ---------------------------------------------------------------------------

/** Compact CSS bar list (label · bar · count) — the FavoriteBars pattern,
 * generalised for the distribution splits the new sections render. */
function BarList({
  rows,
  empty = "Noch keine Daten.",
}: {
  rows: Array<{
    key: string;
    label: string;
    /** Bar scale (relative to the row max). */
    count: number;
    /** Optional suffix after the count (e.g. a share). */
    hint?: string;
    /** Overrides the rendered count text entirely (e.g. an EUR amount). */
    display?: string;
  }>;
  empty?: string;
}) {
  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground">{empty}</p>;
  }
  // True max (no floor of 1): EUR rows scale correctly below 1; `|| 1` only
  // guards the all-zero case against a division by zero.
  const max = Math.max(...rows.map((r) => r.count), 0) || 1;
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-2">
          <div className="basis-[45%] truncate text-xs text-muted-foreground" title={r.label}>
            {r.label}
          </div>
          <div className="h-3.5 flex-1 rounded bg-muted">
            <div
              className="h-full rounded bg-accent"
              style={{ width: `${(Math.max(0, r.count) / max) * 100}%` }}
            />
          </div>
          <div className="shrink-0 basis-20 text-right text-xs text-muted-foreground">
            {r.display ?? `${num(r.count, 0)}${r.hint ? ` · ${r.hint}` : ""}`}
          </div>
        </div>
      ))}
    </div>
  );
}

function LegendDot({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
      {label}: <strong className="text-foreground">{num(value, 0)}</strong>
    </span>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      className={`border-b border-border px-3 py-2 font-semibold text-muted-foreground ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <td
      className={`border-b border-border/60 px-3 py-2 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </td>
  );
}

function Banner({ tone, children }: { tone: "warn" | "info"; children: React.ReactNode }) {
  const cls =
    tone === "warn"
      ? "border-warning/30 bg-warning/10 text-warning"
      : "border-info/30 bg-info/10 text-info";
  return (
    <div className={`rounded-lg border px-3.5 py-3 text-sm ${cls}`}>{children}</div>
  );
}
