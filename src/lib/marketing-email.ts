// Send-through-system for the legacy 1:1 marketing emails (marketing_sends).
// approveAndSend() here and approveAndSendCampaign() (campaign-email.ts) are the
// only two paths that deliver a marketing email; this one concentrates every
// legal guarantee of the 1:1 path in one auditable place so no caller can
// bypass them:
//
//   1. ELIGIBILITY — the address must be marketing-eligible at send time:
//      marketing_doi_status = 'confirmed' AND not unsubscribed AND not on the
//      suppression list. Enforced twice: loadEligibleCapture (SQL) AND
//      canSendMarketing (independent check). If either fails, NOTHING is sent.
//   2. UNSUBSCRIBE — a working, signed unsubscribe link is ALWAYS appended. If
//      we can't build one (no signing secret), we REFUSE to send rather than
//      ship a marketing email without an opt-out.
//   3. CART + DISCOUNT — appended deterministically from the stored row, so the
//      admin's edits to the prose can never remove them. A mail is a set offer
//      OR single items (offer-mode.mjs): a set mail shows only the set — no
//      cart, no code; a draft with an active set AND a discount is refused
//      (offer_conflict) before anything is claimed or minted.
//   4. LOGGING / SUPPRESSION — delivery goes through Resend (lib/email) which
//      logs failures; the status flip records that it was sent.
//
// The admin NEVER copies text into a personal mail client — sending always runs
// here. approveAndSend() claims the row, sends, and marks it sent (or reverts).

import { canSendMarketing, buildUnsubscribeToken, buildErasureUrl } from "./email-capture-store";
import {
  getSendById,
  loadEligibleCapture,
  claimForSend,
  revertClaim,
  markSent,
  generateRedirectToken,
  lastMarketingSendAt,
} from "./marketing-store";
import { parseIntEnv } from "./env-num";
import { sendEmail, senderAddress } from "./email";
import { outboundThreading } from "./email-inbound";
import { recordSentMessage } from "./email-messages-store";
import {
  renderBrandedEmail,
  renderSectionBand,
  renderSectionRow,
  escapeHtml,
  emailTextStyle,
  emailMutedTextStyle,
  emailLinkStyle,
  renderOfferCountdown,
} from "./email-template";
import { withEmailDesign, withEmailRenderData } from "./email-design-context";
import { getCachedEmailDesignForKind } from "./email-design-store";
import { getEmailHeroRenderData } from "./email-hero-store";
import { getCustomerById } from "./customer-store";
import { renderEmailProductRows, productRowItems, catalogNameLookup } from "./email-products";
import { unsubscribeFooter } from "./consent-copy";
import { getBaseUrl } from "./base-url";
import {
  createUniqueDiscountCode,
  formatGermanExpiryDate,
  PLACEHOLDER_DISCOUNT_CODE,
} from "./shopify-discounts";
import { detectDiscountTextMismatch } from "./discount-validation.mjs";
import { applyMintedDiscountToBody, hasStrayPlaceholder } from "./discount-swap.mjs";
import {
  renderEmailProseHtml,
  emailProseToText,
} from "./email-prose.mjs";
import { buildPrefilledCartUrlForIds } from "./cart";
import { mintAttributionToken } from "./mo-orders-store";
import { withCartAttribution } from "./order-attribution.mjs";
import { getActiveBundleForSend, type BundleOfferRow } from "./bundle-offers-store";
import { buildBundleRedirectUrl } from "./bundle-offers";
import { bundleEmailComponents, renderBundleOfferBlock } from "./bundle-email";
import { countdownText, earliestDeadline } from "./offer-countdown.mjs";
import { shouldRenderBundleBlock } from "./bundle-email-core.mjs";
import { OFFER_CONFLICT_MESSAGE, offerConflict } from "./offer-mode.mjs";
import { loadProductCatalog } from "./catalog-store";
import { reportError } from "./observability";
import type { PrefilledCart } from "./cart";
import type { Product } from "./types";

