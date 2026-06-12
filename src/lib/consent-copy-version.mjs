// Consent-copy VERSIONING — kept in plain .mjs (pure, no I/O) so it is
// trivially unit-testable with node:test and shared by the TS modules,
// mirroring the email-offer-trigger.mjs convention.
//
// WHY A VERSION EXISTS: the canonical consent strings (src/lib/consent-copy.ts)
// changed from v1 to v2 (shorter labels, shared Art. 7 footer, BOTH boxes
// unchecked). The verbatim `consent_text_shown` remains the byte-authoritative
// Art. 7 audit record, but a stored version identifier lets the audit trail
// distinguish v1 from v2 records without string-matching old copy. Bump
// CONSENT_COPY_VERSION whenever the served capture-form copy changes.

/**
 * Identifier of the consent copy currently served by the backend. History:
 *   - "v1" — launch placeholder copy (long labels + marketing benefit hint;
 *            transactional box was allowed to render pre-checked). Rows from
 *            before versioning existed are backfilled to "v1" by migration
 *            0011 (v1 was the only copy ever served).
 *   - "v2" — shorter labels + shared footer; BOTH boxes start unchecked.
 */
export const CONSENT_COPY_VERSION = "v2";

/**
 * Compose the pre-served `consentTextShown` audit string from the copy blocks
 * the form displays, in display order. Single source for the separator so the
 * served string and any equality check can never drift.
 *
 * @param {string[]} parts
 * @returns {string}
 */
export function composeConsentTextShown(parts) {
  return parts.join(" | ");
}

/**
 * Resolve which copy version a capture's echoed `consentTextShown` belongs
 * to. The widget echoes the served string byte-for-byte, so an exact match
 * with the currently-served canonical string attests CONSENT_COPY_VERSION.
 * Anything else (stale 60s-cached copy across a deploy boundary, a
 * misbehaving widget, a missing echo) resolves to `null` — stored as an
 * honest "unattested" rather than mislabelling the audit record; the verbatim
 * text itself remains authoritative either way.
 *
 * @param {string | null | undefined} echoedText
 * @param {string} canonicalText
 * @returns {string | null}
 */
export function resolveConsentCopyVersion(echoedText, canonicalText) {
  return echoedText === canonicalText ? CONSENT_COPY_VERSION : null;
}
