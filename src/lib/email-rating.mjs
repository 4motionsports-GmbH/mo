// Newsletter rating links ("Wie hilfreich war diese Empfehlung?") — the pure
// vocabulary shared by the email designs (which render the smiley row) and the
// public rating endpoint (which validates the click).
//
// A rating is deliberately ANONYMOUS: the link carries only the score and the
// email kind, no recipient identity, so a forwarded email can never leak who
// received it and no token has to be minted at send time. The click is stored
// as a normal feedback row (migration 0020) and shows up in the admin Feedback
// tab next to the widget comments.

export const EMAIL_RATING_MIN = 1;
export const EMAIL_RATING_MAX = 5;

/** The smiley + caption shown per score (German admin/customer copy). */
export const EMAIL_RATING_FACES = ["☹", "🙁", "😐", "🙂", "😊"];

/**
 * Parse an untrusted rating value ("4", 4) into 1–5, or null.
 * @param {unknown} value
 * @returns {number | null}
 */
export function parseEmailRating(value) {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isInteger(n) && n >= EMAIL_RATING_MIN && n <= EMAIL_RATING_MAX ? n : null;
}

/**
 * The feedback-row message for one rating — the string the admin Feedback tab
 * shows. Kept here so endpoint and any later analytics agree on the format.
 * @param {number} rating
 * @param {string} kind
 * @returns {string}
 */
export function emailRatingMessage(rating, kind) {
  return `Newsletter-Bewertung: ${rating}/${EMAIL_RATING_MAX} (${kind})`;
}

/**
 * Build the click URL for one score.
 * @param {string} baseUrl  Absolute deployment base URL (no trailing slash).
 * @param {number} rating
 * @param {string} kind     Email kind ('marketing' | 'campaign' | …).
 * @returns {string}
 */
export function emailRatingUrl(baseUrl, rating, kind) {
  return `${baseUrl}/api/newsletter-rating?r=${rating}&k=${encodeURIComponent(kind)}`;
}
