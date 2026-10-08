// Which storefront widget build is live? `ms-chat-widget.js` has no version
// constant or header, so the build is recognised by strings in the served file
// (docs/frontend/07-feature-and-kpi-playbook.md §6.4). Shopify may minify a
// theme's ES5 JavaScript when it serves it (comments and whitespace removed,
// local names possibly mangled), so the markers are string literals — storage
// keys, endpoints, event names, UI text — which survive minification, counted
// whitespace-insensitively. Only 8d0a0c4 → 3e87341 differ by code alone (two
// added endSpeaking() calls): told apart while names are unmangled, otherwise
// reported as one acceptable state. Counts were checked against the theme
// repo's commits raw and after terser (whitespace-only and full).
// Pure — scripts/check-live-widget.mjs fetches.

/** Strings counted in the live JS. */
export const WIDGET_MARKERS = Object.freeze([
  "/api/chat", // any Mo widget
  "/api/auth/link", // PR #73: redeems the one-time sign-in code
  "ms_mo_c", // PR #73: campaign token kept from the head script
  "ms-chat-whoami-done", // PR #73: one whoami call per tab
  "ms-chat-early-params", // PR #73: head-script hand-over
  "get_order_status", // PR #73: the silent tool name
  "order_support", // 8d0a0c4: contact-form reason label
  "Bestellnummer + kurz", // 8d0a0c4: its placeholder
  "endSpeaking(", // 3e87341: 10 calls instead of 8 (unmangled builds only)
  "ms-chat-login-gate-snooze", // 2026-10-01: sign-in popup (its 24 h snooze key)
  "ms-chat-mkt-decision", // PR #67 consent gate (restored in beff918)
  "ms-mo-attr", // 2026-08-12: cart attribution stamp
  "/api/attribution/token", // 2026-08-12: cart attribution token
  "starter_shown", // starter prompts (removed 2026-10-01)
  "ms-chat-ctx-last", // tasks of 2026-10-05: page context on typed messages (storage key)
  "ms-chat-optin-benefits", // tasks of 2026-10-05: served consent-popup bullets (class name)
  "Rabattaktionen zuerst erfahren", // widget-authored popup bullet (2026-10-01 … 2026-10-04 builds); gone with the served bullets
  "ms-chat-reward-badge", // round of 2026-10-08 (495fdf6, PR #76): served reward badge (class name)
  "ms-chat-vm-lead", // round of 2026-10-08: value-moment lead of the inline card (class name)
]);

/** @param {string} s */
const squash = (s) => s.replace(/\s+/g, "");

/**
 * @param {string} text whitespace-free haystack
 * @param {string} needle whitespace-free marker
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
  const text = squash(typeof js === "string" ? js : "");
  /** @type {Record<string, number>} */
  const counts = {};
  for (const m of WIDGET_MARKERS) counts[m] = occurrences(text, squash(m));
  return counts;
}

/**
 * The builds, newest first. `current` = the build live since 2026-10-08 (495fdf6,
 * dormant until the backend serves `reward` / `valueMoment`);
 * `acceptable` = the widget side is ready for the order status and the App Proxy
 * (the App Proxy also needs the backend step C.17, docs/ROLLOUT_TODO.md 5.4).
 * @type {ReadonlyArray<{ key: string, commit: string, label: string, current: boolean, acceptable: boolean, consequence: string }>}
 */
