// Props and payloads of the „Gutscheine“ screen (server GutscheineTab →
// client GutscheineWorkspace, and the /api/admin/gutscheine/* answers).
// Types only — the client imports nothing from the stores at run time.

import type {
  GiftVoucher,
  GiftVoucherDelivery,
  GiftVoucherPrintJob,
  GiftVoucherPrintStatus,
  GiftVoucherReason,
  GiftVoucherSettings,
  GiftVoucherSource,
  GiftVoucherStatus,
  GiftVoucherSummary,
  GiftVoucherMailStatus,
} from "@/lib/gift-voucher-store";
import type { GutscheineFilter, SetupCheck, SetupNotice } from "./gutscheine-core.mjs";

export type { GutscheineFilter, SetupCheck, SetupNotice };

/** One row of the list (only what the table shows). */
export interface GutscheinRow {
  id: number;
  number: string;
  source: GiftVoucherSource;
  reason: GiftVoucherReason;
  status: GiftVoucherStatus;
  attention: string | null;
  amountCents: number;
  balanceCents: number | null;
  recipientName: string | null;
  delivery: GiftVoucherDelivery;
  printStatus: GiftVoucherPrintStatus | null;
  mailStatus: GiftVoucherMailStatus;
  createdAt: string;
}

/**
 * The environment of the screen — switches, limits and whether a piece is
 * configured (presence only, never a value).
 */
export interface GutscheineEnv {
  /** GIFT_VOUCHERS_ENABLED. */
  enabled: boolean;
  shopifyConfigured: boolean;
  /** Resend (RESEND_API_KEY + CONTACT_FROM_EMAIL). */
  emailConfigured: boolean;
  /** BLOB_READ_WRITE_TOKEN (photos, print files for print.one). */
  blobConfigured: boolean;
  /** TOKEN_ENC_KEY decodes to a usable key (codes can be stored). */
  tokenKeyOk: boolean;
  /** GIFT_VOUCHER_PRINT_SENDS_APPROVED — the legal gate of print.one. */
  printSendsApproved: boolean;
  /** The provider in effect (print.one falls back to manual while not configured). */
  printProvider: "printone" | "manual";
  /** GIFT_VOUCHER_PRINT_PROVIDER as set. */
  configuredPrintProvider: "printone" | "manual";
  printOneConfigured: boolean;
  printCountries: string[];
  /** PRINTONE_CARD_COST_CENTS — the estimate shown before printing. */
  cardCostCents: number;
  limits: { minCents: number; maxCents: number; dailyLimitCents: number; adminMaxCents: number };
  validityYears: number;
  handles: { voucher: string; print: string };
}

/** The print job as the admin sees it (no asset token, no file paths). */
export type GutscheinPrintJobView = Omit<GiftVoucherPrintJob, "assetToken" | "assetOutsidePathname" | "assetInsidePathname"> & {
  hasAssets: boolean;
};

/** GET /api/admin/gutscheine/item — one voucher with its print job. */
export interface GutscheinDetail {
  voucher: GiftVoucher;
  printJob: GutscheinPrintJobView | null;
  /** The order in the Shopify admin, when derivable from SHOPIFY_STORE_DOMAIN. */
  orderUrl: string | null;
  /** The German name of the design („Klassisch“ …). */
  designName: string;
}

/** The setup check („Einrichtung“) and the notices above the list. */
export interface GutscheineSetup {
  checks: SetupCheck[];
  notices: SetupNotice[];
  /** Set once the Shopify checks ran (GET /api/admin/gutscheine/setup). */
  checkedAt: string | null;
}

export interface GutscheineWorkspaceProps {
  dbReady: boolean;
  /** Migration 0083 is applied. */
  tablesExist: boolean;
  rows: GutscheinRow[];
  total: number;
  pageSize: number;
  filter: GutscheineFilter;
  summary: GiftVoucherSummary;
  settings: GiftVoucherSettings;
  env: GutscheineEnv;
  /** The designs an operator can pick (not „Eigenes Foto“). */
  designs: Array<{ key: string; name: string }>;
  /** Setup without the Shopify checks (they load in the browser). */
  initialSetup: GutscheineSetup;
  initialId: number | null;
}
