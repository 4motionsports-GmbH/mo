// Fixtures of the Verbesserung (v2) for the node tests: a realistic change
// history (directives with their version events, implemented suggestions), a
// window snapshot built from the business-snapshot fixture, and strategist
// outputs as Opus would return them for that snapshot (German, with keys and
// numbers of SAMPLE_SNAPSHOT_RAW).

import { buildBusinessSnapshot, describePeriod, previousPeriod } from "./business-snapshot-core.mjs";
import { SAMPLE_SNAPSHOT_RAW } from "./business-snapshot.fixtures.mjs";

/** "Today" of the fixtures (UTC day). */
export const SAMPLE_TODAY = "2026-09-09";

/** The run snapshot (period 10.08.–08.09.2026 vs the 30 days before). */
export function sampleRunSnapshot() {
  return buildBusinessSnapshot(SAMPLE_SNAPSHOT_RAW);
}

/**
 * A snapshot for a measurement window: the fixture's numbers relabelled to
 * [from, to] and its previous period (the builder is pure — the window only
 * changes the labels, releases and notes).
 */
export function sampleWindowSnapshot(from, to, { releases = [], releaseNotes = {} } = {}) {
  const period = describePeriod({ from, to });
  return buildBusinessSnapshot({ ...SAMPLE_SNAPSHOT_RAW, period, previous: previousPeriod({ from, to }), releases, releaseNotes });
}

export const SAMPLE_DIRECTIVES = [
  {
    id: 1,
    content: "Wenn ein Kunde eine Wohnung oder Nachbarn erwähnt, weise unaufgefordert auf leise Alternativen (Magnetbremse, Laufbandmatte) hin.",
    active: true,
    source: "suggestion",
    suggestionId: 11,
    events: [{ action: "created", at: "2026-08-20T18:05:41.000Z" }],
  },
  {
    id: 2,
    content: "Wenn ein Kunde nach Lieferzeiten für Speditionsware fragt, weise auf die Lieferung frei Bordsteinkante und die Avisierung hin.",
    active: true,
    source: "operator",
    suggestionId: null,
    events: [
      { action: "created", at: "2026-07-25T14:23:05.000Z" },
      { action: "updated", at: "2026-08-25T09:12:00.000Z" },
    ],
  },
  {
    id: 3,
    content: "Erwähne die Sommeraktion auf Rudergeräte.",
    active: false,
    source: "operator",
    suggestionId: null,
    events: [
      { action: "created", at: "2026-06-30T08:34:25.000Z" },
      { action: "deactivated", at: "2026-07-20T11:43:30.000Z" },
    ],
  },
  {
    id: 4,
    content: "Biete nach jeder Großgeräte-Beratung ein passendes Set an.",
    active: true,
    source: "operator",
    suggestionId: null,
    events: [{ action: "created", at: "2026-09-06T10:00:00.000Z" }],
  },
];

export const SAMPLE_CHANGE_SUGGESTIONS = [
  {
    id: 11,
    title: "Bei Wohnungs-Kontext leise Alternativen nennen",
    lane: "mo",
    category: "chat",
    status: "implemented",
    statusChangedAt: "2026-08-20T18:05:41.000Z",
    expectedEffect: "Weniger Abbrüche in Cardio-Beratungen.",
    details: { successMetric: { key: "quality.droppedOff", target: 0.15, direction: "down", horizonDays: 14 } },
  },
  {
    id: 12,
    title: "Wissensqueue täglich abarbeiten",
    lane: "shop",
    category: "operator",
    status: "implemented",
    statusChangedAt: "2026-08-22T07:00:00.000Z",
    expectedEffect: "Schnellere Antworten auf Wissenslücken.",
    details: { successMetric: { key: "knowledge.hoursToAnswer", target: 24, direction: "down", horizonDays: 14 } },
  },
  {
    id: 13,
    title: "Studio-Anfragen innerhalb von 24 h beantworten",
    lane: "shop",
    category: "prozess",
    status: "accepted",
    statusChangedAt: "2026-08-28T07:00:00.000Z",
    expectedEffect: null,
    details: null,
  },
  {
    // v1 row: no details, the effect named by label only.
    id: 14,
    title: "Maße immer mit Klapp- und Aufbaumaß angeben",
    lane: "mo",
    category: "prompt_kern",
    status: "implemented",
    statusChangedAt: "2026-08-26T12:00:00.000Z",
    expectedEffect: "Weniger Rückfragen; Qualität „Abgesprungen“ sinkt.",
    details: null,
  },
];

