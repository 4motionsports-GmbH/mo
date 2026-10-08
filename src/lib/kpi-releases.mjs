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
      "Etwa 0,7 Sekunden nach dem Senden einer Nachricht, während die Antwort noch lädt, lädt ein Popup anonyme Besucher:innen zur Anmeldung ein und fragt angemeldete nach der Einwilligung — höchstens eines pro Browser-Tab. Startfragen und das anonyme E-Mail-Gate entfallen; der Kampagnen-Link öffnet den Chat wieder.",
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
      "Einmal-Code, Shop-Erkennung vorbereitet (aktiv erst mit App Proxy), Einwilligungsregeln, Lösch-Text, Kampagnen-Token (mo_c), stiller Bestellstatus, Verlauf löschen beim Abmelden; dazu Kontaktformular mit Sitzung, eigene Beschriftung für Bestellanfragen, Abbruch der Antwort bei neuem Chat und der Produktseiten-Knopf auf allen Produktvorlagen.",
  },
  {
    date: "2026-10-05",
    key: "attribution-unresolved",
    title: "Bestell-Zuordnung: markierte Bestellungen ohne Zuordnung",
    detail:
      "Markierte Bestellungen, die keiner Beratung zugeordnet werden können (Markierung unbekannt oder gelöscht, Beratung außerhalb des Zuordnungsfensters), werden seitdem gezählt.",
  },
  {
    date: "2026-10-05",
    key: "attribution-window",
    title: "Bestell-Zuordnung: Fenster ab der letzten Beratung",
    detail:
      "Widget-Markierungen zählen ab der letzten Produktberatung auf dem Gerät statt ab der ersten. Vorher wurden Bestellungen 30 Tage nach der ersten Beratung nicht mehr zugeordnet (Markierung nach 37 Tagen gelöscht). „Direkt“ unverändert.",
  },
  {
    date: "2026-10-05",
    key: "signedin-offer-off",
    title: "Keine E-Mail-Zusammenfassung mehr für angemeldete Kund:innen",
    detail:
      "Mo bietet angemeldeten Kund:innen die Zusammenfassung per E-Mail nicht mehr an (das Widget blendete die Karte ohnehin aus). „Angeboten“ im E-Mail-Capture-Funnel sinkt dadurch, die Quote steigt — kein Verhaltenswechsel der Kund:innen.",
  },
  {
    date: "2026-10-05",
    key: "app-proxy-signin",
    title: "Shop-Anmeldung zählt im Chat (App Proxy)",
    detail:
      "Wer im Shop angemeldet ist, wird im Chat ohne „Anmelden“ erkannt: Name, Verlauf und Einwilligungs-Popup wie nach einer Anmeldung im Chat. Anmeldungen, Einwilligungs-Popups und Kundenkonto-Zahlen steigen dadurch; „Shop-Login-Erkennung“ unter Kundenkonto zeigt den Anteil.",
  },
  {
    date: "2026-10-05",
    key: "optin-measurement",
    title: "Opt-in-Messung nach Quelle und Ergebnis",
    detail:
      "Opt-ins tragen Quelle und Ergebnis (neue DOI / bereits abonniert / gesperrt), DOI-Bestätigungen ihre Quelle. Der E-Mail-Capture-Funnel zählt nur noch das Formular; die Einwilligung nach der Anmeldung zählt Sitzungen statt Klicks.",
  },
  {
    date: "2026-10-06",
    key: "consent-benefits-served",
    title: "Einwilligungs-Popup: Vorteile vom Server, Variante und Platzierung",
    detail:
      "Das Widget zeigt die Vorteilspunkte im Einwilligungs-Popup und in der Karte so, wie der Server sie liefert, und meldet Variante und Platzierung mit. „Nach Variante und Platzierung“ hat erst seitdem Daten; nach einem Annehmen gibt es kein „Weggeklickt“ mehr.",
  },
  {
    date: "2026-10-06",
    key: "page-context-typed",
    title: "Seitenkontext bei getippten Fragen (Widget)",
    detail:
      "Die erste getippte oder gesprochene Frage auf einer Produkt- oder Kollektionsseite trägt seitdem die Seite mit; Produktkarten-Klicks melden „gleiche Seite“. Mo nutzt den Kontext seitdem (CHAT_PAGE_CONTEXT_ENABLED war schon am 05.10. an), noch ohne Kontrollgruppe.",
  },
  {
    date: "2026-10-06",
    key: "attribution-token-renewal",
    title: "Bestell-Zuordnung: Markierung wird nach einer Beratung erneuert",
    detail:
      "Das Widget holt die Bestell-Markierung nach einer Produktberatung neu (eine gelöschte wird ersetzt) und leert sie beim Abmelden, Löschen und Widerruf der Analyse-Einwilligung. „Markierung unbekannt“ unter den markierten Bestellungen ohne Zuordnung sollte dadurch sinken.",
  },
  {
    date: "2026-10-06",
    key: "doi-mail-sent",
    title: "DOI-Quote nur noch auf verschickte DOI-Mails",
    detail:
      "Opt-ins halten fest, ob die DOI-Mail wirklich verschickt wurde. „DOI-Mail fällig“ heißt jetzt „DOI-Mail verschickt“; eine fehlgeschlagene oder übersprungene Sendung zählt nicht mehr im Nenner der DOI-Quote (E-Mail-Capture-Funnel und „Nach Variante und Platzierung“) und steht als „nicht verschickt“ daneben. Ältere Opt-ins zählen wie bisher als verschickt — die DOI-Quote kann ab diesem Tag etwas steigen, ohne dass sich das Verhalten ändert.",
  },
  {
    date: "2026-10-06",
    key: "consent-ask-suppressed",
    title: "Kein Einwilligungs-Popup für gesperrte Adressen",
    detail:
      "Nach der Anmeldung wird eine Adresse auf der Sperrliste (Abmeldung, Bounce, Beschwerde, Löschung) nicht mehr nach der Werbe-Einwilligung gefragt — ein Ja hätte dort ohnehin nichts bewirkt. „Angezeigt“ in „Einwilligung nach der Anmeldung“ kann leicht sinken.",
  },
  {
    date: "2026-10-06",
    key: "attribution-threads-maillinks",
    title: "Bestell-Zuordnung: alle Gespräche im Fenster, Mail-Links ab der letzten Mail",
    detail:
      "„Beraten & gekauft“ prüft die gekauften Produkte gegen alle Gespräche des Geräts im Zuordnungsfenster vor der Bestellung statt nur gegen das jüngste — der Anteil kann steigen, „Beraten, anderes gekauft“ sinken. Mo-Links in E-Mails zählen ab der letzten Mail mit dieser Markierung statt ab der ersten; „Direkt“ kann leicht steigen. Bereits erfasste Bestellungen bleiben unverändert.",
  },
  {
    date: "2026-10-08",
    key: "widget-reward-dormant",
    title: "Widget-Update: Gutschein-Hinweise vorbereitet (ohne sichtbare Änderung)",
    detail:
      "Das Widget kann einen Gutschein-Hinweis im Einwilligungs-Popup, in der Karte und im Anmelde-Popup zeigen und angemeldete Kund:innen nach einer Produktempfehlung fragen („Wertmoment“) — erst, wenn der Server die Texte ausliefert (Schalter aus). Sofort wirksam: Ein zweiter Tab desselben Geräts fragt 24 Stunden nach einem Ja nicht erneut („Angezeigt“ kann leicht sinken); nach einer abgebrochenen Antwort erneuert das Widget die Bestell-Markierung nicht.",
  },
]);

/** First day the opt-in events carry source and outcome (OI1). */
export const OPTIN_MEASUREMENT_FROM = "2026-10-05";

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
  attribution: {
    date: "2026-10-05",
    why: "„Beraten & gekauft“ und „Beraten, anderes gekauft“ zählen erst seitdem ab der letzten Produktberatung auf dem Gerät statt ab der ersten („Direkt“ unverändert)",
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
 * @param {string} section "anmelde-popup" | "consent" | "konto" | "campaign" | "attribution" | "capture"
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
  if ((section === "capture" || section === "consent") && range.from < OPTIN_MEASUREMENT_FROM) {
    notes.push(
      `Ergebnis und Quelle der Opt-ins erst ab dem ${germanDay(OPTIN_MEASUREMENT_FROM)}; ältere Events sind aus dem DOI-Status und dem Auslöser genähert. Zahlen vor und nach diesem Tag sind nicht direkt vergleichbar (Sitzungen statt Klicks, nur das Formular).`
    );
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
