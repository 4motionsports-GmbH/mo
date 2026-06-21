// Locale primitive (pure, no I/O) — kept in plain .mjs so it is trivially
// unit-testable with node:test and shared by BOTH the TS modules and the pure
// `*-core.mjs` copy modules, mirroring the email-offer-trigger.mjs /
// consent-copy-version.mjs convention.
//
// ONE storefront-selected locale flows through the backend: German is the
// default ("/de" and everything legacy), English is opt-in ("/en"). The widget
// derives it from the storefront path and passes it as a `locale` param on the
// chat + capture endpoints; it is carried from capture through send and stored
// with the consent record. Anything we cannot resolve falls back to German, so
// the German experience is never weakened by a missing/garbage value.

/** The default locale — German. Unchanged behaviour for every legacy caller. */
export const DEFAULT_LOCALE = "de";

/** The locales the backend serves. */
export const SUPPORTED_LOCALES = ["de", "en"];

/**
 * Type guard: exactly one of the supported locales.
 * @param {unknown} value
 * @returns {value is "de" | "en"}
 */
export function isLocale(value) {
  return value === "de" || value === "en";
}

/**
 * Coerce an arbitrary input to a supported locale, defaulting to German.
 * Accepts the bare code ("en"), a cased variant ("EN"), or a BCP-47-ish tag
 * whose primary subtag is supported ("en-GB", "de-DE", "de_AT"). Anything else
 * (null, "fr", "", a number) resolves to the default — fail-soft to German.
 *
 * @param {unknown} value
 * @returns {"de" | "en"}
 */
export function normalizeLocale(value) {
  if (typeof value !== "string") return DEFAULT_LOCALE;
  const primary = value.trim().toLowerCase().split(/[-_]/)[0];
  return isLocale(primary) ? primary : DEFAULT_LOCALE;
}

/**
 * Pick the value for `locale` from a `{ de, en }` map. Falls back to the German
 * entry when the locale is missing from the map — so a partially-translated map
 * degrades to German rather than to `undefined`.
 *
 * @template T
 * @param {"de" | "en"} locale
 * @param {{ de: T, en: T }} map
 * @returns {T}
 */
export function pick(locale, map) {
  return locale === "en" && "en" in map ? map.en : map.de;
}
