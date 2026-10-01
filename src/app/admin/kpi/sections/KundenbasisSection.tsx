// Kundenbasis — the shape of the whole customer base: Shopify customers vs.
// Mo leads, who talked to Mo, the one consent, lifecycle and value tiers, AI
// profile coverage. Pure DB, period-independent.

import type { CustomerBaseKpis } from "@/lib/customer-list-store";
import { SEGMENT_LABELS } from "@/lib/admin-customer-filter.mjs";
import { num, ratio } from "@/lib/admin-format.mjs";
import { BarList, Card, CardContent, CardHeader, CardTitle, Stat } from "../../ui";
import { Explain, KpiSection, LifetimeBadge, StatGrid } from "../KpiSection";

const VALUE_LABELS: Record<string, string> = { klein: "Kleinteile", komponente: "Komponenten", grossgeraet: "Großgeräte" };

const INFO = (
  <Explain>
    <p>Der ganze Kundenstamm: Shopify-Kund:innen und Interessenten aus Mo — eine Person, ein Eintrag.</p>
    <p>
      Lebenszyklus und Wertstufe entstehen nächtlich aus den Bestellungen (Kopie aus Shopify). Vor dem ersten
      Import zeigt der Abschnitt nur Personen aus Mo und dem früheren Newsletter-Abgleich.
    </p>
  </Explain>
);

export function KundenbasisSection({ kpis }: { kpis: CustomerBaseKpis | null }) {
  const empty = !kpis ? "Noch keine Daten." : kpis.total === 0 ? "Noch keine Kunden." : null;
  return (
    <KpiSection id="kundenbasis" title="Kundenbasis" info={INFO} badges={<LifetimeBadge />} empty={empty}>
      {kpis && (
        <>
          <StatGrid cols={4}>
            <Stat label="Kunden gesamt" value={num(kpis.total)} hint={`${num(kpis.shopifyCustomers)} Shopify · ${num(kpis.leads)} Interessenten`} />
            <Stat
              label="Mit Mo gesprochen"
              value={num(kpis.withMo)}
              hint={`${ratio(kpis.total > 0 ? kpis.withMo / kpis.total : null)} · davon ${num(kpis.shopifyWithMo)} Shopify-Kunden`}
            />
            <Stat
              label="Mit Einwilligung"
              value={num(kpis.consent.subscribed)}
              hint={`${ratio(kpis.total > 0 ? kpis.consent.subscribed / kpis.total : null)} · DOI-Anteil ${ratio(kpis.doiShare)}`}
            />
            <Stat label="Abwanderung hoch" value={num(kpis.churnHigh)} hint="gemessen am eigenen Kaufrhythmus" />
          </StatGrid>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Lebenszyklus</CardTitle>
              </CardHeader>
              <CardContent>
                <BarList
                  rows={kpis.bySegment.map((s) => ({
                    key: s.key,
                    label: SEGMENT_LABELS[s.key as keyof typeof SEGMENT_LABELS] ?? s.key,
                    count: s.n,
                  }))}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Einwilligung</CardTitle>
              </CardHeader>
              <CardContent>
                <BarList
                  rows={[
                    { key: "subscribed", label: "Angemeldet", count: kpis.consent.subscribed },
                    { key: "pending", label: "Bestätigung offen", count: kpis.consent.pending },
                    { key: "unsubscribed", label: "Abgemeldet", count: kpis.consent.unsubscribed },
                    { key: "none", label: "Keine Einwilligung", count: kpis.consent.none },
                    { key: "blocked", label: "Gesperrt", count: kpis.consent.blocked },
                  ]}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Wertstufe & Profile</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <BarList rows={kpis.byValueTier.map((t) => ({ key: t.key, label: VALUE_LABELS[t.key] ?? t.key, count: t.n }))} />
                <BarList
                  rows={[
                    { key: "voll", label: "Vollprofil", count: kpis.profiles.voll },
                    { key: "kauf", label: "Kaufprofil", count: kpis.profiles.kauf },
                    { key: "none", label: "Ohne Profil", count: kpis.profiles.none },
                  ]}
                />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </KpiSection>
  );
}
