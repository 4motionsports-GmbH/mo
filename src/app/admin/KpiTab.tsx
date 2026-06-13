// KPI tab (server-rendered). Lightweight by design: plain tables + CSS bars, no
// dashboard framework. All numbers come from the pseudonymous analytics cluster
// (conversations / messages / kpi_events) plus a capped Shopify-orders pass for
// the recommendation→purchase loop. Every KPI carries its caveat inline.

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
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <CoreSection core={core} />
      <AiCostSection cost={aiCost} />
      <MarketingFunnelSection funnel={funnel} />
      <PersonaSection personas={personas} cachedQuestions={cachedQuestions} />
      <LoopSection loop={loop} />
    </div>
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
          <p style={{ fontSize: 12, color: "#888", margin: "0 0 12px" }}>
            ab {dateLabel(cost.capturedSince)} erfasst
            {cost.estimated && " · enthält geschätzte Werte"}
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
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

          <h4 style={subhead}>Aufteilung</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
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

          <p style={caption}>
            Kosten werden aus den vom Anbieter gemeldeten Token-Zahlen je Modell
            berechnet (Preistabelle in USD pro Mio. Tokens, überschreibbar via
            <code> MODEL_PRICES_JSON</code>; EUR-Umrechnung via
            <code> USD_EUR_RATE</code>, Standard 0,92). „Ø Kosten / Beratung“ zählt
            nur den Chat-Verbrauch je Konversation. Embeddings (Produktsuche) sind
            kostenseitig Rauschen, werden aber ehrlich mitgezählt
            {cost.estimated && " und teils geschätzt, wenn der Anbieter keine Token-Zahl liefert"}.
          </p>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Marketing funnel: sent → clicked → converted (unique code redeemed)
// ---------------------------------------------------------------------------

function MarketingFunnelSection({ funnel }: { funnel: MarketingFunnel | null }) {
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
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th>Stufe</Th>
                <Th align="right">Anzahl</Th>
                <Th align="right">Rate</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td>Gesendet</Td>
                <Td align="right">{num(funnel.sent, 0)}</Td>
                <Td align="right">—</Td>
              </tr>
              <tr>
                <Td>Geklickt</Td>
                <Td align="right">{num(funnel.clicked, 0)}</Td>
                <Td align="right">
                  {funnel.clickRate == null ? "—" : pct(funnel.clickRate)}
                </Td>
              </tr>
              <tr>
                <Td>Eingelöst (Code verwendet)</Td>
                <Td align="right">
                  {funnel.shopifyConfigured ? num(funnel.converted, 0) : "—"}
                </Td>
                <Td align="right">
                  {funnel.shopifyConfigured && funnel.conversionRate != null
                    ? pct(funnel.conversionRate)
                    : "—"}
                </Td>
              </tr>
            </tbody>
          </table>

          <p style={caption}>
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
          </p>
        </>
      )}
    </Section>
  );
}

const MARKETING_FUNNEL_DISPLAY_CAP = 100;

