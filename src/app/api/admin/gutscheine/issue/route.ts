// POST /api/admin/gutscheine/issue
//   { amountCents, reason, designKey, recipientName?, senderName?, message?,
//     delivery: "pdf" | "email" | "print", recipientEmail?, address?, adminNote? }
//   → { ok: true, id, number, status, lastError }
//
// „Gutschein ausstellen“ — a Geschenkgutschein issued by hand (Kulanz,
// Marketing, Gewinnspiel, Firmengeschenk, Sonstiges). Checked here with the
// screen's rules (gutscheine-core.mjs validateIssueInput: amount up to
// GIFT_VOUCHER_ADMIN_MAX_EUR, no „Eigenes Foto“, marketing only as PDF, a valid
// e-mail / postal address for GIFT_VOUCHER_PRINT_COUNTRIES, printable texts
// within their limits); lib/gift-voucher-issue.ts issueManualGiftVoucher
// checks again, creates the Shopify gift card at once and — per delivery —
// mails it or creates the print job. `ok` means the voucher exists; whether
// the card was created right away is its `status` („issued“ — otherwise the
// sweep retries and `lastError` says why; the dialog warns, gutscheine-core.mjs
// issuedToast). A refused input answers 400 { error: { code, message, field } }
// (German); the library's other refusals get actionErrorStatus (409 / 500 /
// 502 / 503). Audit-logged (gift_voucher.issue, voucher id only — never an
// address, e-mail or text).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";
import { giftVoucherLimits, giftVoucherPrintCountries } from "@/lib/gift-voucher-flags.mjs";
import { getGiftVoucher } from "@/lib/gift-voucher-store";
import { issueManualGiftVoucher } from "@/lib/gift-voucher-issue";
import { actionErrorStatus, validateIssueInput } from "@/app/admin/gutscheine/gutscheine-core.mjs";
import { ADMIN_ACTOR, giftVoucherTablesGate } from "../route-helpers";

export const maxDuration = 60;

function fieldError(code: string, message: string, field: string | undefined, status: number): Response {
  return adminJson({ error: { code, message, ...(field ? { field } : {}) } }, status);
}

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return adminJsonError("bad_request", "Ungültige Anfrage (kein JSON).", 400);
  }
  const gate = await giftVoucherTablesGate();
  if (gate) return gate;

  const parsed = validateIssueInput(body, {
    adminMaxCents: giftVoucherLimits().adminMaxCents,
    printCountries: giftVoucherPrintCountries(),
  });
  if (!parsed.ok) return fieldError("bad_request", parsed.message, parsed.field, 400);

  try {
    const res = await issueManualGiftVoucher({ ...parsed.value, actor: ADMIN_ACTOR });
    if (!res.ok) {
      const status = res.field ? 400 : actionErrorStatus(res.code);
      return fieldError(res.code || "conflict", res.message || "Der Gutschein konnte nicht ausgestellt werden.", res.field, status);
    }
    await recordAdminAccess({ action: "gift_voucher.issue", detail: { voucherId: res.id } }, req);
    const voucher = await getGiftVoucher(res.id);
    return adminJson({
      ok: true,
      id: res.id,
      number: voucher?.number ?? null,
      status: voucher?.status ?? null,
      lastError: voucher?.lastError ?? null,
    });
  } catch (err) {
    reportError(err, { route: "api/admin/gutscheine/issue" });
    return adminJsonError("internal_error", "Der Gutschein konnte nicht ausgestellt werden.", 500);
  }
}
