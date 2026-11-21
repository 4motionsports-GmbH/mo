// Geschenkgutscheine — data access (migration 0083; rules in the pure, tested
// gift-voucher-core.mjs; docs/GIFT_VOUCHERS.md).
//
// Tables: gift_voucher_drafts (what a customer designed before paying),
// gift_vouchers (one row per voucher unit, shop or admin), and
// gift_voucher_print_jobs (the Premium-Karte of a voucher). Settings live in
// admin_settings key 'gift_vouchers' (no migration of their own).
//
// House rules, as in every store:
//   · every function takes `sql = getSql()` last, answers a null-safe fallback
//     without a database, wraps its work in try/catch and reports through
//     reportError({ route, phase }) — context never carries a code, a token,
//     a name or an e-mail address;
//   · a missing table (SQLSTATE 42P01, before migration 0083) is quiet on
//     reads and gives the fallback;
//   · Neon templates are not composable — every query is spelled out. Voucher
//     and print-job rows are read as `to_jsonb(row)` (minus code_enc), so the
//     long column list is not repeated in every query.
//
// The code: `prepareGiftVoucherCode` encrypts a code with TOKEN_ENC_KEY
// (lib/token-crypto.ts, AES-256-GCM) — stored as BYTEA through base64 at the
// SQL boundary (decode/encode, as customer-oauth-store.ts does) — and derives
// the lookup hash and the last four characters. It is stored BEFORE the
// Shopify call (markGiftVoucherIssuing), so a lost response can be resolved
// by looking the card up by its code. encryptToken/decryptToken THROW without
// the key; here that becomes a typed failure.
//
// The lease (locked_until, 3 minutes): claimDueGiftVouchers /
// claimGiftVoucher take it, insertAdminGiftVoucher creates a row already
// leased to its creator. The mark* functions of the issuing steps release it,
// EXCEPT markGiftVoucherIssued — the flow that issued a voucher keeps it
// while it mails and prints, then calls releaseGiftVoucherLock (or lets it
// expire), so the sweep does not mail the same voucher at the same moment.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { decryptToken, encryptToken } from "./token-crypto";
import {
  GIFT_VOUCHER_STATUSES,
  PRINT_JOB_FINAL_STATUSES,
  PRINT_JOB_STATUSES,
  canAdvancePrintJobStatus,
  formatGiftVoucherNumber,
  giftVoucherAddressFromJson,
  giftVoucherAddressToJson,
  giftVoucherCodeHash,
  giftVoucherCodeLast4,
  giftVoucherPhotoIdFromPathname,
  giftVoucherPhotoPathname,
  isGiftVoucherStatus,
  isValidDraftToken,
  newOpaqueToken,
  normalizeGiftVoucherCode,
  parseGiftVoucherNumber,
} from "./gift-voucher-core.mjs";
import {
  DEFAULT_GIFT_VOUCHER_SETTINGS,
  GIFT_VOUCHER_SETTINGS_KEY,
  parseGiftVoucherSettings,
  type GiftVoucherSettings,
} from "./gift-voucher-settings.mjs";

export type { GiftVoucherSettings };

// ── types ────────────────────────────────────────────────────────────────────

export type GiftVoucherStatus = "pending" | "held" | "issuing" | "issued" | "failed" | "rejected" | "cancelled" | "deactivated";
export type GiftVoucherSource = "shop" | "admin";
export type GiftVoucherReason = "verkauf" | "kulanz" | "marketing" | "gewinnspiel" | "firmengeschenk" | "sonstiges";
export type GiftVoucherDelivery = "pdf" | "print" | "email";
export type GiftVoucherMailStatus = "none" | "pending" | "sent" | "failed" | "skipped";
export type GiftVoucherPrintStatus =
  | "review"
  | "queued"
  | "submitting"
  | "submitted"
  | "printing"
  | "sent"
  | "failed"
  | "cancelled"
  | "done";
export type GiftVoucherPrintProvider = "printone" | "manual";

export interface GiftVoucherAddress {
  name: string;
  addressLine1: string;
  addressLine2: string | null;
  postalCode: string;
  city: string;
  country: string;
}

/** The stored snake_case shape (customers.postal_address, validatePostalAddress output). */
export interface GiftVoucherAddressJson {
  name: string;
  address_line_1: string;
  address_line_2?: string | null;
  postal_code: string;
  city: string;
  country: string;
}

/** Store inputs accept either shape. */
export type GiftVoucherAddressInput = GiftVoucherAddress | GiftVoucherAddressJson;

export interface GiftVoucherDraft {
  id: number;
  token: string;
  designKey: string;
  amountCents: number | null;
  recipientName: string | null;
  senderName: string | null;
  message: string | null;
  photoPathname: string | null;
  delivery: "pdf" | "print";
  address: GiftVoucherAddress | null;
  locale: "de" | "en";
  createdAt: string;
  orderedAt: string | null;
}

