// Placeholder→real discount swap (pure, no I/O). At draft time the body carries
// the clearly-marked placeholder code (MO-XXXX) and a PROJECTED expiry date; at
// send time the real unique code is minted and swapped in 1:1, and — if the
// draft sat around — the stale projected date string is swapped for the real
// one, so the prose and the working code/deadline never disagree.
//
// Extracted from marketing-email.ts (approveAndSend) so the campaign send path
// reuses the EXACT same logic instead of duplicating it. Kept in plain .mjs so
// node:test can exercise it directly. Callers pass pre-formatted date LABELS
// (formatGermanExpiryDate) — this module never formats dates itself.

/**
 * Swap the draft placeholder code for the real minted code wherever it appears,
 * and replace a stale projected expiry label with the real one (only when both
 * labels are present and differ).
 *
 * @param {string} body  the drafted prose
 * @param {{
 *   placeholder: string,               // e.g. PLACEHOLDER_DISCOUNT_CODE (MO-XXXX)
 *   code: string,                      // the real minted code (MS5-… / MK-…)
 *   draftExpiryLabel?: string | null,  // label projected at draft time
 *   realExpiryLabel?: string | null,   // label of the just-minted code
 * }} swap
 * @returns {string}
 */
export function applyMintedDiscountToBody(body, swap) {
  let out = typeof body === "string" ? body : "";
  if (swap.placeholder && swap.code) {
    out = out.split(swap.placeholder).join(swap.code);
  }
  if (
    swap.draftExpiryLabel &&
    swap.realExpiryLabel &&
    swap.draftExpiryLabel !== swap.realExpiryLabel
  ) {
    out = out.split(swap.draftExpiryLabel).join(swap.realExpiryLabel);
  }
  return out;
}

/**
 * A placeholder code left in prose that ships WITHOUT a discount: the swap
 * above only runs when a code is minted, so „Mit dem Code MO-XXXX …“ would
 * reach the customer as written — an offer that does not exist. The send
 * paths refuse such a draft (fail-closed); the operator edits the text or
 * picks a depth. Case-insensitive, so „mo-xxxx“ typed by hand counts too.
 *
 * @param {unknown} body
 * @param {string} placeholder
 * @param {unknown} discountPercent
 * @returns {boolean}
 */
export function hasStrayPlaceholder(body, placeholder, discountPercent) {
  if (Number(discountPercent) > 0 || !placeholder) return false;
  const text = typeof body === "string" ? body : "";
  return text.toLowerCase().includes(String(placeholder).toLowerCase());
}
