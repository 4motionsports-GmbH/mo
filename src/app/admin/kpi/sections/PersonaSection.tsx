// Persona insights — distribution chart + per-persona favourites and the
// on-demand top-questions summary. Lifetime aggregate.

import type { PersonaInsight } from "@/lib/kpi-persona";
import type { TopQuestionsSummary } from "@/lib/kpi-top-questions";
import { num } from "@/lib/admin-format.mjs";
import { Card, CardContent } from "../../ui";
import { BarList } from "../BarList";
import { PersonaDistributionChart } from "../charts";
import { KpiTopQuestions } from "../KpiTopQuestions";
import { ChartCard, KpiSection, LifetimeBadge } from "../KpiSection";

export function PersonaSection({
  personas,
  cachedQuestions,
}: {
  personas: PersonaInsight[] | null;
  cachedQuestions: Map<string, TopQuestionsSummary>;
}) {
  return (
    <KpiSection
      id="personas"
      title="Persona-Insights"
      info="Gruppiert nach abgeleitetem Persona-Archetyp: Chats je Persona, die am häufigsten empfohlenen Produkte und — auf Abruf — die Top-Fragen der Gruppe."
      badges={<LifetimeBadge />}
      empty={!personas || personas.length === 0 ? "Noch keine klassifizierten Konversationen." : null}
    >
      {personas && (
        <div className="flex flex-col gap-4">
          <ChartCard title="Verteilung (Chats je Persona)">
            <PersonaDistributionChart
              data={personas.map((p) => ({ name: p.personaDisplay, value: p.chatCount }))}
            />
          </ChartCard>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {personas.map((p) => (
              <Card key={p.personaLabel}>
                <CardContent className="p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <strong className="text-sm">{p.personaDisplay}</strong>
                    <span className="shrink-0 text-xs text-muted-foreground">{num(p.chatCount)} Chats</span>
                  </div>

                  <h5 className="mb-1.5 mt-3 text-xs font-medium text-muted-foreground">
                    Lieblingsprodukte (am häufigsten empfohlen)
                  </h5>
                  <BarList
                    rows={p.favoriteProducts.map((f) => ({ key: f.productId, label: f.name, count: f.count }))}
                    empty="Keine Produktempfehlungen erfasst."
                  />

                  <KpiTopQuestions
                    personaLabel={p.personaLabel}
                    initial={cachedQuestions.get(p.personaLabel) ?? null}
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </KpiSection>
  );
}