export interface GiftVoucher {
  id: number;
  /** G-<Berlin year>-<id 5 digits> — derived, no column. */
  number: string;
  source: GiftVoucherSource;
  reason: GiftVoucherReason;
  status: GiftVoucherStatus;
  holdReason: string | null;
  attention: string | null;
  amountCents: number;
  currency: string;
  expiresOn: string | null;
  codeLast4: string | null;
  hasCode: boolean;
  shopifyGiftCardId: string | null;
  shopifyOrderId: string | null;
  shopifyOrderName: string | null;
  shopifyLineItemId: string | null;
  unitIndex: number;
  shopifyCustomerId: string | null;
  /** The linked customer — the stored link, else the customer with this Shopify id. */
  customerId: number | null;
  buyerEmail: string | null;
  buyerName: string | null;
  draftId: number | null;
  designKey: string;
  recipientName: string | null;
  senderName: string | null;
  message: string | null;
  photoPathname: string | null;
  delivery: GiftVoucherDelivery;
  recipientEmail: string | null;
  locale: "de" | "en";
  mailStatus: GiftVoucherMailStatus;
  mailAttempts: number;
  mailNextAttemptAt: string | null;
  mailedAt: string | null;
  balanceCents: number | null;
  balanceCheckedAt: string | null;
  issuedAt: string | null;
  deactivatedAt: string | null;
  deactivationReason: string | null;
  fulfilledAt: string | null;
  createdBy: string | null;
  adminNote: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  /** Set once the retention anonymised the voucher (texts, names, e-mails gone). */
  personalDataPurgedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A list row: the voucher plus the status of its print job (if any). */
export interface GiftVoucherListRow extends GiftVoucher {
  printStatus: GiftVoucherPrintStatus | null;
}

export interface GiftVoucherPrintJob {
  id: number;
  voucherId: number;
  provider: GiftVoucherPrintProvider;
  status: GiftVoucherPrintStatus;
  address: GiftVoucherAddress | null;
  providerOrderId: string | null;
  providerStatus: string | null;
  assetToken: string | null;
  assetOutsidePathname: string | null;
  assetInsidePathname: string | null;
  costCents: number | null;
  paidLineItemId: string | null;
  error: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  submittedAt: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewGiftVoucherDraft {
  designKey: string;
  amountCents?: number | null;
  recipientName?: string | null;
  senderName?: string | null;
  message?: string | null;
  /** The uploaded photo (validateGiftVoucherDraftInput's photoId) … */
  photoId?: string | null;
  /** … or its pathname directly. */
  photoPathname?: string | null;
  delivery: "pdf" | "print";
  address?: GiftVoucherAddressInput | null;
  locale?: "de" | "en";
}

/** One unit of a shop order line (insertShopGiftVouchers). */
export interface NewShopGiftVoucher {
  amountCents: number;
  currency?: string;
  shopifyOrderId: string;
  shopifyOrderName: string | null;
  shopifyLineItemId: string;
  unitIndex: number;
  shopifyCustomerId: string | null;
  /** Known customer row; without it the customer with shopifyCustomerId is linked. */
  customerId?: number | null;
  buyerEmail: string | null;
  buyerName: string | null;
  draftId: number | null;
  designKey: string;
  recipientName: string | null;
  senderName: string | null;
  message: string | null;
  photoPathname: string | null;
  delivery: "pdf" | "print";
  locale: "de" | "en";
  /** Default 'pending'; 'held' with holdReason when the order is held at once. */
  status?: "pending" | "held";
  holdReason?: string | null;
  attention?: string | null;
  /** Default 'pending' when there is a buyer e-mail, else 'skipped'. */
  mailStatus?: GiftVoucherMailStatus;
}

export interface NewAdminGiftVoucher {
  amountCents: number;
  reason: Exclude<GiftVoucherReason, "verkauf">;
  designKey: string;
  recipientName: string | null;
  senderName: string | null;
  message: string | null;
  photoPathname?: string | null;
  delivery: GiftVoucherDelivery;
  recipientEmail: string | null;
  locale?: "de" | "en";
  adminNote: string | null;
  /** The operator (audit name). */
  createdBy: string;
}

export interface GiftVoucherListFilter {
  status?: GiftVoucherStatus | null;
  source?: GiftVoucherSource | null;
  /** Only vouchers with an attention flag („Achtung“). */
  attention?: boolean;
  q?: string | null;
  page?: number;
  pageSize?: number;
}

export interface GiftVoucherSummary {
  soldCount30d: number;
  soldCents30d: number;
  issuedCount: number;
  issuedCents: number;
  openBalanceCents: number;
  redeemedCents: number;
  heldCount: number;
  attentionCount: number;
  openPrintJobs: number;
  draftCount30d: number;
}

export interface GiftVoucherPurgeResult {
  /** Drafts deleted. */
  drafts: number;
  /** Recipient addresses cleared (finished print jobs, ordered drafts, anonymised vouchers' jobs). */
  addresses: number;
  /** Vouchers anonymised. */
  anonymised: number;
  /** Photo files no row references any more — the caller deletes them from Blob. */
  blobPathnames: string[];
}

// ── helpers ──────────────────────────────────────────────────────────────────

const ROUTE = "lib/gift-voucher-store";
const ERROR_MAX = 500;
const NOTE_MAX = 1000;

type Row = Record<string, unknown>;

/** SQLSTATE 42P01 (undefined_table) on the error or one level down. */
function isMissingTable(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  return e?.code === "42P01" || e?.cause?.code === "42P01";
}

function report(err: unknown, phase: string): void {
  reportError(err, { route: ROUTE, phase });
}

/** Report unless the table is missing (reads before migration 0083). */
function reportRead(err: unknown, phase: string): void {
  if (!isMissingTable(err)) report(err, phase);
}

const iso = (v: unknown): string | null => {
  if (v == null || v === "") return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const text = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const dateOnly = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.slice(0, 10) : null;
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const toIsoParam = (v: Date | string | null | undefined): string | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const cut = (s: string | null | undefined, max: number): string | null =>
  typeof s === "string" && s.length > 0 ? s.slice(0, max) : null;
const positiveInt = (v: unknown, fallback: number, max: number): number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? Math.min(v, max) : fallback;
const isSha256Hex = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

const REASONS: readonly GiftVoucherReason[] = ["verkauf", "kulanz", "marketing", "gewinnspiel", "firmengeschenk", "sonstiges"];
const DELIVERIES: readonly GiftVoucherDelivery[] = ["pdf", "print", "email"];
const MAIL_STATUSES: readonly GiftVoucherMailStatus[] = ["none", "pending", "sent", "failed", "skipped"];
const VOUCHER_STATUSES = GIFT_VOUCHER_STATUSES as readonly GiftVoucherStatus[];
const PRINT_STATUSES = PRINT_JOB_STATUSES as readonly GiftVoucherPrintStatus[];
const FINAL_PRINT_STATUSES = [...PRINT_JOB_FINAL_STATUSES] as string[];

function addressFromJson(v: unknown): GiftVoucherAddress | null {
  return giftVoucherAddressFromJson(v);
}

/** Either address shape → the stored JSON text (or null). */
function addressJsonText(a: GiftVoucherAddressInput | null | undefined): string | null {
  const json = a ? giftVoucherAddressToJson(a) : null;
  return json ? JSON.stringify(json) : null;
}

/** A pathname under gift-voucher-photos/, or null. */
function photoPathOrNull(pathname: string | null | undefined, photoId?: string | null): string | null {
  if (pathname) return giftVoucherPhotoIdFromPathname(pathname) ? pathname : null;
  return photoId ? giftVoucherPhotoPathname(photoId) : null;
}

function mapVoucher(row: Row): GiftVoucher {
  const r = (row.j ?? {}) as Row;
  const id = Number(r.id);
  const createdAt = iso(r.created_at) ?? new Date(0).toISOString();
  return {
    id,
    number: formatGiftVoucherNumber(id, createdAt) ?? `G-${String(id).padStart(5, "0")}`,
    source: r.source === "admin" ? "admin" : "shop",
    reason: pick(r.reason, REASONS, "verkauf"),
    status: pick(r.status, VOUCHER_STATUSES, "pending"),
    holdReason: text(r.hold_reason),
    attention: text(r.attention),
    amountCents: Number(r.amount_cents ?? 0),
    currency: text(r.currency) ?? "EUR",
    expiresOn: dateOnly(r.expires_on),
    codeLast4: text(r.code_last4),
    hasCode: row.has_code === true,
    shopifyGiftCardId: text(r.shopify_gift_card_id),
    shopifyOrderId: text(r.shopify_order_id),
    shopifyOrderName: text(r.shopify_order_name),
    shopifyLineItemId: text(r.shopify_line_item_id),
    unitIndex: Number(r.unit_index ?? 0),
    shopifyCustomerId: text(r.shopify_customer_id),
    customerId: num(row.resolved_customer_id ?? r.customer_id),
    buyerEmail: text(r.buyer_email),
    buyerName: text(r.buyer_name),
    draftId: num(r.draft_id),
    designKey: text(r.design_key) ?? "classic",
    recipientName: text(r.recipient_name),
    senderName: text(r.sender_name),
    message: text(r.message),
    photoPathname: text(r.photo_pathname),
    delivery: pick(r.delivery, DELIVERIES, "pdf"),
    recipientEmail: text(r.recipient_email),
    locale: r.locale === "en" ? "en" : "de",
    mailStatus: pick(r.mail_status, MAIL_STATUSES, "none"),
    mailAttempts: Number(r.mail_attempts ?? 0),
    mailNextAttemptAt: iso(r.mail_next_attempt_at),
    mailedAt: iso(r.mailed_at),
    balanceCents: num(r.balance_cents),
    balanceCheckedAt: iso(r.balance_checked_at),
    issuedAt: iso(r.issued_at),
    deactivatedAt: iso(r.deactivated_at),
    deactivationReason: text(r.deactivation_reason),
    fulfilledAt: iso(r.fulfilled_at),
    createdBy: text(r.created_by),
    adminNote: text(r.admin_note),
    attempts: Number(r.attempts ?? 0),
    nextAttemptAt: iso(r.next_attempt_at),
    lastError: text(r.last_error),
    personalDataPurgedAt: iso(r.personal_data_purged_at),
    createdAt,
    updatedAt: iso(r.updated_at) ?? createdAt,
  };
}

function mapListRow(row: Row): GiftVoucherListRow {
  return { ...mapVoucher(row), printStatus: row.print_status == null ? null : pick(row.print_status, PRINT_STATUSES, "queued") };
}

function mapDraft(row: Row): GiftVoucherDraft {
  const r = (row.j ?? {}) as Row;
  const createdAt = iso(r.created_at) ?? new Date(0).toISOString();
  return {
    id: Number(r.id),
    token: String(r.token ?? ""),
    designKey: text(r.design_key) ?? "classic",
    amountCents: num(r.amount_cents),
    recipientName: text(r.recipient_name),
    senderName: text(r.sender_name),
    message: text(r.message),
    photoPathname: text(r.photo_pathname),
    delivery: r.delivery === "print" ? "print" : "pdf",
    address: addressFromJson(r.recipient_postal_address),
    locale: r.locale === "en" ? "en" : "de",
    createdAt,
    orderedAt: iso(r.ordered_at),
  };
}

function mapPrintJob(row: Row): GiftVoucherPrintJob {
  const r = (row.j ?? {}) as Row;
  const createdAt = iso(r.created_at) ?? new Date(0).toISOString();
  return {
    id: Number(r.id),
    voucherId: Number(r.voucher_id),
    provider: r.provider === "manual" ? "manual" : "printone",
    status: pick(r.status, PRINT_STATUSES, "queued"),
    address: addressFromJson(r.recipient_postal_address),
    providerOrderId: text(r.provider_order_id),
    providerStatus: text(r.provider_status),
    assetToken: text(r.asset_token),
    assetOutsidePathname: text(r.asset_outside_pathname),
    assetInsidePathname: text(r.asset_inside_pathname),
    costCents: num(r.cost_cents),
    paidLineItemId: text(r.paid_line_item_id),
    error: text(r.error),
    attempts: Number(r.attempts ?? 0),
    nextAttemptAt: iso(r.next_attempt_at),
    submittedAt: iso(r.submitted_at),
    sentAt: iso(r.sent_at),
    createdAt,
    updatedAt: iso(r.updated_at) ?? createdAt,
  };
}

/**
 * Do the voucher tables exist (migration 0083 applied)? Erasure and merge use
 * it to leave the tables out while they do not exist yet. An unknown answer
 * (a database error) counts as YES — then the statements run and a real
 * problem fails the transaction honestly instead of being skipped.
 */
export async function giftVoucherTablesExist(sql: Sql | null = getSql()): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = (await sql`
      SELECT to_regclass('gift_vouchers') IS NOT NULL
         AND to_regclass('gift_voucher_print_jobs') IS NOT NULL AS ok
    `) as Array<{ ok: boolean }>;
    return rows[0]?.ok === true;
  } catch (err) {
    report(err, "tablesExist");
    return true;
  }
}

// ── the code ─────────────────────────────────────────────────────────────────

export type PreparedGiftVoucherCode =
  | { ok: true; codeEncB64: string; codeHash: string; codeLast4: string }
  | { ok: false; reason: "invalid_code" | "no_key" };

/**
 * Encrypt a code for storage and derive its lookup hash and last four. Fails
 * with `no_key` without a usable TOKEN_ENC_KEY (encryptToken throws). Never
 * throws, never reports the code.
 */
export function prepareGiftVoucherCode(code: string): PreparedGiftVoucherCode {
  const normalized = normalizeGiftVoucherCode(code);
  const codeLast4 = normalized ? giftVoucherCodeLast4(normalized) : null;
  if (!normalized || !codeLast4) return { ok: false, reason: "invalid_code" };
  let codeHash: string | null;
  try {
    codeHash = giftVoucherCodeHash(normalized);
  } catch (err) {
    report(err, "hashCode");
    return { ok: false, reason: "invalid_code" };
  }
  if (!codeHash) return { ok: false, reason: "invalid_code" };
  try {
    return { ok: true, codeEncB64: encryptToken(normalized).toString("base64"), codeHash, codeLast4 };
  } catch {
    // encryptToken throws without a usable TOKEN_ENC_KEY (the message names
    // the variable, never the code).
    return { ok: false, reason: "no_key" };
  }
}

/** The decrypted code of a voucher, or null (no code, no key, tampered, no DB). Never throws. */
export async function getGiftVoucherCode(id: number, sql: Sql | null = getSql()): Promise<string | null> {
  if (!sql) return null;
  let b64: string | null = null;
  try {
    const rows = (await sql`
      SELECT encode(code_enc, 'base64') AS code_enc FROM gift_vouchers WHERE id = ${id} AND code_enc IS NOT NULL
    `) as Array<{ code_enc: string | null }>;
    b64 = rows[0]?.code_enc ?? null;
  } catch (err) {
    reportRead(err, "getCode");
    return null;
  }
  if (!b64) return null;
  try {
    return decryptToken(Buffer.from(b64, "base64"));
  } catch (err) {
    // No key, wrong key or a tampered value — the message carries no code.
    report(err, "decryptCode");
    return null;
  }
}

// ── drafts ───────────────────────────────────────────────────────────────────

/** Store a storefront draft (validated by validateGiftVoucherDraftInput) → its new token. */
export async function createGiftVoucherDraft(
  input: NewGiftVoucherDraft,
  sql: Sql | null = getSql()
): Promise<{ token: string } | null> {
  if (!sql) return null;
  try {
    const token = newOpaqueToken(24);
    const rows = (await sql`
      INSERT INTO gift_voucher_drafts
        (token, design_key, amount_cents, recipient_name, sender_name, message, photo_pathname,
         delivery, recipient_postal_address, locale)
      VALUES
        (${token}, ${input.designKey}, ${input.amountCents ?? null}, ${input.recipientName ?? null},
         ${input.senderName ?? null}, ${input.message ?? null}, ${photoPathOrNull(input.photoPathname, input.photoId)},
         ${input.delivery === "print" ? "print" : "pdf"},
         ${input.delivery === "print" ? addressJsonText(input.address) : null}::jsonb,
         ${input.locale === "en" ? "en" : "de"})
      RETURNING token
    `) as Array<{ token: string }>;
    return rows[0]?.token ? { token: rows[0].token } : null;
  } catch (err) {
    report(err, "createDraft");
    return null;
  }
}

export async function getGiftVoucherDraftByToken(token: string, sql: Sql | null = getSql()): Promise<GiftVoucherDraft | null> {
  if (!sql || !isValidDraftToken(token)) return null;
  try {
    const rows = (await sql`
      SELECT to_jsonb(d) AS j FROM gift_voucher_drafts d WHERE d.token = ${token}
    `) as Row[];
    return rows[0] ? mapDraft(rows[0]) : null;
  } catch (err) {
    reportRead(err, "getDraft");
    return null;
  }
}

/** The drafts of the given tokens (invalid tokens are ignored, at most 100). */
export async function getGiftVoucherDraftsByTokens(tokens: readonly string[], sql: Sql | null = getSql()): Promise<GiftVoucherDraft[]> {
  const list = [...new Set(tokens.filter(isValidDraftToken))].slice(0, 100);
  if (!sql || list.length === 0) return [];
  try {
    const rows = (await sql`
      SELECT to_jsonb(d) AS j FROM gift_voucher_drafts d WHERE d.token = ANY(${list}::text[])
    `) as Row[];
    return rows.map(mapDraft);
  } catch (err) {
    reportRead(err, "getDrafts");
    return [];
  }
}

/** Stamp drafts as ordered (their data now lives in vouchers). Returns how many. */
export async function markGiftVoucherDraftsOrdered(ids: readonly number[], sql: Sql | null = getSql()): Promise<number> {
  const list = [...new Set(ids.filter((n) => Number.isSafeInteger(n) && n > 0))];
  if (!sql || list.length === 0) return 0;
  try {
    const rows = (await sql`
      WITH upd AS (
        UPDATE gift_voucher_drafts SET ordered_at = COALESCE(ordered_at, now()), updated_at = now()
         WHERE id = ANY(${list}::bigint[])
        RETURNING 1
      )
      SELECT count(*)::int AS n FROM upd
    `) as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  } catch (err) {
    report(err, "markDraftsOrdered");
    return 0;
  }
}

// ── vouchers: write ──────────────────────────────────────────────────────────

function validShopRow(r: NewShopGiftVoucher): boolean {
  return (
    Number.isSafeInteger(r.amountCents) &&
    r.amountCents > 0 &&
    typeof r.shopifyOrderId === "string" &&
    r.shopifyOrderId.length > 0 &&
    typeof r.shopifyLineItemId === "string" &&
    r.shopifyLineItemId.length > 0 &&
    Number.isSafeInteger(r.unitIndex) &&
    r.unitIndex >= 0 &&
    typeof r.designKey === "string" &&
    r.designKey.length > 0
  );
}

/**
 * Record the voucher units of a paid shop order — one row per unit, in ONE
 * transaction, idempotent per (order, line item, unit): a redelivered webhook
 * keeps the rows it finds. Returns the ids of all given units (new or
 * existing) in input order, or ok:false (no DB, invalid row — an amount of 0
 * or less, a missing order / line id — or a database error; nothing is
 * written then). New rows are due at once (next_attempt_at = now()).
 */
export async function insertShopGiftVouchers(
  rows: readonly NewShopGiftVoucher[],
  sql: Sql | null = getSql()
): Promise<{ ok: true; ids: number[] } | { ok: false }> {
  if (!sql) return { ok: false };
  if (rows.length === 0) return { ok: true, ids: [] };
  if (!rows.every(validShopRow)) {
    report(new Error("insertShopGiftVouchers: invalid row (amount, order, line item, unit or design)"), "insertShop");
    return { ok: false };
  }
  try {
    const inserts = rows.map((r) => {
      const status = r.status === "held" ? "held" : "pending";
      const mailStatus = r.mailStatus ?? (r.buyerEmail ? "pending" : "skipped");
      return sql`
        INSERT INTO gift_vouchers
          (source, reason, status, hold_reason, attention, amount_cents, currency,
           shopify_order_id, shopify_order_name, shopify_line_item_id, unit_index,
           shopify_customer_id, customer_id, buyer_email, buyer_name, draft_id, design_key,
           recipient_name, sender_name, message, photo_pathname, delivery, locale,
           mail_status, next_attempt_at)
        VALUES
          ('shop', 'verkauf', ${status}, ${status === "held" ? (r.holdReason ?? null) : null}, ${r.attention ?? null},
           ${r.amountCents}, ${r.currency ?? "EUR"},
           ${r.shopifyOrderId}, ${r.shopifyOrderName}, ${r.shopifyLineItemId}, ${r.unitIndex},
           ${r.shopifyCustomerId},
           COALESCE(${r.customerId ?? null}::bigint,
                    (SELECT c.id FROM customers c
                      WHERE ${r.shopifyCustomerId}::text IS NOT NULL AND c.shopify_customer_id = ${r.shopifyCustomerId}::text
                      LIMIT 1)),
           ${r.buyerEmail}, ${r.buyerName}, ${r.draftId}, ${r.designKey},
           ${r.recipientName}, ${r.senderName}, ${r.message}, ${photoPathOrNull(r.photoPathname)},
           ${r.delivery === "print" ? "print" : "pdf"}, ${r.locale === "en" ? "en" : "de"},
           ${mailStatus}, CASE WHEN ${status}::text = 'pending' THEN now() ELSE NULL END)
        ON CONFLICT (shopify_order_id, shopify_line_item_id, unit_index) DO NOTHING
      `;
    });
    const orderIds = [...new Set(rows.map((r) => r.shopifyOrderId))];
    const select = sql`
      SELECT id, shopify_order_id, shopify_line_item_id, unit_index
        FROM gift_vouchers WHERE shopify_order_id = ANY(${orderIds}::text[])
    `;
    const results = (await sql.transaction([...inserts, select])) as Row[][];
    const found = results[results.length - 1] ?? [];
    const byKey = new Map<string, number>();
    for (const f of found) byKey.set(`${f.shopify_order_id}|${f.shopify_line_item_id}|${f.unit_index}`, Number(f.id));
    const ids: number[] = [];
    for (const r of rows) {
      const id = byKey.get(`${r.shopifyOrderId}|${r.shopifyLineItemId}|${r.unitIndex}`);
      if (id == null) {
        report(new Error("insertShopGiftVouchers: a unit is missing after the insert"), "insertShop");
        return { ok: false };
      }
      ids.push(id);
    }
    return { ok: true, ids };
  } catch (err) {
    report(err, "insertShop");
    return { ok: false };
  }
}

/**
 * Record a voucher an operator issues by hand (validated by
 * decideManualGiftVoucher). Status 'pending', due at once and LEASED to its
 * creator for 3 minutes (the creating request issues it right away; should
 * it die, the sweep takes over after the lease). The mail is 'pending' only
 * for delivery 'email'. Returns the id, or null.
 */
export async function insertAdminGiftVoucher(input: NewAdminGiftVoucher, sql: Sql | null = getSql()): Promise<number | null> {
  if (!sql) return null;
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) return null;
  try {
    const delivery = pick(input.delivery, DELIVERIES, "pdf");
    const rows = (await sql`
      INSERT INTO gift_vouchers
        (source, reason, status, amount_cents, design_key, recipient_name, sender_name, message,
         photo_pathname, delivery, recipient_email, locale, admin_note, created_by, mail_status,
         next_attempt_at, locked_until)
      VALUES
        ('admin', ${input.reason}, 'pending', ${input.amountCents}, ${input.designKey}, ${input.recipientName},
         ${input.senderName}, ${input.message}, ${photoPathOrNull(input.photoPathname)}, ${delivery},
         ${delivery === "email" ? (input.recipientEmail?.trim().toLowerCase() || null) : null},
         ${input.locale === "en" ? "en" : "de"}, ${cut(input.adminNote?.trim(), NOTE_MAX)},
         ${cut(input.createdBy, 200)}, ${delivery === "email" ? "pending" : "none"},
         now(), now() + interval '3 minutes')
      RETURNING id
    `) as Array<{ id: number }>;
    return rows[0]?.id != null ? Number(rows[0].id) : null;
  } catch (err) {
    report(err, "insertAdmin");
    return null;
  }
}

