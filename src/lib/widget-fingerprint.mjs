// Which storefront widget build is live? `ms-chat-widget.js` has no version
// constant or header, so the build is recognised by strings in the served file
// (docs/frontend/07-feature-and-kpi-playbook.md §6.4). Marker counts were
// checked against the theme repo's assets/ms-chat-widget.js at each commit.
// Shopify serves theme assets as uploaded (not minified), so comments and
// spacing in the markers survive. Pure — scripts/check-live-widget.mjs fetches.

/** Strings counted in the live JS. */
export const WIDGET_MARKERS = Object.freeze([
  "redeemLinkCode",
  "captureCampaignToken",
  "ms-chat-early-params",
  "order_support",
  "Bestellnummer + kurz",
  "sessionId: sid",
  "abortActiveStream()",
  "stop any audio still queued",
  "presentLoginGate",
  "moStampCart",
  "handleMoDeepLink",
  "starter_shown",
  "ms-mo-attr",
  "ms-chat-whoami-done",
]);

/**
 * @param {string} text
 * @param {string} needle
 */
function occurrences(text, needle) {
  if (!needle) return 0;
  let n = 0;
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) n++;
  return n;
}

/**
 * @param {unknown} js the served ms-chat-widget.js
 * @returns {Record<string, number>}
 */
export function countWidgetMarkers(js) {
  const text = typeof js === "string" ? js : "";
  /** @type {Record<string, number>} */
  const counts = {};
  for (const m of WIDGET_MARKERS) counts[m] = occurrences(text, m);
  return counts;
}

/**
 * The builds, newest first. `current` = the build the backend expects live.
 * @type {ReadonlyArray<{ key: string, commit: string, label: string, current: boolean, consequence: string }>}
 */
export const WIDGET_BUILDS = Object.freeze([
  {
    key: "main-2026-10-04",
    commit: "3e87341",
    label: "Theme main 3e87341 (2026-10-04, alle Fixes)",
    current: true,
    consequence:
      "Erwarteter Live-Stand: Einmal-Code, Shop-Erkennung, mo_c, Kontaktformular mit Sitzung, order_support-Beschriftung, Antwortabbruch und Audio-Stopp bei neuem Chat. App Proxy und Bestellstatus dürfen eingeschaltet werden.",
  },
  {
    key: "fixes-8d0a0c4",
    commit: "8d0a0c4",
    label: "8d0a0c4 (2026-10-04 b, ohne Audio-Stopp)",
    current: false,
    consequence:
      "Wie main, nur stoppt die Vorlesestimme bei „Neuer Chat“ nicht sofort. App Proxy und Bestellstatus dürfen eingeschaltet werden.",
  },
  {
    key: "pr73",
    commit: "a0df103",
    label: "PR #73 (a0df103, 2026-10-04)",
    current: false,
    consequence:
      "Anmeldung, mo_c und App-Proxy-Einlösen funktionieren; ohne Sitzung am Kontaktformular (Backend nimmt dann x-ms-session), ohne order_support-Beschriftung und ohne Antwortabbruch bei neuem Chat.",
  },
  {
    key: "popup-2026-10-01",
    commit: "44a076b",
    label: "Popup-Build 2026-10-01 (4dbc625 / 44a076b)",
    current: false,
    consequence:
      "Darf nicht mehr live sein: Anmeldung im Chat unmöglich (kein Einmal-Code), mo_c ignoriert, App Proxy muss AUS bleiben (whoami ohne Einlösen).",
  },
  {
    key: "restore-2026-10-01",
    commit: "beff918",
    label: "Wiederherstellung 2026-10-01 (beff918, vor dem Popup)",
    current: false,
    consequence: "Kein Anmelde-Popup, kein Einmal-Code — Anmeldung im Chat unmöglich.",
  },
  {
    key: "drift-2026-08-12",
    commit: "e4b12f1",
    label: "Attributions-Build 2026-08-12 auf verdriftetem Stand (e4b12f1)",
    current: false,
    consequence: "Drift: Startfragen zurück, kein ?mo=open, Einwilligungs-Gate aus PR #67 fehlt.",
  },
  {
    key: "pre-2026-08-12",
    commit: "",
    label: "Älter als 2026-08-12",
    current: false,
    consequence: "Kein _mo-Warenkorbstempel — Zuordnung über den Warenkorb fehlt.",
  },
]);

/**
 * Classify the live build from its marker counts (07 §6.4), newest rule first.
 * @param {Record<string, number>} c countWidgetMarkers() output
 * @returns {{ key: string, commit: string, label: string, current: boolean, consequence: string } | null}
 *   null = no rule matched (a mixed or unknown build — compare by hand)
 */
export function classifyWidgetBuild(c) {
  const n = (k) => Math.max(0, Number(c?.[k]) || 0);
  const build = (key) => WIDGET_BUILDS.find((b) => b.key === key) ?? null;
  const pr73 = n("redeemLinkCode") > 0 && n("captureCampaignToken") > 0;
  const fixes =
    n("order_support") >= 3 && n("Bestellnummer + kurz") > 0 && n("sessionId: sid") >= 3 && n("abortActiveStream()") >= 3;
  if (pr73 && fixes) return build(n("stop any audio still queued") > 0 ? "main-2026-10-04" : "fixes-8d0a0c4");
  if (pr73 && n("order_support") === 0) return build("pr73");
  if (pr73) return null; // partial fixes: neither row of the table
  // Half a PR #73 marker set, or nothing at all (not the widget file): unknown.
  if (n("redeemLinkCode") > 0 || n("captureCampaignToken") > 0) return null;
  if (WIDGET_MARKERS.every((m) => n(m) === 0)) return null;
  if (n("presentLoginGate") > 0) return build("popup-2026-10-01");
  if (n("moStampCart") > 0 && n("handleMoDeepLink") > 0) return build("restore-2026-10-01");
  if (n("moStampCart") > 0 && n("starter_shown") > 0) return build("drift-2026-08-12");
  if (n("moStampCart") === 0 && n("ms-mo-attr") === 0) return build("pre-2026-08-12");
  return null;
}

/**
 * The `ms-chat-widget.js` / `.css` URLs a storefront page references
 * (`asset_url` → //…/cdn/shop/t/<n>/assets/ms-chat-widget.js?v=…).
 * @param {unknown} html
 * @param {string} origin e.g. "https://www.motionsports.de"
 * @returns {{ js: string | null, css: string | null }}
 */
export function widgetAssetUrls(html, origin) {
  const text = typeof html === "string" ? html : "";
  const find = (file) => {
    const re = new RegExp(`["'(]((?:https?:)?//[^"'()\\s]+/${file.replace(".", "\\.")}(?:\\?[^"'()\\s]*)?)["')]`);
    const m = re.exec(text);
    if (!m) return null;
    const url = m[1].replace(/&amp;/g, "&");
    return url.startsWith("//") ? `${new URL(origin).protocol}${url}` : url;
  };
  return { js: find("ms-chat-widget.js"), css: find("ms-chat-widget.css") };
}

/** The CTA-hiding rule snippets/ms-chat-widget.liquid prints on /cart (8d0a0c4). */
export const CART_CTA_HIDING_STYLE = ".ms-chat-product-advisor, .ms-chat-product-cta { display: none !important; }";
