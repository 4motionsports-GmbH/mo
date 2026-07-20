// Send-through-system for CAMPAIGN emails (Kampagnen-Modul, R12). THIS is the
// only path that delivers a campaign email, and it concentrates every legal
// guarantee in one auditable place — the campaign sibling of
// marketing-email.approveAndSend:
//
//   1. GATES — evaluated in one place (campaign-gates.mjs), all fail-closed:
//      a. CAMPAIGN_SENDS_APPROVED master flag (lawyer sign-off; default false —
//         while false NOTHING is sent, via UI or direct API call).
//      b. Opt-in level: contacts without a provable double opt-in
//         (SINGLE_OPT_IN / UNKNOWN) are refused unless
//         CAMPAIGN_ALLOW_SINGLE_OPT_IN is explicitly true.
//      c. Suppression re-checked at send time against OUR opt-out store.
//      d. Cross-channel frequency cap: MARKETING_MIN_SEND_INTERVAL_DAYS spans
//         BOTH channels (marketing_sends + campaign_sends) in both directions.
//   2. UNSUBSCRIBE — the signed unsubscribe link is ALWAYS appended (footer +
//      List-Unsubscribe header); if we can't build one, we REFUSE to send.
//   3. DISCOUNT — the real unique MK- code is minted only now (never at draft
//      time) and swapped for the placeholder via the SAME logic the marketing
//      path uses (discount-swap.mjs); mismatched prose refuses to ship.
//   4. PROMO + FOOTER — the Mo-promo block (deep link) and the unsubscribe/
//      Impressum footer are appended deterministically, outside the editable
//      prose.
//   5. RECORD — the immutable campaign_sends row (body hash, code, gid, expiry)
//      is written so redemption/KPI reads can include MK- codes.

import { isSuppressed, buildUnsubscribeToken } from "./email-capture-store";
import {
  claimContactForSend,
  getContactById,
  getDraftForContact,
  hashCampaignBody,
  lastCrossChannelSendAt,
  markContactSent,
  recordCampaignSend,
  revertContactClaim,
} from "./campaign-store";
import {
  evaluateCampaignSendGates,
  GATE_REASONS,
} from "./campaign-gates.mjs";
import {
  campaignMoDeeplinkUrl,
  isCampaignSendsApproved,
  isSingleOptInAllowed,
} from "./campaign-flags.mjs";
import {
  moPromoBlockText,
  moPromoIntroText,
  moPromoCtaLabel,
} from "./campaign-draft-core.mjs";
import { parseIntEnv } from "./env-num";
import { sendEmail } from "./email";
import { outboundThreading } from "./email-inbound";
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
import { applyMintedDiscountToBody } from "./discount-swap.mjs";
import { reportError } from "./observability";

/** Code prefix for campaign codes — distinct from the marketing "MS5" so
 * campaign revenue stays separable in the KPI dashboard. */
export const CAMPAIGN_DISCOUNT_CODE_PREFIX = "MK";

export type CampaignSendResult =
  | { ok: true; sentTo: string }
  | {
      ok: false;
      reason:
        | "not_found"
        | "no_draft"
        | "already_sent"
        | "sends_not_approved"
        | "opt_in_blocked"
        | "not_eligible"
        | "too_soon"
        | "no_unsubscribe"
        | "claim_failed"
        | "discount_mismatch"
        | "discount_failed"
        | "email_not_configured"
        | "send_failed";
      message: string;
    };

function minSendIntervalDays(): number {
  return parseIntEnv("MARKETING_MIN_SEND_INTERVAL_DAYS", 0, 0);
}

/**
 * Approve and send a drafted campaign email through the system. Performs every
 * gate, claims the contact atomically, mints the MK- code (if a depth was
 * selected), sends via Resend with unsubscribe link + header, records the
 * immutable send row and flips the contact to 'sent'. Never throws.
 */
