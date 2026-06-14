// Consent-copy VERSIONING — kept in plain .mjs (pure, no I/O) so it is
// trivially unit-testable with node:test and shared by the TS modules,
// mirroring the email-offer-trigger.mjs convention.
//
// WHY A VERSION EXISTS: the canonical consent strings (src/lib/consent-copy.ts)
// evolve. The verbatim `consent_text_shown` remains the byte-authoritative
// Art. 7 audit record, but a stored version identifier lets the audit trail
// distinguish copy eras without string-matching old copy. Bump
// CONSENT_COPY_VERSION whenever the served consent copy (any surface) changes.
//
// One linear version spans EVERY consent surface the backend serves (the
// in-chat capture form AND the at-sign-in marketing opt-in). The verbatim
// `consent_text_shown` disambiguates which surface a record came from; the
// version is the coarse copy-era stamp shared by both.

/**
 * Identifier of the consent copy currently served by the backend. History:
 *   - "v1" — launch placeholder copy (long labels + marketing benefit hint;
 *            transactional box was allowed to render pre-checked). Rows from
 *            before versioning existed are backfilled to "v1" by migration
 *            0011 (v1 was the only copy ever served).
 *   - "v2" — shorter labels + shared footer; BOTH boxes start unchecked.
 *   - "v3" — adds the AT-SIGN-IN marketing opt-in surface (a signed-in customer
 *            opts into the SAME double-opt-in without re-typing their verified
 *            email; benefit-framed, UNTICKED, no dark patterns). The in-chat
 *            capture-form labels are unchanged from v2 but ship as part of the
 *            v3 copy set, so new captures on either surface stamp "v3". v3 is
 *            the copy now under lawyer review (it REPLACES v2 there).
 */
export const CONSENT_COPY_VERSION = "v3";

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
