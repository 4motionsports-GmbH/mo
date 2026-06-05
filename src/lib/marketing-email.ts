// Send-through-system for marketing emails. THIS is the only path that delivers
// a marketing email, and it concentrates every legal guarantee in one auditable
// place so no caller can bypass them:
//
//   1. ELIGIBILITY — the address must be marketing-eligible at send time:
//      marketing_doi_status = 'confirmed' AND not unsubscribed AND not on the
//      suppression list. Enforced twice: loadEligibleCapture (SQL) AND
//      canSendMarketing (independent check). If either fails, NOTHING is sent.
//   2. UNSUBSCRIBE — a working, signed unsubscribe link is ALWAYS appended. If
//      we can't build one (no signing secret), we REFUSE to send rather than
//      ship a marketing email without an opt-out.
//   3. CART + DISCOUNT — appended deterministically from the stored row, so the
//      admin's edits to the prose can never remove them.
//   4. LOGGING / SUPPRESSION — delivery goes through Resend (lib/email) which
//      logs failures; the status flip records that it was sent.
//
// The admin NEVER copies text into a personal mail client — sending always runs
// here. approveAndSend() claims the row, sends, and marks it sent (or reverts).

import { canSendMarketing, buildUnsubscribeToken } from "./email-capture-store";
import {
  getSendById,
  loadEligibleCapture,
  claimForSend,
  revertClaim,
  markSent,
} from "./marketing-store";
import { sendEmail } from "./email";
import { unsubscribeFooter } from "./consent-copy";
import { getBaseUrl } from "./base-url";
import {
  createUniqueDiscountCode,
  PLACEHOLDER_DISCOUNT_CODE,
} from "./shopify-discounts";
import { buildPrefilledCartUrlForIds } from "./cart";
import { reportError } from "./observability";

export type ApproveAndSendResult =
  | { ok: true; sentTo: string }
  | {
      ok: false;
      reason:
        | "not_found"
        | "already_sent"
        | "not_eligible"
        | "no_unsubscribe"
        | "claim_failed"
        | "discount_failed"
        | "email_not_configured"
        | "send_failed";
      message: string;
    };

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Approve and send a drafted marketing email through the system. Performs the
 * eligibility + unsubscribe gates, claims the row atomically, sends via Resend,
 * and flips it to 'sent'. Never throws.
 */
