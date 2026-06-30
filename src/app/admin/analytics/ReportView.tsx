// The completed report, rendered on the SERVER from the stored `sections` payload.
// Everything dense + structured in one place: KPIs + spend, category/quality
// distributions, the aggregate insights narrative, the persona breakdown with
// top-questions, the aggregate + per-customer customer knowledge, and the
// per-conversation appendix.

import * as React from "react";
import { BarChart3, Layers, Sparkles, Users, ListTree, Info } from "lucide-react";
import { Card, CardContent, Markdown, Badge } from "../ui";
import { Section, Stat } from "../ui/stat";
import type {
  ReportSections,
  ReportDistributionRow,
  ReportPersonaSection,
  ReportProfileSection,
  ReportAppendixItem,
} from "@/lib/analytics-report-store";

function eur(n: number): string {
  return n.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
}
function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("de-DE", { dateStyle: "medium" });
  } catch {
    return iso;
  }
}

function Distribution({ rows }: { rows: ReportDistributionRow[] }) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1;
  if (rows.length === 0) {
    return <p className="text-[12px] text-muted-foreground">— noch keine Daten</p>;
  }
  return (
    <ul className="space-y-1">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-2 text-[12px]">
          <span className="w-40 shrink-0 truncate text-muted-foreground" title={r.label}>
            {r.label}
          </span>
          <span className="relative h-3 flex-1 overflow-hidden rounded-sm bg-muted">
            <span
              className="absolute inset-y-0 left-0 rounded-sm bg-accent/70"
              style={{ width: `${Math.round((r.count / max) * 100)}%` }}
            />
          </span>
          <span className="w-8 shrink-0 text-right tabular-nums text-foreground">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}

