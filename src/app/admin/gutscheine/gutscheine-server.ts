// „Gutscheine“ — the server half of the screen (SERVER ONLY: imported by
// GutscheineTab.tsx and the /api/admin/gutscheine/* routes, never by a client
// component). Reads the environment (presence only), shapes list rows and the
// detail for the browser (no code, no asset token, no file paths) and runs
// the setup check against Shopify. The rules are in gutscheine-core.mjs.

import { giftVoucherFlagSummary } from "@/lib/gift-voucher-flags.mjs";
import { isShopifyConfigured } from "@/lib/shopify";
import { isEmailConfigured } from "@/lib/email";
import { isGiftVoucherBlobConfigured } from "@/lib/gift-voucher-blob";
import { giftVoucherPrintProvider } from "@/lib/gift-voucher-print";
import { GIFT_VOUCHER_DESIGNS, giftVoucherDesign } from "@/lib/gift-voucher-designs.mjs";
import {
  checkGiftVoucherScopes,
  getGiftCardIssueLimitCents,
  resolveGiftVoucherProducts,
  type GiftVoucherProductInfo,
} from "@/lib/shopify-gift-cards";
import { describeGiftVoucherProductIssues } from "@/lib/shopify-gift-cards-core.mjs";
import {
  getGiftVoucher,
  getGiftVoucherPrintJobForVoucher,
  prepareGiftVoucherCode,
  type GiftVoucherListRow,
  type GiftVoucherPrintJob,
} from "@/lib/gift-voucher-store";
import { reportError } from "@/lib/observability";
import { buildGutscheineSetup, shopifyAdminOrderUrl, type SetupProduct, type SetupShopify } from "./gutscheine-core.mjs";
import type { GutscheinDetail, GutscheinPrintJobView, GutscheinRow, GutscheineEnv, GutscheineSetup } from "./types";

// A syntactically valid dummy code: encrypting it tells whether TOKEN_ENC_KEY
// is usable without touching a real code (nothing is stored or logged).
const KEY_PROBE_CODE = "MOKEYPROBE234567";

/** The screen's environment: switches, limits, what is configured (never a value). */
export function gutscheineEnv(): GutscheineEnv {
  const flags = giftVoucherFlagSummary();
  return {
    enabled: flags.enabled,
    shopifyConfigured: isShopifyConfigured(),
    emailConfigured: isEmailConfigured(),
    blobConfigured: isGiftVoucherBlobConfigured(),
    tokenKeyOk: prepareGiftVoucherCode(KEY_PROBE_CODE).ok,
    printSendsApproved: flags.printSendsApproved,
    printProvider: giftVoucherPrintProvider(),
    configuredPrintProvider: flags.printProvider,
    printOneConfigured: flags.printOne.configured,
    printCountries: [...flags.printCountries],
    cardCostCents: flags.printOne.cardCostCents,
    limits: { ...flags.limits },
    validityYears: flags.validityYears,
    handles: { ...flags.productHandles },
  };
}

/** The designs an operator can pick by hand (no „Eigenes Foto“). */
export function manualGiftVoucherDesigns(): Array<{ key: string; name: string }> {
  return GIFT_VOUCHER_DESIGNS.filter((d) => !d.photo && d.key !== "photo").map((d) => ({ key: d.key, name: d.name.de }));
}

/** A list row for the browser — only what the table shows. */
export function gutscheinRow(r: GiftVoucherListRow): GutscheinRow {
  return {
    id: r.id,
    number: r.number,
    source: r.source,
    reason: r.reason,
    status: r.status,
    attention: r.attention,
    amountCents: r.amountCents,
    balanceCents: r.balanceCents,
    recipientName: r.recipientName,
    delivery: r.delivery,
    printStatus: r.printStatus,
    mailStatus: r.mailStatus,
    createdAt: r.createdAt,
  };
}

/** The print job without its bearer asset token and storage paths. */
export function printJobView(job: GiftVoucherPrintJob): GutscheinPrintJobView {
  const { assetToken, assetOutsidePathname, assetInsidePathname, ...rest } = job;
  void assetToken;
  return { ...rest, hasAssets: Boolean(assetOutsidePathname && assetInsidePathname) };
}

