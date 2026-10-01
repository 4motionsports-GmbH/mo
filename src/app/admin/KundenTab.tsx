// Kunden screen (server-rendered): the whole customer base — every Shopify
// customer (mirror) and every Mo lead — as ONE server-side list. Search,
// views, filters, sort and page live in the URL (lib/admin-customer-filter.mjs)
// and are applied in SQL over customer_overview (lib/customer-list-store.ts),
// so tens of thousands of people never ship to the browser. A customer's
// full detail is loaded on demand (GET /api/admin/customers/detail).
// docs/ADMIN_DASHBOARD.md §3.3.

import { parseCustomerFilter } from "@/lib/admin-customer-filter.mjs";
import { getCustomerBaseSummary, listCustomers } from "@/lib/customer-list-store";
import { getSyncHealth } from "@/lib/shopify-sync";
import { isShopifyCustomerSyncEnabled } from "@/lib/platform-flags.mjs";
import { ARCHETYPE_META } from "@/lib/persona";
import { KundenWorkspace } from "./lazy";
import { Callout } from "./ui";

type SearchParams = { [key: string]: string | string[] | undefined };

export async function KundenTab({
  dbReady,
  searchParams,
  initialCustomerId,
}: {
  dbReady: boolean;
  searchParams: SearchParams;
  initialCustomerId?: number | null;
}) {
  if (!dbReady) {
    return (
      <Callout tone="warning">
        Keine Datenbank konfiguriert (DATABASE_URL) — es können keine Kunden geladen werden.
      </Callout>
    );
  }

  const filter = parseCustomerFilter(searchParams);
  const [page, summary, health] = await Promise.all([listCustomers(filter), getCustomerBaseSummary(), getSyncHealth()]);

  return (
    <KundenWorkspace
      filter={filter}
      items={page.items}
      total={page.total}
      summary={summary}
      importDone={health?.importDone ?? false}
      syncEnabled={isShopifyCustomerSyncEnabled()}
      personas={Object.values(ARCHETYPE_META)
        .filter((m) => m.id !== "unknown")
        .map((m) => ({ key: m.id, label: m.label }))}
      initialCustomerId={initialCustomerId ?? null}
    />
  );
}
