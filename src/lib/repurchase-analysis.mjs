// Repurchase-behaviour analysis (pure, no I/O — plain .mjs so it is
// unit-testable with node:test, per the locale.mjs convention).
//
// WHY THIS EXISTS
//
// The planned lifecycle segmentation for campaign emails ("Ausbauen" /
// "Weiterentwickeln" / "Zurückholen" / "Ruhen lassen") keys off how long ago a
// customer last bought, with the cut points SCALED BY PURCHASE VALUE: in a
// durables catalogue the value of a purchase is a proxy for where the customer
// stands in building their setup, and the two halves move in opposite
// directions — a €5.000 machine has a short, urgent accessory window and then
// a very long silence, while a €40 accessory buyer is actively shopping.
//
// Those cut points must come from measured behaviour, not intuition. This
// module holds the pure statistics over an order history; scripts/analyze-
// repurchase.mjs feeds it real Shopify orders and prints the report. The
// tiering helpers here are deliberately the ones the FEATURE will import later,
// so the analysis and the production segmentation can never disagree on what
// "Großgerät" means.
//
// PRIVACY: everything here works on already-anonymised shapes — a customer is
// an opaque key, an order is a date plus line items. No email, no name, no
// address ever enters this module, and the analysis script never writes
// per-customer rows to disk.

/**
 * @typedef {{ handle: string|null, quantity: number, unitPriceEur: number|null }} AnalysisLineItem
 * @typedef {{ id: string, createdAt: string, lineItems: AnalysisLineItem[] }} AnalysisOrder
 * @typedef {{ key: string, orders: AnalysisOrder[] }} AnalysisCustomer
 */

/**
 * The purchase-value tiers, derived from the catalogue's price distribution
 * (p25 ≈ €54, median ≈ €249, p75 ≈ €1.099): roughly 42 % / 38 % / 20 % of
 * products. Ordered ascending; the last tier is open-ended.
 */
export const VALUE_TIERS = [
  { key: "klein", label: "Kleinteile", maxEur: 150 },
  { key: "komponente", label: "Komponenten", maxEur: 1500 },
  { key: "grossgeraet", label: "Großgeräte", maxEur: Infinity },
];

/** Tier keys in ascending order — the stable iteration order for reports. */
export const VALUE_TIER_KEYS = VALUE_TIERS.map((t) => t.key);

/**
 * The tier an anchor value falls into. Null/negative/NaN → null (unknown), so
 * an order we could not price is EXCLUDED from the statistics rather than
 * silently counted as cheap.
 *
 * @param {number|null|undefined} eur
 * @returns {string|null}
 */
export function valueTierKey(eur) {
  if (typeof eur !== "number" || !Number.isFinite(eur) || eur < 0) return null;
  for (const tier of VALUE_TIERS) {
    if (eur < tier.maxEur) return tier.key;
  }
  return VALUE_TIERS[VALUE_TIERS.length - 1].key;
}

/**
 * The ANCHOR VALUE of an order: the highest single unit price in it.
 *
 * Deliberately not the order total. Ten €50 plates and one €500 bench both
 * total €500 but are completely different customers; the largest single item
 * someone was willing to buy is the better read on commitment level. Returns
 * null when no line item carries a usable price.
 *
 * @param {AnalysisOrder} order
 * @returns {number|null}
 */
export function anchorValueEur(order) {
  let max = null;
  for (const li of order?.lineItems ?? []) {
    const p = li?.unitPriceEur;
    if (typeof p === "number" && Number.isFinite(p) && p >= 0) {
      if (max === null || p > max) max = p;
    }
  }
  return max;
}

/**
 * Linear-interpolated percentile of an ASCENDING-sorted numeric array.
 * Empty → null. p is a fraction (0.5 = median), clamped to [0,1].
 *
 * @param {number[]} sortedAsc
 * @param {number} p
 * @returns {number|null}
 */
