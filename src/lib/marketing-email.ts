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
  generateRedirectToken,
} from "./marketing-store";
import { sendEmail, senderAddress } from "./email";
import { outboundThreading } from "./email-inbound";
import { recordSentMessage } from "./email-messages-store";
import {
  renderBrandedEmail,
  escapeHtml,
  EMAIL_TEXT_STYLE,
  EMAIL_MUTED_TEXT_STYLE,
} from "./email-template";
import { unsubscribeFooter } from "./consent-copy";
import { getBaseUrl } from "./base-url";
import {
  createUniqueDiscountCode,
  formatGermanExpiryDate,
  PLACEHOLDER_DISCOUNT_CODE,
} from "./shopify-discounts";
import { detectDiscountTextMismatch } from "./discount-validation.mjs";
import { buildPrefilledCartUrlForIds } from "./cart";
import { getActiveBundleForSend } from "./bundle-offers-store";
import { buildBundleRedirectUrl } from "./bundle-offers";
import { renderBundleOfferBlock } from "./bundle-email";
import { shouldRenderBundleBlock } from "./bundle-email-core.mjs";
import { loadProductCatalog } from "./catalog-store";
import { reportError } from "./observability";
import type { Product } from "./types";

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
        | "discount_mismatch"
        | "discount_failed"
        | "email_not_configured"
        | "send_failed";
      message: string;
    };

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
      // GATE 3a — the percentage the customer READS comes only from the editable
      // prose (the code + deadline ship deterministically, but the % does not).
      // Refuse if the body clearly states a DIFFERENT discount than the chosen
      // depth, so we never ship copy that promises e.g. 20 % while the coupon
      // grants 10 %. This is the server-side backstop for the dashboard's
      // regenerate-lockout; it's conservative (only a clear in-range contradiction
      // blocks — see detectDiscountTextMismatch) so it can't false-block a send.
      if (claimed.discountPercent > 0) {
        const { mismatch } = detectDiscountTextMismatch(
          claimed.discountPercent,
          claimed.draftedText ?? ""
        );
        if (mismatch) {
          await revertClaim(sendId);
          return {
            ok: false,
            reason: "discount_mismatch",
            message:
              `Der Rabatt im E-Mail-Text stimmt nicht mit dem gewählten Rabatt von ` +
              `${claimed.discountPercent} % überein. Bitte „↻ Neu generieren" und erneut senden.`,
          };
        }
      }

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
        // Same for the expiry date: the prose names the date PROJECTED at draft
        // time, but the real code minted just now expires N days from NOW. If
        // the draft sat around, swap the stale date string for the real one so
        // the stated deadline always matches the code that ships.
        const realExpiryLabel = formatGermanExpiryDate(minted.expiresAt);
        if (claimed.discountExpiresAt) {
          const draftExpiryLabel = formatGermanExpiryDate(claimed.discountExpiresAt);
          if (draftExpiryLabel !== realExpiryLabel) {
            body = body.split(draftExpiryLabel).join(realExpiryLabel);
          }
        }
      }

      // Build the cart permalink that actually ships: it carries ?discount=CODE
      // only when a real code was minted; otherwise no discount param.
      // excludeSoldOut re-checked at SEND time (not just draft time) so an item
      // that sold out while the draft sat around never enters the shipped cart.
      const cart = claimed.productIds.length
        ? await buildPrefilledCartUrlForIds(claimed.productIds, {
            discountCode: discountCode ?? undefined,
            excludeSoldOut: true,
          })
        : { url: null as string | null };
      const cartUrl = cart.url;

      // CLICK-TRACKING: route the click through our own redirect so it's visible
      // to the KPI dashboard. The REAL Shopify cart URL (with ?discount=CODE)
      // stays server-side on the row; the email links to /api/r/<token>, which
      // logs the click and 302s to that cart. Only when there's an actual cart to
      // link to — no cart ⇒ no token, no tracked link.
      let redirectToken: string | null = null;
      let linkUrl: string | null = cartUrl;
      if (cartUrl) {
        redirectToken = generateRedirectToken();
        linkUrl = `${getBaseUrl()}/api/r/${redirectToken}`;
      }

      // SPECIAL-OFFER block — ADDITIVE. When a created, still-active bundle is
      // attached to this send, render it as a special-offer block in the body.
      // This touches NONE of the send safeguards above (eligibility, unsubscribe,
      // discount minting, click-tracking) — a send may carry a discount, a
      // bundle, both, or neither. A bundle resolution failure must never block a
      // send, so it degrades to "no block".
      const bundle = await buildBundleBlockForSend(sendId);

      const { text, html } = renderMarketingEmail({
        subject: claimed.subject ?? "motion sports",
        body,
        // The customer sees/clicks the tracked redirect URL, not the raw cart.
        linkUrl,
        discountCode,
        // Deterministic deadline next to the code, derived from the REAL minted
        // expiry — stated even if the AI prose were edited to drop it.
        discountExpiresLabel: discountExpiresAt
          ? formatGermanExpiryDate(discountExpiresAt)
          : null,
        unsubscribe: unsubscribeFooter(unsubscribeUrl),
        bundle,
      });

      // Our own Message-ID + an inbound Reply-To so a reply threads back into
      // the unified mail log (mirror-write below).
      const threading = outboundThreading();
      const result = await sendEmail({
        to: email,
        subject: claimed.subject ?? "motion sports",
        text,
        html,
        kind: "marketing",
        messageId: threading.messageId,
        replyTo: threading.replyTo,
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

      // Persist the finalized artifacts (real code, gid, expiry, the REAL shipped
      // cart URL, the redirect token that maps to it, and the body with the real
      // code) so analytics has the complete record and the redirect can resolve.
      await markSent(sendId, {
        discountCode,
        discountCodeGid,
        discountExpiresAt,
        cartUrl,
        draftedText: body,
        redirectToken,
      });

      // MIRROR-WRITE (additive, fail-soft): record this campaign send in the
      // unified mail log, LINKED to the workflow row via marketing_send_id. The
      // body we actually shipped is `text`. Never blocks the send.
      await recordSentMessage({
        toAddress: email,
        fromAddress: senderAddress() ?? "",
        subject: claimed.subject ?? "motion sports",
        bodyText: text,
        bodyHtml: html,
        messageId: threading.messageId,
        customerId: claimed.customerId,
        marketingSendId: sendId,
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

/** First usable absolute-https catalog image, or null (mail clients won't load a
 * relative/http image). */
function firstImageUrl(p: Product | undefined): string | null {
  return p?.images?.find((u) => typeof u === "string" && u.startsWith("https://")) ?? null;
}

/**
 * Resolve the bundle attached to this send (if any) and render its special-offer
 * block. Returns null when no live bundle is attached — so the block is OMITTED
 * (the pure shouldRenderBundleBlock guard centralizes that "active-only" rule).
 * Never throws; a failure degrades to "no block" so a send is never blocked by
 * the bundle path.
 */
async function buildBundleBlockForSend(
  sendId: number
): Promise<{ text: string; html: string } | null> {
  try {
    const bundle = await getActiveBundleForSend(sendId);
    if (!shouldRenderBundleBlock(bundle) || !bundle) return null;
    const offerUrl = buildBundleRedirectUrl(bundle.redirectToken);
    if (!offerUrl) return null;

    // Resolve component images from the live catalog (the row snapshots names +
    // prices, not images — the latter can drift, so we look them up fresh).
    const catalog = await loadProductCatalog();
    const byId = new Map(catalog.map((p) => [p.id, p]));
    const components = bundle.components.map((c) => ({
      name: c.title,
      imageUrl: firstImageUrl(byId.get(c.productId)),
    }));

    return renderBundleOfferBlock({
      title: bundle.title ?? "Dein persönliches Set",
      components,
      bundlePrice: bundle.bundlePrice,
      componentsSum: bundle.componentsSum,
      currency: bundle.currency,
      offerUrl,
    });
  } catch (err) {
    reportError(err, { route: "lib/marketing-email", phase: "buildBundleBlockForSend" });
    return null;
  }
}

function renderMarketingEmail(opts: {
  /** Subject line — reused for the HTML <title>/preview line. */
  subject: string;
  body: string;
  /** The URL the cart button/link points at — the tracked /api/r/<token>
   *  redirect, NOT the raw Shopify cart (which is kept server-side). */
  linkUrl: string | null;
  discountCode: string | null;
  /** German-formatted expiry date of the minted code ("TT.MM.JJJJ"); stated
   *  deterministically next to the code so the deadline always ships. */
  discountExpiresLabel: string | null;
  unsubscribe: { text: string; html: string };
  /** Optional special-offer block for an attached bundle (text + HTML parts). */
  bundle: { text: string; html: string } | null;
}): { text: string; html: string } {
  const { subject, body, linkUrl, discountCode, discountExpiresLabel, unsubscribe, bundle } = opts;

  const validityNote = discountExpiresLabel
    ? `, gültig bis ${discountExpiresLabel}`
    : "";

  // --- text part ---
  const textLines = [body.trim()];
  // The special-offer block (when a bundle is attached) sits right after the
  // prose, before the cart link + unsubscribe footer.
  if (bundle) textLines.push(bundle.text);
  if (linkUrl) {
    textLines.push(
      "",
      discountCode
        ? `Dein vorausgefüllter Warenkorb (Code ${discountCode}${validityNote} ist bereits hinterlegt):`
        : "Dein vorausgefüllter Warenkorb:",
      linkUrl
    );
  } else if (discountCode) {
    // No cart to link (no products on the row) — the code + deadline must
    // still appear outside the editable prose.
    textLines.push("", `Dein persönlicher Code: ${discountCode}${validityNote}.`);
  }
  textLines.push("", "—", unsubscribe.text);
  const text = textLines.join("\n");

  // --- html part — rendered through the shared branded template ---
  // The discount note is rendered as the CTA footnote so the code + deadline
  // ship deterministically OUTSIDE the editable prose; the cart button always
  // points at the tracked redirect (linkUrl), never the raw Shopify cart; and
  // the unsubscribe block goes through the template's dedicated footer slot,
  // which a content edit can never remove.
  const discountNote = linkUrl
    ? discountCode
      ? `<p style="${EMAIL_MUTED_TEXT_STYLE} padding-top: 5px; padding-bottom: 10px;" align="center">Dein pers&#246;nlicher Code <strong>${escapeHtml(
          discountCode
        )}</strong> ist im Warenkorb bereits hinterlegt${escapeHtml(validityNote)}.</p>`
      : ""
    : discountCode
      ? `<p style="${EMAIL_MUTED_TEXT_STYLE} padding-top: 5px; padding-bottom: 10px;" align="center">Dein pers&#246;nlicher Code: <strong>${escapeHtml(
          discountCode
        )}</strong>${escapeHtml(validityNote)}.</p>`
      : "";

  const html = renderBrandedEmail({
    subject,
    preheader: body.trim().split("\n")[0]?.slice(0, 140) || undefined,
    heading: "Deine persönliche Empfehlung",
    // The bundle special-offer block (if any) is appended to the prose body so
    // it renders above the cart CTA/unsubscribe footer.
    bodyHtml: `
                                  <p style="${EMAIL_TEXT_STYLE} white-space: pre-wrap;" align="left">${escapeHtml(
                                    body.trim()
                                  )}</p>${bundle ? bundle.html : ""}`,
    ctas: linkUrl ? [{ label: "Warenkorb öffnen", url: linkUrl }] : [],
    footnoteHtml: discountNote || undefined,
    footer: {
      // GATE 2 guarantees `unsubscribe` is always present — every marketing
      // email carries the opt-out block.
      unsubscribeHtml: unsubscribe.html,
    },
  });

  return { text, html };
}
