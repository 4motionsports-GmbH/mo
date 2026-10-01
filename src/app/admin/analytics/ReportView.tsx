// The completed report, rendered from the stored `sections` payload. Everything
// dense + structured in one place: KPIs + spend, category/quality distributions,
// the aggregate insights narrative, the persona breakdown with top-questions,
// the aggregate + per-customer customer knowledge, and the per-conversation
// appendix.

import * as React from "react";
import { Sparkles, Users, ListTree } from "lucide-react";
import type {
  ReportSections,
  ReportPersonaSection,
  ReportProfileSection,
  ReportAppendixItem,
} from "@/lib/analytics-report-store";
import { ADMIN_DATE_MEDIUM, formatAdmin } from "@/lib/admin-datetime.mjs";
import { eur, num, plural, ratio } from "@/lib/admin-format.mjs";
import { SEGMENT_LABELS } from "@/lib/admin-customer-filter.mjs";
import {
  BarList,
  Callout,
  Card,
  CardContent,
  Markdown,
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

export function ReportView({ sections }: { sections: ReportSections }) {
  const k = sections.kpis;
  const toRows = (rows: Array<{ label: string; count: number }>) =>
    rows.map((r) => ({ key: r.label, label: r.label, count: r.count }));
  return (
    <div className="flex flex-col gap-8">
      {sections.notes.length > 0 && (
        <Callout tone="info" compact>
          {sections.notes.map((n, i) => (
            <p key={i}>{n}</p>
          ))}
        </Callout>
      )}

      <Section title="Kennzahlen" level={3} info="Überblick über den Zeitraum.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Gespräche" value={num(k.conversations)} size="sm" />
          <Stat label="Analysiert" value={num(k.analyzed)} size="sm" />
          <Stat label="E-Mail erfasst" value={num(k.emailCaptured)} size="sm" />
          <Stat label="Warenkorb genutzt" value={num(k.cartUsed)} size="sm" />
          <Stat label="Produkt empfohlen" value={num(k.checkoutOffered)} size="sm" />
          <Stat
            label="Ohne Antwort"
            value={num(k.withError)}
            size="sm"
            info="Fehler-Proxy: Nutzer-Nachricht ohne jede Bot-Antwort."
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            Tier · Anonym <strong className="text-foreground">{num(k.tiers.anonymous)}</strong> · E-Mail{" "}
            <strong className="text-foreground">{num(k.tiers.emailOnly)}</strong> · Angemeldet{" "}
            <strong className="text-foreground">{num(k.tiers.signedIn)}</strong>
          </span>
          <span>
            KI-Ausgaben im Zeitraum (alle Aufrufe):{" "}
            <strong className="text-foreground">~{eur(sections.spend.totalEur)}</strong>
          </span>
        </div>
      </Section>

      {sections.customerBase && (
        <Section title="Kundenbasis" level={3} info="Stand heute; neue Anmeldungen im gewählten Zeitraum.">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Kunden gesamt" value={num(sections.customerBase.total)} size="sm" />
            <Stat label="Shopify-Kunden" value={num(sections.customerBase.shopifyCustomers)} size="sm" />
            <Stat label="Mit Mo gesprochen" value={num(sections.customerBase.withMo)} size="sm" />
            <Stat label="Mit Einwilligung" value={num(sections.customerBase.subscribed)} size="sm" />
            <Stat label="Neu angemeldet" value={num(sections.customerBase.newSubscribers)} size="sm" info="Im Zeitraum, über alle Wege (Shop und Mo)." />
          </div>
          {sections.customerBase.bySegment.length > 0 && (
            <Card className="mt-3">
              <CardContent className="p-4">
                <div className="mb-2 text-xs font-semibold text-foreground">Lebenszyklus</div>
                <BarList
                  rows={sections.customerBase.bySegment.map((r) => ({
                    key: r.key,
                    label: SEGMENT_LABELS[r.key as keyof typeof SEGMENT_LABELS] ?? r.key,
                    count: r.n,
                  }))}
                />
              </CardContent>
            </Card>
          )}
        </Section>
      )}

      {sections.campaigns && sections.campaigns.length > 0 && (
        <Section title="Kampagnen" level={3} info="Im Zeitraum gesendete Kampagnen-Mails und was daraus wurde.">
          <Card>
            <CardContent className="p-0 pb-2">
              <Table className="text-xs [&_td]:tabular-nums">
                <TableHeader>
                  <TableRow>
                    <TableHead>Kampagne</TableHead>
                    <TableHead align="right">Gesendet</TableHead>
                    <TableHead align="right">Geklickt</TableHead>
                    <TableHead align="right">Chat gestartet</TableHead>
                    <TableHead align="right">Abgemeldet</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sections.campaigns.map((c) => (
                    <TableRow key={c.name}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell align="right">{num(c.sent)}</TableCell>
                      <TableCell align="right">
                        {num(c.clicked)} ({ratio(c.sent > 0 ? c.clicked / c.sent : null)})
                      </TableCell>
                      <TableCell align="right">{num(c.chatStarted)}</TableCell>
                      <TableCell align="right">{num(c.unsubscribed)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </Section>
      )}

      <Section title="Verteilung der Gespräche" level={3}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardContent className="p-4">
              <div className="mb-2 text-xs font-semibold text-foreground">Kategorien</div>
              <BarList rows={toRows(sections.categories)} />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="mb-2 text-xs font-semibold text-foreground">Qualitätssignale</div>
              <BarList rows={toRows(sections.qualities)} />
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section title="Aggregierte Insights" level={3} info="Verdichtet aus den Gesprächs-Zusammenfassungen.">
        <Card>
          <CardContent className="p-4">
            {sections.insightsMd ? (
              <Markdown content={sections.insightsMd} className="text-sm" />
            ) : (
              <p className="text-xs text-muted-foreground">Keine Insights verfügbar.</p>
            )}
          </CardContent>
        </Card>
      </Section>

      <Section title="Personas" level={3} info="Gruppen, Lieblingsprodukte & Top-Fragen im Zeitraum.">
        {sections.personas.length === 0 ? (
          <p className="text-xs text-muted-foreground">Keine Persona-Daten im Zeitraum.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {sections.personas.map((p) => (
              <PersonaCard key={p.personaLabel} p={p} />
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Kundenwissen"
        level={3}
        info="Aggregierte Synthese & — falls gewählt — einzelne Profile (identitätsbezogen, nur intern)."
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
        {sections.profiles.length > 0 && (
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
      </Section>

      {sections.appendix.length > 0 && (
        <Section
          title={`Anhang · Gespräche (${num(sections.appendix.length)})`}
          level={3}
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
        </Section>
      )}
    </div>
  );
}
