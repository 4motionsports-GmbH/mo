// A complete sample Komplettanalyse in the current (v2) schema: the business
// snapshot of business-snapshot.fixtures.mjs, a strategist result as the
// structured output would return it, the comparison with an older report and
// the legacy chapters. Used by the node:test suites (synthesis, PDF) and to
// insert the sample report the Analyse screenshots show
// (docs/screenshots/2026-10-06-analyse/). Numbers match the snapshot fixture.

import { buildBusinessSnapshot } from "./business-snapshot-core.mjs";
import { SAMPLE_SNAPSHOT_RAW } from "./business-snapshot.fixtures.mjs";
import { assembleDecision, buildReportComparison } from "./analytics-report-synthesis-core.mjs";

/** Pass 1 as the model returns it (before normalisation). */
export const SAMPLE_DECISIONS_OUTPUT = {
  headline:
    "Mo hat 15.221 € bezahlten Umsatz zugeordnet (+50 % zur Vorperiode) — der größte ungenutzte Hebel ist die Anmeldung: nur 12 % der Popup-Sitzungen enden angemeldet.",
  summary:
    "Der Mo-zugeordnete Umsatz stieg auf 15.221 € aus 22 bezahlten Bestellungen (Vorperiode 10.120 €, 16 Bestellungen); das entspricht 15,5 % des Shop-Umsatzes im Ledger. Getragen wird das Plus von Widget-Warenkörben nach Beratung (6.101 €) und Set-Angeboten (5.120 €). Die Beratung wirkt: 47,6 % der Chat-Öffnungen führen zu einer Frage (+6,5 Pp.) und die Produktklicks je Gespräch stiegen auf 0,6. Gebremst wird das Wachstum der Einwilligungsbasis: das Anmelde-Popup bringt nur 17 von 140 Sitzungen in den Chat, und die DOI-Quote des Formulars (67 %, n = 12) ist zu klein für Schlüsse. KI-Kosten von 21 € stehen 711 € Mo-Umsatz je Euro gegenüber.",
  decisions: [
    {
      title: "Anmelde-Popup auf den Wertmoment nach der ersten Produktempfehlung legen",
      rationale:
        "Von 140 Popup-Sitzungen klicken 31 auf „Anmelden“, aber nur 17 landen angemeldet im Chat [signin.popupRate 12,1 %]. Wer angemeldet ist, wird nach der Einwilligung gefragt — 40 % sagen ja. Jede zusätzliche Anmeldung ist damit ein Weg in die Kampagnen-Basis.",
      owner: "frontend",
      impact: "hoch",
      confidence: "mittel",
      metric: "signin.popupRate von 12 % auf 18 % in 4 Wochen; consent.newSubscribers ≥ 25 je 30 Tage",
      link: "kpi_anmeldung",
    },
    {
      title: "Set-Angebote für Großgeräte-Beratungen zum Standard machen",
      rationale:
        "Sets brachten 5.120 € aus 4 Bestellungen (Vorperiode 3.269 €) und haben den höchsten Bestellwert aller Wege. Großgeräte-Käufer:innen mit Mo kaufen häufiger wieder (34 % vs. 27 %).",
      owner: "operator",
      impact: "hoch",
      confidence: "mittel",
      metric: "Umsatz des Wegs „Set-Angebot“ ≥ 6.000 € je 30 Tage bei ≥ 5 Bestellungen",
      link: "kampagnen",
    },
    {
      title: "„Herbst-Kraftraum“ an das Segment „Zurückholen“ ausweiten",
      rationale:
        "Die Kampagne erzielt 29 % Klickrate, 3 Chat-Starts und 1.040 € MK-Umsatz aus 24 Mails bei nur einer Abmeldung. 121 Kund:innen stehen im Segment „Zurückholen“, 88 mit hoher Abwanderung.",
      owner: "operator",
      impact: "mittel",
      confidence: "mittel",
      metric: "campaigns.revenue ≥ 2.000 € im nächsten Zeitraum bei Abmeldequote < 3 %",
      link: "kampagnen",
    },
    {
      title: "Offene Wissensfragen binnen 24 Stunden beantworten",
      rationale:
        "23 % der analysierten Gespräche enden mit offenem Bedarf [quality.unmetNeed], 7 Wissensfragen sind offen und der Median bis zur Antwort liegt bei 30,5 Stunden. Fehlende Antworten zu Maßen und Lieferzeit kosten Warenkörbe.",
      owner: "operator",
      impact: "mittel",
      confidence: "hoch",
      metric: "knowledge.hoursToAnswer < 24 Std.; quality.unmetNeed < 18 %",
      link: "wissen",
    },
  ],
  revenue: {
    summary:
      "15.221 € bezahlter Mo-Umsatz aus 22 Bestellungen (Ø 692 €). Direkt — Code oder Mo-Link — sind 9.120 €, nach Beratung gekauft 1.890 €, beraten und anderes gekauft 4.211 €. Gegenüber der Vorperiode wuchs vor allem die Beratung im Widget-Warenkorb (+57 %) und das Set-Angebot (+57 %).",
    drivers: [
      { title: "Widget-Warenkörbe nach Beratung", detail: "8 Bestellungen, 6.101 € (Vorperiode 3.890 €) — die Produktklicks je Gespräch stiegen von 0,52 auf 0,6." },
      { title: "Set-Angebote", detail: "4 Bestellungen, 5.120 € — der höchste Bestellwert aller Wege (Ø 1.280 €)." },
      { title: "Kampagnen-Codes (MK)", detail: "1.340 € aus 4 Bestellungen; „Herbst-Kraftraum“ trägt 1.040 €." },
      { title: "Bremse: nicht zuordenbare Markierungen", detail: "3 markierte Bestellungen ohne Zuordnung (2 mit unbekannter Markierung, 1 außerhalb des Fensters) — Umsatz, den niemand sieht." },
    ],
  },
  bottlenecks: [
    {
      stage: "Anmelde-Popup → im Chat angemeldet",
      finding: "Der Bruch liegt nach dem Klick: 31 klicken „Anmelden“, 22 melden sich bei Shopify an, nur 17 kommen im Chat an — die Rückkehr in den Chat verliert ein Viertel.",
      evidence: "12,1 % von 140 Sitzungen (Vorperiode 7,5 % von 120)",
      impact: "hoch",
      link: "kpi_anmeldung",
    },
    {
      stage: "Widget gesehen → Chat geöffnet",
      finding: "Nur 11,5 % der Sitzungen mit Widget öffnen den Chat; auf Produktseiten wird das Produkt zu 85 % erkannt, aber das Widget lädt dort nicht aktiv ein.",
      evidence: "212 von 1.840 Sitzungen (Vorperiode 180 von 1.610)",
      impact: "mittel",
      link: "kpi_beratung",
    },
    {
      stage: "E-Mail-Angebot → Formular",
      finding: "Zwei Drittel lehnen die Zusammenfassung ab oder ignorieren sie; der Wert der Zusammenfassung ist im Angebot nicht sichtbar.",
      evidence: "34,4 % von 64 Angeboten (Vorperiode 29,3 %)",
      impact: "mittel",
      link: "kpi_capture",
    },
  ],
  changes: {
    summary:
      "Gegenüber dem letzten Bericht wuchsen Gespräche und Mo-Umsatz deutlich; die damals empfohlene Shop-Login-Erkennung ist live und bringt 9 Anmeldungen ohne „Anmelden“. Offener Bedarf ging nur leicht zurück.",
    items: [
      { title: "Mo-Umsatz +50 %", detail: "15.221 € statt 10.120 € bei gleich langem Zeitraum — getragen von Sets und Widget-Warenkörben.", direction: "besser" },
      { title: "Shop-Login-Erkennung wirkt", detail: "9 Sitzungen über den Shop-Login angemeldet (vorher 0), 75 % der Codes eingelöst (n = 12).", direction: "besser" },
      { title: "Popup-Akzeptanz steigt, Basis klein", detail: "40 % statt 31 % akzeptieren das Einwilligungs-Popup — bei 30 Sitzungen noch kein gesicherter Trend.", direction: "unklar" },
      { title: "Offener Bedarf kaum verändert", detail: "23 % statt 27 % der analysierten Gespräche; die Wissenslücken zu Maßen bleiben.", direction: "gleich" },
    ],
  },
  segments: [
    {
      segment: "Zurückholen (121 Kund:innen)",
      insight: "Größtes Segment mit Bestellhistorie und ohne aktuellen Kauf; 88 Kund:innen mit hoher Abwanderung.",
      action: "Mit „Herbst-Kraftraum“ und Zubehör-Sets ansprechen, nur mit Einwilligung.",
      link: "kunden_abwanderung",
    },
    {
      segment: "Großgeräte-Käufer:innen",
      insight: "Mit Mo 34 % Wiederkauf gegenüber 27 % ohne — vergleichbar gewichtet, aber eine Korrelation.",
      action: "Nach dem Kauf Zubehör-Beratung anbieten (Eingang: Zubehör-Fenster).",
      link: "eingang",
    },
    {
      segment: "Englischsprachige Besucher:innen",
      insight: "8 % der Gespräche sind englisch (Vorperiode 6 %), Tendenz steigend.",
      action: "Wissensantworten auch übersetzen lassen.",
      link: "wissen",
    },
  ],
  campaigns: {
    summary:
      "30 Kampagnen-Mails mit 33 % Klickrate und 4 Bestellungen über MK-Codes (1.340 €). „Herbst-Kraftraum“ verkauft, die Einzelansprache bringt pro Mail am meisten Gespräche. Öffnungen werden bewusst nicht gemessen.",
    items: [
      { campaign: "Herbst-Kraftraum", insight: "24 Mails, 29 % Klickrate, 3 Chat-Starts, 1.040 € Umsatz, 1 Abmeldung.", action: "Auf „Zurückholen“ ausweiten, Set-Link oben platzieren." },
      { campaign: "Einzelansprache", insight: "6 Mails, 50 % Klickrate, 1 Bestellung über 300 €.", action: "Für Kaufabsicht-Hinweise im Eingang nutzen." },
    ],
  },
};