/** The Wirkungs-Check as the strategist returns it (refs of the fixture changes). */
export const SAMPLE_EFFECT_REVIEW_OUTPUT = {
  summary:
    "Die Anweisung zu leisen Alternativen [D1] passt zu weniger Abbrüchen, die Bewegung liegt aber noch im Bereich des Zufalls (n = 74). Die tägliche Wissensqueue [S12] verkürzt die Antwortzeit deutlich, ohne Test — es ist ein Median. Die Set-Anweisung [D4] ist zu frisch, um sie zu bewerten.",
  items: [
    {
      ref: "D1",
      assessment: "„Abgesprungen“ fiel von 19,7 % auf 17,6 % (n = 74 / 66) — die Richtung stimmt, statistisch ist sie nicht klar.",
      recommendation: "beibehalten",
      nextStep: "Weiter messen; mit dem nächsten Lauf (≥ 30 analysierte Gespräche je Fenster) erneut prüfen.",
    },
    {
      ref: "S12",
      assessment: "Median bis zur Antwort 44 → 30,5 Std. — ohne Fallzahl nur die Richtung, aber deutlich.",
      recommendation: "beibehalten",
      nextStep: "Das Ziel < 24 Std. mit einem festen Termin am Vormittag absichern.",
    },
    { ref: "D4", assessment: "Erst 2 Tage live.", recommendation: "beobachten", nextStep: "Ab dem 13.09. mit dem Weg „Set-Angebot“ messen." },
    { ref: "X9", assessment: "unbekannte Referenz", recommendation: "zuruecknehmen", nextStep: "" },
  ],
};

/** The chat & prompt pass as the strategist returns it. */
export const SAMPLE_CHAT_SUGGESTIONS_OUTPUT = {
  headline: "",
  summary: "",
  suggestions: [
    {
      title: "Nach jeder Großgeräte-Beratung ein Set vorschlagen",
      lane: "chat",
      why: "Set-Angebote sind der stärkste Weg: 5.120 € über den Set-Link (Vorperiode 3.269 €), aber nur 9 Klicks auf Bundle-Angebote bei 61 Gesprächen mit Empfehlung.",
      action: "Anweisung aktivieren; nach 14 Tagen den Weg „Set-Angebot“ und die Warenkorb-Klicks je Gespräch prüfen.",
      directive:
        "Wenn du ein Laufband, ein Rack oder eine Bank empfohlen hast und der Kunde Interesse zeigt, biete im selben Zug ein passendes Set mit Zubehör an (Matte, Hantelscheiben, Ablage) und nenne den Set-Vorteil in einem Satz.",
      evidence: [
        { metricKey: "bundles.revenue", text: "5.120 € über Set-Link (Vorperiode 3.269 €)." },
        { metricKey: "bundles.clicks", text: "9 Klicks auf Bundle-Angebote (Vorperiode 4)." },
        { metricKey: "unknown.key", text: "Ein Beleg mit erfundenem Schlüssel." },
      ],
      expectedImpact: "+2 Set-Bestellungen je 30 Tage (≈ +2.500 €), Annahme: gleiche Abschlussquote wie bisher.",
      successMetric: { key: "bundles.revenue", target: 6500, direction: "up", horizonDays: 28 },
      impact: "hoch",
      effort: "niedrig",
      confidence: "mittel",
      risk: "niedrig",
      riskNote: "Zu frühes Set-Angebot kann aufdringlich wirken.",
      link: "verbesserung",
      refersTo: "D4",
    },
    {
      title: "Kontrollgruppe für den Seitenkontext starten",
      lane: "developer",
      why: "Mo erkennt das Produkt der Seite in 85 % der 34 Fragen auf Produktseiten — ob das Klicks oder Käufe bringt, ist ohne Kontrollgruppe nicht messbar.",
      action: "CHAT_PAGE_CONTEXT_HOLDOUT_PCT auf 10 setzen; nach 4 Wochen Klicks je Gespräch in beiden Gruppen vergleichen.",
      directive: "Diese Anweisung gehört nicht in den Entwicklungs-Bereich.",
      evidence: [{ metricKey: "chat.pageContextResolved", text: "85,3 % erkannt (n = 34)." }],
      expectedImpact: "Klarheit, ob der Seitenkontext die Klicks je Gespräch erhöht.",
      successMetric: { key: "chat.clicksPerChat", target: null, direction: "up", horizonDays: 28 },
      impact: "mittel",
      effort: "niedrig",
      confidence: "hoch",
      risk: "niedrig",
      riskNote: "",
      link: "kpi_seitenkontext",
      refersTo: null,
    },
    {
      title: "Popup-Text mit dem Nutzen der Anmeldung testen",
      lane: "frontend",
      why: "Nur 12,1 % der 140 Popup-Sitzungen enden angemeldet im Chat (Vorperiode 7,5 %, n = 120).",
      action: "Im Widget eine Variante mit „Merkliste und Bestellstatus“ als Nutzen gegen die heutige testen.",
      directive: null,
      evidence: [{ metricKey: "signin.popupRate", text: "12,1 % (n = 140), Vorperiode 7,5 % (n = 120)." }],
      expectedImpact: "+3–5 Pp. Anmeldequote.",
      successMetric: { key: "signin.popupRate", target: 18, direction: "up", horizonDays: 300 },
      impact: "mittel",
      effort: "mittel",
      confidence: "niedrig",
      risk: "mittel",
      riskNote: "Mehr Text im Popup kann die Antwort verdecken.",
      link: "kpi_anmeldung",
      refersTo: null,
    },
    { title: "", lane: "chat", why: "ohne Titel", action: "verworfen" },
  ],
};

