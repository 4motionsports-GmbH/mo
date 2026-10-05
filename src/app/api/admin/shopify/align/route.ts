// POST /api/admin/shopify/align → { queued }
//
// Erstabgleich (docs/archive/CUSTOMER_PLATFORM_PLAN.md §7.7): queue a Shopify
// customer (with the consent) for every Mo-only subscriber — people who
// confirmed our double opt-in before the one consent and have no Shopify
// customer. Einstellungen → Shopify-Abgleich, behind a confirm. The outbox
// sends them while SHOPIFY_CONSENT_WRITEBACK is on.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { queueMoOnlySubscribers } from "@/lib/consent-alignment";
import { getSyncHealth } from "@/lib/shopify-sync";

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  const health = await getSyncHealth();
  if (!health?.importDone) {
    return adminJsonError("import_pending", "Erst den Shopify-Kundenstamm übernehmen.", 409);
  }
  const queued = await queueMoOnlySubscribers();
  if (queued === null) return adminJsonError("internal_error", "Abgleich konnte nicht vorgemerkt werden.", 500);
  return adminJson({ queued });
}
