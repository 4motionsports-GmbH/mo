// The KPI groups — the in-page navigation of the KPI screen, ordered by
// decision value: what Mo earned first, then where the journey loses people,
// then the levers (sign-in & consent, campaigns), quality, cost, and finally the
// lifetime aggregates. Sections declare their group; the toolbar renders one
// chip per group (`chip`) and the page one anchored group heading (`label`).
// "gesamt" collects the lifetime/cohort aggregates that ignore the period.

export type KpiGroupKey = "umsatz" | "funnel" | "kunden" | "kampagnen" | "qualitaet" | "kosten" | "gesamt";

export interface KpiGroup {
  key: KpiGroupKey;
  /** Group heading on the page. */
  label: string;
  /** Short label of the toolbar chip. */
  chip: string;
  /** What the group contains — shown in the group heading's InfoTip. */
  description: string;
  /** False for the lifetime aggregates (badge "Gesamtwert" on every section). */
  periodic: boolean;
}

export const KPI_GROUPS: readonly KpiGroup[] = [
  {
    key: "umsatz",
    label: "Umsatz durch Mo",
    chip: "Umsatz",
    description:
      "Was Mo im gewählten Zeitraum eingebracht hat: Umsatz, Bestellungen, Ø Bestellwert und Umsatz je Euro KI-Kosten im Vergleich zum Vorzeitraum, wie der Umsatz entstand (Beratung, Mo-Links, Set-Angebote, Kampagnen-Codes) und jede einzelne zugeordnete Bestellung.",
    periodic: true,
  },
  {
    key: "funnel",
    label: "Beratung & Funnel",
    chip: "Funnel",
    description:
      "Vom Chat zur Bestellung — wo Sitzungen abspringen —, das Volumen der Beratungen mit Sprachen und der Seitenkontext auf Produktseiten, im gewählten Zeitraum.",
    periodic: true,
  },
  {
    key: "kunden",
    label: "Anmeldung & Einwilligung",
    chip: "Anmeldung",
    description:
      "Anmelde-Popup mit Anmelde-Diagnose, Einwilligung nach der Anmeldung, E-Mail-Capture und Kundenkonto & Self-Service im gewählten Zeitraum.",
    periodic: true,
  },
  {
    key: "kampagnen",
    label: "Kampagnen & Eingang",
    chip: "Kampagnen",
    description: "Kampagnen-Funnel mit Kampagnen-Vergleich, Set-Angebote und der Eingang im gewählten Zeitraum.",
    periodic: true,
  },
  {
    key: "qualitaet",
    label: "Qualität & Wissen",
    chip: "Qualität",
    description:
      "Gesprächsqualität (KI-Analyse), Wissens-Queue, Feedback und Bestellstatus im Chat im gewählten Zeitraum.",
    periodic: true,
  },
  {
    key: "kosten",
    label: "Kosten",
    chip: "Kosten",
    description: "Geschätzte KI-Kosten aus den erfassten Token-Verbräuchen im gewählten Zeitraum.",
    periodic: true,
  },
  {
    key: "gesamt",
    label: "Gesamtwerte",
    chip: "Gesamtwerte",
    description:
      "Vom Zeitraum unabhängig: Mo-Effekt, Kundenbasis, Persona-Insights und Postversand sind Lebenszyklus-, Kohorten- bzw. Gesamtaggregate.",
    periodic: false,
  },
];

/** DOM id of a group's anchored heading — its own namespace, so a group never
 * shares an id with a section (`kpi-<section>`, e.g. the section „umsatz“). */
export function kpiGroupAnchor(key: KpiGroupKey): string {
  return `kpi-bereich-${key}`;
}
