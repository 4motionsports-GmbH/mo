"use client";

// The analysis chapters every Komplettanalyse carries (v1 and v2): the
// conversation distributions, the aggregate insights narrative, the persona
// breakdown with top-questions, the aggregate + per-customer customer
// knowledge, and the per-conversation appendix. The legacy report shows them
// as sections; the decision report shows them collapsed under „Grundlagen“.

import * as React from "react";
import { Sparkles, Users, ListTree } from "lucide-react";
import type {
  ReportSections,
  ReportPersonaSection,
  ReportProfileSection,
  ReportAppendixItem,
} from "@/lib/analytics-report-store";
import { ADMIN_DATE_MEDIUM, formatAdmin } from "@/lib/admin-datetime.mjs";
import { num, plural } from "@/lib/admin-format.mjs";
import { BarList, Card, CardContent, Disclosure, Markdown, Section, StatusBadge } from "../ui";

function fmtDate(iso: string): string {
  return formatAdmin(iso, ADMIN_DATE_MEDIUM, iso);
}

function PersonaCard({ p }: { p: ReportPersonaSection }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">{p.personaDisplay}</h3>
          <StatusBadge tone="neutral" dot={false}>
            {plural(p.chatCount, "Gespräch", "Gespräche")}
          </StatusBadge>
        </div>
        {p.favoriteProducts.length > 0 && (
          <div>
            <div className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">Häufig empfohlen</div>
            <ul className="mt-0.5 flex flex-col gap-0.5 text-xs text-foreground">
              {p.favoriteProducts.map((f) => (
                <li key={f.productId} className="flex justify-between gap-2">
                  <span className="truncate">{f.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{num(f.count)}×</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {p.topQuestionsMd && (
          <div>
            <div className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              Top-Fragen &amp; Themen
            </div>
            <Markdown content={p.topQuestionsMd} className="mt-0.5 text-xs" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProfileCard({ pr }: { pr: ReportProfileSection }) {
  const meta = [
    pr.sessionCount != null ? plural(pr.sessionCount, "Session", "Sessions") : null,
    pr.lastSeenAt ? `zuletzt ${fmtDate(pr.lastSeenAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-foreground">{pr.name}</h4>
          {meta && <span className="text-2xs text-muted-foreground">{meta}</span>}
        </div>
        <Markdown content={pr.profileSummary} className="text-xs" />
      </CardContent>
    </Card>
  );
}

function AppendixRow({ a, index }: { a: ReportAppendixItem; index: number }) {
  const head = [a.personaDisplay, a.category, a.quality].filter(Boolean).join(" · ");
  return (
    <li className="border-b border-border/60 py-2 last:border-0">
      <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
        <span className="tabular-nums">{index + 1}.</span>
        <span>{fmtDate(a.createdAt)}</span>
        <StatusBadge tone="neutral" dot={false}>
          {a.tier === "signedIn" ? "Angemeldet" : a.tier === "emailOnly" ? "E-Mail" : "Anonym"}
        </StatusBadge>
        {head && <span className="truncate">{head}</span>}
      </div>
      {a.summary && <p className="mt-0.5 text-xs text-foreground">{a.summary}</p>}
    </li>
  );
}

/**
 * One chapter: a titled Section in the legacy view, a collapsed Disclosure in
 * the decision report (`collapsible`).
 */
function Chapter({
  collapsible,
  title,
  info,
  meta,
  children,
}: {
  collapsible: boolean;
  title: string;
  info?: string;
  meta?: string;
  children: React.ReactNode;
}) {
  if (collapsible) {
    return (
      <Disclosure title={title} meta={meta}>
        {children}
      </Disclosure>
    );
  }
  return (
    <Section title={title} level={3} info={info}>
      {children}
    </Section>
  );
}

export function FoundationChapters({ sections, collapsible = false }: { sections: ReportSections; collapsible?: boolean }) {
  const toRows = (rows: Array<{ label: string; count: number }>) =>
    rows.map((r) => ({ key: r.label, label: r.label, count: r.count }));
  return (
    <div className={collapsible ? "flex flex-col gap-2" : "flex flex-col gap-8"}>
      <Chapter collapsible={collapsible} title="Verteilung der Gespräche" meta={`${num(sections.kpis?.analyzed ?? 0)} analysiert`}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardContent className="p-4">
              <div className="mb-2 text-xs font-semibold text-foreground">Kategorien</div>
              <BarList rows={toRows(sections.categories ?? [])} />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="mb-2 text-xs font-semibold text-foreground">Qualitätssignale</div>
              <BarList rows={toRows(sections.qualities ?? [])} />
            </CardContent>
          </Card>
        </div>
      </Chapter>

      <Chapter collapsible={collapsible} title="Aggregierte Insights" info="Verdichtet aus den Gesprächs-Zusammenfassungen.">
        <Card>
          <CardContent className="p-4">
            {sections.insightsMd ? (
              <Markdown content={sections.insightsMd} className="text-sm" />
            ) : (
              <p className="text-xs text-muted-foreground">Keine Insights verfügbar.</p>
            )}
          </CardContent>
        </Card>
      </Chapter>

      <Chapter
        collapsible={collapsible}
        title="Personas"
        info="Gruppen, Lieblingsprodukte & Top-Fragen im Zeitraum."
        meta={plural(sections.personas?.length ?? 0, "Gruppe", "Gruppen")}
      >
        {(sections.personas ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">Keine Persona-Daten im Zeitraum.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {sections.personas.map((p) => (
              <PersonaCard key={p.personaLabel} p={p} />
            ))}
          </div>
        )}
      </Chapter>

      <Chapter
        collapsible={collapsible}
        title="Kundenwissen"
        info="Aggregierte Synthese & — falls gewählt — einzelne Profile (identitätsbezogen, nur intern)."
        meta={sections.profiles?.length ? `inkl. ${plural(sections.profiles.length, "Profil", "Profile")}` : "pseudonym"}
      >
        <Card>
          <CardContent className="p-4">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Sparkles className="size-3.5 text-accent" aria-hidden />
              Aggregiert (pseudonym)
            </div>
            {sections.customerKnowledgeMd ? (
              <Markdown content={sections.customerKnowledgeMd} className="text-sm" />
            ) : (
              <p className="text-xs text-muted-foreground">Keine aggregierte Synthese verfügbar.</p>
            )}
          </CardContent>
        </Card>
        {(sections.profiles ?? []).length > 0 && (
          <div className="mt-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Users className="size-3.5 text-muted-foreground" aria-hidden />
              Einzelne Kundenprofile ({num(sections.profiles.length)})
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {sections.profiles.map((pr) => (
                <ProfileCard key={pr.customerId} pr={pr} />
              ))}
            </div>
          </div>
        )}
      </Chapter>

      {(sections.appendix ?? []).length > 0 && (
        <Chapter
          collapsible={collapsible}
          title={`Anhang · Gespräche (${num(sections.appendix.length)})`}
          info="Jede analysierte Beratung mit Kategorie & Qualität."
        >
          <Card>
            <CardContent className="p-4">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <ListTree className="size-3.5 text-muted-foreground" aria-hidden />
                Einzel-Gespräche
              </div>
              <ul>
                {sections.appendix.map((a, i) => (
                  <AppendixRow key={`${a.conversationKey}-${i}`} a={a} index={i} />
                ))}
              </ul>
            </CardContent>
          </Card>
        </Chapter>
      )}
    </div>
  );
}
