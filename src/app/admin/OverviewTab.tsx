// ÜBERSICHT — the landing screen. Read-only: "Heute" (what needs attention,
// each card a deep link), the headline numbers of the last 30 days and two
// activity feeds. Every number is a database aggregate (admin-overview-store;
// decision D-1) — opening this screen never calls Shopify.

import Link from "next/link";
import { BookOpen, Inbox, Mail, Send, Sparkles, UserCheck } from "lucide-react";
import { getOverviewSnapshot } from "@/lib/admin-overview-store";
import { mergeRecentSends, todayItems } from "@/lib/admin-overview.mjs";
import { adminTabHref } from "@/lib/admin-tabs.mjs";
import { ADMIN_DATE, formatAdmin } from "@/lib/admin-datetime.mjs";
import { eur, num, plural } from "@/lib/admin-format.mjs";
import { Callout, Card, CardContent, EmptyState, Section, Stat, StatusBadge } from "./ui";

const RECENT_LIMIT = 5;
const WINDOW_DAYS = 30;

const TODAY_ICONS: Record<string, React.ReactNode> = {
  kampagne: <Send />,
  posteingang: <Inbox />,
  wissen: <BookOpen />,
  analysen: <Sparkles />,
};

export async function OverviewTab({ dbReady }: { dbReady: boolean }) {
  const snapshot = dbReady
    ? await getOverviewSnapshot({ windowDays: WINDOW_DAYS, limit: RECENT_LIMIT })
    : null;

  if (!snapshot) {
    return (
      <Callout tone="warning">
        Keine Datenbank konfiguriert (DATABASE_URL) — die Übersicht kann nicht berechnet werden.
      </Callout>
    );
  }

  const { core, aiCost, marketing, campaignActivity, marketingActivity } = snapshot;
  const today = todayItems({
    campaign: snapshot.campaignCounts,
    unmatchedInbound: snapshot.unmatchedInbound,
    qaOpen: snapshot.qaCounts.open,
    runningReports: snapshot.running.reports,
    runningImprovementRuns: snapshot.running.improvementRuns,
  });
  const chatsInWindow = core ? core.chatsByDay.reduce((sum, d) => sum + d.count, 0) : null;
  const marketingSent = marketingActivity?.sentInWindow ?? 0;
  const sentInWindow = campaignActivity.sentInWindow + marketingSent;
  const recentSends = mergeRecentSends(
    campaignActivity.recentSends,
    (marketingActivity?.recentSends ?? []).map((s) => ({ ...s, source: "marketing" as const })),
    RECENT_LIMIT
  );
  const consultationCount = aiCost?.consultationCount ?? 0;

  return (
    <div className="flex flex-col gap-8">
      <Section
        title="Heute"
        info="Was jetzt Aufmerksamkeit braucht. Jede Karte führt direkt in den Bereich, in dem die Arbeit passiert."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {today.map((item) => (
            <Stat
              key={item.key}
              href={item.href}
              icon={TODAY_ICONS[item.key]}
              label={item.label}
              value={
                <span className={item.attention ? "text-foreground" : "text-muted-foreground"}>
                  {num(item.value)}
                </span>
              }
              hint={item.hint}
            />
          ))}
        </div>
      </Section>

      <Section
        title={`Letzte ${WINDOW_DAYS} Tage`}
        info={`Feste ${WINDOW_DAYS}-Tage-Sicht ab heute (Europe/Berlin). Einen anderen Zeitraum und alle Details gibt es unter KPIs. Die Kosten pro Beratung sind ein Durchschnitt über den gesamten Aufzeichnungszeitraum.`}
        actions={
          <Link
            href={adminTabHref("kpi")}
            className="text-xs font-medium text-accent underline-offset-4 hover:underline"
          >
            KPIs öffnen
          </Link>
        }
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat
            label="Beratungen"
            value={chatsInWindow === null ? "—" : num(chatsInWindow)}
            hint={core ? `gesamt ${num(core.totalChats)}` : undefined}
            info="Neue Chats mit mindestens einer Nachricht im Zeitraum; „gesamt“ zählt seit Beginn der Aufzeichnung."
          />
          <Stat
            label="E-Mails gesendet"
            value={num(sentInWindow)}
            hint={`Kampagne ${num(campaignActivity.sentInWindow)} · Marketing ${num(marketingSent)}`}
            info="Kampagnen-E-Mails an Shopify-Abonnent:innen plus persönliche Marketing-E-Mails aus dem Kundenbereich."
          />
          <Stat
            label="Marketing-Kontakte"
            value={num(marketing.eligible)}
            hint="bestätigt (DOI) · Liste öffnen"
            href={adminTabHref("kunden", { filter: "marketing" })}
            info="Kunden mit bestätigter Marketing-Einwilligung (Double-Opt-in). Der Link öffnet die Kundenliste mit diesem Filter."
          />
          <Stat
            label="Beraten, nicht gekauft"
            value={num(marketing.notPurchased)}
            hint="wichtigste Zielgruppe · Liste öffnen"
            href={adminTabHref("kunden", { filter: "no_purchase" })}
            info={
              <>
                Marketing-Kontakte, deren zwischengespeicherte Shopify-Kaufhistorie (täglich
                aktualisiert) keine Bestellung enthält.{" "}
                {marketing.unknown > 0
                  ? `${plural(marketing.unknown, "Kontakt", "Kontakte")} ohne geladene Kaufhistorie ${
                      marketing.unknown === 1 ? "ist" : "sind"
                    } nicht mitgezählt.`
                  : "Alle Kontakte haben eine geladene Kaufhistorie."}
              </>
            }
          />
          <Stat
            label="Ø Kosten / Beratung"
            value={consultationCount > 0 ? eur(aiCost?.avgCostPerConsultationEur ?? 0, 4) : "—"}
            hint={
              consultationCount > 0
                ? `${plural(consultationCount, "Beratung", "Beratungen")} · gesamt`
                : "noch keine Daten"
            }
            info="Mittlere KI-Kosten eines Chats (alle Modellaufrufe der Beratung), über den gesamten Aufzeichnungszeitraum."
          />
        </div>
      </Section>

      <Section
        title="Letzte Aktivität"
        info="Die jüngsten Versände (Kampagne und Marketing) und die zuletzt bestätigten Marketing-Einwilligungen."
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ActivityCard
            icon={<Mail className="size-4 text-muted-foreground" />}
            title="Zuletzt gesendet"
            empty="Noch keine E-Mails versendet."
            items={recentSends.map((s) => ({
              key: `${s.source}-${s.id}`,
              primary: s.email,
              secondary: s.subject ?? "(ohne Betreff)",
              badge: s.source === "campaign" ? "Kampagne" : "Marketing",
              meta: formatAdmin(s.sentAt, ADMIN_DATE),
            }))}
          />
          <ActivityCard
            icon={<UserCheck className="size-4 text-muted-foreground" />}
            title="Zuletzt bestätigt (DOI)"
            empty="Noch keine bestätigten Kontakte."
            items={snapshot.recentConfirmed.map((c) => ({
              key: `contact-${c.email}`,
              primary: c.email,
              secondary: "Marketing-Einwilligung bestätigt",
              meta: formatAdmin(c.confirmedAt, ADMIN_DATE),
            }))}
          />
        </div>
      </Section>
    </div>
  );
}

interface ActivityItem {
  key: string;
  primary: string;
  secondary: string;
  meta: string;
  badge?: string;
}

function ActivityCard({
  icon,
  title,
  empty,
  items,
}: {
  icon: React.ReactNode;
  title: string;
  empty: string;
  items: ActivityItem[];
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-2 flex items-center gap-2">
          {icon}
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
        {items.length === 0 ? (
          <EmptyState compact plain title={empty} />
        ) : (
          <ul className="divide-y divide-border/60">
            {items.map((it) => (
              <li key={it.key} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-foreground">{it.primary}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {it.secondary}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {it.badge && (
                    <StatusBadge tone={it.badge === "Kampagne" ? "accent" : "neutral"} dot={false}>
                      {it.badge}
                    </StatusBadge>
                  )}
                  <span className="text-xs tabular-nums text-muted-foreground">{it.meta}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