/** One voucher with its print job, the Shopify order link and the design name — or null. */
export async function loadGutscheinDetail(id: number): Promise<GutscheinDetail | null> {
  const voucher = await getGiftVoucher(id);
  if (!voucher) return null;
  const job = await getGiftVoucherPrintJobForVoucher(id);
  return {
    voucher,
    printJob: job ? printJobView(job) : null,
    orderUrl: shopifyAdminOrderUrl(process.env.SHOPIFY_STORE_DOMAIN, voucher.shopifyOrderId),
    designName: giftVoucherDesign(voucher.designKey)?.name.de ?? voucher.designKey,
  };
}

function setupProduct(p: GiftVoucherProductInfo | null): SetupProduct | null {
  if (!p) return null;
  return {
    handle: p.handle,
    title: p.title,
    status: p.status,
    isGiftCard: p.isGiftCard,
    variants: p.variants.map((v) => ({
      title: v.title,
      priceCents: v.priceCents,
      taxable: v.taxable,
      requiresShipping: v.requiresShipping,
    })),
  };
}

/**
 * The Shopify half of the setup check: scopes, the two products (with their
 * findings) and the shop's gift-card issue limit. `printOffered` = the shop
 * can sell the Premium-Karte (isGiftVoucherPrintOffered) — a missing print
 * product is an error then. Never throws — a failed check is reported as
 * „nicht prüfbar“.
 */
export async function loadSetupShopify(opts: { fresh?: boolean; printOffered?: boolean } = {}): Promise<SetupShopify | null> {
  if (!isShopifyConfigured()) return null;
  try {
    const [scopes, products, issueLimitCents] = await Promise.all([
      checkGiftVoucherScopes(),
      resolveGiftVoucherProducts({ fresh: opts.fresh === true }),
      getGiftCardIssueLimitCents(),
    ]);
    const handles = giftVoucherFlagSummary().productHandles;
    return {
      scopes: scopes.ok
        ? { ok: true, missing: [...scopes.missing], optionalMissing: [...(scopes.optionalMissing ?? [])] }
        : { ok: false, message: scopes.message },
      products: products.ok
        ? {
            ok: true,
            voucher: setupProduct(products.voucher),
            print: setupProduct(products.print),
            issues: describeGiftVoucherProductIssues({
              voucher: products.voucher,
              print: products.print,
              handles,
              printOffered: opts.printOffered === true,
            }),
          }
        : { ok: false, message: products.message },
      issueLimitCents,
    };
  } catch (err) {
    reportError(err, { route: "admin/gutscheine", phase: "setupShopify" });
    return {
      scopes: { ok: false, message: "Prüfung fehlgeschlagen." },
      products: { ok: false, message: "Prüfung fehlgeschlagen." },
      issueLimitCents: null,
    };
  }
}

/** The full setup check (env + database + Shopify). */
export function gutscheineSetup(input: {
  env: GutscheineEnv;
  dbReady: boolean;
  tablesExist: boolean;
  salesEnabled: boolean;
  openPrintJobs: number;
  shopify: SetupShopify | null;
  checkedAt: string | null;
}): GutscheineSetup {
  const { env } = input;
  const { checks, notices } = buildGutscheineSetup({
    dbReady: input.dbReady,
    tablesExist: input.tablesExist,
    enabled: env.enabled,
    salesEnabled: input.salesEnabled,
    tokenKeyOk: env.tokenKeyOk,
    emailConfigured: env.emailConfigured,
    blobConfigured: env.blobConfigured,
    shopifyConfigured: env.shopifyConfigured,
    printSendsApproved: env.printSendsApproved,
    printProvider: env.printProvider,
    configuredPrintProvider: env.configuredPrintProvider,
    printOneConfigured: env.printOneConfigured,
    openPrintJobs: input.openPrintJobs,
    handles: env.handles,
    limits: env.limits,
    validityYears: env.validityYears,
    printCountries: env.printCountries,
    cardCostCents: env.cardCostCents,
    shopify: input.shopify,
  });
  return { checks, notices, checkedAt: input.checkedAt };
}
