// Send-through-system for CAMPAIGN emails (Kampagnen-Modul, R12). THIS is the
// only path that delivers a campaign email, and it concentrates every legal
// guarantee in one auditable place — the campaign sibling of
// marketing-email.approveAndSend:
//
//   0. CAMPAIGN — the recipient's campaign must be live (aktiv, inside its
//      schedule); a Testkontakt may preview a campaign before it starts.
//   1. GATES — evaluated in one place (campaign-gates.mjs), all fail-closed:
//      a. CAMPAIGN_SENDS_APPROVED master flag (lawyer sign-off; default false —
//         while false NOTHING is sent, via UI or direct API call).
//      b. The one consent (customers.email_consent_state, shared with
//         Shopify) must be `subscribed` — read fresh at send time.
//      c. Opt-in level (customers.email_consent_level): no provable double
//         opt-in → refused unless CAMPAIGN_ALLOW_SINGLE_OPT_IN is true.
//      d. Suppression re-checked at send time against OUR opt-out store.
//      e. Cross-channel frequency cap: MARKETING_MIN_SEND_INTERVAL_DAYS spans
//         BOTH channels (marketing_sends + campaign_sends) in both directions.
//   2. UNSUBSCRIBE — the signed unsubscribe link is ALWAYS appended (footer +
//      List-Unsubscribe header); if we can't build one, we REFUSE to send.
//   3. DISCOUNT — the real unique MK- code is minted only now (never at draft
//      time) and swapped for the placeholder via the SAME logic the marketing
//      path uses (discount-swap.mjs); mismatched prose refuses to ship. A mail
//      is a set offer OR single items (offer-mode.mjs): a set mail carries NO
//      code — a draft with an active set AND a discount is refused
//      (offer_conflict), and no code is ever minted for a set mail.
//   4. PROMO + FOOTER — the Mo-promo block (deep link) and the unsubscribe/
//      Impressum footer are appended deterministically, outside the editable
//      prose.
//   5. RECORD — the immutable campaign_sends row (body hash, code, gid, expiry)
//      is written so redemption/KPI reads can include MK- codes.

import { isSuppressed, buildUnsubscribeToken, buildErasureUrl } from "./email-capture-store";
import {
  claimContactForSend,
  getContactById,
  getDraftForContact,
  hashCampaignBody,
  lastCrossChannelSendAt,
  markContactSent,
  recordCampaignSend,
  resetTestContactAfterSend,
  revertContactClaim,
} from "./campaign-store";
import {
  evaluateCampaignSendGates,
  GATE_REASONS,
  optInLevelFromConsent,
} from "./campaign-gates.mjs";
import { getCampaignForContact, campaignAcceptsWork, type Campaign } from "./campaigns-store";
import { getCustomerById } from "./customer-store";
import { recordSentMessage } from "./email-messages-store";
import {
  campaignMoDeeplinkUrl,
  isCampaignSendsApproved,
  isSingleOptInAllowed,
  marketingMinSendIntervalDays,
} from "./campaign-flags.mjs";
import {
  moPromoBlockText,
  moPromoIntroText,
  moPromoCtaLabel,
} from "./campaign-draft-core.mjs";
import { sendEmail, senderAddress } from "./email";
import { outboundThreading } from "./email-inbound";
import { withEmailDesign, withEmailRenderData } from "./email-design-context";
import { getEmailDesignForKey } from "./email-design-store";
import { getEmailHeroRenderData } from "./email-hero-store";
import {
  renderBrandedEmail,
  renderMoPromoBlock,
  renderSectionBand,
  renderSectionRow,
  emailTextStyle,
  emailLinkStyle,
  renderOfferCountdown,
  renderDiscountCoupon,
} from "./email-template";
import { renderEmailProductRows, productRowItems, catalogNameLookup } from "./email-products";
import { unsubscribeFooter } from "./consent-copy";
import { getBaseUrl } from "./base-url";
import { withLocaleParam } from "./locale";
import {
  createUniqueDiscountCode,
  formatExpiryDateForLanguage,
  formatGermanExpiryDate,
  PLACEHOLDER_DISCOUNT_CODE,
} from "./shopify-discounts";
import { detectDiscountTextMismatch } from "./discount-validation.mjs";
import type { DiscountScope } from "./discount-scope.mjs";
import { fetchProductGidsByHandles } from "./shopify";
import { applyMintedDiscountToBody, hasStrayPlaceholder } from "./discount-swap.mjs";
import {
  renderEmailProseHtml,
  emailProseToText,
} from "./email-prose.mjs";
import { generateRedirectToken } from "./marketing-store";
import { getActiveBundleForCampaignContact, type BundleOfferRow } from "./bundle-offers-store";
import { buildBundleRedirectUrl } from "./bundle-offers";
import { bundleEmailComponents, renderBundleOfferBlock, type BundleEmailComponent } from "./bundle-email";
import { countdownText, earliestDeadline } from "./offer-countdown.mjs";
import { couponText } from "./discount-coupon.mjs";
import { shouldRenderBundleBlock } from "./bundle-email-core.mjs";
import { OFFER_CONFLICT_MESSAGE, offerConflict } from "./offer-mode.mjs";
import { loadProductCatalog } from "./catalog-store";
import { resolveProductSelections } from "./product-catalog";
import { reportError } from "./observability";
import type { Product } from "./types";

