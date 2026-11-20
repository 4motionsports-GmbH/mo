// POST /api/admin/gutscheine/action  { action, id, note?, reason? }
//   → { ok: true, detail }  (reveal_code: { ok: true, code }; sync_balance also balanceCents)
//
// The operator's actions on one Geschenkgutschein (`id` = voucher id; the
// print actions act on its print job):
//   reveal_code      the full code, formatted „ABCD EFGH JKLM NPQR“ — only to
//                    the admin, never logged (audit gift_voucher.code_reveal)
//   issue_held       „Ausstellen“ of a held voucher (creates the Shopify card,
//                    mails the buyer) — lib/gift-voucher-issue.ts
//   reject {note?}   „Ablehnen“ (no card; refund in Shopify)
//   retry            „Erneut versuchen“ after an error
//   resend_mail      „E-Mail erneut senden“ (a new download link)
//   deactivate {reason}  „Sperren“ — the card is disabled in Shopify (final)
//   sync_balance     „Abgleichen“ — the balance from Shopify
//   note {note}      the internal note (≤ 1000 characters; empty clears)
//   clear_attention  „Als geklärt markieren“ (drops the attention flag)
//   print_release    „Freigeben“ (review → queued)
//   print_submit     „Jetzt drucken“ (print.one, behind GIFT_VOUCHER_PRINT_SENDS_APPROVED)
//   print_cancel     „Stornieren“ of the print job
//   print_done       „Als versendet markieren“ (printed by hand)
// The libraries decide whether an action is allowed; their German message
// comes back as the error (404 unknown, 409 wrong state, 502 Shopify /
// print.one failed, 503 not configured). Every successful action is
// audit-logged as gift_voucher.<action> (the reveal as gift_voucher.code_reveal)
// with ids only (voucher, print job,
// the buyer's customer id) — never a code, a note, a reason or an address.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";
import { formatGiftVoucherCode } from "@/lib/gift-voucher-core.mjs";
import {
  getGiftVoucher,
  getGiftVoucherCode,
  getGiftVoucherPrintJobForVoucher,
  setGiftVoucherAdminNote,
  setGiftVoucherAttention,
} from "@/lib/gift-voucher-store";
import {
  deactivateGiftVoucher,
  issueHeldGiftVoucher,
  rejectGiftVoucher,
  resendGiftVoucherMail,
  retryGiftVoucher,
  syncGiftVoucherBalance,
} from "@/lib/gift-voucher-issue";
import {
  cancelGiftVoucherPrintJob,
  markGiftVoucherPrintJobDone,
  releaseGiftVoucherPrintJob,
  submitGiftVoucherPrintJob,
} from "@/lib/gift-voucher-print";
import { actionErrorStatus, parseGutscheinAction } from "@/app/admin/gutscheine/gutscheine-core.mjs";
import { loadGutscheinDetail } from "@/app/admin/gutscheine/gutscheine-server";
import { ADMIN_ACTOR, giftVoucherTablesGate } from "../route-helpers";

export const maxDuration = 60;

type ActionResult = { ok: true } | { ok: false; code: string; message: string };

const PRINT_ACTIONS = new Set(["print_release", "print_submit", "print_cancel", "print_done"]);

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return adminJsonError("bad_request", "Ungültige Anfrage (kein JSON).", 400);
  }
  const parsed = parseGutscheinAction(body);
  if (!parsed.ok) return adminJsonError("bad_request", parsed.message, 400);
  const gate = await giftVoucherTablesGate();
  if (gate) return gate;
  const { action, id } = parsed;

  try {
    const voucher = await getGiftVoucher(id);
    if (!voucher) return adminJsonError("not_found", "Gutschein nicht gefunden.", 404);
    const audit = (detail: Record<string, unknown> = {}) =>
      recordAdminAccess(
        {
          action: action === "reveal_code" ? "gift_voucher.code_reveal" : `gift_voucher.${action}`,
          targetCustomerId: voucher.customerId,
          detail: { voucherId: id, ...detail },
        },
        req
      );

    if (action === "reveal_code") {
      if (!voucher.hasCode) return adminJsonError("no_code", "Für diesen Gutschein ist kein Code gespeichert.", 409);
      const code = await getGiftVoucherCode(id);
      if (!code) {
        return adminJsonError("not_configured", "Der Code lässt sich nicht entschlüsseln (TOKEN_ENC_KEY prüfen).", 503);
      }
      await audit();
      return new Response(JSON.stringify({ ok: true, code: formatGiftVoucherCode(code) }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    let jobId: number | null = null;
    if (PRINT_ACTIONS.has(action)) {
      const job = await getGiftVoucherPrintJobForVoucher(id);
      if (!job) return adminJsonError("not_found", "Dieser Gutschein hat keinen Druckauftrag.", 404);
      jobId = job.id;
    }

    let result: ActionResult;
    let balanceCents: number | null = null;
    switch (action) {
      case "issue_held":
        result = await issueHeldGiftVoucher(id, ADMIN_ACTOR);
        break;
      case "reject":
        result = await rejectGiftVoucher(id, parsed.note);
        break;
      case "retry":
        result = await retryGiftVoucher(id);
        break;
      case "resend_mail":
        result = await resendGiftVoucherMail(id);
        break;
      case "deactivate":
        result = await deactivateGiftVoucher(id, parsed.reason ?? "");
        break;
      case "sync_balance": {
        const r = await syncGiftVoucherBalance(id);
        result = r.ok ? { ok: true } : { ok: false, code: "failed", message: r.message };
        if (r.ok) balanceCents = r.balanceCents;
        break;
      }
      case "note":
        result = (await setGiftVoucherAdminNote(id, parsed.note))
          ? { ok: true }
          : { ok: false, code: "internal_error", message: "Die Notiz konnte nicht gespeichert werden." };
        break;
      case "clear_attention":
        result = (await setGiftVoucherAttention(id, null))
          ? { ok: true }
          : { ok: false, code: "internal_error", message: "Der Hinweis konnte nicht entfernt werden." };
        break;
      case "print_release":
        result = await releaseGiftVoucherPrintJob(jobId as number);
        break;
      case "print_submit": {
        const r = await submitGiftVoucherPrintJob(jobId as number);
        result = r.ok ? { ok: true } : r;
        break;
      }
      case "print_cancel":
        result = await cancelGiftVoucherPrintJob(jobId as number);
        break;
      case "print_done":
        result = await markGiftVoucherPrintJobDone(jobId as number);
        break;
      default:
        return adminJsonError("bad_request", "Unbekannte Aktion.", 400);
    }

    if (!result.ok) {
      const status = result.code === "internal_error" ? 500 : actionErrorStatus(result.code);
      return adminJsonError(result.code || "conflict", result.message || "Die Aktion ist nicht möglich.", status);
    }
    await audit(jobId !== null ? { jobId } : {});
    const detail = await loadGutscheinDetail(id);
    return adminJson(balanceCents !== null ? { ok: true, balanceCents, detail } : { ok: true, detail });
  } catch (err) {
    reportError(err, { route: "api/admin/gutscheine/action", phase: action });
    return adminJsonError("internal_error", "Die Aktion ist fehlgeschlagen.", 500);
  }
}