/**
 * Claim vouchers that are due for issuing (status pending or issuing,
 * next_attempt_at reached, not leased) — FOR UPDATE SKIP LOCKED, so two
 * workers never take the same row; each claimed row is leased for 3 minutes.
 * `orderId` limits to one order (the webhook's after()), `ids` to given rows.
 * Claiming does not count an attempt (scheduleGiftVoucherRetry does).
 */
export async function claimDueGiftVouchers(
  opts: { limit: number; orderId?: string | null; ids?: readonly number[] | null },
  sql: Sql | null = getSql()
): Promise<GiftVoucher[]> {
  if (!sql) return [];
  const limit = positiveInt(opts.limit, 20, 200);
  const ids = opts.ids && opts.ids.length > 0 ? [...opts.ids] : null;
  try {
    const rows = (await sql`
      UPDATE gift_vouchers v
         SET locked_until = now() + interval '3 minutes'
       WHERE v.id IN (
         SELECT g.id FROM gift_vouchers g
          WHERE g.status IN ('pending', 'issuing')
            AND (g.next_attempt_at IS NULL OR g.next_attempt_at <= now())
            AND (g.locked_until IS NULL OR g.locked_until < now())
            AND (${opts.orderId ?? null}::text IS NULL OR g.shopify_order_id = ${opts.orderId ?? null}::text)
            AND (${ids}::bigint[] IS NULL OR g.id = ANY(${ids}::bigint[]))
          ORDER BY g.next_attempt_at NULLS FIRST, g.id
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
       )
      RETURNING to_jsonb(v) - 'code_enc' AS j, (v.code_enc IS NOT NULL) AS has_code,
                COALESCE(v.customer_id, (SELECT c.id FROM customers c
                                          WHERE v.shopify_customer_id IS NOT NULL
                                            AND c.shopify_customer_id = v.shopify_customer_id LIMIT 1)) AS resolved_customer_id
    `) as Row[];
    return rows.map(mapVoucher);
  } catch (err) {
    reportRead(err, "claimDue");
    return [];
  }
}