export const WIDGET_BUILDS = Object.freeze([
  {
    key: "reward-2026-10-08",
    commit: "495fdf6",
    label: "Widget mit der Runde vom 08.10. (495fdf6, PR #76: Willkommensgutschein, Anmelde-Teaser, Wertmoment — ruhend)",
    current: true,
    acceptable: true,
    consequence:
      "Erwarteter Live-Stand, ruhend: ohne reward / valueMoment im ausgelieferten Text (v6) zeigt das Widget nichts Neues; aktiv sind nur die Härtungen H-1 (kein Wertmoment und keine Token-Erneuerung nach einem abgebrochenen Stream) und H-2 (ein Ja der letzten 24 h auf diesem Gerät fragt nicht erneut). CONSENT_REWARD_ENABLED / CONSENT_VALUE_MOMENT_ENABLED erst nach T8/T9.",
  },
  {
    key: "tasks-2026-10-05",
    commit: "bc7fb5d",
    label: "Widget mit den Aufgaben vom 05.10. (bc7fb5d, 2026-10-06: Vorteile vom Server, Seitenkontext, Token-Erneuerung)",
    current: false,
    acceptable: true,
    consequence:
      "Stand vom 06.10.: Vorteile im Einwilligungs-Popup kommen vom Server (mit Variante und Platzierung), getippte Fragen auf Produkt- und Kollektionsseiten tragen den Seitenkontext, die Bestell-Markierung wird nach einer Beratung erneuert und beim Abmelden geleert — aber ohne Gutschein-Hinweis, Anmelde-Teaser und Wertmoment und ohne H-1/H-2. 495fdf6 hochladen.",
  },
  {
    key: "main-2026-10-04",
    commit: "3e87341",
    label: "Theme main 3e87341 (2026-10-04, alle Fixes)",
    current: false,
    acceptable: true,
    consequence:
      "Stand vor dem 06.10.: Einmal-Code, Shop-Erkennung, mo_c, Kontaktformular mit Sitzung, order_support-Beschriftung, Antwortabbruch und Audio-Stopp bei neuem Chat — aber Vorteile im Einwilligungs-Popup noch aus dem Widget, kein Seitenkontext bei getippten Fragen, keine Token-Erneuerung. 495fdf6 hochladen.",
  },
  {
    key: "fixes-minified",
    commit: "8d0a0c4 / 3e87341",
    label: "8d0a0c4 oder main 3e87341 (minifiziert ausgeliefert)",
    current: false,
    acceptable: true,
    consequence:
      "Stand vor dem 06.10. (minifiziert; ob der Audio-Stopp von 3e87341 dabei ist, lässt sich nicht erkennen): ohne Vorteile vom Server, Seitenkontext und Token-Erneuerung — 495fdf6 hochladen.",
  },
  {
    key: "fixes-8d0a0c4",
    commit: "8d0a0c4",
    label: "8d0a0c4 (2026-10-04 b, ohne Audio-Stopp)",
    current: false,
    acceptable: true,
    consequence:
      "Stand vom 04.10. ohne Audio-Stopp bei „Neuer Chat“ und ohne die Aufgaben vom 05.10. — 495fdf6 hochladen.",
  },
  {
    key: "pr73",
    commit: "a0df103",
    label: "PR #73 (a0df103, 2026-10-04)",
    current: false,
    acceptable: true,
    consequence:
      "Anmeldung, mo_c und App-Proxy-Einlösen funktionieren; ohne Sitzung im Kontaktformular-Body (das Backend nimmt dann x-ms-session), ohne order_support-Beschriftung, ohne Antwortabbruch bei neuem Chat und ohne die Aufgaben vom 05.10. — 495fdf6 hochladen.",
  },
  {
    key: "popup-2026-10-01",
    commit: "44a076b",
    label: "Popup-Build 2026-10-01 (4dbc625 / 44a076b)",
    current: false,
    acceptable: false,
    consequence:
      "Darf nicht mehr live sein: Anmeldung im Chat unmöglich (kein Einmal-Code), mo_c ignoriert, App Proxy muss AUS bleiben (whoami ohne Einlösen).",
  },
  {
    key: "restore-2026-10-01",
    commit: "beff918",
    label: "Wiederherstellung 2026-10-01 (beff918, vor dem Popup)",
    current: false,
    acceptable: false,
    consequence: "Kein Anmelde-Popup, kein Einmal-Code — Anmeldung im Chat unmöglich.",
  },
  {
    key: "drift-2026-08-12",
    commit: "e4b12f1",
    label: "Attributions-Build 2026-08-12 auf verdriftetem Stand (e4b12f1)",
    current: false,
    acceptable: false,
    consequence: "Drift: Startfragen zurück, kein ?mo=open, Einwilligungs-Gate aus PR #67 fehlt.",
  },
  {
    key: "pre-2026-08-12",
    commit: "",
    label: "Älter als 2026-08-12",
    current: false,
    acceptable: false,
    consequence: "Kein _mo-Warenkorbstempel — Zuordnung über den Warenkorb fehlt.",
  },
]);

/**
 * Classify the live build from its marker counts (07 §6.4), newest rule first.
 * @param {Record<string, number>} c countWidgetMarkers() output
 * @returns {(typeof WIDGET_BUILDS)[number] | null}
 *   null = no rule matched (a mixed or unknown build, or not the widget file)
 */
export function classifyWidgetBuild(c) {
  const n = (k) => Math.max(0, Number(c?.[k]) || 0);
  const build = (key) => WIDGET_BUILDS.find((b) => b.key === key) ?? null;
  if (n("/api/chat") === 0) return null; // not the widget (an error page)
  const pr73 = n("/api/auth/link") > 0 && n("ms_mo_c") > 0;
  const fixes = n("order_support") > 0 && n("Bestellnummer + kurz") > 0;
  if (pr73 && fixes && (n("ms-chat-ctx-last") > 0 || n("ms-chat-optin-benefits") > 0)) {
    // The upload with the tasks of 2026-10-05 — only when all of it arrived;
    // a half-applied build is unknown.
    const complete =
      n("ms-chat-ctx-last") > 0 && n("ms-chat-optin-benefits") > 0 && n("Rabattaktionen zuerst erfahren") === 0;
    if (!complete) return null;
    // On top of it, the round of 2026-10-08 (495fdf6): both of its class names,
    // or it is half applied.
    const reward = n("ms-chat-reward-badge") > 0;
    const valueMoment = n("ms-chat-vm-lead") > 0;
    if (reward && valueMoment) return build("reward-2026-10-08");
    if (reward || valueMoment) return null;
    return build("tasks-2026-10-05");
  }
  if (pr73 && fixes) {
    const speaking = n("endSpeaking(");
    if (speaking === 0) return build("fixes-minified"); // names mangled
    return build(speaking >= 10 ? "main-2026-10-04" : "fixes-8d0a0c4");
  }
  if (pr73 && n("order_support") === 0 && n("Bestellnummer + kurz") === 0) return build("pr73");
  if (pr73) return null; // half the 8d0a0c4 strings: neither row of the table
  if (n("/api/auth/link") > 0 || n("ms_mo_c") > 0) return null; // half a PR #73 set
  if (n("ms-chat-login-gate-snooze") > 0) return build("popup-2026-10-01");
  if (n("ms-mo-attr") > 0 && n("ms-chat-mkt-decision") > 0) return build("restore-2026-10-01");
  if (n("ms-mo-attr") > 0 && n("starter_shown") > 0) return build("drift-2026-08-12");
  if (n("ms-mo-attr") === 0 && n("/api/attribution/token") === 0) return build("pre-2026-08-12");
  return null;
}

/** Does this build redeem the one-time code (safe with the App Proxy on)? */
export function widgetRedeemsLinkCode(c) {
  return Math.max(0, Number(c?.["/api/auth/link"]) || 0) > 0;
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

/** Whitespace-insensitive "does the page contain this snippet". */
export function containsLoosely(haystack, needle) {
  return typeof haystack === "string" && squash(haystack).includes(squash(needle));
}
