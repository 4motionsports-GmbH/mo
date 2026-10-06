"use client";

// The completed report, rendered from the stored `sections` payload. Reports
// with the decision layer (sections v2 — business snapshot + strategist
// synthesis, since 2026-10-06) render as the DecisionReport; older reports
// keep their original view: KPIs + spend, Kundenbasis, Kampagnen and the
// analysis chapters (FoundationChapters).

import * as React from "react";
import type { ReportSections } from "@/lib/analytics-report-store";
import { isDecisionReport } from "@/lib/analytics-report-synthesis-core.mjs";
import { eur, num, ratio } from "@/lib/admin-format.mjs";
import { SEGMENT_LABELS } from "@/lib/admin-customer-filter.mjs";
import {
  BarList,
  Callout,
  Card,
  CardContent,
  Section,
  Stat,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui";
import { DecisionReport } from "./DecisionReport";
import { FoundationChapters } from "./FoundationChapters";

export function ReportView({ sections }: { sections: ReportSections }) {
  if (isDecisionReport(sections)) return <DecisionReport sections={sections} />;
  return <LegacyReportView sections={sections} />;
}

/** Reports generated before the decision layer (sections v1). */
function LegacyReportView({ sections }: { sections: ReportSections }) {
  const k = sections.kpis;
  return (
    <div className="flex flex-col gap-8">
      <Callout tone="neutral" compact>
        Älterer Bericht ohne Entscheidungsteil und Geschäftsdaten — eine neue Komplettanalyse enthält beides.
      </Callout>
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
            <Stat
              label="Neu angemeldet"
              value={num(sections.customerBase.newSubscribers)}
              size="sm"
              info="Im Zeitraum, über alle Wege (Shop und Mo)."
            />
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
                    <TableRow key={c.campaignId ?? c.name}>
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

      <FoundationChapters sections={sections} />
    </div>
  );
}
