// Pure search / filter / sort logic for the Kunden list (no I/O, unit-tested).
// Works on the SLIM list rows the server sends (customer-store
// listCustomerListRows) — never on full customer details.

/**
 * @typedef {"all" | "1" | "2" | "3"} TierFilter
 * @typedef {"all" | "confirmed" | "pending" | "none" | "unsubscribed"} MarketingFilter
 * @typedef {"all" | "purchased" | "no_purchase"} KaufFilter
 * @typedef {"all" | "draft" | "sent" | "none"} SendFilter
 * @typedef {"recent" | "name" | "first_seen" | "sessions"} CustomerSortKey
 * @typedef {{
 *   query: string,
 *   tier: TierFilter,
 *   marketing: MarketingFilter,
 *   kauf: KaufFilter,
 *   send: SendFilter,
 *   sort: CustomerSortKey,
 * }} CustomerFilterState
 * @typedef {{
 *   id: number,
 *   email: string,
 *   name: string | null,
 *   identityTier: 1 | 2 | 3,
 *   firstSeenAt: string | null,
 *   lastSeenAt: string | null,
 *   marketingStatus: "none" | "pending" | "confirmed" | "unsubscribed",
 *   purchaseState: "purchased" | "no_purchase" | "unknown",
 *   sendStatus: "draft" | "approved" | "sent" | null,
 *   sessionCount: number,
 * }} CustomerListRowLike
 */

/** @type {CustomerFilterState} */
export const DEFAULT_FILTER = Object.freeze({
  query: "",
  tier: "all",
  marketing: "all",
  kauf: "all",
  send: "all",
  sort: "recent",
});

/**
 * Quick-filter presets the Übersicht deep-links (?filter=) seed into the list.
 * @param {string | undefined | null} preset
 * @returns {CustomerFilterState}
 */
export function presetFilter(preset) {
  switch (preset) {
    case "no_purchase":
      // "beraten, nicht gekauft" — the key marketing audience.
      return { ...DEFAULT_FILTER, marketing: "confirmed", kauf: "no_purchase" };
    case "marketing":
      return { ...DEFAULT_FILTER, marketing: "confirmed" };
    case "draft":
      return { ...DEFAULT_FILTER, send: "draft" };
    default:
      return { ...DEFAULT_FILTER };
  }
}

/**
 * The customer's latest marketing-send lifecycle state for the list badge/filter.
 * @param {CustomerListRowLike} c
 * @returns {"sent" | "draft" | "none"}
 */
export function sendState(c) {
  if (!c.sendStatus) return "none";
  return c.sendStatus === "sent" ? "sent" : "draft";
}

/**
 * @param {string | null | undefined} iso
 * @returns {number} epoch ms or NaN
 */
function time(iso) {
  if (!iso) return Number.NaN;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? Number.NaN : t;
}

/**
 * @param {CustomerListRowLike} c
 * @param {CustomerFilterState} f
 */
function matches(c, f) {
  const q = f.query.trim().toLowerCase();
  if (q) {
    const hay = `${c.email} ${c.name ?? ""}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (f.tier !== "all" && String(c.identityTier) !== f.tier) return false;
  if (f.marketing !== "all" && c.marketingStatus !== f.marketing) return false;
  if (f.kauf !== "all" && c.purchaseState !== f.kauf) return false;
  if (f.send !== "all" && sendState(c) !== f.send) return false;
  return true;
}

/**
 * Compare two timestamps; missing values sort last in both directions.
 * @param {string | null} a
 * @param {string | null} b
 * @param {"asc" | "desc"} dir
 */
function compareTime(a, b, dir) {
  const ta = time(a);
  const tb = time(b);
  if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
  if (Number.isNaN(ta)) return 1;
  if (Number.isNaN(tb)) return -1;
  return dir === "asc" ? ta - tb : tb - ta;
}

/**
 * Apply the active filter + sort (newest activity first by default). Pure —
 * returns a new array, never mutates the input.
 * @template {CustomerListRowLike} T
 * @param {T[]} customers
 * @param {CustomerFilterState} f
 * @returns {T[]}
 */
export function filterCustomers(customers, f) {
  const sorted = customers.filter((c) => matches(c, f));
  sorted.sort((a, b) => {
    switch (f.sort) {
      case "name": {
        const na = (a.name ?? a.email).toLowerCase();
        const nb = (b.name ?? b.email).toLowerCase();
        return na.localeCompare(nb, "de");
      }
      case "sessions":
        return b.sessionCount - a.sessionCount || compareTime(a.lastSeenAt, b.lastSeenAt, "desc");
      case "first_seen":
        return compareTime(a.firstSeenAt, b.firstSeenAt, "asc"); // oldest first
      case "recent":
      default:
        return compareTime(a.lastSeenAt, b.lastSeenAt, "desc"); // newest first
    }
  });
  return sorted;
}

/**
 * Number of non-default filters (search counts as one) — drives the reset
 * affordance in the FilterBar.
 * @param {CustomerFilterState} f
 * @returns {number}
 */
export function activeFilterCount(f) {
  let n = 0;
  if (f.query.trim() !== "") n++;
  if (f.tier !== "all") n++;
  if (f.marketing !== "all") n++;
  if (f.kauf !== "all") n++;
  if (f.send !== "all") n++;
  return n;
}

/**
 * True when any non-default filter/search is active.
 * @param {CustomerFilterState} f
 */
export function isFilterActive(f) {
  return activeFilterCount(f) > 0;
}