/**
 * Claim ONE voucher for immediate processing (an operator's „Ausstellen“ /
 * „Erneut versuchen“): status pending or issuing and not leased — the due
 * time is ignored. Null when it is not claimable.
 */
export async function claimGiftVoucher(id: number, sql: Sql | null = getSql()): Promise<GiftVoucher | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      UPDATE gift_vouchers v
         SET locked_until = now() + interval '3 minutes'
       WHERE v.id IN (
         SELECT g.id FROM gift_vouchers g
          WHERE g.id = ${id}
            AND g.status IN ('pending', 'issuing')
            AND (g.locked_until IS NULL OR g.locked_until < now())
          FOR UPDATE SKIP LOCKED
       )
      RETURNING to_jsonb(v) - 'code_enc' AS j, (v.code_enc IS NOT NULL) AS has_code,
                COALESCE(v.customer_id, (SELECT c.id FROM customers c
                                          WHERE v.shopify_customer_id IS NOT NULL
                                            AND c.shopify_customer_id = v.shopify_customer_id LIMIT 1)) AS resolved_customer_id
    `) as Row[];
    return rows[0] ? mapVoucher(rows[0]) : null;
  } catch (err) {
    reportRead(err, "claimOne");
    return null;
  }
}

/** End the lease of a voucher. */
export async function releaseGiftVoucherLock(id: number, sql: Sql | null = getSql()): Promise<void> {
  if (!sql) return;
  try {
    await sql`UPDATE gift_vouchers SET locked_until = NULL WHERE id = ${id}`;
  } catch (err) {
    report(err, "releaseLock");
  }
}

/**
 * Store the code (prepareGiftVoucherCode) and the expiry BEFORE the Shopify
 * call: status → 'issuing'. Only while the voucher is pending or failed AND
 * has no code yet — an existing code is never replaced (a retry must reuse
 * it). True when written.
 */
export async function markGiftVoucherIssuing(
  id: number,
  input: { codeEncB64: string; codeHash: string; codeLast4: string; expiresOn: string | null },
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  const expiresOn = input.expiresOn && /^\d{4}-\d{2}-\d{2}$/.test(input.expiresOn) ? input.expiresOn : null;
  try {
    const rows = (await sql`
      UPDATE gift_vouchers
         SET status = 'issuing', code_enc = decode(${input.codeEncB64}, 'base64'), code_hash = ${input.codeHash},
             code_last4 = ${input.codeLast4}, expires_on = ${expiresOn}::date, updated_at = now()
       WHERE id = ${id} AND status IN ('pending', 'failed') AND code_enc IS NULL
      RETURNING id
    `) as Row[];
    return rows.length > 0;
  } catch (err) {
    report(err, "markIssuing");
    return false;
  }
}

/**
 * The Shopify card exists: status → 'issued' with its id, the balance read
 * from Shopify and the hash of the e-mailed download token. From pending,
 * held, issuing or failed (a card adopted after a lost response); already
 * issued with the same card counts as done. Keeps the lease (see header).
 */
export async function markGiftVoucherIssued(
  id: number,
  input: { giftCardId: string; balanceCents: number | null; downloadTokenHash: string | null },
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  const balance = typeof input.balanceCents === "number" && Number.isSafeInteger(input.balanceCents) ? input.balanceCents : null;
  const hash = isSha256Hex(input.downloadTokenHash) ? input.downloadTokenHash : null;
  try {
    const rows = (await sql`
      UPDATE gift_vouchers
         SET status = 'issued', shopify_gift_card_id = ${input.giftCardId},
             balance_cents = COALESCE(${balance}::int, balance_cents, amount_cents), balance_checked_at = now(),
             issued_at = COALESCE(issued_at, now()), download_token_hash = COALESCE(${hash}::text, download_token_hash),
             hold_reason = NULL, last_error = NULL, next_attempt_at = NULL, updated_at = now()
       WHERE id = ${id}
         AND (status IN ('pending', 'held', 'issuing', 'failed')
              OR (status = 'issued' AND shopify_gift_card_id = ${input.giftCardId}))
      RETURNING id
    `) as Row[];
    return rows.length > 0;
  } catch (err) {
    report(err, "markIssued");
    return false;
  }
}

/** Hold for an operator („Zu prüfen“) with a reason key (GIFT_VOUCHER_HOLD_REASON_LABELS). */
export async function markGiftVoucherHeld(id: number, reason: string, sql: Sql | null = getSql()): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = (await sql`
      UPDATE gift_vouchers
         SET status = 'held', hold_reason = ${cut(reason, 100)}, next_attempt_at = NULL, locked_until = NULL, updated_at = now()
       WHERE id = ${id} AND status IN ('pending', 'issuing', 'failed', 'held')
      RETURNING id
    `) as Row[];
    return rows.length > 0;
  } catch (err) {
    report(err, "markHeld");
    return false;
  }
}

/**
 * Try again later (planGiftVoucherRetry): stores the error, the next due
 * time and ends the lease. A failed try counts an attempt; pass
 * `countAttempt: false` for a deferral that is no failure (risk still
 * pending, payment not complete). Only for pending / issuing vouchers.
 */
export async function scheduleGiftVoucherRetry(
  id: number,
  input: { error: string | null; nextAttemptAt: Date | string; countAttempt?: boolean },
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  const next = toIsoParam(input.nextAttemptAt);
  if (!next) return false;
  const inc = input.countAttempt === false ? 0 : 1;
  try {
    const rows = (await sql`
      UPDATE gift_vouchers
         SET last_error = ${cut(input.error, ERROR_MAX)}, next_attempt_at = ${next}::timestamptz,
             attempts = attempts + ${inc}, locked_until = NULL, updated_at = now()
       WHERE id = ${id} AND status IN ('pending', 'issuing')
      RETURNING id
    `) as Row[];
    return rows.length > 0;
  } catch (err) {
    report(err, "scheduleRetry");
    return false;
  }
}

/** Give up with an error Shopify will not change its mind about (invalid, limit). */
export async function markGiftVoucherFailed(id: number, error: string, sql: Sql | null = getSql()): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = (await sql`
      UPDATE gift_vouchers
         SET status = 'failed', last_error = ${cut(error, ERROR_MAX)}, attempts = attempts + 1,
             next_attempt_at = NULL, locked_until = NULL, updated_at = now()
       WHERE id = ${id} AND status IN ('pending', 'issuing', 'held', 'failed')
      RETURNING id
    `) as Row[];
    return rows.length > 0;
  } catch (err) {
    report(err, "markFailed");
    return false;
  }
}

/**
 * Generic status change (reject, cancel, retry): 'pending' is due at once
 * with the attempts reset; 'held' / 'rejected' keep or set the hold reason
 * (else it is cleared); 'deactivated' stamps the time and the reason.
 * `attention` is only touched when given (null clears it). `from` restricts
 * the change to the listed current statuses (race-safe). Ends the lease.
 */
export async function setGiftVoucherStatus(
  id: number,
  status: GiftVoucherStatus,
  opts: {
    holdReason?: string | null;
    attention?: string | null;
    deactivationReason?: string | null;
    from?: readonly GiftVoucherStatus[];
  } = {},
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql || !isGiftVoucherStatus(status)) return false;
  const setAttention = opts.attention !== undefined;
  const from = opts.from && opts.from.length > 0 ? [...opts.from] : null;
  try {
    const rows = (await sql`
      UPDATE gift_vouchers
         SET status = ${status},
             hold_reason = CASE WHEN ${status}::text IN ('held', 'rejected')
                                THEN COALESCE(${cut(opts.holdReason, 100)}::text, hold_reason) ELSE NULL END,
             attention = CASE WHEN ${setAttention}::boolean THEN ${opts.attention ?? null}::text ELSE attention END,
             deactivation_reason = CASE WHEN ${status}::text = 'deactivated'
                                        THEN COALESCE(${cut(opts.deactivationReason, ERROR_MAX)}::text, deactivation_reason)
                                        ELSE deactivation_reason END,
             deactivated_at = CASE WHEN ${status}::text = 'deactivated' THEN COALESCE(deactivated_at, now()) ELSE deactivated_at END,
             next_attempt_at = CASE WHEN ${status}::text = 'pending' THEN now() ELSE NULL END,
             attempts = CASE WHEN ${status}::text = 'pending' THEN 0 ELSE attempts END,
             locked_until = NULL,
             updated_at = now()
       WHERE id = ${id} AND (${from}::text[] IS NULL OR status = ANY(${from}::text[]))
      RETURNING id
    `) as Row[];
    return rows.length > 0;
  } catch (err) {
    report(err, "setStatus");
    return false;
  }
}

/**
 * The buyer / recipient mail state. A concluded try ('sent', 'failed', or an
 * error with a retry) counts a mail attempt, so the next send gets a new
 * idempotency key (gift-voucher-mail-<id>-<mailAttempts>); `countAttempt`
 * overrides. `error` is stored as last_error when given. 'sent' stamps
 * mailed_at (now unless given).
 */
export async function setGiftVoucherMailState(
  id: number,
  input: {
    status: GiftVoucherMailStatus;
    error?: string | null;
    nextAttemptAt?: Date | string | null;
    mailedAt?: Date | string | null;
    countAttempt?: boolean;
  },
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql || !(MAIL_STATUSES as readonly string[]).includes(input.status)) return false;
  const hasError = input.error !== undefined;
  const concluded = input.status === "sent" || input.status === "failed" || Boolean(input.error);
  const inc = (input.countAttempt ?? concluded) ? 1 : 0;
  try {
    const rows = (await sql`
      UPDATE gift_vouchers
         SET mail_status = ${input.status},
             mail_attempts = mail_attempts + ${inc},
             mail_next_attempt_at = ${toIsoParam(input.nextAttemptAt)}::timestamptz,
             mailed_at = CASE WHEN ${input.status}::text = 'sent'
                              THEN COALESCE(${toIsoParam(input.mailedAt)}::timestamptz, now()) ELSE mailed_at END,
             last_error = CASE WHEN ${hasError}::boolean THEN ${cut(input.error, ERROR_MAX)}::text ELSE last_error END,
             updated_at = now()
       WHERE id = ${id}
      RETURNING id
    `) as Row[];
    return rows.length > 0;
  } catch (err) {
    report(err, "setMailState");
    return false;
  }
}

/** A new download link (the old one stops working). `hash` = sha256 hex of the token. */
export async function setGiftVoucherDownloadTokenHash(id: number, hash: string, sql: Sql | null = getSql()): Promise<boolean> {
  if (!sql || !isSha256Hex(hash)) return false;
  try {
    const rows = (await sql`
      UPDATE gift_vouchers SET download_token_hash = ${hash}, updated_at = now() WHERE id = ${id} RETURNING id
    `) as Row[];
    return rows.length > 0;
  } catch (err) {
    report(err, "setDownloadToken");
    return false;
  }
}

/**
 * The balance just read from Shopify. A read that finds the balance unchanged
 * is no activity: it stamps balance_checked_at but leaves updated_at alone, so
 * the daily balance sync does not keep a used-up voucher „fresh“ for the
 * retention (purgeGiftVoucherData); a changed balance (spent, refunded onto
 * the card) moves updated_at. SET reads the old balance_cents.
 */
export async function updateGiftVoucherBalance(id: number, balanceCents: number, sql: Sql | null = getSql()): Promise<boolean> {
  if (!sql || !Number.isSafeInteger(balanceCents) || balanceCents < 0) return false;
  try {
    const rows = (await sql`
      UPDATE gift_vouchers
         SET balance_cents = ${balanceCents}, balance_checked_at = now(),
             updated_at = CASE WHEN balance_cents IS DISTINCT FROM ${balanceCents}::int THEN now() ELSE updated_at END
       WHERE id = ${id}
      RETURNING id
    `) as Row[];
    return rows.length > 0;
  } catch (err) {
    report(err, "updateBalance");
    return false;
  }
}

/** The card was deactivated in Shopify (irreversible): only from 'issued'; already deactivated counts as done. */
export async function markGiftVoucherDeactivated(id: number, reason: string, sql: Sql | null = getSql()): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = (await sql`
      UPDATE gift_vouchers
         SET status = 'deactivated', deactivated_at = COALESCE(deactivated_at, now()),
             deactivation_reason = COALESCE(deactivation_reason, ${cut(reason, ERROR_MAX)}),
             locked_until = NULL, updated_at = now()
       WHERE id = ${id} AND status IN ('issued', 'deactivated')
      RETURNING id
    `) as Row[];
    return rows.length > 0;
  } catch (err) {
    report(err, "markDeactivated");
    return false;
  }
}

/** Flag (or clear, with null) something an operator must look at (GIFT_VOUCHER_ATTENTION_LABELS). */
export async function setGiftVoucherAttention(id: number, key: string | null, sql: Sql | null = getSql()): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = (await sql`
      UPDATE gift_vouchers SET attention = ${cut(key, 100)}, updated_at = now() WHERE id = ${id} RETURNING id
    `) as Row[];
    return rows.length > 0;
  } catch (err) {
    report(err, "setAttention");
    return false;
  }
}

/** The operator's internal note (trimmed, at most 1000 characters; empty clears). */
export async function setGiftVoucherAdminNote(id: number, note: string | null, sql: Sql | null = getSql()): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = (await sql`
      UPDATE gift_vouchers SET admin_note = ${cut(note?.trim(), NOTE_MAX)}, updated_at = now() WHERE id = ${id} RETURNING id
    `) as Row[];
    return rows.length > 0;
  } catch (err) {
    report(err, "setAdminNote");
    return false;
  }
}

/** The voucher lines were marked fulfilled in Shopify. Returns how many rows changed. */
export async function markGiftVoucherFulfilled(ids: readonly number[], sql: Sql | null = getSql()): Promise<number> {
  const list = [...new Set(ids.filter((n) => Number.isSafeInteger(n) && n > 0))];
  if (!sql || list.length === 0) return 0;
  try {
    const rows = (await sql`
      WITH upd AS (
        UPDATE gift_vouchers SET fulfilled_at = now(), updated_at = now()
         WHERE id = ANY(${list}::bigint[]) AND fulfilled_at IS NULL
        RETURNING 1
      )
      SELECT count(*)::int AS n FROM upd
    `) as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  } catch (err) {
    report(err, "markFulfilled");
    return 0;
  }
}

// ── vouchers: read ───────────────────────────────────────────────────────────

export async function getGiftVoucher(id: number, sql: Sql | null = getSql()): Promise<GiftVoucher | null> {
  if (!sql || !Number.isSafeInteger(id) || id <= 0) return null;
  try {
    const rows = (await sql`
      SELECT to_jsonb(v) - 'code_enc' AS j, (v.code_enc IS NOT NULL) AS has_code,
             COALESCE(v.customer_id, (SELECT c.id FROM customers c
                                       WHERE v.shopify_customer_id IS NOT NULL
                                         AND c.shopify_customer_id = v.shopify_customer_id LIMIT 1)) AS resolved_customer_id
        FROM gift_vouchers v WHERE v.id = ${id}
    `) as Row[];
    return rows[0] ? mapVoucher(rows[0]) : null;
  } catch (err) {
    reportRead(err, "get");
    return null;
  }
}

/** The voucher with this code hash (giftVoucherCodeHash) — the balance check. */
export async function getGiftVoucherByCodeHash(hash: string, sql: Sql | null = getSql()): Promise<GiftVoucher | null> {
  if (!sql || !isSha256Hex(hash)) return null;
  try {
    const rows = (await sql`
      SELECT to_jsonb(v) - 'code_enc' AS j, (v.code_enc IS NOT NULL) AS has_code,
             COALESCE(v.customer_id, (SELECT c.id FROM customers c
                                       WHERE v.shopify_customer_id IS NOT NULL
                                         AND c.shopify_customer_id = v.shopify_customer_id LIMIT 1)) AS resolved_customer_id
        FROM gift_vouchers v WHERE v.code_hash = ${hash}
    `) as Row[];
    return rows[0] ? mapVoucher(rows[0]) : null;
  } catch (err) {
    reportRead(err, "getByCodeHash");
    return null;
  }
}

/** The voucher of an e-mailed download link (sha256 hex of its token). */
export async function getGiftVoucherByDownloadTokenHash(hash: string, sql: Sql | null = getSql()): Promise<GiftVoucher | null> {
  if (!sql || !isSha256Hex(hash)) return null;
  try {
    const rows = (await sql`
      SELECT to_jsonb(v) - 'code_enc' AS j, (v.code_enc IS NOT NULL) AS has_code,
             COALESCE(v.customer_id, (SELECT c.id FROM customers c
                                       WHERE v.shopify_customer_id IS NOT NULL
                                         AND c.shopify_customer_id = v.shopify_customer_id LIMIT 1)) AS resolved_customer_id
        FROM gift_vouchers v WHERE v.download_token_hash = ${hash}
    `) as Row[];
    return rows[0] ? mapVoucher(rows[0]) : null;
  } catch (err) {
    reportRead(err, "getByDownloadToken");
    return null;
  }
}

/** Every voucher unit of a Shopify order (numeric order id), in line / unit order. */
export async function listGiftVouchersForOrder(orderId: string, sql: Sql | null = getSql()): Promise<GiftVoucher[]> {
  if (!sql || !orderId) return [];
  try {
    const rows = (await sql`
      SELECT to_jsonb(v) - 'code_enc' AS j, (v.code_enc IS NOT NULL) AS has_code,
             COALESCE(v.customer_id, (SELECT c.id FROM customers c
                                       WHERE v.shopify_customer_id IS NOT NULL
                                         AND c.shopify_customer_id = v.shopify_customer_id LIMIT 1)) AS resolved_customer_id
        FROM gift_vouchers v
       WHERE v.shopify_order_id = ${orderId}
       ORDER BY v.shopify_line_item_id, v.unit_index, v.id
    `) as Row[];
    return rows.map(mapVoucher);
  } catch (err) {
    reportRead(err, "listForOrder");
    return [];
  }
}

/**
 * Cents of shop vouchers issued today (Europe/Berlin day) — the daily limit.
 * Vouchers being issued right now count too. 0 without a database or on an
 * error (reported): the limit is a fraud brake, not a legal gate.
 */
export async function sumShopGiftVouchersIssuedToday(sql: Sql | null = getSql()): Promise<number> {
  if (!sql) return 0;
  try {
    const rows = (await sql`
      SELECT COALESCE(SUM(amount_cents), 0)::bigint AS cents
        FROM gift_vouchers
       WHERE source = 'shop'
         AND (issued_at >= (date_trunc('day', now() AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'Europe/Berlin')
              OR (status = 'issuing' AND issued_at IS NULL
                  AND updated_at >= (date_trunc('day', now() AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'Europe/Berlin')))
    `) as Array<{ cents: string | number }>;
    return Number(rows[0]?.cents ?? 0);
  } catch (err) {
    reportRead(err, "sumIssuedToday");
    return 0;
  }
}

/** Issued vouchers whose mail is due (pending, due time reached, not leased). */
export async function listGiftVouchersDueForMail(opts: { limit: number }, sql: Sql | null = getSql()): Promise<GiftVoucher[]> {
  if (!sql) return [];
  const limit = positiveInt(opts.limit, 20, 200);
  try {
    const rows = (await sql`
      SELECT to_jsonb(v) - 'code_enc' AS j, (v.code_enc IS NOT NULL) AS has_code,
             COALESCE(v.customer_id, (SELECT c.id FROM customers c
                                       WHERE v.shopify_customer_id IS NOT NULL
                                         AND c.shopify_customer_id = v.shopify_customer_id LIMIT 1)) AS resolved_customer_id
        FROM gift_vouchers v
       WHERE v.status = 'issued' AND v.mail_status = 'pending'
         AND (v.mail_next_attempt_at IS NULL OR v.mail_next_attempt_at <= now())
         AND (v.locked_until IS NULL OR v.locked_until < now())
       ORDER BY v.mail_next_attempt_at NULLS FIRST, v.id
       LIMIT ${limit}
    `) as Row[];
    return rows.map(mapVoucher);
  } catch (err) {
    reportRead(err, "listDueForMail");
    return [];
  }
}

/**
 * Issued vouchers whose balance was not read for `olderThanHours` — live
 * ones (balance left, not expired) first, then the longest unchecked.
 */
export async function listGiftVouchersForBalanceSync(
  opts: { limit: number; olderThanHours: number },
  sql: Sql | null = getSql()
): Promise<GiftVoucher[]> {
  if (!sql) return [];
  const limit = positiveInt(opts.limit, 15, 200);
  const hours = typeof opts.olderThanHours === "number" && Number.isFinite(opts.olderThanHours) && opts.olderThanHours >= 0
    ? Math.floor(opts.olderThanHours)
    : 24;
  try {
    const rows = (await sql`
      SELECT to_jsonb(v) - 'code_enc' AS j, (v.code_enc IS NOT NULL) AS has_code,
             COALESCE(v.customer_id, (SELECT c.id FROM customers c
                                       WHERE v.shopify_customer_id IS NOT NULL
                                         AND c.shopify_customer_id = v.shopify_customer_id LIMIT 1)) AS resolved_customer_id
        FROM gift_vouchers v
       WHERE v.status = 'issued' AND v.shopify_gift_card_id IS NOT NULL
         AND (v.balance_checked_at IS NULL OR v.balance_checked_at < now() - make_interval(hours => ${hours}::int))
       ORDER BY (COALESCE(v.balance_cents, v.amount_cents) > 0
                 AND (v.expires_on IS NULL OR v.expires_on >= (now() AT TIME ZONE 'Europe/Berlin')::date)) DESC,
                v.balance_checked_at NULLS FIRST, v.id
       LIMIT ${limit}
    `) as Row[];
    return rows.map(mapVoucher);
  } catch (err) {
    reportRead(err, "listForBalanceSync");
    return [];
  }
}

/** `%…%` ILIKE pattern with the LIKE wildcards of the input escaped. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * The admin list, newest first, with filters: status, source, attention
 * only, and a search over the voucher number (G-2026-00042), the order name,
 * buyer / recipient name and e-mail, and the last four characters of the
 * code. Pages of 1–100 rows; `total` counts every match.
 */
export async function listGiftVouchers(
  filter: GiftVoucherListFilter = {},
  sql: Sql | null = getSql()
): Promise<{ rows: GiftVoucherListRow[]; total: number }> {
  if (!sql) return { rows: [], total: 0 };
  const pageSize = positiveInt(filter.pageSize, 25, 100);
  const page = positiveInt(filter.page, 1, 100000);
  const offset = (page - 1) * pageSize;
  const status = filter.status && isGiftVoucherStatus(filter.status) ? filter.status : null;
  const source = filter.source === "shop" || filter.source === "admin" ? filter.source : null;
  const attentionOnly = filter.attention === true;
  const q = typeof filter.q === "string" ? filter.q.trim().slice(0, 100) : "";
  const pattern = q ? likePattern(q) : null;
  const numberId = q ? parseGiftVoucherNumber(q) : null;
  const compact = q.replace(/[\s-]+/g, "").toUpperCase();
  const last4 = /^[A-Z0-9]{4}$/.test(compact) ? compact : null;
  try {
    const rows = (await sql`
      SELECT to_jsonb(v) - 'code_enc' AS j, (v.code_enc IS NOT NULL) AS has_code,
             COALESCE(v.customer_id, (SELECT c.id FROM customers c
                                       WHERE v.shopify_customer_id IS NOT NULL
                                         AND c.shopify_customer_id = v.shopify_customer_id LIMIT 1)) AS resolved_customer_id,
             pj.status AS print_status
        FROM gift_vouchers v
        LEFT JOIN gift_voucher_print_jobs pj ON pj.voucher_id = v.id
       WHERE (${status}::text IS NULL OR v.status = ${status}::text)
         AND (${source}::text IS NULL OR v.source = ${source}::text)
         AND (${attentionOnly}::boolean = false OR v.attention IS NOT NULL)
         AND (${pattern}::text IS NULL
              OR v.id = ${numberId}::bigint
              OR v.code_last4 = ${last4}::text
              OR v.shopify_order_name ILIKE ${pattern}::text
              OR v.buyer_name ILIKE ${pattern}::text
              OR v.recipient_name ILIKE ${pattern}::text
              OR v.buyer_email ILIKE ${pattern}::text
              OR v.recipient_email ILIKE ${pattern}::text)
       ORDER BY v.created_at DESC, v.id DESC
       LIMIT ${pageSize} OFFSET ${offset}
    `) as Row[];
    const counted = (await sql`
      SELECT count(*)::int AS n
        FROM gift_vouchers v
       WHERE (${status}::text IS NULL OR v.status = ${status}::text)
         AND (${source}::text IS NULL OR v.source = ${source}::text)
         AND (${attentionOnly}::boolean = false OR v.attention IS NOT NULL)
         AND (${pattern}::text IS NULL
              OR v.id = ${numberId}::bigint
              OR v.code_last4 = ${last4}::text
              OR v.shopify_order_name ILIKE ${pattern}::text
              OR v.buyer_name ILIKE ${pattern}::text
              OR v.recipient_name ILIKE ${pattern}::text
              OR v.buyer_email ILIKE ${pattern}::text
              OR v.recipient_email ILIKE ${pattern}::text)
    `) as Array<{ n: number }>;
    return { rows: rows.map(mapListRow), total: counted[0]?.n ?? 0 };
  } catch (err) {
    reportRead(err, "list");
    return { rows: [], total: 0 };
  }
}

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
  draftCount30d: 0,
};

/**
 * The figures of the admin stats row. Sold = shop vouchers of the last 30
 * days that were not cancelled or rejected; issued = every voucher that ever
 * became a card; open balance = active, unexpired cards (last known balance);
 * redeemed = what was spent from issued or deactivated cards. Zeros without a
 * database or before the migration.
 */
export async function giftVoucherSummary(sql: Sql | null = getSql()): Promise<GiftVoucherSummary> {
  if (!sql) return { ...EMPTY_SUMMARY };
  try {
    const rows = (await sql`
      SELECT
        count(*) FILTER (WHERE source = 'shop' AND created_at >= now() - interval '30 days'
                           AND status NOT IN ('cancelled', 'rejected'))::int AS sold_count_30d,
        COALESCE(SUM(amount_cents) FILTER (WHERE source = 'shop' AND created_at >= now() - interval '30 days'
                                             AND status NOT IN ('cancelled', 'rejected')), 0)::bigint AS sold_cents_30d,
        count(*) FILTER (WHERE issued_at IS NOT NULL)::int AS issued_count,
        COALESCE(SUM(amount_cents) FILTER (WHERE issued_at IS NOT NULL), 0)::bigint AS issued_cents,
        COALESCE(SUM(COALESCE(balance_cents, amount_cents)) FILTER (
          WHERE status = 'issued'
            AND (expires_on IS NULL OR expires_on >= (now() AT TIME ZONE 'Europe/Berlin')::date)), 0)::bigint AS open_balance_cents,
        COALESCE(SUM(GREATEST(amount_cents - balance_cents, 0)) FILTER (
          WHERE status IN ('issued', 'deactivated') AND balance_cents IS NOT NULL), 0)::bigint AS redeemed_cents,
        count(*) FILTER (WHERE status = 'held')::int AS held_count,
        count(*) FILTER (WHERE attention IS NOT NULL)::int AS attention_count,
        (SELECT count(*) FROM gift_voucher_print_jobs
          WHERE status IN ('review', 'queued', 'submitting', 'submitted', 'printing'))::int AS open_print_jobs,
        (SELECT count(*) FROM gift_voucher_drafts WHERE created_at >= now() - interval '30 days')::int AS draft_count_30d
      FROM gift_vouchers
    `) as Row[];
    const r = rows[0] ?? {};
    return {
      soldCount30d: Number(r.sold_count_30d ?? 0),
      soldCents30d: Number(r.sold_cents_30d ?? 0),
      issuedCount: Number(r.issued_count ?? 0),
      issuedCents: Number(r.issued_cents ?? 0),
      openBalanceCents: Number(r.open_balance_cents ?? 0),
      redeemedCents: Number(r.redeemed_cents ?? 0),
      heldCount: Number(r.held_count ?? 0),
      attentionCount: Number(r.attention_count ?? 0),
      openPrintJobs: Number(r.open_print_jobs ?? 0),
      draftCount30d: Number(r.draft_count_30d ?? 0),
    };
  } catch (err) {
    reportRead(err, "summary");
    return { ...EMPTY_SUMMARY };
  }
}

// ── print jobs ───────────────────────────────────────────────────────────────

/**
 * Create the print job of a voucher (at most one — ON CONFLICT (voucher_id)
 * DO NOTHING). Starts 'queued' (or 'review' when an operator must release
 * it first). Returns the id of the new or the existing job, or null.
 */
export async function insertGiftVoucherPrintJob(
  input: {
    voucherId: number;
    provider: GiftVoucherPrintProvider;
    status: "review" | "queued";
    address: GiftVoucherAddressInput | null;
    paidLineItemId: string | null;
  },
  sql: Sql | null = getSql()
): Promise<number | null> {
  if (!sql) return null;
  const provider = input.provider === "manual" ? "manual" : "printone";
  const status = input.status === "review" ? "review" : "queued";
  try {
    const rows = (await sql`
      WITH ins AS (
        INSERT INTO gift_voucher_print_jobs
          (voucher_id, provider, status, recipient_postal_address, paid_line_item_id, next_attempt_at)
        VALUES (${input.voucherId}, ${provider}, ${status}, ${addressJsonText(input.address)}::jsonb,
                ${input.paidLineItemId}, now())
        ON CONFLICT (voucher_id) DO NOTHING
        RETURNING id
      )
      SELECT id FROM ins
      UNION ALL
      SELECT id FROM gift_voucher_print_jobs WHERE voucher_id = ${input.voucherId}
      LIMIT 1
    `) as Array<{ id: number }>;
    return rows[0]?.id != null ? Number(rows[0].id) : null;
  } catch (err) {
    report(err, "insertPrintJob");
    return null;
  }
}

export async function getGiftVoucherPrintJob(id: number, sql: Sql | null = getSql()): Promise<GiftVoucherPrintJob | null> {
  if (!sql || !Number.isSafeInteger(id) || id <= 0) return null;
  try {
    const rows = (await sql`SELECT to_jsonb(j) AS j FROM gift_voucher_print_jobs j WHERE j.id = ${id}`) as Row[];
    return rows[0] ? mapPrintJob(rows[0]) : null;
  } catch (err) {
    reportRead(err, "getPrintJob");
    return null;
  }
}

export async function getGiftVoucherPrintJobForVoucher(voucherId: number, sql: Sql | null = getSql()): Promise<GiftVoucherPrintJob | null> {
  if (!sql || !Number.isSafeInteger(voucherId) || voucherId <= 0) return null;
  try {
    const rows = (await sql`SELECT to_jsonb(j) AS j FROM gift_voucher_print_jobs j WHERE j.voucher_id = ${voucherId}`) as Row[];
    return rows[0] ? mapPrintJob(rows[0]) : null;
  } catch (err) {
    reportRead(err, "getPrintJobForVoucher");
    return null;
  }
}

/** The job of a print.one order id (webhook / poll). */
export async function getGiftVoucherPrintJobByProviderOrderId(
  providerOrderId: string,
  sql: Sql | null = getSql()
): Promise<GiftVoucherPrintJob | null> {
  if (!sql || typeof providerOrderId !== "string" || !providerOrderId || providerOrderId.length > 200) return null;
  try {
    const rows = (await sql`
      SELECT to_jsonb(j) AS j FROM gift_voucher_print_jobs j WHERE j.provider_order_id = ${providerOrderId}
    `) as Row[];
    return rows[0] ? mapPrintJob(rows[0]) : null;
  } catch (err) {
    reportRead(err, "getPrintJobByProviderOrder");
    return null;
  }
}

/** The job whose print files are served under this asset token (the public print-asset route). */
export async function getGiftVoucherPrintJobByAssetToken(token: string, sql: Sql | null = getSql()): Promise<GiftVoucherPrintJob | null> {
  if (!sql || typeof token !== "string" || !/^[A-Za-z0-9_-]{22,64}$/.test(token)) return null;
  try {
    const rows = (await sql`SELECT to_jsonb(j) AS j FROM gift_voucher_print_jobs j WHERE j.asset_token = ${token}`) as Row[];
    return rows[0] ? mapPrintJob(rows[0]) : null;
  } catch (err) {
    reportRead(err, "getPrintJobByAsset");
    return null;
  }
}

/**
 * Claim print jobs that are due for submission: status queued (or a
 * 'submitting' one whose lease ran out — retried with the same idempotency
 * key), voucher issued, due, not leased; FOR UPDATE SKIP LOCKED and a
 * 3-minute lease. `provider` limits to one provider.
 */
export async function claimDueGiftVoucherPrintJobs(
  opts: { limit: number; provider?: GiftVoucherPrintProvider | null },
  sql: Sql | null = getSql()
): Promise<GiftVoucherPrintJob[]> {
  if (!sql) return [];
  const limit = positiveInt(opts.limit, 10, 100);
  const provider = opts.provider === "manual" || opts.provider === "printone" ? opts.provider : null;
  try {
    const rows = (await sql`
      UPDATE gift_voucher_print_jobs j
         SET locked_until = now() + interval '3 minutes'
       WHERE j.id IN (
         SELECT pj.id FROM gift_voucher_print_jobs pj
           JOIN gift_vouchers v ON v.id = pj.voucher_id
          WHERE pj.status IN ('queued', 'submitting')
            AND v.status = 'issued'
            AND (pj.next_attempt_at IS NULL OR pj.next_attempt_at <= now())
            AND (pj.locked_until IS NULL OR pj.locked_until < now())
            AND (${provider}::text IS NULL OR pj.provider = ${provider}::text)
          ORDER BY pj.next_attempt_at NULLS FIRST, pj.id
          LIMIT ${limit}
          FOR UPDATE OF pj SKIP LOCKED
       )
      RETURNING to_jsonb(j) AS j
    `) as Row[];
    return rows.map(mapPrintJob);
  } catch (err) {
    reportRead(err, "claimPrintJobs");
    return [];
  }
}

/**
 * Record the job's print files (asset token + both pathnames) — once per job:
 * false when the job already has files (the provider must always get the
 * same URLs for the same order).
 */
export async function setGiftVoucherPrintJobAssets(
  id: number,
  input: { token: string; outside: string; inside: string },
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = (await sql`
      UPDATE gift_voucher_print_jobs
         SET asset_token = ${input.token}, asset_outside_pathname = ${input.outside},
             asset_inside_pathname = ${input.inside}, updated_at = now()
       WHERE id = ${id} AND asset_token IS NULL
      RETURNING id
    `) as Row[];
    return rows.length > 0;
  } catch (err) {
    report(err, "setPrintAssets");
    return false;
  }
}

/** print.one accepted the order: status → 'submitted' (only from queued / submitting). */
export async function markGiftVoucherPrintJobSubmitted(
  id: number,
  input: { providerOrderId: string; providerStatus: string | null; costCents: number | null },
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  const cost = typeof input.costCents === "number" && Number.isSafeInteger(input.costCents) ? input.costCents : null;
  try {
    const rows = (await sql`
      UPDATE gift_voucher_print_jobs
         SET status = 'submitted', provider_order_id = ${input.providerOrderId}, provider_status = ${cut(input.providerStatus, 100)},
             cost_cents = COALESCE(${cost}::int, cost_cents), submitted_at = COALESCE(submitted_at, now()),
             error = NULL, next_attempt_at = NULL, locked_until = NULL, updated_at = now()
       WHERE id = ${id} AND status IN ('queued', 'submitting')
      RETURNING id
    `) as Row[];
    return rows.length > 0;
  } catch (err) {
    report(err, "markPrintSubmitted");
    return false;
  }
}

/**
 * Move a job to `status` when canAdvancePrintJobStatus allows it (forward
 * only, finals frozen — a late or repeated webhook changes nothing). True
 * when the status changed. A new provider status for an unchanged status is
 * still recorded.
 */
export async function updateGiftVoucherPrintJobStatus(
  id: number,
  status: GiftVoucherPrintStatus,
  opts: { providerStatus?: string | null; error?: string | null; sentAt?: Date | string | null } = {},
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  const from = PRINT_STATUSES.filter((s) => canAdvancePrintJobStatus(s, status));
  if (from.length === 0) return false;
  const providerStatus = cut(opts.providerStatus, 100);
  const hasError = opts.error !== undefined;
  try {
    const rows = (await sql`
      UPDATE gift_voucher_print_jobs
         SET status = ${status},
             provider_status = COALESCE(${providerStatus}::text, provider_status),
             error = CASE WHEN ${hasError}::boolean THEN ${cut(opts.error, ERROR_MAX)}::text ELSE error END,
             sent_at = CASE WHEN ${status}::text = 'sent'
                            THEN COALESCE(${toIsoParam(opts.sentAt)}::timestamptz, sent_at, now()) ELSE sent_at END,
             next_attempt_at = NULL, locked_until = NULL, updated_at = now()
       WHERE id = ${id} AND status = ANY(${from}::text[])
      RETURNING id
    `) as Row[];
    if (rows.length > 0) return true;
    if (providerStatus) {
      await sql`
        UPDATE gift_voucher_print_jobs SET provider_status = ${providerStatus}, updated_at = now()
         WHERE id = ${id} AND status = ${status} AND provider_status IS DISTINCT FROM ${providerStatus}
      `;
    }
    return false;
  } catch (err) {
    report(err, "updatePrintStatus");
    return false;
  }
}

/**
 * Submit again later: stores the error and the due time, counts an attempt,
 * ends the lease; a job caught in 'submitting' goes back to 'queued'.
 */
export async function scheduleGiftVoucherPrintJobRetry(
  id: number,
  input: { error: string | null; nextAttemptAt: Date | string },
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  const next = toIsoParam(input.nextAttemptAt);
  if (!next) return false;
  try {
    const rows = (await sql`
      UPDATE gift_voucher_print_jobs
         SET status = CASE WHEN status = 'submitting' THEN 'queued' ELSE status END,
             error = ${cut(input.error, ERROR_MAX)}, attempts = attempts + 1,
             next_attempt_at = ${next}::timestamptz, locked_until = NULL, updated_at = now()
       WHERE id = ${id} AND status IN ('queued', 'submitting', 'submitted', 'printing')
      RETURNING id
    `) as Row[];
    return rows.length > 0;
  } catch (err) {
    report(err, "schedulePrintRetry");
    return false;
  }
}

/** Jobs at print.one whose status should be read again (unchanged for `minAgeMinutes`). */
export async function listGiftVoucherPrintJobsToPoll(
  opts: { limit: number; minAgeMinutes: number },
  sql: Sql | null = getSql()
): Promise<GiftVoucherPrintJob[]> {
  if (!sql) return [];
  const limit = positiveInt(opts.limit, 20, 200);
  const minutes = typeof opts.minAgeMinutes === "number" && Number.isFinite(opts.minAgeMinutes) && opts.minAgeMinutes >= 0
    ? Math.floor(opts.minAgeMinutes)
    : 30;
  try {
    const rows = (await sql`
      SELECT to_jsonb(j) AS j FROM gift_voucher_print_jobs j
       WHERE j.provider = 'printone' AND j.provider_order_id IS NOT NULL
         AND j.status IN ('submitted', 'printing')
         AND j.updated_at < now() - make_interval(mins => ${minutes}::int)
       ORDER BY j.updated_at, j.id
       LIMIT ${limit}
    `) as Row[];
    return rows.map(mapPrintJob);
  } catch (err) {
    reportRead(err, "listPrintJobsToPoll");
    return [];
  }
}

/** A poll found no news: restart the job's poll clock (updated_at). */
export async function markGiftVoucherPrintJobPolled(id: number, sql: Sql | null = getSql()): Promise<void> {
  if (!sql) return;
  try {
    await sql`UPDATE gift_voucher_print_jobs SET updated_at = now() WHERE id = ${id}`;
  } catch (err) {
    report(err, "markPrintPolled");
  }
}

/** Jobs whose print files can go: finished, or created more than 14 days ago. */
export async function listGiftVoucherPrintJobsWithAssetsToClean(
  opts: { limit: number },
  sql: Sql | null = getSql()
): Promise<GiftVoucherPrintJob[]> {
  if (!sql) return [];
  const limit = positiveInt(opts.limit, 20, 200);
  try {
    const rows = (await sql`
      SELECT to_jsonb(j) AS j FROM gift_voucher_print_jobs j
       WHERE j.asset_token IS NOT NULL
         AND (j.status = ANY(${FINAL_PRINT_STATUSES}::text[]) OR j.created_at < now() - interval '14 days')
       ORDER BY j.updated_at, j.id
       LIMIT ${limit}
    `) as Row[];
    return rows.map(mapPrintJob);
  } catch (err) {
    reportRead(err, "listPrintAssetsToClean");
    return [];
  }
}

/** The print files were deleted: forget token and pathnames (the asset URL stops working). */
export async function clearGiftVoucherPrintJobAssets(id: number, sql: Sql | null = getSql()): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = (await sql`
      UPDATE gift_voucher_print_jobs
         SET asset_token = NULL, asset_outside_pathname = NULL, asset_inside_pathname = NULL, updated_at = now()
       WHERE id = ${id}
      RETURNING id
    `) as Row[];
    return rows.length > 0;
  } catch (err) {
    report(err, "clearPrintAssets");
    return false;
  }
}

// ── settings (admin_settings key 'gift_vouchers') ────────────────────────────

function defaultSettings(): GiftVoucherSettings {
  return { ...DEFAULT_GIFT_VOUCHER_SETTINGS };
}

/** The stored settings, or the defaults (no database, no row, before 0078, read error). */
export async function getGiftVoucherSettings(sql: Sql | null = getSql()): Promise<GiftVoucherSettings> {
  if (!sql) return defaultSettings();
  try {
    const rows = (await sql`
      SELECT value FROM admin_settings WHERE key = ${GIFT_VOUCHER_SETTINGS_KEY}
    `) as Array<{ value: unknown }>;
    return rows.length ? parseGiftVoucherSettings(rows[0]?.value) : defaultSettings();
  } catch (err) {
    reportRead(err, "getSettings");
    return defaultSettings();
  }
}

// Request-path cache: one settings read per instance and minute at most. A
// save in the admin drops this instance's copy; other instances follow
// within the TTL.
const SETTINGS_TTL_MS = 60_000;
let settingsCache: { at: number; settings: GiftVoucherSettings } | null = null;

export async function getCachedGiftVoucherSettings(): Promise<GiftVoucherSettings> {
  if (settingsCache && Date.now() - settingsCache.at < SETTINGS_TTL_MS) return { ...settingsCache.settings };
  const settings = await getGiftVoucherSettings();
  settingsCache = { at: Date.now(), settings };
  return { ...settings };
}

export type SaveGiftVoucherSettingsResult =
  | { ok: true; settings: GiftVoucherSettings }
  | { ok: false; reason: "no_db" | "missing_table" | "failed" };

/** Store the settings (UPSERT); the caller validated them (validateGiftVoucherSettingsInput). */
export async function setGiftVoucherSettings(
  settings: GiftVoucherSettings,
  sql: Sql | null = getSql()
): Promise<SaveGiftVoucherSettingsResult> {
  if (!sql) return { ok: false, reason: "no_db" };
  const value = JSON.stringify(parseGiftVoucherSettings(settings));
  try {
    const rows = (await sql`
      INSERT INTO admin_settings (key, value, updated_at)
      VALUES (${GIFT_VOUCHER_SETTINGS_KEY}, ${value}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
      RETURNING value
    `) as Array<{ value: unknown }>;
    settingsCache = null;
    return { ok: true, settings: parseGiftVoucherSettings(rows[0]?.value ?? settings) };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, reason: "missing_table" };
    report(err, "setSettings");
    return { ok: false, reason: "failed" };
  }
}

// ── retention ────────────────────────────────────────────────────────────────

const daysAgoIso = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const windowDays = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : 0);

/**
 * The voucher retention (lib/retention.ts step 5j; 0 disables a step, never
 * "delete everything"):
 *   personalDays — a voucher that ENDED that many days ago is anonymised:
 *     expired (expires_on), deactivated, cancelled, rejected, failed and
 *     untouched, or used up (balance 0 and the row unchanged that long — an
 *     unchanged balance read does not move updated_at, see
 *     updateGiftVoucherBalance). Never a voucher still pending, held or
 *     issuing — a held one is a paid order whose voucher is still owed —
 *     except a held TEST order (hold_reason 'test_order', no money behind
 *     it) untouched that long. Names, texts, e-mail addresses, the photo and
 *     the download link go (and the address of its print job, open or
 *     finished); amounts, status, code hash / last 4, ids stay.
 *   addressDays — the recipient address of a FINISHED print job (sent,
 *     done, cancelled, failed) unchanged that long, and the address copy of
 *     an ordered draft, are cleared.
 *   draftDays — drafts older than that are deleted unless a voucher that
 *     still keeps its data refers to them (a never-ordered draft, or one
 *     whose vouchers are all anonymised).
 * Photos no row refers to any more are returned for the caller to delete
 * from Blob. Never throws; a missing table (before 0083) gives zeros.
 */
export async function purgeGiftVoucherData(
  opts: { draftDays: number; addressDays: number; personalDays: number },
  sql: Sql | null = getSql()
): Promise<GiftVoucherPurgeResult> {
  const result: GiftVoucherPurgeResult = { drafts: 0, addresses: 0, anonymised: 0, blobPathnames: [] };
  if (!sql) return result;
  const personalDays = windowDays(opts.personalDays);
  const addressDays = windowDays(opts.addressDays);
  const draftDays = windowDays(opts.draftDays);
  const candidates = new Set<string>();

  if (personalDays > 0) {
    try {
      const cutoff = daysAgoIso(personalDays);
      const rows = (await sql`
        WITH ended AS (
          SELECT id, photo_pathname FROM gift_vouchers
           WHERE personal_data_purged_at IS NULL
             AND ((status NOT IN ('pending', 'held', 'issuing')
                   AND ((expires_on IS NOT NULL
                         AND expires_on < (now() AT TIME ZONE 'Europe/Berlin')::date - ${personalDays}::int)
                        OR (status = 'deactivated' AND COALESCE(deactivated_at, updated_at) < ${cutoff}::timestamptz)
                        OR (status IN ('cancelled', 'rejected', 'failed') AND updated_at < ${cutoff}::timestamptz)
                        OR (balance_cents = 0 AND updated_at < ${cutoff}::timestamptz)))
                  OR (status = 'held' AND hold_reason = 'test_order' AND updated_at < ${cutoff}::timestamptz))
        ),
        upd AS (
          UPDATE gift_vouchers v
             SET recipient_name = NULL, sender_name = NULL, message = NULL, buyer_name = NULL,
                 buyer_email = NULL, recipient_email = NULL, photo_pathname = NULL,
                 download_token_hash = NULL, personal_data_purged_at = now(), updated_at = now()
            FROM ended e
           WHERE v.id = e.id
          RETURNING v.id, e.photo_pathname
        ),
        jobs AS (
          UPDATE gift_voucher_print_jobs j
             SET recipient_postal_address = NULL, updated_at = now()
           WHERE j.voucher_id IN (SELECT id FROM upd) AND j.recipient_postal_address IS NOT NULL
          RETURNING 1
        )
        SELECT (SELECT count(*) FROM upd)::int AS n,
               (SELECT count(*) FROM jobs)::int AS addresses,
               COALESCE((SELECT array_agg(DISTINCT photo_pathname) FROM upd WHERE photo_pathname IS NOT NULL),
                        '{}'::text[]) AS photos
      `) as Array<{ n: number; addresses: number; photos: string[] | null }>;
      result.anonymised = rows[0]?.n ?? 0;
      result.addresses += rows[0]?.addresses ?? 0;
      for (const p of rows[0]?.photos ?? []) candidates.add(p);
    } catch (err) {
      reportRead(err, "purgePersonal");
    }
  }

  if (addressDays > 0) {
    try {
      const cutoff = daysAgoIso(addressDays);
      const rows = (await sql`
        WITH jobs AS (
          UPDATE gift_voucher_print_jobs
             SET recipient_postal_address = NULL, updated_at = now()
           WHERE recipient_postal_address IS NOT NULL
             AND status = ANY(${FINAL_PRINT_STATUSES}::text[])
             AND updated_at < ${cutoff}::timestamptz
          RETURNING 1
        ),
        drafts AS (
          UPDATE gift_voucher_drafts
             SET recipient_postal_address = NULL, updated_at = now()
           WHERE recipient_postal_address IS NOT NULL
             AND ordered_at IS NOT NULL AND ordered_at < ${cutoff}::timestamptz
          RETURNING 1
        )
        SELECT (SELECT count(*) FROM jobs)::int + (SELECT count(*) FROM drafts)::int AS n
      `) as Array<{ n: number }>;
      result.addresses += rows[0]?.n ?? 0;
    } catch (err) {
      reportRead(err, "purgeAddresses");
    }
  }

  if (draftDays > 0) {
    try {
      const cutoff = daysAgoIso(draftDays);
      const rows = (await sql`
        WITH del AS (
          DELETE FROM gift_voucher_drafts d
           WHERE d.created_at < ${cutoff}::timestamptz
             AND NOT EXISTS (SELECT 1 FROM gift_vouchers v
                              WHERE v.draft_id = d.id AND v.personal_data_purged_at IS NULL)
          RETURNING d.photo_pathname
        )
        SELECT (SELECT count(*) FROM del)::int AS n,
               COALESCE((SELECT array_agg(DISTINCT photo_pathname) FROM del WHERE photo_pathname IS NOT NULL),
                        '{}'::text[]) AS photos
      `) as Array<{ n: number; photos: string[] | null }>;
      result.drafts = rows[0]?.n ?? 0;
      for (const p of rows[0]?.photos ?? []) candidates.add(p);
    } catch (err) {
      reportRead(err, "purgeDrafts");
    }
  }

  if (candidates.size > 0) {
    result.blobPathnames = await unreferencedGiftVoucherPhotos([...candidates], sql);
  }
  return result;
}

/**
 * Of the given photo pathnames, those no draft and no voucher refers to —
 * safe to delete from Blob. [] on any error (nothing is deleted then).
 */
export async function unreferencedGiftVoucherPhotos(pathnames: readonly string[], sql: Sql | null = getSql()): Promise<string[]> {
  const list = [...new Set(pathnames.filter((p) => giftVoucherPhotoIdFromPathname(p) !== null))];
  if (!sql || list.length === 0) return [];
  try {
    const rows = (await sql`
      SELECT t.p FROM unnest(${list}::text[]) AS t(p)
       WHERE NOT EXISTS (SELECT 1 FROM gift_voucher_drafts d WHERE d.photo_pathname = t.p)
         AND NOT EXISTS (SELECT 1 FROM gift_vouchers v WHERE v.photo_pathname = t.p)
    `) as Array<{ p: string }>;
    return rows.map((r) => r.p);
  } catch (err) {
    reportRead(err, "unreferencedPhotos");
    return [];
  }
}