/** The business pass as the strategist returns it (with the run's headline). */
export const SAMPLE_BUSINESS_SUGGESTIONS_OUTPUT = {
  headline: "Umsatz durch Mo +50 % auf 15.221 € — Sets und Kampagnen tragen, die Anmeldung bremst.",
  summary:
    "Mo brachte 15.221 € (Vorperiode 10.120 €) bei gleicher Abschlussquote der Beratungen (9,1 %, n = 88). Kampagnen klicken besser (33 %, n = 30) bei sinkender Abmeldequote. Die Antwortzeit im Wissen sank auf 30,5 Std. Größter Hebel: Sets nach Großgeräte-Beratungen; größtes Risiko: die dünne Einwilligungsbasis aus dem Chat.",
  suggestions: [
    {
      title: "„Herbst-Kraftraum“ für das Segment „Zurückholen“ duplizieren",
      lane: "campaign",
      why: "Kampagnen-Klickrate 33,3 % (n = 30, Vorperiode 21,1 %), 1.340 € mit MK-Code bei 3,3 % Abmeldequote.",
      action: "Kampagne kopieren, Zielgruppe „Zurückholen“ mit Einwilligung, Set-Link oben.",
      directive: "nicht erlaubt",
      evidence: [
        { metricKey: "campaigns.clickRate", text: "33,3 % Klickrate (n = 30)." },
        { metricKey: "campaigns.revenue", text: "1.340 € mit MK-Code (Vorperiode 810 €)." },
      ],
      expectedImpact: "+1.500–2.500 € MK-Umsatz bei ~60 Empfänger:innen.",
      successMetric: { key: "campaigns.revenue", target: 2000, direction: "up", horizonDays: 21 },
      impact: "hoch",
      effort: "niedrig",
      confidence: "mittel",
      risk: "mittel",
      riskNote: "Abmeldungen steigen, wenn dieselben Empfänger:innen zu oft angeschrieben werden.",
      link: "kampagne_neu",
      refersTo: null,
    },
    {
      title: "Einwilligungstext für die Shop-Login-Erkennung prüfen lassen",
      lane: "legal",
      why: "Ein Viertel der Einwilligungs-Popups kommt über den Shop-Login; der Text wurde für die Chat-Anmeldung geschrieben.",
      action: "Dem Anwalt den Popup-Text mit dem Weg „Shop-Login erkannt“ vorlegen.",
      directive: null,
      evidence: [{ metricKey: "consent.popupRate", text: "40 % Akzeptanz (n = 30)." }],
      expectedImpact: "Rechtssicherheit für den wachsenden Kanal.",
      successMetric: { key: "consent.newSubscribers", target: null, direction: "up", horizonDays: 30 },
      impact: "mittel",
      effort: "niedrig",
      confidence: "hoch",
      risk: "hoch",
      riskNote: "Ohne Prüfung droht eine unwirksame Einwilligung.",
      link: "none",
      refersTo: null,
    },
  ],
};
