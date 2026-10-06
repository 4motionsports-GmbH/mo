// „Vom Chat zur Bestellung“ — the journey funnel of the KPI tab
// (docs/ADMIN_DASHBOARD.md §5.4). Pure shaping of the per-stage session counts
// that lib/kpi-journey-store aggregates; plain .mjs for node:test.
//
// The stages are NESTED by definition (each a subset of the one before), so
// every rate is a real conversion and every drop a real loss:
//   1. Beratung           sessions with a chat (≥ 1 visitor message) started in the period
//   2. Produkt gezeigt    … whose chats discussed or selected ≥ 1 product
//   3. Produkt angeklickt … with a product click or an add-to-cart click (widget)
//   4. Warenkorb / Kasse  … with an add-to-cart / checkout click
//   5. Bestellt           … with a Mo-attributed, paid order of the session
// Orders that happened without a cart click in the chat (search bar, mail link)
// are not lost: `orderedAny` counts every chat session with an order.

/** @type {ReadonlyArray<{ key: "chats"|"shown"|"clicked"|"cart"|"ordered", label: string, detail: string }>} */
export const JOURNEY_STAGES = Object.freeze([
  {
    key: "chats",
    label: "Beratung",
    detail: "Sitzungen mit einem im Zeitraum begonnenen Chat, in dem die Person mindestens eine Nachricht geschrieben hat.",
  },
  {
    key: "shown",
    label: "Produkt gezeigt",
    detail: "… in deren Chats Mo mindestens ein Produkt gezeigt, verglichen oder in den Warenkorb vorgeschlagen hat.",
  },
  {
    key: "clicked",
    label: "Produkt angeklickt",
    detail: "… mit einem Klick auf ein Produkt (Produktkarte, Vergleich) oder auf „In den Warenkorb“ im Chat.",
  },
  {
    key: "cart",
    label: "Warenkorb / Kasse",
    detail: "… mit einem Klick auf „In den Warenkorb“ oder „Zur Kasse“ im Chat.",
  },
  {
    key: "ordered",
    label: "Bestellt",
    detail: "… mit einer Mo-zugeordneten, bezahlten Bestellung der Sitzung nach dem ersten Chat, bis zum Ende des Zeitraums.",
  },
]);

/** @param {unknown} v */
function count(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * @param {{ chats?: number, shown?: number, clicked?: number, cart?: number, ordered?: number,
 *           orderedAny?: number, orderedOrders?: number, revenue?: number }} raw
 */
export function journeyFunnel(raw) {
  const r = raw ?? {};
  // Clamp each stage to the one before — the store's query nests them already;
  // this only guards against a drifting definition ever showing a rate > 100 %.
  /** @type {number[]} */
  const values = [];
  for (const s of JOURNEY_STAGES) {
    const v = count(/** @type {any} */ (r)[s.key]);
    values.push(values.length === 0 ? v : Math.min(v, values[values.length - 1]));
  }
  const start = values[0];
  const stages = JOURNEY_STAGES.map((s, i) => {
    const prev = i === 0 ? null : values[i - 1];
    return {
      key: s.key,
      label: s.label,
      detail: s.detail,
      value: values[i],
      ofStart: start > 0 ? values[i] / start : null,
      ofPrevious: prev == null ? null : prev > 0 ? values[i] / prev : null,
      lost: prev == null ? 0 : prev - values[i],
    };
  });
  // The step with the largest relative loss (ties: the earlier step), only
  // among steps that had someone to lose.
  /** @type {{ from: string, to: string, lost: number, rate: number } | null} */
  let biggestDrop = null;
  for (let i = 1; i < stages.length; i++) {
    const prev = values[i - 1];
    if (prev <= 0) continue;
    const rate = (prev - values[i]) / prev;
    if (rate > 0 && (!biggestDrop || rate > biggestDrop.rate)) {
      biggestDrop = { from: stages[i - 1].label, to: stages[i].label, lost: prev - values[i], rate };
    }
  }
  const orderedAny = Math.min(count(r.orderedAny), start);
  const revenue = typeof r.revenue === "number" && Number.isFinite(r.revenue) && r.revenue > 0 ? Math.round(r.revenue * 100) / 100 : 0;
  return {
    stages,
    biggestDrop,
    orderedAny,
    orderedWithoutCart: Math.max(0, orderedAny - values[values.length - 1]),
    orderedOrders: count(r.orderedOrders),
    chatToOrderRate: start > 0 ? orderedAny / start : null,
    revenue,
    revenuePerChat: start > 0 ? Math.round((revenue / start) * 100) / 100 : null,
  };
}