/** Pass 2 as the model returns it. */
export const SAMPLE_PLAN_OUTPUT = {
  recommendations: [
    {
      title: "Rückkehr nach der Shopify-Anmeldung reparieren",
      why: "22 Sitzungen melden sich bei Shopify an, 17 kommen im Chat an — 5 Anmeldungen gehen auf dem Rückweg verloren [signin.popupLinked].",
      action: "Anmelde-Diagnose (KPIs) nach „Keine Rückkehr gemeldet“ prüfen und den Rücksprung im Widget testen.",
      expectedImpact: "+4–6 Anmeldungen je 30 Tage, davon ~40 % mit Einwilligung",
      impact: "hoch",
      effort: "klein",
      confidence: "hoch",
      owner: "frontend",
      successMetric: "signin.popupLinked ÷ Shopify-Anmeldungen > 90 % in 2 Wochen",
      link: "kpi_anmeldung",
    },
    {
      title: "Set-Angebot nach jeder Großgeräte-Beratung anbieten",
      why: "Sets haben den höchsten Bestellwert (Ø 1.280 €) und steigerten ihren Umsatz um 57 %.",
      action: "Mos Anweisung ergänzen: nach Laufband, Rack oder Bank ein passendes Set mit Zubehör vorschlagen.",
      expectedImpact: "+2 Set-Bestellungen je 30 Tage (≈ +2.500 €), Annahme: gleiche Abschlussquote",
      impact: "hoch",
      effort: "klein",
      confidence: "mittel",
      owner: "developer",
      successMetric: "Umsatz des Wegs „Set-Angebot“ ≥ 6.000 € je 30 Tage",
      link: "verbesserung",
    },
    {
      title: "„Herbst-Kraftraum“ für das Segment „Zurückholen“ duplizieren",
      why: "29 % Klickrate und 1.040 € aus 24 Mails bei einer Abmeldung.",
      action: "Kampagne kopieren, Zielgruppe „Zurückholen“ mit Einwilligung, Set-Link oben.",
      expectedImpact: "+1.500–2.500 € MK-Umsatz bei ~60 Empfänger:innen",
      impact: "mittel",
      effort: "klein",
      confidence: "mittel",
      owner: "operator",
      successMetric: "campaigns.revenue ≥ 2.000 €, campaigns.unsubscribeRate < 3 %",
      link: "kampagne_neu",
    },
    {
      title: "Wissensqueue täglich abarbeiten",
      why: "Median 30,5 Std. bis zur Antwort, 7 offene Fragen, 23 Gespräche ungeprüft.",
      action: "Täglich 10 Minuten im Wissen-Tab; Lückenscan für die 23 Gespräche starten.",
      expectedImpact: "−3 Pp. offener Bedarf in 4 Wochen",
      impact: "mittel",
      effort: "klein",
      confidence: "hoch",
      owner: "operator",
      successMetric: "knowledge.hoursToAnswer < 24 Std.; quality.unmetNeed < 20 %",
      link: "wissen",
    },
    {
      title: "Wert der E-Mail-Zusammenfassung im Angebot zeigen",
      why: "Nur 34 % der Angebote führen zum Formular [capture.submitRate].",
      action: "Angebotstext mit konkretem Nutzen testen (Maße, Preise, Links zum Nachlesen).",
      expectedImpact: "+5 Pp. Formularquote",
      impact: "mittel",
      effort: "mittel",
      confidence: "niedrig",
      owner: "frontend",
      successMetric: "capture.submitRate ≥ 40 % bei n ≥ 60",
      link: "kpi_capture",
    },
    {
      title: "Kontrollgruppe für den Seitenkontext starten",
      why: "Der Seitenkontext läuft ohne Kontrollgruppe — seine Wirkung ist nicht messbar.",
      action: "CHAT_PAGE_CONTEXT_HOLDOUT_PCT auf 10 % setzen und das Experiment vorregistrieren.",
      expectedImpact: "Klarheit, ob der Kontext Klicks auf andere Produkte erhöht",
      impact: "niedrig",
      effort: "klein",
      confidence: "hoch",
      owner: "developer",
      successMetric: "Experiment erreicht die Zielgröße je Gruppe",
      link: "kpi_seitenkontext",
    },
    {
      title: "Einwilligungstext für die Shop-Login-Erkennung prüfen lassen",
      why: "Ein Viertel der Einwilligungs-Popups kommt inzwischen über den Shop-Login.",
      action: "Dem Anwalt den aktuellen Popup-Text mit dem Weg „Shop-Login erkannt“ vorlegen.",
      expectedImpact: "Rechtssicherheit für den wachsenden Kanal",
      impact: "mittel",
      effort: "klein",
      confidence: "hoch",
      owner: "lawyer",
      successMetric: "Freigabe dokumentiert",
      link: "none",
    },
  ],
  experiments: [
    {
      title: "Anmelde-Popup: sofort vs. nach der ersten Empfehlung",
      hypothesis: "Wenn das Popup erst nach der ersten Produktempfehlung erscheint, melden sich mehr an, weil der Nutzen dann sichtbar ist.",
      design: "50/50 je Sitzung, nur anonyme Besucher:innen; Variante B zeigt das Popup nach der ersten Produktkarte.",
      metric: "signin.popupRate",
      duration: "6 Wochen bzw. 150 Sitzungen je Gruppe",
      successCriterion: "≥ +4 Pp. bei 95-%-Intervall ohne Null",
      owner: "frontend",
    },
    {
      title: "Set-Link oben vs. unten in Kampagnen-Mails",
      hypothesis: "Ein Set-Link über dem Text erhöht die Set-Klicks, ohne die Abmeldungen zu erhöhen.",
      design: "Zwei Varianten der nächsten Kampagne, zufällig je Empfänger:in.",
      metric: "Set-Klicks je Mail; campaigns.unsubscribeRate",
      duration: "Bis je 60 Mails versendet sind",
      successCriterion: "Set-Klicks +50 % bei gleicher Abmeldequote",
      owner: "operator",
    },
  ],
  risks: [
    {
      title: "Einwilligungsbasis wächst zu langsam",
      detail: "19 neue Einwilligungen in 30 Tagen; Kampagnen erreichen damit nur einen kleinen Teil der 642 Kund:innen.",
      severity: "hoch",
      mitigation: "Anmeldung und Formular verbessern (Empfehlungen 1 und 5).",
      owner: "operator",
    },
    {
      title: "Kampagnen-Frequenz",
      detail: "Mehr Kampagnen an dasselbe Segment können Abmeldungen treiben (bisher 1 von 30).",
      severity: "mittel",
      mitigation: "Mindestabstand einhalten, Abmeldequote je Kampagne beobachten.",
      owner: "operator",
    },
  ],
  dataQuality: [
    { title: "Geräte-Wechsel unsichtbar", detail: "Käufe nach einer Beratung auf einem anderen Gerät fehlen im Mo-Umsatz — er ist eine Untergrenze." },
    { title: "Kleine Basis bei Einwilligung und DOI", detail: "30 Popup-Sitzungen und 12 DOI-Mails — Quoten erst ab etwa 30 bzw. 100 Fällen belastbar." },
  ],
};

