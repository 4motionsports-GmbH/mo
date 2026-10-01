// Eingang (server-rendered) — the operator's start of the day: one ranked list
// of customer signals (lib/customer-signals.mjs via the hourly job) plus the
// system cards that used to be the Übersicht „Heute“ (drafts per campaign,
// open Wissen questions, running analyses, Shopify sync trouble, mail that
// matches no customer) and a compact 30-day strip. Items are decided in the
// client workspace; nothing here sends. docs/ADMIN_DASHBOARD.md §3.1.

import { listInboxItems, getInboxCounts, reopenDueSnoozed } from "@/lib/inbox-store";
import { listCampaigns } from "@/lib/campaigns-store";
import { getEingangSystemSnapshot } from "@/lib/admin-overview-store";
import { listUnmatchedInbound } from "@/lib/email-messages-store";
import { describeSyncProblems, getSyncHealth } from "@/lib/shopify-sync";
import { getOutboxStats } from "@/lib/shopify-outbox";
import { isShopifyCustomerSyncEnabled } from "@/lib/platform-flags.mjs";
import { EingangWorkspace } from "./lazy";
import { Callout } from "./ui";
import type { EingangSystemCards } from "./eingang/types";

export async function EingangTab({
  dbReady,
  initialItemId,
  initialStatus,
}: {
  dbReady: boolean;
  initialItemId: number | null;
  initialStatus: string | undefined;
}) {
  if (!dbReady) {
    return (
      <Callout tone="warning">Keine Datenbank konfiguriert (DATABASE_URL) — der Eingang kann nicht geladen werden.</Callout>
    );
  }
  const status = initialStatus === "zurueckgestellt" || initialStatus === "erledigt" ? initialStatus : "offen";
  // Snoozes that are due reopen before the list is read (the badge counts them as open already).
  await reopenDueSnoozed();
  const [items, counts, campaigns, snapshot, unmatched, health, outbox] = await Promise.all([
    listInboxItems({ status, limit: 300 }),
    getInboxCounts(),
    listCampaigns(),
    getEingangSystemSnapshot({ windowDays: 30 }),
    listUnmatchedInbound(),
    getSyncHealth(),
    getOutboxStats(),
  ]);

  const syncProblems = describeSyncProblems(health, outbox?.dead ?? 0, { syncEnabled: isShopifyCustomerSyncEnabled() });

  const system: EingangSystemCards = {
    campaigns: campaigns
      .filter((c) => c.status === "aktiv" && c.stats.drafted > 0)
      .map((c) => ({ id: c.id, slug: c.slug, name: c.name, drafted: c.stats.drafted })),
    qaOpen: snapshot?.qaOpen ?? 0,
    runningReports: snapshot?.runningReports ?? 0,
    runningImprovementRuns: snapshot?.runningImprovementRuns ?? 0,
    syncProblems,
    strip: {
      chats: snapshot?.chats ?? null,
      campaignMails: snapshot?.campaignMails ?? 0,
      newSubscribers: snapshot?.newSubscribers ?? 0,
    },
  };

  return (
    <EingangWorkspace
      items={items}
      counts={counts}
      status={status}
      system={system}
      unmatched={unmatched}
      initialItemId={initialItemId}
    />
  );
}