export async function approveAndSendCampaign(contactId: number): Promise<CampaignSendResult> {
  try {
    const contact = await getContactById(contactId);
    if (!contact) return { ok: false, reason: "not_found", message: "Contact not found." };
    if (contact.status === "sent") {
      return { ok: false, reason: "already_sent", message: "Already sent." };
    }
    const draft = await getDraftForContact(contactId);
    if (!draft) {
      return { ok: false, reason: "no_draft", message: "No draft exists for this contact." };
    }

    // GATE 1 — all campaign gates, evaluated before any claim/mint/send step.
    const gate = evaluateCampaignSendGates({
      sendsApproved: isCampaignSendsApproved(),
      allowSingleOptIn: isSingleOptInAllowed(),
      optInLevel: contact.optInLevel,
      suppressed: await isSuppressed(contact.email),
      lastSendAt: await lastCrossChannelSendAt(contact.email),
      minIntervalDays: minSendIntervalDays(),
    });
    if (!gate.allowed) {
      switch (gate.reason) {
        case GATE_REASONS.NOT_APPROVED:
          return {
            ok: false,
            reason: "sends_not_approved",
            message:
              "Kampagnen-Versand ist noch nicht freigegeben (CAMPAIGN_SENDS_APPROVED) — " +
              "die anwaltliche Freigabe für diesen Kanal steht aus. Kopieren/Vorschau bleibt möglich.",
          };
        case GATE_REASONS.OPT_IN_LEVEL:
          return {
            ok: false,
            reason: "opt_in_blocked",
            message:
              "Für diesen Kontakt liegt kein nachweisbares Double-Opt-in vor " +
              "(Shopify-Opt-in-Level) — erneute Einwilligung erforderlich.",
          };
        case GATE_REASONS.TOO_SOON:
          return {
            ok: false,
            reason: "too_soon",
            message: `Diese Adresse wurde innerhalb der letzten ${minSendIntervalDays()} Tage bereits angeschrieben (kanalübergreifend).`,
          };
        default:
          return {
            ok: false,
            reason: "not_eligible",
            message: "Recipient is suppressed/unsubscribed — refusing to send.",
          };
      }
    }

    // GATE 2 — a working unsubscribe link is mandatory. No link → no send.
    const unsubToken = buildUnsubscribeToken(contact.email);
    if (!unsubToken) {
      return {
        ok: false,
        reason: "no_unsubscribe",
        message:
          "Cannot build an unsubscribe link (signing secret not configured) — refusing to send.",
      };
    }
    const unsubscribeUrl =
      `${getBaseUrl()}/api/unsubscribe?token=${encodeURIComponent(unsubToken)}` +
      (contact.language === "en" ? "&locale=en" : "");

    // Claim atomically so concurrent sends can't both proceed.
    const claimed = await claimContactForSend(contactId);
    if (!claimed) {
      return {
        ok: false,
        reason: "claim_failed",
        message: "Contact is already being sent or has been sent.",
      };
    }

    try {
      // GATE 3a — the percentage the customer READS comes only from the
      // editable prose; refuse a clear contradiction (same conservative
      // backstop as the marketing path).
      if (draft.discountPercent > 0) {
        const { mismatch } = detectDiscountTextMismatch(draft.discountPercent, draft.body);
        if (mismatch) {
          await revertContactClaim(contactId);
          return {
            ok: false,
            reason: "discount_mismatch",
            message:
              `Der Rabatt im E-Mail-Text stimmt nicht mit dem gewählten Rabatt von ` +
              `${draft.discountPercent} % überein. Bitte „↻ Neu generieren" und erneut senden.`,
          };
        }
      }

      // GATE 3b — mint the REAL unique single-use MK- code now (never at draft
      // time). When a discount was selected we MUST get a working code.
      let body = draft.body;
      let discountCode: string | null = null;
      let discountCodeGid: string | null = null;
      let discountExpiresAt: string | null = null;

      if (draft.discountPercent > 0) {
        const minted = await createUniqueDiscountCode({
          percentage: draft.discountPercent / 100,
          codePrefix: CAMPAIGN_DISCOUNT_CODE_PREFIX,
          title: `Kampagnen-Rabatt (${draft.discountPercent}%)`,
        });
        if (!minted) {
          await revertContactClaim(contactId);
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
        // Same swap logic as the marketing path (discount-swap.mjs): real code
        // in for the placeholder, real expiry label in for a stale projection.
        body = applyMintedDiscountToBody(body, {
          placeholder: PLACEHOLDER_DISCOUNT_CODE,
          code: minted.code,
          draftExpiryLabel: draft.discountExpiresAt
            ? formatGermanExpiryDate(draft.discountExpiresAt)
            : null,
          realExpiryLabel: formatGermanExpiryDate(minted.expiresAt),
        });
      }

      const { text, html } = renderCampaignEmail({
        subject: draft.subject,
        body,
        language: contact.language,
        discountCode,
        discountExpiresLabel: discountExpiresAt
          ? formatGermanExpiryDate(discountExpiresAt)
          : null,
        unsubscribe: unsubscribeFooter(unsubscribeUrl, contact.language),
      });

      const threading = outboundThreading();
      const result = await sendEmail({
        to: contact.email,
        subject: draft.subject,
        text,
        html,
        kind: "campaign",
        messageId: threading.messageId,
        replyTo: threading.replyTo,
        listUnsubscribeUrl: unsubscribeUrl,
      });

      if (!result.ok) {
        await revertContactClaim(contactId);
        if (result.skipped) {
          return {
            ok: false,
            reason: "email_not_configured",
            message: "Email delivery is not configured (RESEND_API_KEY / sender).",
          };
        }
        return { ok: false, reason: "send_failed", message: "Email delivery failed." };
      }

      // Immutable audit/KPI record — the redemption + revenue reads pick the
      // MK- code up from here.
      await recordCampaignSend({
        contactId,
        email: contact.email,
        subject: draft.subject,
        bodyHash: hashCampaignBody(text),
        sentVia: "email",
        discountCode,
        discountCodeGid,
        discountExpiresAt,
      });
      await markContactSent(contactId);
      return { ok: true, sentTo: contact.email };
    } catch (err) {
      await revertContactClaim(contactId);
      throw err;
    }
  } catch (err) {
    reportError(err, { route: "lib/campaign-email", phase: "approveAndSendCampaign" });
    return { ok: false, reason: "send_failed", message: "Unexpected error while sending." };
  }
}

/**
 * Render the campaign email (text + HTML): the (edited) prose, then the
 * deterministic Mo-promo block with the deep-link CTA, the deterministic
 * discount line (code + deadline outside the editable prose), and the
 * unsubscribe footer. The branded shell carries the Impressum menu + legal
 * company footer (email-template.ts), matching every other outgoing mail.
 */
function renderCampaignEmail(opts: {
  subject: string;
  body: string;
  language: "de" | "en";
  discountCode: string | null;
  discountExpiresLabel: string | null;
  unsubscribe: { text: string; html: string };
}): { text: string; html: string } {
  const { subject, body, language, discountCode, discountExpiresLabel, unsubscribe } = opts;
  const en = language === "en";
  const deeplink = campaignMoDeeplinkUrl();

  const validityNote = discountExpiresLabel
    ? en
      ? `, valid until ${discountExpiresLabel}`
      : `, gültig bis ${discountExpiresLabel}`
    : "";

  // --- text part ---
  const textLines = [body.trim()];
  if (discountCode) {
    textLines.push(
      "",
      en
        ? `Your personal code: ${discountCode}${validityNote}.`
        : `Dein persönlicher Code: ${discountCode}${validityNote}.`
    );
  }
  textLines.push("", moPromoBlockText(language, deeplink));
  textLines.push("", "—", unsubscribe.text);
  const text = textLines.join("\n");

  // --- html part — the shared branded template ---
  const discountNote = discountCode
    ? `<p style="${EMAIL_MUTED_TEXT_STYLE} padding-top: 5px; padding-bottom: 10px;" align="center">${
        en ? "Your personal code" : "Dein pers&#246;nlicher Code"
      }: <strong>${escapeHtml(discountCode)}</strong>${escapeHtml(validityNote)}.</p>`
    : "";
  const promoHtml = `<p style="${EMAIL_TEXT_STYLE} padding-top: 16px;" align="left">${escapeHtml(
    moPromoIntroText(language)
  )}</p>`;

  const html = renderBrandedEmail({
    subject,
    preheader: body.trim().split("\n")[0]?.slice(0, 140) || undefined,
    heading: en ? "Your personal recommendation" : "Deine persönliche Empfehlung",
    bodyHtml: `
                                  <p style="${EMAIL_TEXT_STYLE} white-space: pre-wrap;" align="left">${escapeHtml(
                                    body.trim()
                                  )}</p>${promoHtml}`,
    ctas: [{ label: moPromoCtaLabel(language), url: deeplink }],
    footnoteHtml: discountNote || undefined,
    footer: {
      // GATE 2 guarantees `unsubscribe` is always present.
      unsubscribeHtml: unsubscribe.html,
    },
    locale: language,
  });

  return { text, html };
}
