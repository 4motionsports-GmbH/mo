// GET /api/admin/gutscheine/setup[?fresh=1] → { checks, notices, checkedAt }
//
// Gutscheine → „Einrichtung“: the setup check with Shopify — the app's scopes
// (write_gift_cards required; read_gift_card_transactions,
// write_merchant_managed_fulfillment_orders optional), the voucher product
// and the Premium-Karte add-on by their handles with their findings
// (describeGiftVoucherProductIssues: not found, a gift-card product, taxable
// or shipping variants …), the shop's gift-card issue limit — plus the
// database, the switches and which keys are set (presence only, never a
// value). The rows and the notices above the list come from the tested
// gutscheine-core.mjs buildGutscheineSetup. `fresh=1` re-reads the products
// (otherwise cached 10 minutes per instance). Read-only; never fails on
// Shopify (a failed check is a row „nicht prüfbar“).

import { guardAdminGet, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { reportError } from "@/lib/observability";
import { getGiftVoucherSettings, giftVoucherSummary, giftVoucherTablesExist } from "@/lib/gift-voucher-store";
import { gutscheineEnv, gutscheineSetup, loadSetupShopify } from "@/app/admin/gutscheine/gutscheine-server";

export const maxDuration = 30;

export async function GET(req: Request) {
  const blocked = await guardAdminGet();
  if (blocked) return blocked;
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  try {
    const env = gutscheineEnv();
    const dbReady = isDbConfigured();
    const tablesExist = dbReady ? await giftVoucherTablesExist() : false;
    const [settings, summary, shopify] = await Promise.all([
      getGiftVoucherSettings(),
      tablesExist ? giftVoucherSummary() : Promise.resolve(null),
      loadSetupShopify({ fresh }),
    ]);
    return adminJson(
      gutscheineSetup({
        env,
        dbReady,
        tablesExist,
        salesEnabled: settings.salesEnabled,
        openPrintJobs: summary?.openPrintJobs ?? 0,
        shopify,
        checkedAt: new Date().toISOString(),
      })
    );
  } catch (err) {
    reportError(err, { route: "api/admin/gutscheine/setup" });
    return adminJsonError("internal_error", "Die Einrichtung konnte nicht geprüft werden.", 500);
  }
}
