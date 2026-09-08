// /admin — the back-office dashboard. Auth is enforced by the proxy; this page
// is only ever reached with a valid admin session.
//
// Rendering model: exactly ONE screen is fetched + rendered on the SERVER per
// request — the one selected by ?tab= (see src/lib/admin-tabs.mjs for the
// registry and the URL contract). Switching screens is a soft navigation via
// the sidebar (AdminShell), so a screen never pays for another screen's data.
// Screen-specific URL state (Kunden filter preset, KPI range, Gespräche filter)
// is parsed here and handed to the screen.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE_NAME } from "@/lib/admin-auth";
import { parseAdminTab, type AdminTabKey } from "@/lib/admin-tabs.mjs";
import { isDbConfigured } from "@/lib/db";
import { listMarketingTargets, type MarketingTarget } from "@/lib/marketing-store";
import { getCampaignCounts } from "@/lib/campaign-store";
import { getQaCounts } from "@/lib/qa-store";
import { countUnmatchedInbound } from "@/lib/email-messages-store";
import { resolveKpiRange } from "@/lib/kpi-range";
import { parseAdminConversationFilter } from "@/lib/admin-conversations";
import { KundenTab } from "./KundenTab";
import { KpiTab } from "./KpiTab";
import { FeedbackTab } from "./FeedbackTab";
import { GespraecheTab } from "./GespraecheTab";
import { WissenTab } from "./WissenTab";
import { OverviewTab } from "./OverviewTab";
import { AnalyseTab } from "./AnalyseTab";
import { VerbesserungTab } from "./VerbesserungTab";
import { KampagneTab } from "./KampagneTab";
import { EinstellungenTab } from "./EinstellungenTab";
import { AdminShell, type AdminBadges } from "./AdminShell";
import { THEME_COOKIE, type Theme } from "./theme-config";

export const dynamic = "force-dynamic";

async function logoutAction(): Promise<void> {
  "use server";
  const store = await cookies();
  store.delete(ADMIN_COOKIE_NAME);
  redirect("/admin/login");
}

type SearchParams = { [key: string]: string | string[] | undefined };

const firstParam = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

/**
 * Navigation counts (queue sizes) shown next to the screen names. Three cheap
 * COUNT queries, all fail-soft — a missing count never breaks the page.
 */
async function loadBadges(dbReady: boolean): Promise<AdminBadges> {
  if (!dbReady) return {};
  const [campaign, qa, unmatched] = await Promise.all([
    getCampaignCounts(),
    getQaCounts(),
    countUnmatchedInbound(),
  ]);
  return {
    kampagne: campaign?.drafted ?? 0,
    wissen: qa.open,
    kunden: unmatched,
  };
}

async function renderScreen(tab: AdminTabKey, sp: SearchParams, dbReady: boolean) {
  switch (tab) {
    case "overview": {
      // The marketing targets back the Overview headline KPIs / "not purchased"
      // count — a Shopify-touching list, fetched only for this screen.
      const targets: MarketingTarget[] = dbReady ? await listMarketingTargets() : [];
      return <OverviewTab dbReady={dbReady} targets={targets} />;
    }
    case "kunden": {
      // Overview deep-links seed a Kunden filter preset via ?filter= (e.g.
      // "no_purchase", "marketing"); accept the legacy ?status= as a fallback.
      const initialFilter = firstParam(sp.filter) ?? firstParam(sp.status);
      return <KundenTab dbReady={dbReady} initialFilter={initialFilter} />;
    }
    case "kampagne":
      return <KampagneTab dbReady={dbReady} />;
    case "kpi": {
      // KPI date-range picker state lives in the URL so a refresh / copied link
      // keeps the window; resolveKpiRange validates + clamps it.
      const range = resolveKpiRange({
        kpiRange: firstParam(sp.kpiRange),
        kpiFrom: firstParam(sp.kpiFrom),
        kpiTo: firstParam(sp.kpiTo),
      });
      return <KpiTab dbReady={dbReady} range={range} />;
    }
    case "feedback":
      return <FeedbackTab dbReady={dbReady} />;
    case "gespraeche": {
      // Conversation inspector filter — date range / tier / has-error / page all
      // live in the URL (g*) so a refresh / copied link keeps the view.
      const filter = parseAdminConversationFilter({
        grange: firstParam(sp.grange),
        gfrom: firstParam(sp.gfrom),
        gto: firstParam(sp.gto),
        gtier: firstParam(sp.gtier),
        gerr: firstParam(sp.gerr),
        gcat: firstParam(sp.gcat),
        gqual: firstParam(sp.gqual),
        gq: firstParam(sp.gq),
        gpage: firstParam(sp.gpage),
      });
      return <GespraecheTab dbReady={dbReady} filter={filter} />;
    }
    case "wissen":
      return <WissenTab dbReady={dbReady} />;
    case "analyse":
      return <AnalyseTab dbReady={dbReady} />;
    case "verbesserung":
      return <VerbesserungTab dbReady={dbReady} />;
    case "einstellungen":
      return <EinstellungenTab dbReady={dbReady} />;
  }
}

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const tab = parseAdminTab(sp.tab);
  const dbReady = isDbConfigured();

  const store = await cookies();
  const themeCookie = store.get(THEME_COOKIE)?.value;
  const themeInitial: Theme | null =
    themeCookie === "dark" ? "dark" : themeCookie === "light" ? "light" : null;

  const [badges, screen] = await Promise.all([
    loadBadges(dbReady),
    renderScreen(tab, sp, dbReady),
  ]);

  return (
    <AdminShell tab={tab} themeInitial={themeInitial} logoutAction={logoutAction} badges={badges}>
      {screen}
    </AdminShell>
  );
}
