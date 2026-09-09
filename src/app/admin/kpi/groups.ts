// The five KPI groups — the in-page navigation of the KPI screen. Sections
// declare their group; the toolbar renders one chip per group and the page one
// anchored group heading. "gesamt" collects the lifetime/cohort aggregates that
// ignore the selected period.

export type KpiGroupKey = "beratung" | "marketing" | "umsatz" | "kosten" | "gesamt";

export interface KpiGroup {
  key: KpiGroupKey;
  label: string;
  /** What the group contains — shown in the group heading's InfoTip. */
  description: string;
  /** False for the lifetime aggregates (badge "Gesamtwert" on every section). */
  periodic: boolean;
}

export const KPI_GROUPS: readonly KpiGroup[] = [
  {
    key: "beratung",
    label: "Beratung",
    description:
      "Kern-Metriken der Beratungen, Sprachen, Gesprächsqualität, Wissens-Queue, Feedback und Kundenkonto — alle im gewählten Zeitraum.",
    periodic: true,
  },
  {
    key: "marketing",
    label: "Marketing & Kampagne",
    description:
      "Consent-Gate, E-Mail-Capture, Kampagnen-Funnel (Shopify-Subscriber) und Set-Angebote im gewählten Zeitraum.",
    periodic: true,
  },
  {
    key: "umsatz",
    label: "Umsatz",
    description:
      "Umsatz über Mo-Rabattcodes (Shopify read_orders) und der per Bestell-Webhook zugeordnete Umsatz im gewählten Zeitraum.",
    periodic: true,
  },
  {
    key: "kosten",
    label: "Kosten",
    description: "Geschätzte KI-Kosten aus den erfassten Token-Verbräuchen im gewählten Zeitraum.",
    periodic: true,
  },
  {
    key: "gesamt",
    label: "Gesamtwerte",
    description:
      "Vom Zeitraum unabhängig: Postversand, Marketing-Funnel, Persona-Insights und Empfehlung → Kauf sind Lebenszyklus-, Kohorten- bzw. Gesamtaggregate.",
    periodic: false,
  },
];

/** DOM id of a group's anchored heading. */
export function kpiGroupAnchor(key: KpiGroupKey): string {
  return `kpi-${key}`;
}