// ---------------------------------------------------------------------------
// 1. Core metrics
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
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

      <h4 style={subhead}>Chats pro Tag (letzte {core.windowDays} Tage)</h4>
      <DayBars data={core.chatsByDay} />

      <h4 style={subhead}>In-Chat-Klicks (Buttons im Chat)</h4>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
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
      <p style={caption}>
        Klick-Signale werden anhand der Event-Namen aus der Widget-Telemetrie
        gemustert (Produkt/CTA: <code>%product%click%</code> / <code>%cta%click%</code>;
        Warenkorb: <code>%cart%</code> / <code>%checkout%</code>). Die vollständige
        Event-Übersicht zeigt die Rohdaten.
      </p>

      <h4 style={subhead}>Status-Verteilung</h4>
      <div style={{ display: "flex", gap: 16, fontSize: 13, color: "#444" }}>
        <span>Aktiv: <strong>{num(core.status.active, 0)}</strong></span>
        <span>Abgebrochen: <strong>{num(core.status.abandoned, 0)}</strong></span>
        <span>Konvertiert: <strong>{num(core.status.converted, 0)}</strong></span>
      </div>

      {core.topEvents.length > 0 && (
        <>
          <h4 style={subhead}>Event-Übersicht (Top 20)</h4>
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th>Event</Th>
                <Th align="right">Anzahl</Th>
              </tr>
            </thead>
            <tbody>
              {core.topEvents.map((e) => (
                <tr key={e.event}>
                  <Td><code>{e.event}</code></Td>
                  <Td align="right">{num(e.count, 0)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Section>
  );
}

function DayBars({ data }: { data: Array<{ day: string; count: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 80, marginTop: 8 }}>
      {data.map((d) => (
        <div
          key={d.day}
          title={`${d.day}: ${d.count}`}
          style={{
            flex: 1,
            background: "#2563eb",
            opacity: d.count === 0 ? 0.15 : 0.85,
            height: `${Math.max(2, (d.count / max) * 100)}%`,
            borderRadius: "2px 2px 0 0",
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Persona insights
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
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {personas.map((p) => (
            <div
              key={p.personaLabel}
              style={{ border: "1px solid #eee", borderRadius: 10, padding: "14px 16px", background: "#fff" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <strong style={{ fontSize: 14 }}>{p.personaDisplay}</strong>
                <span style={{ fontSize: 12, color: "#888" }}>{num(p.chatCount, 0)} Chats</span>
              </div>

              <h5 style={{ ...subhead, fontSize: 12 }}>
                Lieblingsprodukte (am häufigsten empfohlen)
              </h5>
              {p.favoriteProducts.length === 0 ? (
                <p style={caption}>Keine Produktempfehlungen erfasst.</p>
              ) : (
                <FavoriteBars favorites={p.favoriteProducts} />
              )}

              <KpiTopQuestions
                personaLabel={p.personaLabel}
                initial={cachedQuestions.get(p.personaLabel) ?? null}
              />
            </div>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
      {favorites.map((f) => (
        <div key={f.productId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: "0 0 45%", fontSize: 12, color: "#444", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.name}>
            {f.name}
          </div>
          <div style={{ flex: 1, background: "#f1f1f1", borderRadius: 4, height: 14 }}>
            <div style={{ width: `${(f.count / max) * 100}%`, background: "#16a34a", height: "100%", borderRadius: 4 }} />
          </div>
          <div style={{ flex: "0 0 28px", textAlign: "right", fontSize: 12, color: "#666" }}>{f.count}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Recommendation → purchase loop
// ---------------------------------------------------------------------------

function LoopSection({ loop }: { loop: RecommendationLoopResult | null }) {
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

          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
            <span style={{ fontSize: 32, fontWeight: 700, color: "#111" }}>
              {loop.recommendationToPurchaseRate == null
                ? "—"
                : pct(loop.recommendationToPurchaseRate)}
            </span>
            <span style={{ fontSize: 13, color: "#666" }}>
              der Käufer:innen <strong>mit E-Mail-Angabe</strong> kauften ein zuvor
              empfohlenes Produkt
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 14 }}>
            <Stat label="Kontakte geprüft" value={num(loop.contactsExamined, 0)} />
            <Stat label="mit Empfehlung" value={num(loop.withRecommendation, 0)} />
            <Stat label="mit Kauf" value={num(loop.withPurchase, 0)} />
            <Stat label="Kauf = Empfehlung" value={num(loop.withRecommendedPurchase, 0)} />
          </div>

          <p style={caption}>
            ⚠️ Aussagekraft begrenzt: erfasst <strong>nur</strong> Nutzer, die eine
            E-Mail angegeben <strong>und</strong> der Verarbeitung zugestimmt haben
            — also eine Minderheit aller Chatter und nicht alle Käufer. Produkt-Zuordnung
            erfolgt über normalisierte Shopify-Handles; umbenannte/archivierte Produkte
            können fehlen.
            {loop.purchaseUnknown > 0 &&
              ` Bei ${loop.purchaseUnknown} Kontakt(en) lieferte Shopify keine Antwort (als „unbekannt" gewertet).`}
            {loop.sampled && " Stichprobe auf die 100 neuesten Kontakte begrenzt."}
          </p>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Shared presentational bits
// ---------------------------------------------------------------------------

const subhead: React.CSSProperties = {
  fontSize: 13,
  margin: "18px 0 0",
  color: "#333",
};

const caption: React.CSSProperties = {
  fontSize: 11,
  color: "#999",
  margin: "8px 0 0",
  lineHeight: 1.5,
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  marginTop: 8,
  fontSize: 13,
};

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 style={{ fontSize: 17, margin: "0 0 2px" }}>{title}</h2>
      {subtitle && <p style={{ fontSize: 12, color: "#888", margin: "0 0 12px" }}>{subtitle}</p>}
      {!subtitle && <div style={{ height: 10 }} />}
      {children}
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ border: "1px solid #eee", borderRadius: 10, padding: "12px 14px", background: "#fff" }}>
      <div style={{ fontSize: 12, color: "#888" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, margin: "4px 0 0" }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th style={{ textAlign: align, padding: "6px 8px", borderBottom: "1px solid #eee", color: "#888", fontWeight: 600 }}>
      {children}
    </th>
  );
}

function Td({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <td style={{ textAlign: align, padding: "6px 8px", borderBottom: "1px solid #f5f5f5" }}>
      {children}
    </td>
  );
}

function Banner({ tone, children }: { tone: "warn" | "info"; children: React.ReactNode }) {
  const bg = tone === "warn" ? "#fef3c7" : "#eff6ff";
  const fg = tone === "warn" ? "#92400e" : "#1e40af";
  return (
    <div style={{ background: bg, color: fg, fontSize: 13, padding: "12px 14px", borderRadius: 10 }}>
      {children}
    </div>
  );
}
