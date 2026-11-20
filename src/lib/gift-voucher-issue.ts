// STUB — replaced by P3 Issuing (spec §9, gift-voucher-issue.ts).
//
// The exact exports of the issuing pipeline (webhook recording, issuing,
// order changes, the admin actions and the cron sweep), so the routes and the
// admin compile while the pipeline is being built. Every placeholder answers
// at once and never throws: webhook helpers acknowledge without doing
// anything (a stub must never make Shopify retry), admin actions answer
// `not_implemented`, the sweep reports zeros.

import type { GiftVoucherAddress, GiftVoucherDelivery, GiftVoucherReason } from "./gift-voucher-store";

const NOT_IMPLEMENTED = "Geschenkgutscheine sind noch nicht fertig eingerichtet.";

function notImplemented(): { ok: false; code: string; message: string } {
  return { ok: false, code: "not_implemented", message: NOT_IMPLEMENTED };
}

/** orders/paid: record the voucher units of a paid order (fast, never throws). */
export async function recordGiftVoucherOrder(
  payload: unknown
): Promise<{ ok: true; action: string; orderId: string | null; created: number } | { ok: false; action: string }> {
  void payload;
  return { ok: true, action: "gift_vouchers_not_implemented", orderId: null, created: 0 };
}

/** Issue the due vouchers of one order (for after(); never throws). */
export async function processGiftVoucherOrder(orderId: string): Promise<void> {
  void orderId;
}

/** orders/cancelled, orders/updated (refunds): revoke what the order no longer pays for. */
export async function handleGiftVoucherOrderChange(
  payload: unknown,
  topic: string
): Promise<{ ok: true; action: string } | { ok: false; action: string }> {
  void payload;
  void topic;
  return { ok: true, action: "gift_vouchers_not_implemented" };
}

export async function issueHeldGiftVoucher(id: number, actor: string): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  void id;
  void actor;
  return notImplemented();
}

export async function rejectGiftVoucher(id: number, note: string | null): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  void id;
  void note;
  return notImplemented();
}

export async function retryGiftVoucher(id: number): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  void id;
  return notImplemented();
}

export interface ManualGiftVoucherInput {
  amountCents: number;
  reason: Exclude<GiftVoucherReason, "verkauf">;
  designKey: string;
  recipientName: string | null;
  senderName: string | null;
  message: string | null;
  delivery: GiftVoucherDelivery;
  recipientEmail: string | null;
  address: GiftVoucherAddress | null;
  adminNote: string | null;
  actor: string;
}

export async function issueManualGiftVoucher(
  input: ManualGiftVoucherInput
): Promise<{ ok: true; id: number } | { ok: false; code: string; message: string; field?: string }> {
  void input;
  return notImplemented();
}

export async function resendGiftVoucherMail(id: number): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  void id;
  return notImplemented();
}

export async function deactivateGiftVoucher(id: number, reason: string): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  void id;
  void reason;
  return notImplemented();
}

export async function syncGiftVoucherBalance(id: number): Promise<{ ok: true; balanceCents: number } | { ok: false; message: string }> {
  void id;
  return { ok: false, message: NOT_IMPLEMENTED };
}

export interface GiftVoucherSweepResult {
  issued: number;
  held: number;
  deferred: number;
  failed: number;
  mailed: number;
  printSubmitted: number;
  printPolled: number;
  assetsCleaned: number;
  balancesSynced: number;
  fulfilled: number;
}

/** The cron sweep (retries, mails, print jobs, balances, fulfilment). */
export async function runGiftVoucherSweep(opts?: { deadlineMs?: number }): Promise<GiftVoucherSweepResult> {
  void opts;
  return {
    issued: 0,
    held: 0,
    deferred: 0,
    failed: 0,
    mailed: 0,
    printSubmitted: 0,
    printPolled: 0,
    assetsCleaned: 0,
    balancesSynced: 0,
    fulfilled: 0,
  };
}
