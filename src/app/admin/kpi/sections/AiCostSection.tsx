// KI-Kosten — average cost per consultation (EUR) + total spend, chat vs admin,
// per call site and prompt caching.

import type { AiCostMetrics } from "@/lib/ai-usage-store";
import { ADMIN_DATE, formatAdmin } from "@/lib/admin-datetime.mjs";
import { eur, num, ratio } from "@/lib/admin-format.mjs";
import { Stat } from "../../ui";
import { BarList } from "../BarList";
import { ChartCard, Explain, KpiSection, StatGrid, SubHeading } from "../KpiSection";

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

export function AiCostSection({ cost }: { cost: AiCostMetrics | null }) {
  const ready = cost != null && cost.capturedSince != null;
  const info = (
    <Explain>
      <p>Geschätzte KI-Kosten (EUR) aus erfassten Token-Verbräuchen pro Modell.</p>
      <p>
        Kosten werden aus den vom Anbieter gemeldeten Token-Zahlen je Modell berechnet (Preistabelle
        in USD pro Mio. Tokens, überschreibbar via <code>MODEL_PRICES_JSON</code>; EUR-Umrechnung via{" "}
        <code>USD_EUR_RATE</code>, Standard 0,92). „Ø Kosten / Beratung“ zählt nur den Chat-Verbrauch je
        Konversation. Embeddings (Produktsuche) sind kostenseitig Rauschen, werden aber ehrlich
        mitgezählt. Für die Sprachausgabe (TTS) zählt die Spalte Input-Tokens <strong>Zeichen</strong>{" "}
        statt Tokens (Abrechnung je Zeichen). Cache-Lesen kostet 0,1×, Cache-Schreiben 1,25× des
        Input-Preises — die Ersparnis ist der Netto-Effekt gegenüber denselben Aufrufen ohne Caching
        {cost?.estimated &&
          "; einzelne Werte sind geschätzt, wenn der Anbieter keine Token-Zahl liefert"}
        .
      </p>
    </Explain>
  );
  return (
    <KpiSection
      id="ki-kosten"
      title="KI-Kosten"
      info={info}
      empty={
        ready
          ? null
          : "Noch keine KI-Verbrauchsdaten erfasst. Die Erfassung beginnt mit dem Deploy dieser Version — danach erscheinen hier die Kosten."
      }
      notes={
        ready
          ? [
              `Erfasst ab ${formatAdmin(cost.capturedSince, ADMIN_DATE)}.`,
              cost.estimated && "Enthält geschätzte Werte.",
            ]
          : []
      }
    >
      {ready && (
        <>
          <StatGrid cols={3}>
            <Stat
              label="Ø Kosten / Beratung"
              value={cost.consultationCount > 0 ? eur(cost.avgCostPerConsultationEur, 4) : "—"}
              hint={`${num(cost.consultationCount)} Beratungen mit Token-Erfassung`}
            />
            <Stat
              label="Median / Beratung"
              value={cost.consultationCount > 0 ? eur(cost.medianCostPerConsultationEur, 4) : "—"}
            />
            <Stat label="Gesamtausgaben" value={eur(cost.totalSpendEur)} hint="alle KI-Aufrufe im Zeitraum" />
          </StatGrid>

          <SubHeading>Aufteilung</SubHeading>
          <StatGrid cols={2}>
            <Stat
              label="Chat (inkl. Embeddings & Sprachausgabe)"
              value={eur(cost.chatSpendEur)}
              hint="Beratungs-Chat + Produktsuche + TTS"
            />
            <Stat
              label="Dashboard / Admin"
              value={eur(cost.adminSpendEur)}
              hint="E-Mail-Entwürfe, Profile, Analysen, Wissen"
            />
          </StatGrid>

          {cost.perCallSite.length > 0 && (
            <>
              <SubHeading>Nach Einsatzort</SubHeading>
              <ChartCard>
                <BarList
                  rows={cost.perCallSite.map((s) => ({
                    key: s.callSite,
                    label: CALL_SITE_LABELS[s.callSite] ?? s.callSite,
                    count: s.spendEur,
                    display: eur(s.spendEur),
                  }))}
                />
              </ChartCard>
            </>
          )}

          <SubHeading>Prompt-Caching (Chat)</SubHeading>
          <StatGrid cols={3}>
            <Stat
              label="Cache-Trefferquote"
              value={ratio(cost.cache.hitRate)}
              hint="gelesene Cache-Tokens ÷ Chat-Input-Tokens"
            />
            <Stat label="Ersparnis (netto)" value={eur(cost.cache.savedEur)} hint="Lese-Rabatt minus Schreib-Aufschlag" />
            <Stat
              label="Cache-Tokens"
              value={`${num(cost.cache.readTokens)} gelesen`}
              hint={`${num(cost.cache.writeTokens)} geschrieben`}
            />
          </StatGrid>
        </>
      )}
    </KpiSection>
  );
}