/** Code prefix for campaign codes — distinct from the marketing "MS5" so
 * campaign revenue stays separable in the KPI dashboard. */
const CAMPAIGN_DISCOUNT_CODE_PREFIX = "MK";

export type CampaignSendResult =
  | { ok: true; sentTo: string; test: boolean }
  | {
      ok: false;
      reason:
        | "not_found"
        | "no_draft"
        | "campaign_closed"
        | "no_consent"
        | "already_sent"
        | "sends_not_approved"
        | "opt_in_blocked"
        | "not_eligible"
        | "too_soon"
        | "no_unsubscribe"
        | "claim_failed"
        | "discount_mismatch"
        | "discount_scope_unresolved"
        | "offer_conflict"
        | "discount_failed"
        | "email_not_configured"
        | "send_failed";
      message: string;
    };

/** Refusal text for a draft still carrying the retired scope "set"
 * (discount-scope.mjs: history only since 12.10.2026). */
const SET_SCOPE_RETIRED_MESSAGE = "„Gilt für: Set“ gibt es nicht mehr — bitte „Gilt für“ ändern.";

// One parser for the cadence cap (campaign-flags.mjs) — the review desk shows
// the same number, so a blocked contact is visible before the gate refuses it.
function minSendIntervalDays(): number {
  return marketingMinSendIntervalDays();
}

export type CampaignSendRefusal = Extract<CampaignSendResult, { ok: false }>;

type CampaignSendPreflight =
  | {
      ok: true;
      contact: NonNullable<Awaited<ReturnType<typeof getContactById>>>;
      draft: NonNullable<Awaited<ReturnType<typeof getDraftForContact>>>;
      campaign: NonNullable<Awaited<ReturnType<typeof getCampaignForContact>>>;
      person: Awaited<ReturnType<typeof getCustomerById>> | null;
      recipient: string;
      unsubscribeUrl: string;
      /** The active, unexpired set attached to the contact (null → an item
       * mail). The gates decided on THIS row and the send renders it, so the
       * offer kind checked is the offer kind shipped. */
      bundle: BundleOfferRow | null;
    }
  | CampaignSendRefusal;

/**
 * Every gate of a campaign send that needs no claim: the row and its draft, the
 * campaign being live, the person read fresh, all legal gates (master flag, the
 * one consent, opt-in level, suppression, cadence) and a working unsubscribe
 * link. approveAndSendCampaign runs it first; „Freigeben" runs it at approval
 * time too (the release job then sends through approveAndSendCampaign, so it
 * all runs again at send time). Never sends, never claims. Never throws.
 */
