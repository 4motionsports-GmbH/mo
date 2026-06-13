// KPI tab (server-rendered). Re-skinned onto the Session-A admin design system
// (themed Cards + tokens) with Recharts visuals. The server component still owns
// ALL aggregation — every number comes from the same kpi-store / kpi-persona /
// kpi-recommendation-loop / marketing-store / ai-usage-store getters as before,
// fetched once on the server and handed to the charts as plain props. The charts
// (./KpiCharts) are the only client islands; no KPI is fetched or recomputed in
// the browser. Every KPI keeps its honesty caveat inline.

import { getCoreMetrics, type CoreMetrics } from "@/lib/kpi-store";
import { getPersonaInsights, type PersonaInsight } from "@/lib/kpi-persona";
import {
  getRecommendationLoop,
  type RecommendationLoopResult,
} from "@/lib/kpi-recommendation-loop";
import { getMarketingFunnel, type MarketingFunnel } from "@/lib/marketing-store";
import { getCachedTopQuestionsMap } from "@/lib/kpi-top-questions";
import { getAiCostMetrics, type AiCostMetrics } from "@/lib/ai-usage-store";
import { KpiTopQuestions } from "./KpiTopQuestions";
import { Card, CardContent, CardHeader, CardTitle, Section, Stat, Caveat } from "./ui";
import {
  ChatsPerDayChart,
  StatusSplitChart,
  PersonaDistributionChart,
  StageFunnelChart,
} from "./KpiCharts";

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

function dateLabel(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("de-DE");
}

const MARKETING_FUNNEL_DISPLAY_CAP = 100;

export async function KpiTab({ dbReady }: { dbReady: boolean }) {
  if (!dbReady) {
    return (
      <Banner tone="warn">
        Keine Datenbank konfiguriert (DATABASE_URL) — es können keine KPIs
        berechnet werden.
      </Banner>
    );
  }

  const [core, personas, loop, funnel, cachedQuestions, aiCost] = await Promise.all([
    getCoreMetrics(30),
    getPersonaInsights(5),
    getRecommendationLoop(),
    getMarketingFunnel(),
    getCachedTopQuestionsMap(),
    getAiCostMetrics(),
  ]);

  return (
    <div className="flex flex-col gap-10">
      <CoreSection core={core} />
      <AiCostSection cost={aiCost} />
      <MarketingFunnelSection funnel={funnel} />
      <PersonaSection personas={personas} cachedQuestions={cachedQuestions} />
      <LoopSection loop={loop} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Core metrics — headline stat cards + chats-per-day + status split
// ---------------------------------------------------------------------------

function CoreSection({ core }: { core: CoreMetrics | null }) {
  if (!core) {
    return (
      <Section title="Kern-Metriken">
        <Banner tone="info">Noch keine Daten.</Banner>
      </Section>
    );
  }

  return (
    <Section title="Kern-Metriken">
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
              Chats pro Tag (letzte {core.windowDays} Tage)
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
// AI cost: average cost per consultation (EUR) + total spend, chat vs admin
// ---------------------------------------------------------------------------

function AiCostSection({ cost }: { cost: AiCostMetrics | null }) {
  return (
    <Section
      title="KI-Kosten"
      subtitle="Geschätzte KI-Kosten (EUR) aus erfassten Token-Verbräuchen pro Modell."
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
              label="Chat (inkl. Embeddings)"
              value={eur(cost.chatSpendEur, 2)}
              hint="Beratungs-Chat + Produktsuche"
            />
            <Stat
              label="Dashboard / Admin"
              value={eur(cost.adminSpendEur, 2)}
              hint="E-Mail-Entwürfe, Profile, Themen-Summaries"
            />
          </div>

          <Caveat>
            Kosten werden aus den vom Anbieter gemeldeten Token-Zahlen je Modell
            berechnet (Preistabelle in USD pro Mio. Tokens, überschreibbar via
            <code> MODEL_PRICES_JSON</code>; EUR-Umrechnung via
            <code> USD_EUR_RATE</code>, Standard 0,92). „Ø Kosten / Beratung“ zählt
            nur den Chat-Verbrauch je Konversation. Embeddings (Produktsuche) sind
            kostenseitig Rauschen, werden aber ehrlich mitgezählt
            {cost.estimated && " und teils geschätzt, wenn der Anbieter keine Token-Zahl liefert"}.
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
                    ? `${pct(funnel.conversionRate)} Einlösungsrate`
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
            einer echten Bestellung verwendet wurde.
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
// Shared presentational bits — themed via the admin design tokens.
// Section / Stat / Caveat now live in ./ui/stat so the Overview tab reuses them.
// ---------------------------------------------------------------------------

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
