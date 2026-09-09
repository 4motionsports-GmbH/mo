// The admin screen registry (pure, unit-tested): keys, labels, groups,
// explanations, keyboard shortcuts and URL mapping. The React side
// (src/app/admin/tabs.tsx) adds icons and the server loaders; everything that
// does not need React lives here so the shell, the page and the tests share
// one source of truth.
//
// URL contract (unchanged since the first dashboard): `/admin` is the Übersicht,
// every other screen is `/admin?tab=<key>`. The legacy `?tab=customers` (the
// former Marketing tab) keeps resolving to Kunden.

/**
 * @typedef {"overview" | "kunden" | "kampagne" | "kpi" | "feedback" | "gespraeche" |
 *   "wissen" | "analyse" | "verbesserung" | "einstellungen"} AdminTabKey
 * @typedef {"Arbeit" | "Einblicke" | "System"} AdminTabGroup
 * @typedef {{
 *   key: AdminTabKey,
 *   label: string,
 *   group: AdminTabGroup,
 *   description: string,
 *   wide: boolean,
 *   shortcut: string,
 * }} AdminTabMeta
 */

/** Sidebar groups in display order. */
export const ADMIN_TAB_GROUPS = /** @type {const} */ (["Arbeit", "Einblicke", "System"]);

/**
 * Screens in display order (also the shortcut order: 1 … 9, 0). Descriptions
 * are the former tab subtitles — they now live in the InfoTip next to the title.
 * @type {readonly AdminTabMeta[]}
 */
export const ADMIN_TABS = Object.freeze([
  {
    key: "overview",
    label: "Übersicht",
    group: "Arbeit",
    description: "Kennzahlen & Schnellzugriff auf einen Blick.",
    wide: false,
    shortcut: "1",
  },
  {
    key: "kampagne",
    label: "Kampagne",
    group: "Arbeit",
    description:
      "Personalisierte E-Mails an Shopify-Marketing-Abonnent:innen — prüfen, anpassen, senden.",
    wide: true,
    shortcut: "2",
  },
  {
    key: "kunden",
    label: "Kunden",
    group: "Arbeit",
    description:
      "Suche, filtere & öffne eine Person — Profil, Käufe, Marketing, Korrespondenz & Brief.",
    wide: true,
    shortcut: "3",
  },
  {
    key: "wissen",
    label: "Wissen",
    group: "Arbeit",
    description:
      "Offene Kundenfragen aus Beratungen beantworten & als Q&A veröffentlichen — für Produktseite & Mo.",
    wide: false,
    shortcut: "4",
  },
  {
    key: "kpi",
    label: "KPIs",
    group: "Einblicke",
    description: "Pseudonyme Analytics (Cluster A) + Shopify-Käufe.",
    wide: true,
    shortcut: "5",
  },
  {
    key: "gespraeche",
    label: "Gespräche",
    group: "Einblicke",
    description:
      "Alle Beratungen einsehen & auswerten — Transkripte, Signale, KI-Analyse.",
    wide: true,
    shortcut: "6",
  },
  {
    key: "feedback",
    label: "Feedback",
    group: "Einblicke",
    description: "Kund:innen-Rückmeldungen aus dem Widget — neueste zuerst.",
    wide: false,
    shortcut: "7",
  },
  {
    key: "analyse",
    label: "Analyse",
    group: "Einblicke",
    description:
      "Komplettanalysen je Zeitintervall — alle KI-Auswertungen verdichtet, gespeichert & als PDF.",
    wide: true,
    shortcut: "8",
  },
  {
    key: "verbesserung",
    label: "Verbesserung",
    group: "Einblicke",
    description:
      "Mo analysiert die Komplettanalyse & schlägt Verbesserungen vor — für den Shop & für sich selbst.",
    wide: true,
    shortcut: "9",
  },
  {
    key: "einstellungen",
    label: "Einstellungen",
    group: "System",
    description:
      "E-Mail-Designs auswählen & je E-Mail-Typ aktivieren — neue Designs entstehen mit Claude Code.",
    wide: false,
    shortcut: "0",
  },
]);

/** @type {readonly AdminTabKey[]} */
export const ADMIN_TAB_KEYS = Object.freeze(ADMIN_TABS.map((t) => t.key));

/** Legacy `?tab=` values that still resolve to a screen. */
const TAB_ALIASES = Object.freeze({ customers: "kunden", marketing: "kunden" });

const DEFAULT_ADMIN_TAB = "overview";

/**
 * Resolve a raw `?tab=` value (string, array or nothing) to a screen key.
 * Unknown values fall back to the Übersicht — never to an error page.
 * @param {unknown} raw
 * @returns {AdminTabKey}
 */
export function parseAdminTab(raw) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return DEFAULT_ADMIN_TAB;
  const key = value.trim().toLowerCase();
  if (ADMIN_TAB_KEYS.includes(/** @type {AdminTabKey} */ (key))) {
    return /** @type {AdminTabKey} */ (key);
  }
  if (key in TAB_ALIASES) return TAB_ALIASES[/** @type {keyof typeof TAB_ALIASES} */ (key)];
  return DEFAULT_ADMIN_TAB;
}

/**
 * @param {AdminTabKey} key
 * @returns {AdminTabMeta}
 */
export function adminTabMeta(key) {
  return ADMIN_TABS.find((t) => t.key === key) ?? ADMIN_TABS[0];
}

/**
 * URL of a screen. The Übersicht is the bare `/admin`; extra params are
 * appended (e.g. `{ filter: "no_purchase" }` for a pre-filtered Kunden list).
 * @param {AdminTabKey} key
 * @param {Record<string, string | undefined>} [params]
 * @returns {string}
 */
export function adminTabHref(key, params = {}) {
  const sp = new URLSearchParams();
  if (key !== DEFAULT_ADMIN_TAB) sp.set("tab", key);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") sp.set(name, value);
  }
  const query = sp.toString();
  return query ? `/admin?${query}` : "/admin";
}

/**
 * Screen for a bare digit key press (1 … 9, 0) or null.
 * @param {string} digit
 * @returns {AdminTabKey | null}
 */
export function adminTabForShortcut(digit) {
  return ADMIN_TABS.find((t) => t.shortcut === digit)?.key ?? null;
}