function PersonaCard({ p }: { p: ReportPersonaSection }) {
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">{p.personaDisplay}</h3>
          <Badge variant="secondary">{p.chatCount} Gespräch(e)</Badge>
        </div>
        {p.favoriteProducts.length > 0 && (
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Häufig empfohlen
            </div>
            <ul className="mt-0.5 space-y-0.5 text-[12px] text-foreground">
              {p.favoriteProducts.map((f) => (
                <li key={f.productId} className="flex justify-between gap-2">
                  <span className="truncate">{f.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{f.count}×</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {p.topQuestionsMd && (
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Top-Fragen &amp; Themen
            </div>
            <Markdown content={p.topQuestionsMd} className="mt-0.5 text-[12px]" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProfileCard({ pr }: { pr: ReportProfileSection }) {
  const meta = [
    pr.sessionCount != null ? `${pr.sessionCount} Session(s)` : null,
    pr.lastSeenAt ? `zuletzt ${fmtDate(pr.lastSeenAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-foreground">{pr.name}</h4>
          {meta && <span className="text-[11px] text-muted-foreground">{meta}</span>}
        </div>
        <Markdown content={pr.profileSummary} className="text-[12px]" />
      </CardContent>
    </Card>
  );
}

function AppendixRow({ a, index }: { a: ReportAppendixItem; index: number }) {
  const head = [a.personaDisplay, a.category, a.quality].filter(Boolean).join(" · ");
  return (
    <li className="border-b border-border/60 py-2 last:border-0">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="tabular-nums">{index + 1}.</span>
        <span>{fmtDate(a.createdAt)}</span>
        <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
          {a.tier === "signedIn" ? "Angemeldet" : a.tier === "emailOnly" ? "E-Mail" : "Anonym"}
        </Badge>
        {head && <span className="truncate">{head}</span>}
      </div>
      {a.summary && <p className="mt-0.5 text-[12px] text-foreground">{a.summary}</p>}
    </li>
  );
}

export function ReportView({ sections }: { sections: ReportSections }) {
  const k = sections.kpis;
  return (
    <div className="space-y-8">
      {sections.notes.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-[12px] text-info">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <div>
            {sections.notes.map((n, i) => (
              <p key={i}>{n}</p>
            ))}
          </div>
        </div>
      )}

      {/* KPIs */}
      <Section title="Kennzahlen" subtitle="Überblick über den Zeitraum">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Gespräche" value={String(k.conversations)} />
          <Stat label="Analysiert" value={String(k.analyzed)} />
          <Stat label="E-Mail erfasst" value={String(k.emailCaptured)} />
          <Stat label="Warenkorb genutzt" value={String(k.cartUsed)} />
          <Stat label="Produkt empfohlen" value={String(k.checkoutOffered)} />
          <Stat
            label="Ohne Antwort"
            value={String(k.withError)}
            tooltip="Fehler-Proxy: Nutzer-Nachricht ohne jede Bot-Antwort."
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
          <span>
            Tier · Anonym <strong className="text-foreground">{k.tiers.anonymous}</strong> · E-Mail{" "}
            <strong className="text-foreground">{k.tiers.emailOnly}</strong> · Angemeldet{" "}
            <strong className="text-foreground">{k.tiers.signedIn}</strong>
          </span>
          <span>
            KI-Ausgaben im Zeitraum (alle Aufrufe):{" "}
            <strong className="text-foreground">~{eur(sections.spend.totalEur)}</strong>
          </span>
        </div>
      </Section>

      {/* Distributions */}
      <Section title="Verteilung der Gespräche">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardContent className="p-4">
              <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
                <Layers className="size-3.5 text-muted-foreground" />
                Kategorien
              </div>
              <Distribution rows={sections.categories} />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
                <BarChart3 className="size-3.5 text-muted-foreground" />
                Qualitätssignale
              </div>
              <Distribution rows={sections.qualities} />
            </CardContent>
          </Card>
        </div>
      </Section>

      {/* Insights */}
      <Section title="Aggregierte Insights" subtitle="Verdichtet aus den Gesprächs-Zusammenfassungen">
        <Card>
          <CardContent className="p-4">
            {sections.insightsMd ? (
              <Markdown content={sections.insightsMd} className="text-[13px]" />
            ) : (
              <p className="text-[12px] text-muted-foreground">Keine Insights verfügbar.</p>
            )}
          </CardContent>
        </Card>
      </Section>

      {/* Personas */}
      <Section title="Personas" subtitle="Gruppen, Lieblingsprodukte & Top-Fragen im Zeitraum">
        {sections.personas.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">Keine Persona-Daten im Zeitraum.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {sections.personas.map((p) => (
              <PersonaCard key={p.personaLabel} p={p} />
            ))}
          </div>
        )}
      </Section>

      {/* Customer knowledge */}
      <Section title="Kundenwissen" subtitle="Aggregierte Synthese & — falls gewählt — einzelne Profile">
        <Card>
          <CardContent className="p-4">
            <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
              <Sparkles className="size-3.5 text-accent" />
              Aggregiert (pseudonym)
            </div>
            {sections.customerKnowledgeMd ? (
              <Markdown content={sections.customerKnowledgeMd} className="text-[13px]" />
            ) : (
              <p className="text-[12px] text-muted-foreground">Keine aggregierte Synthese verfügbar.</p>
            )}
          </CardContent>
        </Card>
        {sections.profiles.length > 0 && (
          <div className="mt-3">
            <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
              <Users className="size-3.5 text-muted-foreground" />
              Einzelne Kundenprofile ({sections.profiles.length})
              <span className="font-normal text-muted-foreground">— identitätsbezogen, nur intern</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {sections.profiles.map((pr) => (
                <ProfileCard key={pr.customerId} pr={pr} />
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* Appendix */}
      {sections.appendix.length > 0 && (
        <Section
          title={`Anhang · Gespräche (${sections.appendix.length})`}
          subtitle="Jede analysierte Beratung mit Kategorie & Qualität"
        >
          <Card>
            <CardContent className="p-4">
              <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
                <ListTree className="size-3.5 text-muted-foreground" />
                Einzel-Gespräche
              </div>
              <ul>
                {sections.appendix.map((a, i) => (
                  <AppendixRow key={`${a.conversationKey}-${i}`} a={a} index={i} />
                ))}
              </ul>
            </CardContent>
          </Card>
        </Section>
      )}
    </div>
  );
}
