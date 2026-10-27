// Pure helpers of the storefront live check (scripts/check-live-widget.mjs,
// `npm run verify:widget`) beyond the widget fingerprint: is the Home-Gym-
// Konfigurator served under its public URL, and does an old URL redirect
// there? (docs/CONFIGURATOR.md §7, docs/ROLLOUT_TODO.md item 16.)

/** The configurator's public URL path — announced to the Men's Health / Women's Health editors. */
export const CONFIGURATOR_PAGE_PATH = "/pages/home-gym-konfigurator";

/** Earlier paths of the configurator page that should redirect to CONFIGURATOR_PAGE_PATH. */
export const CONFIGURATOR_OLD_PATHS = Object.freeze(["/pages/home-gym-konfigurator-1"]);

/**
 * What a storefront page's HTML says about the configurator section
 * (sections/ms-home-gym-configurator.liquid): the docked Mo host and the
 * answer form are its markers.
 * @param {unknown} html
 * @returns {{ configurator: boolean, dock: boolean, form: boolean }}
 */
export function configuratorPageStatus(html) {
  const text = typeof html === "string" ? html : "";
  const dock = text.includes("data-ms-chat-dock");
  const form = text.includes("data-ms-hgk-form");
  return { configurator: dock && form, dock, form };
}

/**
 * The path (without query / hash, without a trailing slash) of a URL or path;
 * "" when unparseable.
 * @param {unknown} url
 * @param {string} [origin]
 */
export function urlPath(url, origin = "https://www.motionsports.de") {
  if (typeof url !== "string" || !url.trim()) return "";
  try {
    const path = new URL(url, origin).pathname.replace(/\/+$/, "");
    return path || "/";
  } catch {
    return "";
  }
}

/**
 * Does a redirect answer (status + Location header) lead to `targetPath`?
 * Shopify's URL redirects answer 301; 302/307/308 count too.
 * @param {number} status
 * @param {unknown} location
 * @param {string} targetPath
 * @param {string} [origin]
 */
export function redirectsTo(status, location, targetPath, origin) {
  if (![301, 302, 307, 308].includes(status)) return false;
  return urlPath(location, origin) === urlPath(targetPath, origin);
}