/**
 * The recipient's first name for the personal greeting of image-first designs
 * (null when unknown — the design then leaves the AI prose's own greeting).
 * Never throws: a lookup failure just means "no name".
 */
async function recipientFirstNameForSend(customerId: number | null): Promise<string | null> {
  if (!customerId) return null;
  try {
    const customer = await getCustomerById(customerId);
    const summary = customer?.shopifyAccountSummary;
    const first = summary?.firstName?.trim() || summary?.displayName?.trim()?.split(/\s+/)[0];
    return first || null;
  } catch (err) {
    reportError(err, { route: "lib/marketing-email", phase: "recipientFirstName" });
    return null;
  }
}

export type ApproveAndSendResult =
  | { ok: true; sentTo: string }
  | {
      ok: false;
      reason:
        | "not_found"
        | "already_sent"
        | "not_eligible"
        | "too_soon"
        | "no_unsubscribe"
        | "claim_failed"
        | "discount_mismatch"
        | "offer_conflict"
        | "discount_failed"
        | "email_not_configured"
        | "send_failed";
      message: string;
    };

/**
 * The products the mail shows: exactly the ones that made it into the cart
 * link — available, resolvable, each once. buildPrefilledCartUrl also lists
 * the lines it left OUT (sold out with excludeSoldOut, a vanished pinned
 * variant, no numeric variant) for explanation; those never reach the mail.
 */
function cartProducts(cart: Pick<PrefilledCart, "lines" | "resolvedProductIds">): Product[] {
  const inCart = new Set(cart.resolvedProductIds ?? []);
  const seen = new Set<string>();
  const out: Product[] = [];
  for (const line of cart.lines ?? []) {
    if (!line.product || !inCart.has(line.productId) || seen.has(line.productId)) continue;
    seen.add(line.productId);
    out.push(line.product);
  }
  return out;
}

const NO_CART: Pick<PrefilledCart, "url" | "lines" | "resolvedProductIds"> = {
  url: null,
  lines: [],
  resolvedProductIds: [],
};

/**
 * Minimum days between two marketing sends to the SAME recipient (per-recipient
 * frequency cap). 0 disables (default). Configurable via
 * MARKETING_MIN_SEND_INTERVAL_DAYS — the cadence is a policy choice
 * (docs/archive/LEGAL_READINESS_REPORT.md §8 OQ-16).
 */
