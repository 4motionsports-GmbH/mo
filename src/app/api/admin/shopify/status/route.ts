// GET /api/admin/shopify/status → { health, runs, outbox, flags }
//
// Einstellungen → Shopify-Abgleich: import state, last reconcile and webhook,
// the outbox (write-backs to Shopify) and the flags. Pure DB.

import { guardAdminGet, adminJson } from "@/lib/admin-api";
import { getSyncHealth, listSyncRuns } from "@/lib/shopify-sync";
import { getOutboxStats } from "@/lib/shopify-outbox";
import { shopifySyncFlags } from "@/lib/shopify-sync-flags";

export async function GET() {
  const blocked = await guardAdminGet();
  if (blocked) return blocked;
  const [health, runs, outbox] = await Promise.all([getSyncHealth(), listSyncRuns(8), getOutboxStats()]);
  return adminJson({ health, runs, outbox, flags: shopifySyncFlags() });
}