export async function approveAndSend(sendId: number): Promise<ApproveAndSendResult> {
  try {
    const send = await getSendById(sendId);
    if (!send) return { ok: false, reason: "not_found", message: "Draft not found." };
    if (send.status === "sent") {
      return { ok: false, reason: "already_sent", message: "Already sent." };
    }

    // GATE 1a — the capture must still be eligible (SQL-enforced: confirmed,
    // not unsubscribed, not suppressed).
    const capture = await loadEligibleCapture(send.emailCaptureId);
    if (!capture) {
      return {
        ok: false,
        reason: "not_eligible",
        message: "Recipient is not marketing-eligible (DOI not confirmed or suppressed).",
      };
    }
    const email = capture.email;

    // GATE 1b — independent re-check (defense in depth). Fail-closed.
    if (!(await canSendMarketing(email))) {
      return {
        ok: false,
        reason: "not_eligible",
        message: "Recipient is not marketing-eligible.",
      };
    }

    // GATE 2 — a working unsubscribe link is mandatory. No link → no send.
    const unsubToken = buildUnsubscribeToken(email);
    if (!unsubToken) {
      return {
        ok: false,
        reason: "no_unsubscribe",
        message: "Cannot build an unsubscribe link (signing secret not configured) — refusing to send.",
      };
    }
    const unsubscribeUrl = `${getBaseUrl()}/api/unsubscribe?token=${encodeURIComponent(unsubToken)}`;

    // Claim atomically so concurrent sends can't both proceed.
    const claimed = await claimForSend(sendId);
    if (!claimed) {
      return {
        ok: false,
        reason: "claim_failed",
        message: "Draft is already being sent or has been sent.",
      };
    }

    try {
      // GATE 3 — mint the REAL unique single-use code now (not at draft time, so
      // discarded drafts never burn a code). When a discount was selected we MUST
      // get a working code: the body already promises a personal offer, so if
      // minting fails we refuse to send a mail that references a dead code.
      let body = claimed.draftedText ?? "";
      let discountCode: string | null = null;
      let discountCodeGid: string | null = null;
      let discountExpiresAt: string | null = null;

      if (claimed.discountPercent > 0) {
        const minted = await createUniqueDiscountCode({
          percentage: claimed.discountPercent / 100,
        });
        if (!minted) {
          await revertClaim(sendId);
          return {
            ok: false,
            reason: "discount_failed",
            message:
              "Could not mint the unique Shopify discount code — refusing to send " +
              "an email that promises an offer. Check Shopify config and retry.",
          };
        }
        discountCode = minted.code;
        discountCodeGid = minted.gid;
        discountExpiresAt = minted.expiresAt;
        // Swap the preview placeholder for the real code wherever it appears so
        // the prose and the working code never disagree.
        body = body.split(PLACEHOLDER_DISCOUNT_CODE).join(minted.code);
      }

      // Build the cart permalink that actually ships: it carries ?discount=CODE
      // only when a real code was minted; otherwise no discount param.
      const cart = claimed.productIds.length
        ? await buildPrefilledCartUrlForIds(claimed.productIds, {
            discountCode: discountCode ?? undefined,
          })
        : { url: null as string | null };
      const cartUrl = cart.url;

      const { text, html } = renderMarketingEmail({
        body,
        cartUrl,
        discountCode,
        unsubscribe: unsubscribeFooter(unsubscribeUrl),
      });

      const result = await sendEmail({
        to: email,
        subject: claimed.subject ?? "motion sports",
        text,
        html,
        kind: "marketing",
      });

      if (!result.ok) {
        // Roll back the claim so the admin can retry.
        await revertClaim(sendId);
        if (result.skipped) {
          return {
            ok: false,
            reason: "email_not_configured",
            message: "Email delivery is not configured (RESEND_API_KEY / sender).",
          };
        }
        return { ok: false, reason: "send_failed", message: "Email delivery failed." };
      }

      // Persist the finalized artifacts (real code, gid, expiry, shipped cart,
      // body with the real code) so analytics has the complete record.
      await markSent(sendId, {
        discountCode,
        discountCodeGid,
        discountExpiresAt,
        cartUrl,
        draftedText: body,
      });
      return { ok: true, sentTo: email };
    } catch (err) {
      await revertClaim(sendId);
      throw err;
    }
  } catch (err) {
    reportError(err, { route: "lib/marketing-email", phase: "approveAndSend" });
    return { ok: false, reason: "send_failed", message: "Unexpected error while sending." };
  }
}

function renderMarketingEmail(opts: {
  body: string;
  cartUrl: string | null;
  discountCode: string | null;
  unsubscribe: { text: string; html: string };
}): { text: string; html: string } {
  const { body, cartUrl, discountCode, unsubscribe } = opts;

  // --- text part ---
  const textLines = [body.trim()];
  if (cartUrl) {
    textLines.push(
      "",
      discountCode
        ? `Dein vorausgefüllter Warenkorb (Code ${discountCode} ist bereits hinterlegt):`
        : "Dein vorausgefüllter Warenkorb:",
      cartUrl
    );
  }
  textLines.push("", "—", unsubscribe.text);
  const text = textLines.join("\n");

  // --- html part ---
  const cartButton = cartUrl
    ? `<p style="margin:24px 0">
         <a href="${cartUrl}" style="background:#111;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block">Warenkorb öffnen</a>
       </p>` +
      (discountCode
        ? `<p style="font-size:13px;color:#666;margin:-12px 0 0">Dein persönlicher Code <strong>${escapeHtml(
            discountCode
          )}</strong> ist im Warenkorb bereits hinterlegt.</p>`
        : "")
    : "";

  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#111">
  <div style="white-space:pre-wrap">${escapeHtml(body.trim())}</div>
  ${cartButton}
  ${unsubscribe.html}
</div>`;

  return { text, html };
}
