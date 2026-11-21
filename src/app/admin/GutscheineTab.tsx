// „Gutscheine“ (server component) — Geschenkgutscheine from the shop and
// issued by hand (docs/GIFT_VOUCHERS.md; not the newsletter welcome code).
// Fetches once and hands plain props to the client GutscheineWorkspace:
//   - the list page for the URL filter (?status= incl. „achtung“ and „druck“
//     — „Druck offen“, ?quelle= shop | hand, ?q=, ?seite= — gutscheine-core.mjs),
//     newest first;
//   - the stats row (giftVoucherSummary) and the operator settings
//     (admin_settings 'gift_vouchers');
//   - the environment (switches, limits, presence of keys — never a value)
//     and the setup check WITHOUT Shopify — scopes and products load in the
//     browser (GET /api/admin/gutscheine/setup), so a slow Shopify never holds
//     up the screen.
// The selected voucher (?gutschein=) loads on demand in the workspace (GET
// /api/admin/gutscheine/item), also when it is not on the current page.
// Without a database or before migration 0083 the toolbar stays usable and
// a callout says why the list is empty.

import {
  getGiftVoucherSettings,
  giftVoucherSummary,
  giftVoucherTablesExist,
  listGiftVouchers,
  type GiftVoucherSummary,
} from "@/lib/gift-voucher-store";
import { DEFAULT_GIFT_VOUCHER_SETTINGS } from "@/lib/gift-voucher-settings.mjs";
import { GutscheineWorkspace } from "./lazy";
import { GUTSCHEINE_PAGE_SIZE, gutscheineStoreFilter, parseGutscheineFilter } from "./gutscheine/gutscheine-core.mjs";
import {
  gutscheinRow,
  gutscheineEnv,
  gutscheineSetup,
  isPrintOneHeld,
  manualGiftVoucherDesigns,
} from "./gutscheine/gutscheine-server";

const EMPTY_SUMMARY: GiftVoucherSummary = {
  soldCount30d: 0,
  soldCents30d: 0,
  issuedCount: 0,
  issuedCents: 0,
  openBalanceCents: 0,
  redeemedCents: 0,
  heldCount: 0,
  attentionCount: 0,
  openPrintJobs: 0,
  printReviewCount: 0,
  printOpenCount: 0,
  draftCount30d: 0,
};

export async function GutscheineTab({
  dbReady,
  initialId,
  status,
  quelle,
  q,
  seite,
}: {
  dbReady: boolean;
  initialId: number | null;
  status: string | undefined;
  quelle: string | undefined;
  q: string | undefined;
  seite: string | undefined;
}) {
  const filter = parseGutscheineFilter({ status, quelle, q, seite });
  const tablesExist = dbReady ? await giftVoucherTablesExist() : false;
  const ready = dbReady && tablesExist;
  const env = gutscheineEnv();
  // While print.one takes no card, its waiting cards are „Druck offen“ too.
  const printOneHeld = isPrintOneHeld(env);

  const [firstPage, summary, settings] = await Promise.all([
    ready ? listGiftVouchers(gutscheineStoreFilter(filter, { printOneHeld })) : Promise.resolve({ rows: [], total: 0 }),
    ready ? giftVoucherSummary({ printOneHeld }) : Promise.resolve({ ...EMPTY_SUMMARY }),
    dbReady ? getGiftVoucherSettings() : Promise.resolve({ ...DEFAULT_GIFT_VOUCHER_SETTINGS }),
  ]);
  // A page past the end (an old link, a narrowed filter) shows page 1 instead of nothing.
  let list = firstPage;
  let shownFilter = filter;
  if (ready && list.rows.length === 0 && list.total > 0 && filter.page > 1) {
    shownFilter = { ...filter, page: 1 };
    list = await listGiftVouchers(gutscheineStoreFilter(shownFilter, { printOneHeld }));
  }

  const initialSetup = gutscheineSetup({
    env,
    dbReady,
    tablesExist,
    salesEnabled: settings.salesEnabled,
    print: summary,
    shopify: null,
    checkedAt: null,
  });

  return (
    <GutscheineWorkspace
      dbReady={dbReady}
      tablesExist={tablesExist}
      rows={list.rows.map(gutscheinRow)}
      total={list.total}
      pageSize={GUTSCHEINE_PAGE_SIZE}
      filter={shownFilter}
      summary={summary}
      settings={settings}
      env={env}
      designs={manualGiftVoucherDesigns()}
      initialSetup={initialSetup}
      initialId={initialId}
    />
  );
}
