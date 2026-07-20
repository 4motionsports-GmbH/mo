// Campaign audience sync — pull Shopify's SUBSCRIBED marketing contacts into
// campaign_contacts (docs/CAMPAIGNS.md, Task A).
//
// Legal rules enforced here (the pure logic lives in campaign-sync-core.mjs):
//   1. Only marketingState = SUBSCRIBED customers are stored — the GraphQL
//      filter narrows the fetch, the per-node mapper is the guarantee.
//   2. Every synced email is cross-checked against OUR suppression store
//      (suppression_list + unsubscribed captures) in bulk; suppressed
//      addresses are stored as status='suppressed' (visible for audit, never
//      queued, re-checked again at send time).
//   3. A contact that vanished from Shopify's SUBSCRIBED set (unsubscribed on
//      the shop side) is marked suppressed on re-sync — never deleted.
//
// Idempotent (upsert on shopify_customer_id); triggered by the admin ("Sync"
// button) and by the daily cron (/api/cron/sync-campaign-audience) to catch
// Shopify-side unsubscribes. Fail-safe: on cron failure nothing is ever sent
// anyway without a human clicking Send.

import { fetchSubscribedCustomers } from "./shopify-customers";
import {
  mapCustomerToContact,
  planContactStatus,
} from "./campaign-sync-core.mjs";
import {
  getContactStatusesByShopifyIds,
  listSuppressedEmails,
  suppressContactsMissingFromSync,
  upsertCampaignContact,
  type CampaignContactStatus,
} from "./campaign-store";
import { isDbConfigured } from "./db";
import { reportError } from "./observability";

export type CampaignSyncResult =
  | { ok: false; reason: "not_configured"; message: string }
  | {
      ok: true;
      /** Subscribed customers fetched from Shopify (post-mapping). */
      total: number;
      /** Contacts stored for the first time this run. */
      created: number;
      /** Existing contacts refreshed. */
      updated: number;
      /** Contacts stored/kept as suppressed (local list or Shopify state),
       *  including rows that dropped out of Shopify's SUBSCRIBED set. */
      suppressed: number;
      /** Non-suppressed audience by opt-in level. */
      byOptInLevel: Record<string, number>;
    };

/**
 * Run one full audience sync. Returns "not_configured" when Shopify or the DB
 * is missing (the UI reports it; nothing crashes). Throws only on a hard
 * mid-run failure (transport/DB), which callers surface — a partial run is
 * safe: upserts are idempotent and nothing is sent without a human.
 */
export async function syncCampaignAudience(): Promise<CampaignSyncResult> {
  if (!isDbConfigured()) {
    return {
      ok: false,
      reason: "not_configured",
      message: "No database configured (DATABASE_URL).",
    };
  }
  const nodes = await fetchSubscribedCustomers();
  if (nodes === null) {
    return {
      ok: false,
      reason: "not_configured",
      message: "Shopify Admin API is not configured (SHOPIFY_* env vars).",
    };
  }

  // Map + drop everyone who must never be stored (not SUBSCRIBED / no email).
  const mapped = nodes
    .map((n) => mapCustomerToContact(n))
    .filter((c): c is NonNullable<typeof c> => c !== null);

  const [suppressedSet, existingStatuses] = await Promise.all([
    listSuppressedEmails(mapped.map((c) => c.email)),
    getContactStatusesByShopifyIds(mapped.map((c) => c.shopifyCustomerId)),
  ]);

  let created = 0;
  let updated = 0;
  let suppressed = 0;
  const byOptInLevel: Record<string, number> = {};

  for (const contact of mapped) {
    const current = existingStatuses.get(contact.shopifyCustomerId) ?? null;
    const status = planContactStatus(current, {
      shopifyEligible: true, // mapped ⇒ SUBSCRIBED
      locallySuppressed: suppressedSet.has(contact.email),
    }) as CampaignContactStatus;
    try {
      await upsertCampaignContact({ ...contact, status });
    } catch (err) {
      reportError(err, { route: "lib/campaign-sync", phase: "upsert" });
      throw err;
    }
    if (current === null) created++;
    else updated++;
    if (status === "suppressed") {
      suppressed++;
    } else {
      byOptInLevel[contact.optInLevel] = (byOptInLevel[contact.optInLevel] ?? 0) + 1;
    }
  }

  // Contacts that dropped out of Shopify's SUBSCRIBED set.
  suppressed += await suppressContactsMissingFromSync(
    mapped.map((c) => c.shopifyCustomerId)
  );

  return { ok: true, total: mapped.length, created, updated, suppressed, byOptInLevel };
}
