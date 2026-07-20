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

/**
 * Whether an existing open draft may be reused as-is (same offer, no explicit
 * regenerate). Mirrors /api/admin/marketing/draft.
 *
 * @param {{ discountPercent: number } | null | undefined} existing
 * @param {number} requestedPercent
 * @param {boolean} regenerate
 * @returns {boolean}
 */
export function shouldReuseCampaignDraft(existing, requestedPercent, regenerate) {
  if (!existing) return false;
  if (regenerate === true) return false;
  return Number(existing.discountPercent) === Number(requestedPercent);
}

/**
 * The Mo-promo intro (2–3 sentences introducing the AI advisor), per language.
 * Deliberately calm copy: no urgency, no countdown (same ceiling as the
 * drafts). The deep link itself is appended by moPromoBlockText (text part) /
 * rendered as the CTA button (HTML part).
 *
 * @param {"de" | "en"} language
 * @returns {string}
 */
export function moPromoIntroText(language) {
  if (language === "en") {
    return (
      "By the way: our shop now has a personal advisor — Mo. Ask him anything " +
      "about training and equipment in the chat: which machine fits you, how to " +
      "plan your home gym, what pairs well with what you already own. One click " +
      "and your personal consultation starts right away, in full screen:"
    );
  }
  return (
    "Übrigens: In unserem Shop berät dich jetzt Mo — dein persönlicher " +
    "KI-Berater. Stell ihm im Chat alle Fragen rund um Training und Ausstattung: " +
    "welches Gerät zu dir passt, wie du dein Home-Gym planst, was gut zu deiner " +
    "vorhandenen Ausstattung passt. Ein Klick genügt und deine persönliche " +
    "Beratung startet direkt im Vollbild:"
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