function minSendIntervalDays(): number {
  return parseIntEnv("MARKETING_MIN_SEND_INTERVAL_DAYS", 0, 0);
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

    // GATE 1c — per-recipient frequency cap. Don't mail the same person more
    // often than the configured interval (0 = disabled). Checked before the
    // claim so a too-soon send never burns a code.
    const intervalDays = minSendIntervalDays();
    if (intervalDays > 0) {
      const last = await lastMarketingSendAt(send.emailCaptureId, sendId);
      if (last) {
        const ageMs = Date.now() - Date.parse(last);
        if (Number.isFinite(ageMs) && ageMs < intervalDays * 86_400_000) {
          return {
            ok: false,
            reason: "too_soon",
            message: `Diese Adresse wurde innerhalb der letzten ${intervalDays} Tage bereits angeschrieben.`,
          };
        }
      }
    }

    // GATE 1d — a mail is a set offer OR single items (offer-mode.mjs): a set
    // mail carries no code, the set price is the offer. Fail closed for a
    // draft from before the rule that has both — before the claim, so nothing
    // is claimed or minted. The send renders THIS row (setBundle).
    const activeBundle = await getActiveBundleForSend(sendId);
    const setBundle = shouldRenderBundleBlock(activeBundle) ? activeBundle : null;
    if (offerConflict({ discountPercent: send.discountPercent, hasActiveBundle: setBundle !== null })) {
      return { ok: false, reason: "offer_conflict", message: OFFER_CONFLICT_MESSAGE };
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
      // The claimed row is the one that ships — re-check the offer kind on it
      // (a discount set between the read above and the claim).
      if (offerConflict({ discountPercent: claimed.discountPercent, hasActiveBundle: setBundle !== null })) {
        await revertClaim(sendId);
        return { ok: false, reason: "offer_conflict", message: OFFER_CONFLICT_MESSAGE };
      }

      // GATE 3a — the percentage the customer READS comes only from the editable
      // prose (the code + deadline ship deterministically, but the % does not).
      // Refuse if the body clearly states a DIFFERENT discount than the chosen
      // depth, so we never ship copy that promises e.g. 20 % while the coupon
      // grants 10 %. This is the server-side backstop for the dashboard's
      // regenerate-lockout; it's conservative (only a clear in-range contradiction
      // blocks — see detectDiscountTextMismatch) so it can't false-block a send.
      // A placeholder code without a discount would ship as written — refuse.
      if (hasStrayPlaceholder(claimed.draftedText, PLACEHOLDER_DISCOUNT_CODE, claimed.discountPercent)) {
        await revertClaim(sendId);
        return {
          ok: false,
          reason: "discount_mismatch",
          message:
            `Der Text nennt den Platzhalter-Code ${PLACEHOLDER_DISCOUNT_CODE}, aber für diese Mail ist kein Rabatt ` +
            "gewählt — Text anpassen oder einen Rabatt wählen.",
        };
      }
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

      // Never for a set mail (the re-check above refused set + discount).
      if (claimed.discountPercent > 0 && !setBundle) {
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
        // Swap the preview placeholder for the real code wherever it appears,
        // and a stale projected expiry date for the real one, so the prose and
        // the working code/deadline never disagree. Shared with the campaign
        // send path — see discount-swap.mjs.
        body = applyMintedDiscountToBody(body, {
          placeholder: PLACEHOLDER_DISCOUNT_CODE,
          code: minted.code,
          draftExpiryLabel: claimed.discountExpiresAt
            ? formatGermanExpiryDate(claimed.discountExpiresAt)
            : null,
          realExpiryLabel: formatGermanExpiryDate(minted.expiresAt),
        });
      }

      // Render inside the design selected for this email type (admin
      // Einstellungen); null → classic built-ins. Fail-soft, never blocks.
      const emailDesign = await getCachedEmailDesignForKind("marketing");

      // SET MAIL: the set block, from the row the gate checked, built inside
      // the design (it is HTML rendered through the design's renderers;
      // building it outside shipped the classic block inside a Performance
      // mail). A block that fails to build degrades to the item mail (never
      // blocks a send — and carries no code: a set draft has no discount).
      const bundleBlock = setBundle
        ? await withEmailDesign(emailDesign, () => buildBundleBlockForSend(setBundle, claimed.productHighlights))
        : null;

      // Build the cart permalink that actually ships: it carries ?discount=CODE
      // only when a real code was minted; otherwise no discount param.
      // excludeSoldOut re-checked at SEND time (not just draft time) so an item
      // that sold out while the draft sat around never enters the shipped cart.
      // A SET MAIL has no cart: the set's own „Zur Kasse“ (its tracked link)
      // is its one action, so no single-item cart link (or token) is made.
      const cart = !bundleBlock && claimed.productIds.length
        ? await buildPrefilledCartUrlForIds(claimed.productIds, {
            discountCode: discountCode ?? undefined,
            excludeSoldOut: true,
          })
        : NO_CART;
      // ORDER ATTRIBUTION: stamp the shipped cart with the session's opaque
      // token (attributes[_mo]) so even a code-less checkout via this link is
      // attributable (docs/ORDER_ATTRIBUTION.md). Minting failure → unstamped
      // link (the send must never block on attribution).
      const moToken = cart.url ? await mintAttributionToken(capture.sessionId, "marketing_email") : null;
      const cartUrl = withCartAttribution(cart.url, moToken);

      // The recommended products, exactly as the shipped cart contains them —
      // sold-out or unresolvable ones are left out of the cart AND the mail.
      // Rendered as the product rows above the cart CTA. Purely presentational
      // (the cart link stays the source of truth), so a resolve failure just
      // drops the rows, never the send.
      const recommendedProducts = cartProducts(cart);

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

      // The per-send hero image (email-hero.ts) rides along for hero designs.
      const hero = await getEmailHeroRenderData("marketing", sendId);
      const recipientFirstName = await recipientFirstNameForSend(claimed.customerId);
      const { text, html } = await withEmailDesign(emailDesign, () =>
        withEmailRenderData({ ...hero, recipientFirstName }, async () => renderMarketingEmail({
        subject: claimed.subject ?? "motion sports",
        body,
        // The customer sees/clicks the tracked redirect URL, not the raw cart.
        linkUrl,
        products: recommendedProducts,
        productHighlights: claimed.productHighlights,
        discountCode,
        // Deterministic deadline next to the code, derived from the REAL minted
        // expiry — stated even if the AI prose were edited to drop it.
        discountExpiresLabel: discountExpiresAt
          ? formatGermanExpiryDate(discountExpiresAt)
          : null,
        discountExpiresAt,
        unsubscribe: unsubscribeFooter(unsubscribeUrl, "de", buildErasureUrl(email)),
        // A set mail shows only the set (offer-mode.mjs) — the renderer drops
        // product rows, cart button and code note when the block is given.
        bundle: bundleBlock,
        labelForUrl: await catalogNameLookup("lib/marketing-email"),
      })));

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


/**
 * Render the set block for a send's set row (null / no longer active → null —
 * the pure shouldRenderBundleBlock guard centralizes that "active-only" rule).
 * The components carry the snapshot count and unit price, a fresh catalog
 * image (the row snapshots no images) and the draft's highlight as their
 * short description (bundleEmailComponents). Never throws; a failure degrades
 * to "no block" so a send is never blocked by the bundle path.
 */
async function buildBundleBlockForSend(
  bundle: BundleOfferRow | null,
  highlights: Array<{ name: string; description: string }> | null
): Promise<{ text: string; html: string; expiresAt: string | null } | null> {
  try {
    if (!bundle || !shouldRenderBundleBlock(bundle)) return null;
    const offerUrl = buildBundleRedirectUrl(bundle.redirectToken);
    if (!offerUrl) return null;
    const catalog = await loadProductCatalog();
    const block = renderBundleOfferBlock({
      title: bundle.title ?? "Dein persönliches Set",
      components: bundleEmailComponents(bundle.components, new Map(catalog.map((p) => [p.id, p])), highlights),
      bundlePrice: bundle.bundlePrice,
      componentsSum: bundle.componentsSum,
      currency: bundle.currency,
      offerUrl,
    });
    return { ...block, expiresAt: bundle.expiresAt };
  } catch (err) {
    reportError(err, { route: "lib/marketing-email", phase: "buildBundleBlockForSend" });
    return null;
  }
}


export type MarketingPreviewResult =
  | { ok: true; subject: string; html: string }
  | { ok: false; reason: "not_found" | "no_draft"; message: string };

/**
 * Render the REVIEW-TIME preview of a drafted marketing email: the exact same
 * renderer/composition the send path uses (branded shell, product grid, bundle
 * block, discount line, unsubscribe footer) — but READ-ONLY and gate-free:
 * nothing is claimed, minted, sent or recorded. The discount line shows the
 * MO-XXXX placeholder with the PROJECTED expiry; the real MS5- code exists
 * only at send time, and the cart link is the plain (untracked, discount-free)
 * permalink since the tracked redirect token is minted only at send time.
 * `overrides` carries the operator's on-screen subject/body so unsaved edits
 * preview correctly. The marketing sibling of renderCampaignEmailPreview.
 */
export async function renderMarketingEmailPreview(
  sendId: number,
  overrides: { subject?: string; body?: string } = {}
): Promise<MarketingPreviewResult> {
  const send = await getSendById(sendId);
  if (!send) return { ok: false, reason: "not_found", message: "Draft not found." };

  const subject =
    typeof overrides.subject === "string" && overrides.subject.trim()
      ? overrides.subject
      : (send.subject ?? "motion sports");
  const body =
    typeof overrides.body === "string" && overrides.body.trim()
      ? overrides.body
      : (send.draftedText ?? "");

  // Real unsubscribe link when the capture resolves and the signing secret is
  // configured; otherwise an inert anchor so the footer still shows (the
  // preview never delivers).
  const capture = await loadEligibleCapture(send.emailCaptureId);
  const unsubToken = capture ? buildUnsubscribeToken(capture.email) : null;
  const unsubscribeUrl = unsubToken
    ? `${getBaseUrl()}/api/unsubscribe?token=${encodeURIComponent(unsubToken)}`
    : "#";

  // The preview renders inside the SAME selected design as the send path —
  // including the per-send hero image and the set block, built inside the
  // design context — so what the operator reviews is what ships.
  const emailDesign = await getCachedEmailDesignForKind("marketing");
  const bundle = await withEmailDesign(emailDesign, async () =>
    buildBundleBlockForSend(await getActiveBundleForSend(sendId), send.productHighlights)
  );

  // Same cart resolution as the send path, minus discount + tracking (both
  // exist only at send time). The rows show exactly the cart's contents; a
  // set mail has no cart.
  const cart = !bundle && send.productIds.length
    ? await buildPrefilledCartUrlForIds(send.productIds, { excludeSoldOut: true })
    : NO_CART;
  const products = cartProducts(cart);

  const hero = await getEmailHeroRenderData("marketing", sendId);
  const recipientFirstName = await recipientFirstNameForSend(send.customerId);
  const { html } = await withEmailDesign(emailDesign, () =>
    withEmailRenderData({ ...hero, recipientFirstName }, async () => renderMarketingEmail({
    subject,
    body,
    linkUrl: cart.url,
    products,
    productHighlights: send.productHighlights,
    discountCode: send.discountPercent > 0 ? PLACEHOLDER_DISCOUNT_CODE : null,
    discountExpiresLabel:
      send.discountPercent > 0 && send.discountExpiresAt
        ? formatGermanExpiryDate(send.discountExpiresAt)
        : null,
    discountExpiresAt: send.discountPercent > 0 ? send.discountExpiresAt : null,
    unsubscribe: unsubscribeFooter(
      unsubscribeUrl,
      "de",
      capture ? buildErasureUrl(capture.email) : null
    ),
    bundle,
    labelForUrl: await catalogNameLookup("lib/marketing-email"),
  })));
  return { ok: true, subject, html };
}

// Exported for scripts/send-test-emails.mjs (design test-sends with sample
// data) — production sends still go exclusively through approveAndSend().
export function renderMarketingEmail(opts: {
  /** Subject line — reused for the HTML <title>/preview line. */
  subject: string;
  body: string;
  /** The URL the cart button/link points at — the tracked /api/r/<token>
   *  redirect, NOT the raw Shopify cart (which is kept server-side). */
  linkUrl: string | null;
  /** The recommended products (the shipped cart's contents) — rendered as
   *  personalised rows (image/name/price | description) above the cart CTA. */
  products: Product[];
  /** The draft's stored per-product personalised descriptions (matched by
   *  name; catalog shortDescription is the fallback). */
  productHighlights?: Array<{ name: string; description: string }> | null;
  discountCode: string | null;
  /** German-formatted expiry date of the minted code ("TT.MM.JJJJ"); stated
   *  deterministically next to the code so the deadline always ships. */
  discountExpiresLabel: string | null;
  /** ISO/Date expiry of the discount — feeds the offer countdown together
   * with the set's expiry (the earlier one counts). */
  discountExpiresAt?: string | Date | null;
  unsubscribe: { text: string; html: string };
  /** The set block of an attached, active set (text + HTML parts + its
   *  deadline). Given → a SET MAIL: only the set is shown — products, the
   *  cart button/link and the code note are dropped (offer-mode.mjs). */
  bundle: { text: string; html: string; expiresAt?: string | null } | null;
  /** Names a bare product URL in the prose (catalog lookup); null → compact
   * host/path label. Markdown links carry their own label. */
  labelForUrl?: (url: string) => string | null;
}): { text: string; html: string } {
  const { subject, body, discountExpiresLabel, unsubscribe, bundle } = opts;

  // SET MAIL xor ITEM MAIL (offer-mode.mjs): with a set block the mail offers
  // only the set — no product rows, no single-item cart (its link would carry
  // ?discount=) and no code; the set's „Zur Kasse“ is the one action.
  const setMail = bundle !== null;
  const linkUrl = setMail ? null : opts.linkUrl;
  const discountCode = setMail ? null : opts.discountCode;

  const validityNote = discountExpiresLabel
    ? `, gültig bis ${discountExpiresLabel}`
    : "";

  // Item mail: the personalised recommendation rows, each carrying its
  // personalised description.
  const rowItems = setMail
    ? []
    : productRowItems(opts.products, { locale: "de", highlights: opts.productHighlights });

  // --- text part — markdown links flatten to "Label (URL)" ---
  const textLines = [emailProseToText(body.trim())];
  if (rowItems.length) {
    textLines.push(
      "",
      "Für dich ausgesucht:",
      ...rowItems.map((item) =>
        item.description ? `- ${item.name}: ${item.description}` : `- ${item.name}`
      )
    );
  }
  // Set mail: the set block sits right after the prose, before the
  // unsubscribe footer.
  if (bundle) textLines.push(bundle.text);
  // The offer countdown runs to the deadline of the one offer in the mail:
  // the set's expiry (set mail) or the code's (item mail with a code).
  const offerExpiresAt = bundle
    ? earliestDeadline(bundle.expiresAt)
    : discountCode
      ? earliestDeadline(opts.discountExpiresAt)
      : null;
  const countdownLine = offerExpiresAt ? countdownText(offerExpiresAt, "de") : "";
  if (countdownLine) textLines.push("", countdownLine);
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
  // which a content edit can never remove. The note's gaps are margins:
  // Outlook for Windows ignores padding on <p>.
  const discountNote = linkUrl
    ? discountCode
      ? `<p style="${emailMutedTextStyle()} Margin-top: 5px; Margin-bottom: 10px;" align="center">Dein pers&#246;nlicher Code <strong>${escapeHtml(
          discountCode
        )}</strong> ist im Warenkorb bereits hinterlegt${escapeHtml(validityNote)}.</p>`
      : ""
    : discountCode
      ? `<p style="${emailMutedTextStyle()} Margin-top: 5px; Margin-bottom: 10px;" align="center">Dein pers&#246;nlicher Code: <strong>${escapeHtml(
          discountCode
        )}</strong>${escapeHtml(validityNote)}.</p>`
      : "";

  // Personalised product section: black separator band + one ROW per product
  // (image/name/price in the first third, the personalised description + a
  // product button in the remaining two thirds).
  const productsRows = rowItems.length
    ? renderSectionBand("Für dich ausgesucht") +
      renderSectionRow(renderEmailProductRows(rowItems), {
        padding: "10px 60px 20px",
        align: "center",
      })
    : "";

  const html = renderBrandedEmail({
    subject,
    preheader: body.trim().split("\n")[0]?.slice(0, 140) || undefined,
    heading: "Deine persönliche Empfehlung",
    // The email is written by Mo — the brand orb makes that recognizable.
    moAvatar: true,
    // Prose links (markdown + bare URLs) render as clickable text — never a
    // raw pasted URL.
    bodyHtml: `
                    <p style="${emailTextStyle()} white-space: pre-wrap;" align="left">${renderEmailProseHtml(
                      body.trim(),
                      { labelForUrl: opts.labelForUrl, linkStyle: emailLinkStyle() }
                    )}</p>`,
    // Full-width newsletter sections between prose and the cart pill: the
    // offer — the product rows (item mail) or the set block (set mail) — and
    // its countdown.
    preCtaRowsHtml: `${productsRows}${bundle ? bundle.html : ""}${
      offerExpiresAt ? renderOfferCountdown({ expiresAt: offerExpiresAt, language: "de" }) : ""
    }`,
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