/** A v1 report (before the decision layer) as the previous report. */
export const SAMPLE_PREVIOUS_REPORT = {
  id: 11,
  title: "Komplettanalyse · 11.07.2026 – 09.08.2026",
  from: "2026-07-11",
  to: "2026-08-09",
  completedAt: "2026-08-10T07:12:00.000Z",
  sections: {
    kpis: {
      conversations: 71,
      analyzed: 66,
      tiers: { anonymous: 48, emailOnly: 13, signedIn: 10 },
      withError: 4,
      emailCaptured: 15,
      cartUsed: 4,
      checkoutOffered: 40,
    },
    spend: { totalEur: 16.8, byCallSite: [] },
    categories: [],
    qualities: [
      { label: "Gut gelöst", count: 35 },
      { label: "Offener Bedarf", count: 18 },
      { label: "Abgesprungen", count: 13 },
    ],
    insightsMd: null,
    personas: [],
    customerKnowledgeMd: null,
    profiles: [],
    appendix: [],
    notes: [],
  },
};

/** The full sample `sections` payload (v2). */
export function sampleReportSections() {
  const snapshot = buildBusinessSnapshot(SAMPLE_SNAPSHOT_RAW);
  const legacy = {
    kpis: { conversations: 96, analyzed: 74, tiers: { anonymous: 61, emailOnly: 18, signedIn: 17 }, withError: 3, emailCaptured: 18, cartUsed: 7, checkoutOffered: 61 },
    spend: { totalEur: 21.4, byCallSite: [{ callSite: "customer_profile", eur: 7.2 }] },
    categories: [
      { label: "Produktberatung", count: 41 },
      { label: "Größe & Maße", count: 14 },
      { label: "Preis/Rabatt", count: 9 },
    ],
    qualities: [
      { label: "Gut gelöst", count: 44 },
      { label: "Offener Bedarf", count: 17 },
      { label: "Abgesprungen", count: 13 },
    ],
    insightsMd:
      "## Top-Themen & Fragen\n\n- Leise Laufbänder für die Wohnung\n- Maße von Racks für niedrige Decken\n\n## Wo Beratungen stocken\n\n- Lieferzeiten für Großgeräte sind unklar.",
    personas: [
      {
        personaLabel: "home_gym_builder",
        personaDisplay: "Home-Gym-Aufbauer",
        chatCount: 38,
        favoriteProducts: [{ productId: "rack-1", name: "Power Rack PR-500", count: 12 }],
        topQuestionsMd: "- Passt das Rack unter 2,30 m?\n- Welche Hantelbank passt dazu?",
      },
    ],
    customerKnowledgeMd: "### Wer kauft\n\nVor allem Home-Gym-Aufbauer mit Platzfragen.",
    profiles: [],
    appendix: [],
    notes: ["Analyse auf 2000 Gespräche begrenzt — 14 nicht analysiert."],
    customerBase: null,
    campaigns: [],
  };
  const comparison = buildReportComparison({ ...legacy, snapshot, from: "2026-08-10", to: "2026-09-08" }, SAMPLE_PREVIOUS_REPORT);
  return {
    ...legacy,
    version: 2,
    snapshot,
    comparison,
    decision: assembleDecision({
      decisions: SAMPLE_DECISIONS_OUTPUT,
      plan: SAMPLE_PLAN_OUTPUT,
      model: "claude-opus-5-5",
      efforts: { decisions: "high", plan: "high" },
      notes: [],
      generatedAt: "2026-09-09T06:04:00.000Z",
    }),
  };
}