export function percentile(sortedAsc, p) {
  if (!Array.isArray(sortedAsc) || sortedAsc.length === 0) return null;
  const q = Math.min(1, Math.max(0, p));
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = q * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

/** Whole days between two ISO instants (b - a), or null if either is unusable. */
export function daysBetween(aIso, bIso) {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return (b - a) / 86_400_000;
}

/** Orders sorted oldest-first, dropping any without a usable date. */
export function sortedOrders(orders) {
  return (orders ?? [])
    .filter((o) => o && !Number.isNaN(new Date(o.createdAt).getTime()))
    .slice()
    .sort((x, y) => new Date(x.createdAt) - new Date(y.createdAt));
}

/**
 * How far apart two orders must be to count as SEPARATE buying decisions.
 *
 * One checkout routinely lands as several Shopify order records (split
 * checkouts, edited or re-placed orders, a customer who checks out again
 * minutes later because they forgot something). Counting those as repurchases
 * is what produced a median "repurchase interval" of 0.0 days on the real
 * store — more than half of all measured gaps were under an hour.
 *
 * Seven days is the default because the question this analysis serves is
 * "when would a lifecycle e-mail have mattered": nothing bought within a week
 * of the previous order was influenced by a mail we might have sent, so it
 * belongs to the same purchase occasion.
 */
export const DEFAULT_OCCASION_GAP_DAYS = 7;

/**
 * Collapse a customer's orders into PURCHASE OCCASIONS: consecutive orders
 * closer together than `gapDays` merge into one, keeping the earliest date and
 * the union of the line items (so the occasion's anchor value is the largest
 * single item anyone bought across the whole episode).
 *
 * The gap is measured from the occasion's START, not from the previous order,
 * which bounds an occasion at `gapDays`. Chaining off the previous order
 * instead would collapse a customer who orders every five days for a year into
 * a single occasion and hide every repurchase they made.
 *
 * Every downstream statistic runs on occasions, not raw orders — otherwise a
 * split checkout inflates the repeat rate and floors the interval.
 *
 * @param {AnalysisOrder[]} orders
 * @param {number} [gapDays]
 * @returns {AnalysisOrder[]}
 */
export function mergePurchaseOccasions(orders, gapDays = DEFAULT_OCCASION_GAP_DAYS) {
  const sorted = sortedOrders(orders);
  /** @type {AnalysisOrder[]} */
  const occasions = [];
  for (const order of sorted) {
    const last = occasions[occasions.length - 1];
    const gap = last ? daysBetween(last.createdAt, order.createdAt) : null;
    if (last && gap !== null && gap < gapDays) {
      last.lineItems = [...last.lineItems, ...(order.lineItems ?? [])];
      continue;
    }
    occasions.push({
      id: order.id,
      createdAt: order.createdAt,
      lineItems: [...(order.lineItems ?? [])],
    });
  }
  return occasions;
}

/**
 * Apply mergePurchaseOccasions to every customer. The analysis entry points
 * take the RESULT of this — they do not merge internally, so the caller can
 * report how much collapsing happened.
 *
 * @param {AnalysisCustomer[]} customers
 * @param {number} [gapDays]
 * @returns {AnalysisCustomer[]}
 */
export function toPurchaseOccasions(customers, gapDays = DEFAULT_OCCASION_GAP_DAYS) {
  return (customers ?? []).map((c) => ({
    key: c.key,
    orders: mergePurchaseOccasions(c?.orders, gapDays),
  }));
}

/**
 * Every consecutive purchase gap, tagged with the tier of the order it
 * STARTED from — that is exactly the question the segmentation asks: "given
 * they just bought something in this tier, how long until they come back?"
 *
 * @param {AnalysisCustomer[]} customers
 * @returns {Array<{ tierKey: string, days: number, anchorEur: number }>}
 */
export function buildRepurchaseIntervals(customers) {
  const out = [];
  for (const customer of customers ?? []) {
    const orders = sortedOrders(customer?.orders);
    for (let i = 0; i < orders.length - 1; i++) {
      const anchor = anchorValueEur(orders[i]);
      const tierKey = valueTierKey(anchor);
      const days = daysBetween(orders[i].createdAt, orders[i + 1].createdAt);
      // Unknown tier or a non-advancing timestamp (same-instant split orders)
      // is excluded rather than guessed.
      if (tierKey === null || days === null || days < 0) continue;
      out.push({ tierKey, days, anchorEur: /** @type {number} */ (anchor) });
    }
  }
  return out;
}

/**
 * Interval statistics per value tier, plus an "alle" row over everything.
 * Percentiles are in DAYS; `months` mirrors the median in 30.44-day months
 * because the segmentation is specified in months.
 *
 * @param {ReturnType<typeof buildRepurchaseIntervals>} intervals
 */
export function summarizeIntervals(intervals) {
  const groups = new Map(VALUE_TIER_KEYS.map((k) => [k, []]));
  const all = [];
  for (const it of intervals ?? []) {
    if (groups.has(it.tierKey)) groups.get(it.tierKey).push(it.days);
    all.push(it.days);
  }
  const row = (key, label, values) => {
    const sorted = values.slice().sort((a, b) => a - b);
    const median = percentile(sorted, 0.5);
    return {
      key,
      label,
      n: sorted.length,
      p25: percentile(sorted, 0.25),
      median,
      p75: percentile(sorted, 0.75),
      p90: percentile(sorted, 0.9),
      medianMonths: median === null ? null : median / 30.44,
    };
  };
  return [
    ...VALUE_TIERS.map((t) => row(t.key, t.label, groups.get(t.key) ?? [])),
    row("alle", "Alle", all),
  ];
}

/**
 * Repeat rate per tier: of the customers whose FIRST order sits in a tier, how
 * many ever ordered again. This is the ceiling on the whole segmentation — if
 * almost nobody returns, better email timing cannot fix that.
 *
 * @param {AnalysisCustomer[]} customers
 */
export function repeatRateByTier(customers) {
  const counts = new Map(VALUE_TIER_KEYS.map((k) => [k, { customers: 0, repeaters: 0 }]));
  let total = 0;
  let totalRepeaters = 0;
  for (const customer of customers ?? []) {
    const orders = sortedOrders(customer?.orders);
    if (orders.length === 0) continue;
    const tierKey = valueTierKey(anchorValueEur(orders[0]));
    if (tierKey === null) continue;
    const bucket = counts.get(tierKey);
    if (!bucket) continue;
    bucket.customers += 1;
    total += 1;
    if (orders.length > 1) {
      bucket.repeaters += 1;
      totalRepeaters += 1;
    }
  }
  const rows = VALUE_TIERS.map((t) => {
    const c = counts.get(t.key) ?? { customers: 0, repeaters: 0 };
    return {
      key: t.key,
      label: t.label,
      customers: c.customers,
      repeaters: c.repeaters,
      rate: c.customers > 0 ? c.repeaters / c.customers : null,
    };
  });
  rows.push({
    key: "alle",
    label: "Alle",
    customers: total,
    repeaters: totalRepeaters,
    rate: total > 0 ? totalRepeaters / total : null,
  });
  return rows;
}

/**
 * THE HYPOTHESIS TEST for the "Ausbauen" segment: when a customer comes back,
 * how often does the next order contain a merchant-curated ACCESSORY
 * (Product.compatibleWith, "Ergänzende Produkte") of something they already
 * owned?
 *
 * A high rate here is direct evidence that recommending accessories beats the
 * current recommender, which scores pure embedding SIMILARITY against owned
 * products and therefore surfaces substitutes ("another rack") rather than
 * complements ("the hooks for your rack").
 *
 * `minDays`/`maxDays` restrict to return orders that arrived inside that
 * window, so the same measurement answers the TIMING question too: if the
 * accessory rate is much higher in the first 90 days than later, the short
 * "Ausbauen" window is real. The window filters the TRANSITION only — the
 * "already owned" set still accumulates over every earlier order, so a
 * customer's history is never truncated by the slice being measured.
 *
 * The baseline models "what if the return order had been a random draw from
 * the catalogue": for an accessory set of size `a` in a catalogue of `N`
 * products and a return order of `k` distinct items,
 *     P(hit) = 1 − (1 − a/N)^k
 * Averaged over transitions, that gives an expected rate; observed / expected
 * is a rough LIFT. It is a coarse baseline (real buying is not uniform), so
 * treat the lift as an order of magnitude, not a precise effect size.
 *
 * @param {AnalysisCustomer[]} customers
 * @param {Map<string, string[]>} accessoryMap handle → compatibleWith handles
 * @param {{ catalogSize: number, minDays?: number, maxDays?: number }} opts
 */
export function accessoryFollowUpRate(customers, accessoryMap, opts) {
  const catalogSize = Math.max(1, Number(opts?.catalogSize) || 1);
  const minDays = Number.isFinite(opts?.minDays) ? opts.minDays : 0;
  const maxDays = opts?.maxDays ?? Infinity;
  const perTier = new Map(
    VALUE_TIER_KEYS.map((k) => [k, { transitions: 0, hits: 0, expected: 0 }])
  );
  let transitions = 0;
  let hits = 0;
  let expectedSum = 0;

  for (const customer of customers ?? []) {
    const orders = sortedOrders(customer?.orders);
    /** Everything owned BEFORE the return order under test. */
    const owned = new Set();
    for (let i = 0; i < orders.length - 1; i++) {
      for (const li of orders[i].lineItems ?? []) {
        if (li?.handle) owned.add(li.handle);
      }
      const next = orders[i + 1];
      const days = daysBetween(orders[i].createdAt, next.createdAt);
      if (days === null || days < 0) continue;
      if (days < minDays || days >= maxDays) continue;

      const tierKey = valueTierKey(anchorValueEur(orders[i]));
      if (tierKey === null || !perTier.has(tierKey)) continue;

      // The accessory set of everything owned so far, minus what they already
      // have (buying a second identical item is not an accessory follow-up).
      const accessories = new Set();
      for (const handle of owned) {
        for (const acc of accessoryMap?.get(handle) ?? []) {
          if (!owned.has(acc)) accessories.add(acc);
        }
      }

      const nextHandles = new Set(
        (next.lineItems ?? []).map((li) => li?.handle).filter(Boolean)
      );
      if (nextHandles.size === 0) continue;

      const hit = [...nextHandles].some((h) => accessories.has(h));
      const p = Math.min(1, accessories.size / catalogSize);
      const expected = 1 - Math.pow(1 - p, nextHandles.size);

      const bucket = perTier.get(tierKey);
      bucket.transitions += 1;
      bucket.expected += expected;
      if (hit) bucket.hits += 1;

      transitions += 1;
      expectedSum += expected;
      if (hit) hits += 1;
    }
  }

  const row = (key, label, b) => ({
    key,
    label,
    transitions: b.transitions,
    hits: b.hits,
    rate: b.transitions > 0 ? b.hits / b.transitions : null,
    expectedRate: b.transitions > 0 ? b.expected / b.transitions : null,
    lift:
      b.transitions > 0 && b.expected > 0 ? b.hits / b.expected : null,
  });

  return [
    ...VALUE_TIERS.map((t) => row(t.key, t.label, perTier.get(t.key))),
    row("alle", "Alle", { transitions, hits, expected: expectedSum }),
  ];
}

/**
 * Accessory follow-up rate sliced by how long the customer took to return.
 * This is what turns the matrix's month boundaries from a guess into a
 * measurement: if the rate collapses after ~90 days, the short urgent
 * "Ausbauen" window is confirmed.
 *
 * Each slice is a fresh full pass with a different transition window — never a
 * reconstructed customer list, so every slice sees the complete purchase
 * history behind each transition.
 *
 * @param {AnalysisCustomer[]} customers
 * @param {Map<string, string[]>} accessoryMap
 * @param {{ catalogSize: number, buckets?: number[] }} opts
 */
export function accessoryRateByWindow(customers, accessoryMap, opts) {
  const buckets = opts?.buckets ?? [30, 90, 180, 365, 730, Infinity];
  const rows = [];
  let prev = 0;
  for (const upper of buckets) {
    const all = accessoryFollowUpRate(customers, accessoryMap, {
      catalogSize: opts.catalogSize,
      minDays: prev,
      maxDays: upper,
    });
    const overall = all[all.length - 1];
    rows.push({
      fromDays: prev,
      toDays: upper,
      transitions: overall.transitions,
      rate: overall.rate,
      lift: overall.lift,
      // Per-tier rows too: the accessory window is expected to close at a
      // different point for a €40 accessory than for a €5.000 machine, and
      // only this breakdown can set those boundaries separately.
      byTier: all.slice(0, -1),
    });
    prev = upper;
  }
  return rows;
}
