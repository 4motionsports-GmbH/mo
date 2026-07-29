// The two heuristic click-signal shapes matched against widget telemetry event
// names, shared by every aggregation that derives a "product/CTA click" or
// "cart/checkout" signal from kpi_events (kpi-store, admin-conversations,
// analytics-report-store). SQL ILIKE patterns, matched by SHAPE because the
// widget owns the literal event names — a rename like product_card_click →
// product_cta_click must not require a backend change. One definition so the
// KPI tab, the Gespräche inspector and the Komplettanalyse can never drift
// apart on what counts as a click.

/** Product-card / CTA clicks (e.g. product_cta_clicked). */
export const CTA_PATTERNS = Object.freeze(["%product%click%", "%cta%click%"]);

/** Add-to-cart / checkout clicks (e.g. add_to_cart_clicked, checkout_opened). */
export const CART_PATTERNS = Object.freeze(["%cart%", "%checkout%"]);
