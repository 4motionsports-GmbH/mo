// Campaign email-language derivation (pure, no I/O) — kept in plain .mjs so it
// is unit-testable with node:test, mirroring the locale.mjs convention.
//
// Campaign contacts never used Mo, so there is no stored widget locale; the
// language is derived from the Shopify customer profile instead:
//   1. customer `locale` if present — a de* tag → 'de', any other tag → 'en';
//   2. fallback: defaultAddress country DE/AT/CH → 'de', anything else → 'en';
//   3. final fallback 'de' (no locale AND no country — German store default).

/** Countries whose customers default to German when no locale is stored. */
const GERMAN_COUNTRIES = new Set(["DE", "AT", "CH"]);

/**
 * Derive the campaign email language for a synced Shopify customer.
 *
 * @param {{ locale?: string | null, countryCode?: string | null }} input
 *   `locale` — Shopify Customer.locale (BCP-47-ish, e.g. "de", "de-DE", "en-GB").
 *   `countryCode` — Customer.defaultAddress.countryCodeV2 (ISO alpha-2).
 * @returns {"de" | "en"}
 */
export function deriveCampaignLanguage(input = {}) {
  const locale = typeof input.locale === "string" ? input.locale.trim() : "";
  if (locale) {
    const primary = locale.toLowerCase().split(/[-_]/)[0];
    return primary === "de" ? "de" : "en";
  }
  const country =
    typeof input.countryCode === "string" ? input.countryCode.trim().toUpperCase() : "";
  if (country) {
    return GERMAN_COUNTRIES.has(country) ? "de" : "en";
  }
  return "de";
}
