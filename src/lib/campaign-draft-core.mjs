// Campaign draft idempotency + the deterministic Mo-promo block (pure, no I/O).
//
// Idempotency mirrors the existing marketing draft route's rule: an open draft
// is reused only when nothing about the offer changed; a changed discount depth
// or an explicit regenerate overwrites it, so the text and the eventual real
// code can never disagree.
//
// The Mo-promo block is appended DETERMINISTICALLY to every campaign email
// (like the unsubscribe footer) rather than asked of the model, so its presence,
// its exact deep link, and its no-dark-pattern copy are guaranteed — an edit to
// the prose can never remove it.

import { storedTextMode } from "./email-text-mode.mjs";

/**
 * Whether an existing open draft may be reused as-is (same offer, no explicit
 * regenerate). Mirrors /api/admin/customers/marketing-draft.
 *
 * `requestedTextMode` is the explicitly requested text mode, or null/undefined
 * when the request did not name one — an unnamed mode keeps the draft's stored
 * mode, so it never blocks reuse. A named mode that differs from the stored
 * one (NULL = legacy 'detailed') forces a regenerate, so the visible text and
 * the selected mode can never disagree.
 *
 * @param {{ discountPercent: number, textMode?: string | null } | null | undefined} existing
 * @param {number} requestedPercent
 * @param {boolean} regenerate
 * @param {string | null | undefined} [requestedTextMode]
 * @returns {boolean}
 */
export function shouldReuseCampaignDraft(existing, requestedPercent, regenerate, requestedTextMode) {
  if (!existing) return false;
  if (regenerate === true) return false;
  if (Number(existing.discountPercent) !== Number(requestedPercent)) return false;
  if (requestedTextMode != null && storedTextMode(existing) !== requestedTextMode) return false;
  return true;
}

/**
 * The Mo-promo intro (two short sentences introducing the advisor), per
 * language. Deliberately calm and plain: no urgency, no countdown (same
 * ceiling as the drafts), no sales-letter phrasing. The deep link itself is
 * appended by moPromoBlockText (text part) / rendered as the CTA button
 * (HTML part).
 *
 * @param {"de" | "en"} language
 * @returns {string}
 */
export function moPromoIntroText(language) {
  if (language === "en") {
    return (
      "Mo advises you right in the shop chat: which machine suits you, what " +
      "completes your setup, how to plan your home gym. One click and you're talking."
    );
  }
  return (
    "Mo berät dich direkt im Shop-Chat: welches Gerät zu dir passt, was dein " +
    "Setup ergänzt, wie du dein Home-Gym planst. Ein Klick, und ihr sprecht."
  );
}

/**
 * Label of the deep-link CTA button in the HTML part.
 * @param {"de" | "en"} language
 * @returns {string}
 */
export function moPromoCtaLabel(language) {
  return language === "en" ? "Start your consultation with Mo" : "Beratung mit Mo starten";
}

/**
 * The full plain-text Mo-promo block: intro + deep link on its own line.
 * @param {"de" | "en"} language
 * @param {string} deeplinkUrl
 * @returns {string}
 */
export function moPromoBlockText(language, deeplinkUrl) {
  return `${moPromoIntroText(language)}\n${deeplinkUrl}`;
}
