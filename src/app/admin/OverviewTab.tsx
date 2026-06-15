// OVERVIEW (Übersicht) — the default landing tab of the admin dashboard.
// Read-only at-a-glance: headline KPI cards + a small recent-activity feed +
// quick links that deep-link into the other tabs (pre-applying the Marketing
// status filter where it helps). Re-skinned onto the Session-A design system and
// reuses the KPI tab's Stat/Section cards (./ui/stat).
//
// EVERY number is aggregated from the EXISTING stores: the marketing targets the
// Marketing tab already fetched (passed in, so the eligible / "not purchased"
// numbers agree with that list and Shopify isn't re-queried), plus the same
// kpi-store / marketing-store / ai-usage-store getters the KPI tab uses. No new
// business logic, no new endpoints — nothing here sends or mutates.

import { ArrowRight, Mail, UserCheck } from "lucide-react";
import { getCoreMetrics } from "@/lib/kpi-store";
import { getAiCostMetrics } from "@/lib/ai-usage-store";
import { getMarketingActivity, type MarketingTarget } from "@/lib/marketing-store";
import {
  summarizeMarketingTargets,
  recentConfirmedContacts,
} from "@/lib/admin-overview.mjs";
import { Card, CardContent, Section, Stat } from "./ui";

const RECENT_LIMIT = 5;
const WINDOW_DAYS = 30;

function num(n: number): string {
  return n.toLocaleString("de-DE", { maximumFractionDigits: 0 });
}

// EUR with up to 4 decimals — per-consultation costs are fractions of a cent
// (same formatting the KPI tab uses).
function eur(n: number): string {
  return n.toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 4,
  });
}

function dateLabel(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("de-DE");
}

export async function OverviewTab({
  dbReady,
  targets,
}: {
  dbReady: boolean;
  targets: MarketingTarget[];
}) {
  if (!dbReady) {
    return (
      <Banner tone="warn">
        Keine Datenbank konfiguriert (DATABASE_URL) — die Übersicht kann nicht
        berechnet werden.
      </Banner>
    );
  }

  // Aggregation only — the heavy marketing/Shopify fetch (listMarketingTargets)
  // already ran once at the page level and is handed in via `targets`.
  const [core, aiCost, activity] = await Promise.all([
    getCoreMetrics(WINDOW_DAYS),
    getAiCostMetrics(),
    getMarketingActivity({ windowDays: WINDOW_DAYS, limit: RECENT_LIMIT }),
  ]);

  const marketing = summarizeMarketingTargets(targets);
  const recentContacts = recentConfirmedContacts(targets, RECENT_LIMIT);
  const recentSends = activity?.recentSends ?? [];
  const consultationCount = aiCost?.consultationCount ?? 0;
  const hasCost = consultationCount > 0;

  return (
    <div className="flex flex-col gap-10">
      <Section
        title="Überblick"
        subtitle="Aggregierte Kennzahlen aus den bestehenden Datenquellen — schreibgeschützt, nur Lesen."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Chats gesamt" value={core ? num(core.totalChats) : "—"} />
          <Stat
            label="Marketing-Kontakte"
            value={num(marketing.eligible)}
            hint="bestätigt (DOI), aktiv"
          />
          <Stat
            label="Beraten, nicht gekauft"
            value={num(marketing.notPurchased)}
            hint="wichtigste Zielgruppe"
          />
          <Stat
            label={`Gesendet (${WINDOW_DAYS} T.)`}
            value={activity ? num(activity.sentInWindow) : "—"}
            hint="Marketing-E-Mails"
          />
          <Stat
            label="Ø Kosten / Beratung"
            value={hasCost ? eur(aiCost?.avgCostPerConsultationEur ?? 0) : "—"}
            hint={hasCost ? `${num(consultationCount)} Beratungen` : "noch keine Daten"}
          />
        </div>
      </Section>

      <Section
        title="Schnellzugriff"
        subtitle="Direkt in die anderen Tabs springen — die Kunden-Links öffnen die Liste bereits gefiltert."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <QuickLink
            href="/admin?tab=kunden&filter=no_purchase"
            title={`${num(marketing.notPurchased)} beraten, nicht gekauft`}
            desc="Öffnet die Kundenliste, gefiltert auf „bestätigt + nicht gekauft“."
          />
          <QuickLink
            href="/admin?tab=kunden&filter=marketing"
            title={`${num(marketing.eligible)} Marketing-Kontakte`}
            desc="Alle bestätigten (DOI) Kontakte in der Kundenliste."
          />
          <QuickLink
            href="/admin?tab=kunden"
            title="Alle Kunden ansehen"
            desc="Profile, Sessions, Käufe & Marketing — gruppiert nach Person."
          />
          <QuickLink
            href="/admin?tab=kpi"
            title="KPIs ansehen"
            desc="Analytics, Marketing-Funnel & KI-Kosten."
          />
        </div>
      </Section>

      <Section
        title="Letzte Aktivität"
        subtitle="Die jüngsten Versände und bestätigten Kontakte aus den bestehenden Daten."
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ActivityCard
            icon={<Mail className="size-4 text-muted-foreground" />}
            title="Zuletzt gesendet"
            empty="Noch keine Marketing-E-Mails versendet."
            items={recentSends.map((s) => ({
              key: `send-${s.id}`,
              primary: s.email,
              secondary: s.subject ?? "(ohne Betreff)",
              meta: dateLabel(s.sentAt),
            }))}
          />
          <ActivityCard
            icon={<UserCheck className="size-4 text-muted-foreground" />}
            title="Zuletzt bestätigt (DOI)"
            empty="Noch keine bestätigten Kontakte."
            items={recentContacts.map((c) => ({
              key: `contact-${c.email}`,
              primary: c.email,
              secondary: "Marketing-Einwilligung bestätigt",
              meta: dateLabel(c.confirmedAt),
            }))}
          />
        </div>
      </Section>
    </div>
  );
}

// A quick link is a deep link (full navigation) into another tab — re-running the
// server re-seeds the active tab from ?tab= and the Marketing filter from
// ?status=, so the operator lands exactly where the card promised. App Router has
// no pages/ dir, so a plain <a> is the right primitive here.
function QuickLink({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <a
      href={href}
      className="group flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <span>
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{desc}</span>
      </span>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </a>
  );
}

interface ActivityItem {
  key: string;
  primary: string;
  secondary: string;
  meta: string;
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
          <p className="text-xs text-muted-foreground">{empty}</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {items.map((it) => (
              <li key={it.key} className="flex items-baseline justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-foreground">{it.primary}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {it.secondary}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{it.meta}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// Page-level banner (not-configured state), themed via tokens — mirrors the
// Banner used by the other tab bodies.
function Banner({ tone, children }: { tone: "warn" | "info"; children: React.ReactNode }) {
  const cls =
    tone === "warn"
      ? "border-warning/30 bg-warning/10 text-warning"
      : "border-info/30 bg-info/10 text-info";
  return <div className={`mb-4 rounded-lg border px-3.5 py-3 text-sm ${cls}`}>{children}</div>;
}