export async function campaignSendPreflight(contactId: number): Promise<CampaignSendPreflight> {
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

    // GATE 0 — the campaign must be live. A Testkontakt may preview a
    // campaign that has not started yet (Black Friday drafts are tested
    // before the day), never one that was ended or archived.
    const campaign = await getCampaignForContact(contactId);
    if (
      !campaign ||
      (contact.isTest
        ? campaign.status === "beendet" || campaign.status === "archiviert"
        : !campaignAcceptsWork(campaign))
    ) {
      return {
        ok: false,
        reason: "campaign_closed",
        message: "Die Kampagne läuft gerade nicht (Entwurf, pausiert, beendet oder außerhalb ihres Zeitraums).",
      };
    }

    // The person, read fresh: the one consent and its level, and the CURRENT
    // address (a Shopify e-mail change merges people — the recipient row may
    // still carry the old one). A Testkontakt is the operator's own inbox.
    const person = contact.isTest || contact.customerId == null ? null : await getCustomerById(contact.customerId);
    if (!contact.isTest && !person) {
      return { ok: false, reason: "not_eligible", message: "Zu diesem Empfänger gibt es keinen Kunden mehr — Versand verweigert." };
    }
    const recipient = person?.email ?? contact.email;

    // GATE 1 — all campaign gates, evaluated before any claim/mint/send step.
    const gate = evaluateCampaignSendGates({
      sendsApproved: isCampaignSendsApproved(),
      allowSingleOptIn: isSingleOptInAllowed(),
      consentState: contact.isTest ? "subscribed" : (person?.emailConsentState ?? null),
      optInLevel: contact.isTest ? contact.optInLevel : optInLevelFromConsent(person?.emailConsentLevel ?? null),
      // A Testkontakt is the operator's own inbox (0057): neither an old
      // unsubscribe/bounce on that address nor the cadence cap may stop a test
      // send. Every other gate (master flag, opt-in, discount check) applies.
      suppressed: contact.isTest ? false : await isSuppressed(recipient),
      lastSendAt: await lastCrossChannelSendAt(recipient),
      minIntervalDays: contact.isTest ? 0 : minSendIntervalDays(),
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
        case GATE_REASONS.NO_CONSENT:
          return {
            ok: false,
            reason: "no_consent",
            message:
              "Für diese Person liegt keine Einwilligung in E-Mail-Werbung vor " +
              "(Shopify und Mo teilen sich eine Einwilligung) — Versand verweigert.",
          };
        case GATE_REASONS.OPT_IN_LEVEL:
          return {
            ok: false,
            reason: "opt_in_blocked",
            message:
              "Für diese Person liegt kein nachweisbares Double-Opt-in vor " +
              "— erneute Einwilligung erforderlich.",
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

    // GATE 1b — no placeholder code in a mail without a discount: nothing
    // would replace it, the customer would read an offer that does not exist.
    if (hasStrayPlaceholder(draft.body, PLACEHOLDER_DISCOUNT_CODE, draft.discountPercent)) {
      return {
        ok: false,
        reason: "discount_mismatch",
        message:
          `Der Text nennt den Platzhalter-Code ${PLACEHOLDER_DISCOUNT_CODE}, aber für diese Mail ist kein Rabatt ` +
          "gewählt — Text anpassen oder einen Rabatt wählen.",
      };
    }

    // GATE 1c — a mail is a set offer OR single items (offer-mode.mjs): a set
    // mail carries no code, the set price is the offer. Fail closed for a
    // draft from before the rule that has both.
    const activeBundle = await getActiveBundleForCampaignContact(contactId);
    const bundle = shouldRenderBundleBlock(activeBundle) ? activeBundle : null;
    if (offerConflict({ discountPercent: draft.discountPercent, hasActiveBundle: bundle !== null })) {
      return { ok: false, reason: "offer_conflict", message: OFFER_CONFLICT_MESSAGE };
    }

    // GATE 1d — the code only on the set (scope "set") is history: only an
    // item mail carries a code now. Never mint against a scope that no longer
    // exists — the operator picks „Alles“ or „Empfehlungen“.
    if (draft.discountPercent > 0 && draft.discountScope === "set") {
      return { ok: false, reason: "discount_scope_unresolved", message: SET_SCOPE_RETIRED_MESSAGE };
    }

    // GATE 2 — a working unsubscribe link is mandatory. No link → no send.
    const unsubToken = buildUnsubscribeToken(recipient);
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

    return { ok: true, contact, draft, campaign, person, recipient, unsubscribeUrl, bundle };
  } catch (err) {
    reportError(err, { route: "lib/campaign-email", phase: "campaignSendPreflight" });
    return { ok: false, reason: "send_failed", message: "Unexpected error while checking the send." };
  }
}

/**
 * Approve and send a drafted campaign email through the system. Performs every
 * gate (campaignSendPreflight), claims the contact atomically, mints the MK-
 * code (if a depth was selected), sends via Resend with unsubscribe link +
 * header, records the immutable send row and flips the contact to 'sent'. Once
 * Resend has accepted the mail the claim is never reverted (a retry would send
 * it twice) — bookkeeping errors after that are reported, the row is marked
 * sent. Never throws.
 */
export async function approveAndSendCampaign(contactId: number): Promise<CampaignSendResult> {
  try {
    const pre = await campaignSendPreflight(contactId);
    if (!pre.ok) return pre;
    const { contact, draft, campaign, person, recipient, unsubscribeUrl } = pre;
    // The set the gates saw (null → an item mail). A set mail never gets a
    // code: GATE 1c refused set + discount, and minting below checks again.
    const setBundle = pre.bundle;

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

      if (draft.discountPercent > 0 && !setBundle) {
        // Scope (migration 0058): a code for "Empfehlungen" is minted against
        // exactly the products the mail shows (available ones only). A scope
        // that cannot be resolved refuses the send — never a silently wider code.
        const scoped = await resolveDiscountScopeProducts(draft.discountScope, draft.recommendedProductIds);
        if (!scoped.ok) {
          await revertContactClaim(contactId);
          return { ok: false, reason: "discount_scope_unresolved", message: scoped.message };
        }
        const minted = await createUniqueDiscountCode({
          percentage: draft.discountPercent / 100,
          codePrefix: CAMPAIGN_DISCOUNT_CODE_PREFIX,
          // An Aktion's codes all end with it (discount_valid_until, 0066).
          endsAt: campaign.discountValidUntil,
          title: `Kampagnen-Rabatt (${draft.discountPercent}%${
            draft.discountScope === "recommendations" ? ", Empfehlungen" : ""
          })`,
          productIds: scoped.productIds,
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
        // Labels are formatted in the contact's language — the same formatter
        // the draft used, so the swap finds the stale string.
        body = applyMintedDiscountToBody(body, {
          placeholder: PLACEHOLDER_DISCOUNT_CODE,
          code: minted.code,
          draftExpiryLabel: draft.discountExpiresAt
            ? formatExpiryDateForLanguage(draft.discountExpiresAt, contact.language)
            : null,
          realExpiryLabel: formatExpiryDateForLanguage(minted.expiresAt, contact.language),
        });
        // Legacy backstop: English drafts generated BEFORE the language-aware
        // formatter carry the German numeric label — try that format too (a
        // no-op for German contacts, where both formats are identical).
        body = applyMintedDiscountToBody(body, {
          placeholder: PLACEHOLDER_DISCOUNT_CODE,
          code: minted.code,
          draftExpiryLabel: draft.discountExpiresAt
            ? formatGermanExpiryDate(draft.discountExpiresAt)
            : null,
          realExpiryLabel: formatExpiryDateForLanguage(minted.expiresAt, contact.language),
        });
      }

      // Tracked CTA (migration 0041): the Mo-promo deep link — the email's main
      // CTA — routes through /api/r/<token> so the Kampagnen-Funnel can count
      // clicks, exactly like the marketing channel's cart link. The redirect
      // resolves back to campaignMoDeeplinkUrl(); the customer experiences a
      // perfectly normal click. Preview/copy paths stay untracked.
      const redirectToken = generateRedirectToken();
      // The recipient's locale rides along like on the unsubscribe link
      // (API_CONTRACT §12.2); German links stay as before.
      const trackedCtaUrl = withLocaleParam(`${getBaseUrl()}/api/r/${redirectToken}`, contact.language);

      // Render inside the design selected for this email type (admin
      // Einstellungen); null → classic built-ins. Fail-soft, never blocks.
      // The per-contact hero image (email-hero.ts) rides along for hero designs.
      // The campaign's own design (design_key) wins over the selection.
      const emailDesign = await getEmailDesignForKey(campaign.designKey, "campaign");
      // hero_mode 'none': no per-contact AI hero rides along, even if one exists.
      const hero =
        campaign.heroMode === "none"
          ? { heroImageUrl: null, heroImageMobileUrl: null, heroHeadline: null }
          : await getEmailHeroRenderData("campaign", contactId);
      let bundleOfferId: number | null = null;
      const { text, html } = await withEmailDesign(emailDesign, () =>
        withEmailRenderData(
          { ...hero, recipientFirstName: contact.firstName?.trim() || null },
          async () => {
            // SET MAIL or ITEM MAIL (offer-mode.mjs). The set block is built
            // from the row the gates checked, HERE inside withEmailDesign (the
            // block is HTML rendered through the design's renderers; building
            // it before the design was active shipped the classic block inside
            // a Performance mail). A set mail shows only the set; a block that
            // fails to build degrades to the item mail (never blocks a send —
            // and it carries no code: a set draft has no discount).
            const bundle = await buildBundleBlock(setBundle, contact.language, draft.productHighlights);
            bundleOfferId = bundle?.offerId ?? null;
            return renderCampaignEmail({
              subject: draft.subject,
              body,
              language: contact.language,
              products: bundle ? [] : await resolveRecommendedProducts(draft.recommendedProductIds),
              productHighlights: draft.productHighlights,
              discountCode,
              discountExpiresLabel: discountExpiresAt
                ? formatExpiryDateForLanguage(discountExpiresAt, contact.language)
                : null,
              discountExpiresAt,
              discountPercent: draft.discountPercent,
              discountScope: draft.discountScope,
              unsubscribe: unsubscribeFooter(
                unsubscribeUrl,
                contact.language,
                buildErasureUrl(recipient, contact.language)
              ),
              bundle,
              labelForUrl: await catalogNameLookup("lib/campaign-email"),
              ctaUrl: trackedCtaUrl,
              ...campaignCtaOptions(campaign, contact.language),
            });
          }
        )
      );

      const threading = outboundThreading();
      const result = await sendEmail({
        to: recipient,
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

      // The mail is out. From here on nothing may revert the claim — a retry
      // would send it twice; bookkeeping failures are reported instead.
      try {
        // Immutable audit/KPI record — the redemption + revenue reads pick the
        // MK- code up from here. The shipped parts are retained (0038) so the
        // admin can open exactly what the recipient received.
        await recordCampaignSend({
          contactId,
          email: recipient,
          subject: draft.subject,
          bodyHash: hashCampaignBody(text),
          bodyText: text,
          bodyHtml: html,
          sentVia: "email",
          discountCode,
          discountCodeGid,
          discountExpiresAt,
          redirectToken,
          // Stamped from the draft so the funnel can be read per segment later.
          segment: draft.segment,
          // Send-time snapshot (migration 0054): what this mail looked like, so
          // the KPI tab can compare hero variants and designs after the fact.
          designKey: emailDesign?.key ?? "classic",
          heroVariant: hero.heroImageUrl ? "ai" : emailDesign ? "default" : "none",
          heroImageUrl: hero.heroImageUrl,
          heroHeadline: hero.heroHeadline,
          textMode: draft.textMode ?? null,
          language: contact.language,
          discountPercent: draft.discountPercent,
          discountScope: discountCode ? draft.discountScope : null,
          bundleOfferId,
          providerEmailId: result.id ?? null,
          isTest: contact.isTest,
        });
        // The mail in the person's Korrespondenz (additive, never breaks the send).
        if (!contact.isTest && person) {
          await recordSentMessage({
            customerId: person.id,
            messageId: threading.messageId,
            fromAddress: senderAddress() ?? "",
            toAddress: recipient,
            subject: draft.subject,
            bodyText: text,
            bodyHtml: html,
          });
        }
      } catch (err) {
        reportError(err, { route: "lib/campaign-email", phase: "approveAndSendCampaign.record" });
      }
      // A Testkontakt keeps its draft and returns to the queue (0057).
      if (contact.isTest) await resetTestContactAfterSend(contactId);
      else await markContactSent(contactId);
      return { ok: true, sentTo: recipient, test: contact.isTest };
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
 * The campaign's call to action for renderCampaignEmail (0066): the Mo hint
 * on/off and — for cta_kind 'shop' — the shop button label + untracked link
 * (the send path passes the tracked /api/r link as ctaUrl, which then
 * redirects to the shop).
 */
export function campaignCtaOptions(
  campaign: Pick<Campaign, "moPromo" | "ctaKind" | "ctaUrl"> | null,
  language: "de" | "en"
): { moPromo: boolean; shopCtaLabel: string | null; shopCtaUrl: string | null } {
  if (!campaign) return { moPromo: true, shopCtaLabel: null, shopCtaUrl: null };
  const shop = campaign.ctaKind === "shop" && campaign.ctaUrl ? campaign.ctaUrl : null;
  return {
    moPromo: campaign.moPromo,
    shopCtaLabel: shop ? (language === "en" ? "Shop the offer" : "Zum Angebot") : null,
    shopCtaUrl: shop,
  };
}

/**
 * The Shopify product gids a scoped discount code is minted against
 * (discount-scope.mjs): for "Empfehlungen" exactly the products the mail
 * shows — resolveRecommendedProducts, so a sold-out recommendation is neither
 * shown nor covered — with their handles resolved in Shopify. "all" → no
 * restriction. The retired scope "set" (only the set; history since a set
 * mail carries no code) is refused — GATE 1d already stops it. Fails (ok:
 * false, German message for the desk) when the scope cannot be honoured — no
 * available recommendations, an unresolvable handle — so the send path
 * refuses instead of minting a code wider than promised.
 */
async function resolveDiscountScopeProducts(
  scope: DiscountScope,
  recommendedProductIds: string[]
): Promise<{ ok: true; productIds: string[] } | { ok: false; message: string }> {
  if (scope === "all") return { ok: true, productIds: [] };
  if (scope !== "recommendations") return { ok: false, message: SET_SCOPE_RETIRED_MESSAGE };
  try {
    const products = await resolveRecommendedProducts(recommendedProductIds);
    const handles = [...new Set(products.map((p) => p.slug || p.id).filter(Boolean))];
    if (handles.length === 0) {
      return {
        ok: false,
        message:
          "Der Rabatt soll nur für die Empfehlungen gelten, aber der Entwurf enthält keine verfügbaren Empfehlungen. " +
          "Produkte hinzufügen oder den Rabatt-Bereich ändern.",
      };
    }
    const gids = await fetchProductGidsByHandles(handles);
    const missing = handles.filter((h) => !gids.has(h));
    if (missing.length > 0) {
      return {
        ok: false,
        message: `Für ${missing.length === 1 ? "ein empfohlenes Produkt" : `${missing.length} empfohlene Produkte`} konnte Shopify keine Produkt-ID liefern (${missing.join(", ")}) — der Rabatt lässt sich nicht auf die Empfehlungen begrenzen.`,
      };
    }
    return { ok: true, productIds: handles.map((h) => gids.get(h) as string) };
  } catch (err) {
    reportError(err, { route: "lib/campaign-email", phase: "resolveDiscountScopeProducts" });
    return {
      ok: false,
      message: "Shopify konnte die Produkte für den begrenzten Rabatt nicht auflösen — bitte erneut versuchen.",
    };
  }
}

/**
 * Resolve the draft's recommended product ids (including review-time curation;
 * possibly variant-pinned refs) against the live catalog — the campaign's
 * product rows, exactly like the marketing channel's cart contents. Returns
 * variant-projected display products, so a row shows the CHOSEN variant's
 * name, price and deep link. Purely presentational: a resolve failure just
 * drops the rows (the prose keeps its product links), it never blocks a send.
 *
 * Dropped:
 *   - a ref whose pinned variant no longer exists (reported) — never silently
 *     downgraded to the default variant: a marketing mail must not show a
 *     price the admin didn't approve (PAngV);
 *   - a SOLD-OUT product/variant — a mail never advertises what cannot be
 *     bought (the catalog sync keeps stock fresh; the scoped code follows,
 *     since resolveDiscountScopeProducts reads this same list).
 */
async function resolveRecommendedProducts(productIds: string[]): Promise<Product[]> {
  if (productIds.length === 0) return [];
  try {
    const selections = await resolveProductSelections(productIds);
    const gone = selections.filter((s) => s.missingVariant);
    if (gone.length > 0) {
      reportError(
        new Error(
          `campaign email: pinned variant(s) vanished, dropped from grid: ${gone
            .map((s) => s.ref)
            .join(", ")}`
        ),
        { route: "lib/campaign-email", phase: "resolveRecommendedProducts" }
      );
    }
    return selections
      .filter((s) => s.available)
      .map((s) => s.display)
      .filter((p): p is Product => p !== null);
  } catch (err) {
    reportError(err, { route: "lib/campaign-email", phase: "resolveRecommendedProducts" });
    return [];
  }
}

/**
 * Render the set block for a campaign contact's set row (null / no longer
 * active → null) — the campaign sibling of marketing-email's
 * buildBundleBlockForSend: same active-only guard (shouldRenderBundleBlock),
 * same tracked redirect, same renderer and component mapping (snapshot count
 * and unit price, fresh catalog image, the draft's highlight as description).
 * Never throws; a failure degrades to "no block" so a send is never blocked
 * by the bundle path.
 */
async function buildBundleBlock(
  bundle: BundleOfferRow | null,
  language: "de" | "en",
  highlights: Array<{ name: string; description: string }> | null
): Promise<{ text: string; html: string; expiresAt: string | null; offerId: number } | null> {
  try {
    if (!bundle || !shouldRenderBundleBlock(bundle)) return null;
    const offerUrl = buildBundleRedirectUrl(bundle.redirectToken, language);
    if (!offerUrl) return null;
    const catalog = await loadProductCatalog();
    const components: BundleEmailComponent[] = bundleEmailComponents(
      bundle.components,
      new Map(catalog.map((p) => [p.id, p])),
      highlights
    );
    const block = renderBundleOfferBlock({
      title: bundle.title ?? (language === "en" ? "Your personal set" : "Dein persönliches Set"),
      components,
      bundlePrice: bundle.bundlePrice,
      componentsSum: bundle.componentsSum,
      currency: bundle.currency,
      offerUrl,
      language,
    });
    return { ...block, expiresAt: bundle.expiresAt, offerId: bundle.id };
  } catch (err) {
    reportError(err, { route: "lib/campaign-email", phase: "buildBundleBlock" });
    return null;
  }
}

export type CampaignPreviewResult =
  | { ok: true; subject: string; html: string }
  | { ok: false; reason: "not_found" | "no_draft"; message: string };

/**
 * Render the REVIEW-TIME preview of a drafted campaign email: the exact same
 * renderer/composition the send path uses (branded shell, optional bundle
 * block, Mo-promo, discount line, unsubscribe footer) — but READ-ONLY and
 * gate-free: nothing is claimed, minted, sent or recorded. The discount line
 * shows the MO-XXXX placeholder with the PROJECTED expiry; the real MK- code
 * exists only at send time. `overrides` carries the operator's on-screen
 * subject/body so unsaved edits preview correctly.
 */
export async function renderCampaignEmailPreview(
  contactId: number,
  overrides: { subject?: string; body?: string } = {}
): Promise<CampaignPreviewResult> {
  const contact = await getContactById(contactId);
  if (!contact) return { ok: false, reason: "not_found", message: "Contact not found." };
  const draft = await getDraftForContact(contactId);
  if (!draft) {
    return { ok: false, reason: "no_draft", message: "No draft exists for this contact." };
  }

  const subject =
    typeof overrides.subject === "string" && overrides.subject.trim()
      ? overrides.subject
      : draft.subject;
  const body =
    typeof overrides.body === "string" && overrides.body.trim() ? overrides.body : draft.body;

  // Real unsubscribe link when the signing secret is configured; otherwise an
  // inert anchor so the footer still shows (the preview never delivers).
  const unsubToken = buildUnsubscribeToken(contact.email);
  const unsubscribeUrl = unsubToken
    ? `${getBaseUrl()}/api/unsubscribe?token=${encodeURIComponent(unsubToken)}` +
      (contact.language === "en" ? "&locale=en" : "")
    : "#";

  // The preview renders inside the SAME selected design as the send path —
  // including the per-contact hero image and the bundle block, which is
  // built inside the design context below — so what the operator reviews is
  // what ships.
  const campaign = await getCampaignForContact(contactId);
  const emailDesign = await getEmailDesignForKey(campaign?.designKey ?? null, "campaign");
  const hero =
    campaign?.heroMode === "none"
      ? { heroImageUrl: null, heroImageMobileUrl: null, heroHeadline: null }
      : await getEmailHeroRenderData("campaign", contactId);
  const activeBundle = await getActiveBundleForCampaignContact(contactId);
  const { html } = await withEmailDesign(emailDesign, () =>
    withEmailRenderData(
      { ...hero, recipientFirstName: contact.firstName?.trim() || null },
      async () => {
        // Set mail or item mail, decided exactly like the send path.
        const bundle = await buildBundleBlock(activeBundle, contact.language, draft.productHighlights);
        return renderCampaignEmail({
          subject,
          body,
          language: contact.language,
          products: bundle ? [] : await resolveRecommendedProducts(draft.recommendedProductIds),
          productHighlights: draft.productHighlights,
          discountCode: draft.discountPercent > 0 ? PLACEHOLDER_DISCOUNT_CODE : null,
          discountExpiresLabel:
            draft.discountPercent > 0 && draft.discountExpiresAt
              ? formatExpiryDateForLanguage(draft.discountExpiresAt, contact.language)
              : null,
          discountExpiresAt: draft.discountPercent > 0 ? draft.discountExpiresAt : null,
          discountPercent: draft.discountPercent,
          discountScope: draft.discountScope,
          unsubscribe: unsubscribeFooter(
            unsubscribeUrl,
            contact.language,
            buildErasureUrl(contact.email, contact.language)
          ),
          bundle,
          labelForUrl: await catalogNameLookup("lib/campaign-email"),
          ...campaignCtaOptions(campaign, contact.language),
        });
      }
    )
  );
  return { ok: true, subject, html };
}

/**
 * Render a „Prüfen & testen“ sample (campaign-sample.ts) — a draft that has
 * no recipient row. Same design and composition as
 * renderCampaignEmailPreview, with the placeholder code, the design's own
 * title image (per-person AI images and sets come only on the desk) and
 * INERT unsubscribe/erasure links: the sample is shown to the operator and
 * never delivered, so it must not carry a working link for a real customer.
 */
export async function renderCampaignSample(input: {
  campaign: Pick<Campaign, "designKey" | "moPromo" | "ctaKind" | "ctaUrl">;
  language: "de" | "en";
  firstName: string | null;
  subject: string;
  body: string;
  recommendedProductIds: string[];
  productHighlights: Array<{ name: string; description: string }> | null;
  discountPercent: number;
  discountExpiresAt: string | null;
  discountScope: DiscountScope;
}): Promise<string> {
  const { campaign, language } = input;
  const emailDesign = await getEmailDesignForKey(campaign.designKey ?? null, "campaign");
  const hasDiscount = input.discountPercent > 0;
  const { html } = await withEmailDesign(emailDesign, () =>
    withEmailRenderData(
      {
        heroImageUrl: null,
        heroImageMobileUrl: null,
        heroHeadline: null,
        recipientFirstName: input.firstName?.trim() || null,
      },
      async () =>
        renderCampaignEmail({
          subject: input.subject,
          body: input.body,
          language,
          products: await resolveRecommendedProducts(input.recommendedProductIds),
          productHighlights: input.productHighlights,
          discountCode: hasDiscount ? PLACEHOLDER_DISCOUNT_CODE : null,
          discountExpiresLabel:
            hasDiscount && input.discountExpiresAt
              ? formatExpiryDateForLanguage(input.discountExpiresAt, language)
              : null,
          discountExpiresAt: hasDiscount ? input.discountExpiresAt : null,
          discountPercent: input.discountPercent,
          discountScope: input.discountScope,
          unsubscribe: unsubscribeFooter("#", language, "#"),
          bundle: null,
          labelForUrl: await catalogNameLookup("lib/campaign-email"),
          ...campaignCtaOptions(campaign, language),
        })
    )
  );
  return html;
}

/**
 * Render the campaign email (text + HTML): the (edited) prose, then the OFFER —
 * EITHER the set block (a set mail: `bundle` given — only the set, no product
 * rows, no coupon, the countdown runs to the set's deadline) OR the item mail
 * (the recommended products as rows under „Für dich ausgesucht“ plus the
 * coupon card when a code was minted, the countdown to the code's expiry) —
 * offer-mode.mjs; then the deterministic Mo-promo block with the deep-link
 * CTA and the unsubscribe footer. The branded shell carries the
 * social/company/Impressum footer (email-template.ts), matching every other
 * outgoing mail.
 */
// Exported for scripts/send-test-emails.mjs (design test-sends with sample
// data) — production sends still go exclusively through approveAndSendCampaign().
export function renderCampaignEmail(opts: {
  subject: string;
  body: string;
  language: "de" | "en";
  /** The draft's recommended products (curation included) — rendered as
   *  personalised rows between prose and CTA in an ITEM mail (ignored in a
   *  set mail). Optional so the test-send script and legacy callers can omit
   *  it. */
  products?: Product[];
  /** The draft's stored per-product personalised descriptions (matched by
   *  name; catalog shortDescription is the fallback). */
  productHighlights?: Array<{ name: string; description: string }> | null;
  discountCode: string | null;
  discountExpiresLabel: string | null;
  /** ISO/Date expiry of the discount — feeds the offer countdown together
   * with the set's expiry (the earlier one counts). */
  discountExpiresAt?: string | Date | null;
  /** Discount depth in percent — the coupon's benefit line ("5 % auf deine
   * gesamte Bestellung"); omitted → generic wording. */
  discountPercent?: number | null;
  /** What the code applies to (discount-scope.mjs): the benefit line and the
   * text part follow it. Omitted → the whole order. */
  discountScope?: string | null;
  unsubscribe: { text: string; html: string };
  /** The set block of an attached, active set (text + HTML parts + its
   *  deadline). Given → a SET MAIL: only the set is shown — products,
   *  discountCode and the coupon are ignored (offer-mode.mjs). */
  bundle: { text: string; html: string; expiresAt?: string | null } | null;
  /** Names a bare product URL in the prose (catalog lookup); null → compact
   * host/path label. Markdown links carry their own label. */
  labelForUrl?: (url: string) => string | null;
  /** The tracked /api/r/<token> CTA URL at send time; omitted (preview) the
   * promo links straight to the untracked Mo deep link. */
  ctaUrl?: string;
  /** Append the Mo chat hint (campaign mo_promo, default true). */
  moPromo?: boolean;
  /** The button text when the campaign's CTA leads to the shop (cta_kind
   * 'shop'); omitted = the Mo button ("Beratung starten"). */
  shopCtaLabel?: string | null;
  /** Untracked shop link for previews (the send path tracks via ctaUrl). */
  shopCtaUrl?: string | null;
}): { text: string; html: string } {
  const { subject, body, language, discountExpiresLabel, unsubscribe, bundle } = opts;
  const en = language === "en";
  const moPromo = opts.moPromo !== false;
  const shopCta = opts.shopCtaLabel ? { label: opts.shopCtaLabel, url: opts.ctaUrl ?? opts.shopCtaUrl ?? "" } : null;
  // With a shop button the tracked link leads to the shop; the Mo hint (if
  // kept) then links Mo directly, untracked.
  const deeplink = shopCta ? campaignMoDeeplinkUrl() : (opts.ctaUrl ?? campaignMoDeeplinkUrl());

  // SET MAIL xor ITEM MAIL (offer-mode.mjs): with a set block the mail offers
  // only the set — no product rows and no code (the set price is the offer).
  const setMail = bundle !== null;
  const discountCode = setMail ? null : opts.discountCode;
  const rowItems = setMail
    ? []
    : productRowItems(opts.products ?? [], { locale: language, highlights: opts.productHighlights });

  // --- text part — markdown links flatten to "Label (URL)" ---
  const textBody = emailProseToText(body.trim());
  const textLines = [textBody];
  // The set block (set mail) sits right after the prose, before the promo /
  // unsubscribe footer.
  if (bundle) textLines.push(bundle.text);
  // Item mail: the coupon — code, value, terms and the one-click redeem link
  // (discount-coupon.mjs) — outside the editable prose, so code and deadline
  // are always stated exactly once, deterministically.
  if (discountCode) {
    textLines.push(
      "",
      couponText(language, {
        code: discountCode,
        percent: opts.discountPercent ?? null,
        expiresLabel: discountExpiresLabel,
        scope: opts.discountScope ?? null,
      })
    );
  }
  // The offer countdown runs to the deadline of the one offer in the mail:
  // the set's expiry (set mail) or the code's (item mail with a code).
  const offerExpiresAt = bundle
    ? earliestDeadline(bundle.expiresAt)
    : discountCode
      ? earliestDeadline(opts.discountExpiresAt)
      : null;
  const countdownLine = offerExpiresAt ? countdownText(offerExpiresAt, language) : "";
  if (countdownLine) textLines.push("", countdownLine);
  if (shopCta?.url) textLines.push("", `${shopCta.label}: ${shopCta.url}`);
  if (moPromo) textLines.push("", moPromoBlockText(language, deeplink));
  textLines.push("", "—", unsubscribe.text);
  const text = textLines.join("\n");

  // --- html part — the shared branded template ---
  // Item mail: the coupon card (renderDiscountCoupon; a design lays it out)
  // sits under the product rows and above the countdown of its deadline.
  const couponRows = discountCode
    ? renderDiscountCoupon({
        code: discountCode,
        percent: opts.discountPercent ?? null,
        expiresLabel: discountExpiresLabel,
        scope: opts.discountScope ?? null,
        language,
      })
    : "";
  // The Mo promo goes through the shared renderer so a design can present it
  // as its own advisor card (email-template renderMoPromoBlock); the classic
  // chat-style media row is unchanged.
  const promoRows = moPromo
    ? renderMoPromoBlock({
        introText: moPromoIntroText(language),
        ctaLabel: moPromoCtaLabel(language),
        ctaUrl: deeplink,
        language,
      })
    : "";

  // Personalised product section: black separator band + one ROW per product
  // (image, name link, price with red strikethrough compare-at in the first
  // third; the personalised description + product button in the remaining two
  // thirds) — the visual weight lives here, the prose stays short and personal.
  const productsRows = rowItems.length
    ? renderSectionBand(en ? "Picked for you" : "Für dich ausgesucht") +
      renderSectionRow(renderEmailProductRows(rowItems), {
        padding: "10px 60px 20px",
        align: "center",
      })
    : "";

  const html = renderBrandedEmail({
    subject,
    preheader: textBody.split("\n")[0]?.slice(0, 140) || undefined,
    heading: en ? "Your personal recommendation" : "Deine persönliche Empfehlung",
    // Prose links (markdown + bare URLs) render as clickable text — never a
    // raw pasted URL (email-prose.mjs).
    bodyHtml: `
                    <p style="${emailTextStyle()} white-space: pre-wrap;" align="left">${renderEmailProseHtml(
                      body.trim(),
                      { labelForUrl: opts.labelForUrl, linkStyle: emailLinkStyle() }
                    )}</p>`,
    // Full-width newsletter sections between the body and the CTA pill: the
    // offer (product rows + coupon, or the set block), its countdown, and last
    // the Mo-promo media row — directly above its "Beratung starten" CTA.
    preCtaRowsHtml:
      `${productsRows}${bundle ? bundle.html : ""}${couponRows}${
        offerExpiresAt ? renderOfferCountdown({ expiresAt: offerExpiresAt, language }) : ""
      }${promoRows}` || undefined,
    ctas: shopCta?.url
      ? [{ label: shopCta.label, url: shopCta.url }]
      : moPromo
        ? [{ label: moPromoCtaLabel(language), url: deeplink }]
        : [],
    footer: {
      // GATE 2 guarantees `unsubscribe` is always present.
      unsubscribeHtml: unsubscribe.html,
    },
    locale: language,
  });

  return { text, html };
}
