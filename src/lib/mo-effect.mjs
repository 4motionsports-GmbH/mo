// Mo-Effekt (pure, tested) — do customers who talked to Mo buy differently
// from comparable customers who never did? docs/CUSTOMER_PLATFORM_PLAN.md §12.3.
//
// Input: one row per (value tier × group) with sums from customer_overview —
// only customers with at least one order. "Comparable" = the same value-tier
// mix: the no-Mo figures are re-weighted to the Mo group's tier distribution
// (direct standardisation), so a Mo group full of Großgeräte buyers is not
// compared with a base full of small-parts buyers. This is NOT causal: people
// who chat may be more engaged to begin with (selection bias) — the UI says so.

/**
 * @typedef {{ tier: string, mo: boolean, n: number, orders: number, spentCents: number, repeaters: number }} MoEffectRow
 * @typedef {{ n: number, avgOrders: number | null, aovCents: number | null, repurchaseRate: number | null }} GroupFigures
 */

/** @param {number} a @param {number} b */
const div = (a, b) => (b > 0 ? a / b : null);

/** @param {MoEffectRow[]} rows @returns {GroupFigures} */
function figures(rows) {
  const n = rows.reduce((s, r) => s + r.n, 0);
  const orders = rows.reduce((s, r) => s + r.orders, 0);
  const spent = rows.reduce((s, r) => s + r.spentCents, 0);
  const repeaters = rows.reduce((s, r) => s + r.repeaters, 0);
  return { n, avgOrders: div(orders, n), aovCents: div(spent, orders), repurchaseRate: div(repeaters, n) };
}

/**
 * @param {MoEffectRow[]} rows
 * @param {{ minGroupSize?: number }} [opts]
 * @returns {{
 *   mo: GroupFigures,
 *   withoutMo: GroupFigures,
 *   withoutMoMatched: GroupFigures | null,
 *   lift: { avgOrders: number | null, aovCents: number | null, repurchaseRate: number | null } | null,
 *   tiers: Array<{ tier: string, mo: GroupFigures, withoutMo: GroupFigures }>,
 *   enough: boolean,
 * }}
 */
export function computeMoEffect(rows, opts = {}) {
  const minGroupSize = opts.minGroupSize ?? 20;
  const clean = (rows ?? []).filter((r) => r && r.n > 0);
  const moRows = clean.filter((r) => r.mo);
  const otherRows = clean.filter((r) => !r.mo);
  const mo = figures(moRows);
  const withoutMo = figures(otherRows);

  const tierKeys = [...new Set(clean.map((r) => r.tier))].sort();
  const tiers = tierKeys.map((tier) => ({
    tier,
    mo: figures(moRows.filter((r) => r.tier === tier)),
    withoutMo: figures(otherRows.filter((r) => r.tier === tier)),
  }));

  // Standardise the no-Mo group to the Mo group's tier mix. Only tiers present
  // in BOTH groups count; the weights are the Mo group's customers per tier.
  const shared = tiers.filter((t) => t.mo.n > 0 && t.withoutMo.n > 0);
  const weight = shared.reduce((s, t) => s + t.mo.n, 0);
  let withoutMoMatched = null;
  if (weight > 0) {
    const w = (/** @type {(g: GroupFigures) => number | null} */ pick) => {
      let sum = 0;
      let used = 0;
      for (const t of shared) {
        const v = pick(t.withoutMo);
        if (v == null) continue;
        sum += v * t.mo.n;
        used += t.mo.n;
      }
      return used > 0 ? sum / used : null;
    };
    withoutMoMatched = {
      n: shared.reduce((s, t) => s + t.withoutMo.n, 0),
      avgOrders: w((g) => g.avgOrders),
      aovCents: w((g) => g.aovCents),
      repurchaseRate: w((g) => g.repurchaseRate),
    };
  }

  const rel = (a, b) => (a != null && b != null && b > 0 ? a / b - 1 : null);
  const lift = withoutMoMatched
    ? {
        avgOrders: rel(mo.avgOrders, withoutMoMatched.avgOrders),
        aovCents: rel(mo.aovCents, withoutMoMatched.aovCents),
        repurchaseRate: rel(mo.repurchaseRate, withoutMoMatched.repurchaseRate),
      }
    : null;

  return {
    mo,
    withoutMo,
    withoutMoMatched,
    lift,
    tiers,
    enough: mo.n >= minGroupSize && (withoutMoMatched?.n ?? 0) >= minGroupSize,
  };
}

/** Consent source → the group shown in "Abonnenten nach Herkunft". */
export function consentSourceGroup(source) {
  const s = String(source ?? "");
  if (s === "shopify") return "shopify";
  if (s === "mo" || s.startsWith("mo_")) return "mo";
  if (s === "admin") return "admin";
  return "sonstige";
}

export const CONSENT_SOURCE_GROUP_LABELS = {
  shopify: "Shop (Checkout, Konto, Newsletter)",
  mo: "Mo (Chat, Formular, Anmeldung)",
  admin: "Admin",
  sonstige: "Übernahme / unbekannt",
};
