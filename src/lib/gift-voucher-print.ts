// STUB — replaced by P4 Print (spec §10, gift-voucher-print.ts).
//
// The Premium-Karte print pipeline (submit to print.one behind the legal gate
// GIFT_VOUCHER_PRINT_SENDS_APPROVED, poll, cancel, release from review,
// manual printing, asset cleanup). The exact exports, so the issuing sweep,
// the webhook and the admin compile while P4 is being built. Placeholders
// never throw and never hand an address to anyone: submissions answer
// `not_configured`, the batch helpers report zeros.
// giftVoucherPrintProvider is already the real rule.

import { configuredGiftVoucherPrintProvider } from "./gift-voucher-flags.mjs";
import type { GiftVoucherPrintProvider, GiftVoucherPrintStatus } from "./gift-voucher-store";
import { isPrintOneConfigured } from "./printone";

const NOT_IMPLEMENTED = "Der Kartendruck ist noch nicht fertig eingerichtet.";

/** GIFT_VOUCHER_PRINT_PROVIDER, falling back to the manual print queue while print.one is not configured. */
export function giftVoucherPrintProvider(): GiftVoucherPrintProvider {
  return configuredGiftVoucherPrintProvider() === "printone" && isPrintOneConfigured() ? "printone" : "manual";
}

export async function submitGiftVoucherPrintJob(
  jobId: number
): Promise<
  | { ok: true; status: GiftVoucherPrintStatus }
  | { ok: false; code: "gate_off" | "not_configured" | "manual" | "not_ready" | "review" | "failed" | "not_found"; message: string }
> {
  void jobId;
  return { ok: false, code: "not_configured", message: NOT_IMPLEMENTED };
}

export async function submitDueGiftVoucherPrintJobs(opts: { limit: number; deadlineMs?: number }): Promise<{ submitted: number; failed: number; skipped: number }> {
  void opts;
  return { submitted: 0, failed: 0, skipped: 0 };
}

export async function pollGiftVoucherPrintJobs(opts: { limit: number }): Promise<{ updated: number }> {
  void opts;
  return { updated: 0 };
}

export async function cancelGiftVoucherPrintJob(
  jobId: number
): Promise<{ ok: true } | { ok: false; code: "too_late" | "failed" | "not_found"; message: string }> {
  void jobId;
  return { ok: false, code: "failed", message: NOT_IMPLEMENTED };
}

/** review → queued. */
export async function releaseGiftVoucherPrintJob(jobId: number): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  void jobId;
  return { ok: false, code: "not_implemented", message: NOT_IMPLEMENTED };
}

/** Manual fulfilment done. */
export async function markGiftVoucherPrintJobDone(jobId: number): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  void jobId;
  return { ok: false, code: "not_implemented", message: NOT_IMPLEMENTED };
}

export async function cleanupGiftVoucherPrintAssets(opts: { limit: number }): Promise<{ deleted: number }> {
  void opts;
  return { deleted: 0 };
}

/** The two print spreads of a job (admin download for manual printing). */
export async function giftVoucherPrintFiles(jobId: number): Promise<{ outside: Buffer; inside: Buffer } | null> {
  void jobId;
  return null;
}
