// Release dates that change what a KPI number means — the KPI tab annotates
// the affected sections when the selected period reaches back before them
// (docs/frontend/README.md §4, docs/frontend/05-engagement-and-kpi.md §12.1).
// Pure: dates are calendar days (YYYY-MM-DD, Europe/Berlin), compared as
// strings; the notes are German UI text.

/**
 * @typedef {{ date: string, key: string, title: string, detail: string }} KpiRelease
 */

/** @type {readonly KpiRelease[]} */
export const KPI_RELEASES = Object.freeze([
  {
    date: "2026-10-01",
    key: "widget-popups",
    title: "Widget-Update: Anmelde-Popup und Einwilligungs-Popup",
    detail:
      "Anonyme Besucher:innen werden nach der ersten Antwort zur Anmeldung eingeladen; angemeldete fragt ein Popup nach der Einwilligung. Startfragen und das anonyme E-Mail-Gate entfallen; der Kampagnen-Link öffnet den Chat wieder.",
  },
  {
    date: "2026-10-03",
    key: "signin-code",
    title: "Anmelde-Fix mit Einmal-Code (Backend)",
    detail:
      "Eine Anmeldung zählt im Chat nur noch, wenn das Widget den Einmal-Code einlöst. Bis zum Widget-Upload am 04.10. konnte sich deshalb niemand im Chat anmelden.",
  },
  {
    date: "2026-10-04",
    key: "customer-platform-widget",
    title: "Kundenplattform-Widget live",
    detail:
      "Einmal-Code, Shop-Erkennung, Einwilligungsregeln, Lösch-Text, Kampagnen-Token (mo_c), stiller Bestellstatus, Verlauf löschen beim Abmelden; dazu Kontaktformular mit Sitzung, eigene Beschriftung für Bestellanfragen, Abbruch der Antwort bei neuem Chat und der Produktseiten-Knopf auf allen Produktvorlagen.",
  },
]);

/** First day whose data a section can be read for — earlier days are not comparable. */
const MEANINGFUL_FROM = Object.freeze({
  "anmelde-popup": {
    date: "2026-10-04",
    why: "Anmeldungen im Chat (letzte Stufe) gibt es erst seit dem Upload des Kundenplattform-Widgets",
  },
  consent: {
    date: "2026-10-04",
    why: "das Einwilligungs-Popup erscheint nur nach einer Anmeldung im Chat, die erst seit dem Widget-Upload wieder funktioniert",
  },
  konto: {
    date: "2026-10-04",
    why: "Anmeldungen im Chat, Datenexport, Löschung und die Sitzung am Kontaktformular gibt es erst seit dem Widget-Upload",
  },
  campaign: {
    date: "2026-10-04",
    why: "„Chat gestartet“ zählt erst, seit das Widget den Kampagnen-Token (mo_c) mitschickt",
  },
});

/** The sign-in outage: backend required the code, the live widget did not redeem it yet. */
export const SIGNIN_OUTAGE = Object.freeze({ from: "2026-10-03", to: "2026-10-04" });

const SIGNIN_SECTIONS = new Set(["anmelde-popup", "consent", "konto"]);

/** @param {string} ymd YYYY-MM-DD → DD.MM.YYYY */
export function germanDay(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(ymd);
}

/** @param {unknown} v */
function isYmd(v) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/**
 * Notes for one KPI section and the selected period: one when the period starts
 * before the section's data is meaningful, one when it covers the sign-in
 * outage. Empty when the period is entirely after both.
 *
 * @param {string} section "anmelde-popup" | "consent" | "konto" | "campaign"
 * @param {{ from: string, to: string }} range
 * @returns {string[]}
 */
export function releaseNotesFor(section, range) {
  if (!range || !isYmd(range.from) || !isYmd(range.to)) return [];
  /** @type {string[]} */
  const notes = [];
  const m = /** @type {Record<string, { date: string, why: string }>} */ (MEANINGFUL_FROM)[section];
  if (m && range.from < m.date) {
    notes.push(`Erst ab dem ${germanDay(m.date)} aussagekräftig: ${m.why}. Für Vergleiche den Zeitraum ab diesem Tag wählen.`);
  }
  if (SIGNIN_SECTIONS.has(section) && range.from <= SIGNIN_OUTAGE.to && range.to >= SIGNIN_OUTAGE.from) {
    notes.push(
      `Vom ${germanDay(SIGNIN_OUTAGE.from)} bis zum Widget-Upload am ${germanDay(SIGNIN_OUTAGE.to)} konnte sich niemand im Chat anmelden (Einmal-Code vom Backend verlangt, vom Widget noch nicht eingelöst) — Rückgänge in diesen Tagen sind kein Trend.`
    );
  }
  return notes;
}

/**
 * Releases inside the selected period (inclusive), oldest first — the KPI tab
 * lists them above the sections.
 *
 * @param {{ from: string, to: string }} range
 * @returns {KpiRelease[]}
 */
export function releasesInRange(range) {
  if (!range || !isYmd(range.from) || !isYmd(range.to)) return [];
  return KPI_RELEASES.filter((r) => r.date >= range.from && r.date <= range.to);
}
