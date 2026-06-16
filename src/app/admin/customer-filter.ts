// Pure search / filter / sort helpers for the merged Kunden workspace
// (KundenWorkspace). Kept framework-free and dependency-light so the list logic
// is simple to reason about and reuse — the same role marketing-filter.ts played
// for the old Marketing tab, now covering the unified customer list.

import type { CustomerProps } from "./CustomerProfileCard";

export type TierFilter = "all" | "1" | "2" | "3";
export type MarketingFilter = "all" | "confirmed" | "pending" | "none" | "unsubscribed";
export type KaufFilter = "all" | "purchased" | "no_purchase";
export type SendFilter = "all" | "draft" | "sent" | "none";
export type CustomerSortKey = "recent" | "name" | "first_seen" | "sessions";

export interface CustomerFilterState {
  query: string;
  tier: TierFilter;
  marketing: MarketingFilter;
  kauf: KaufFilter;
  send: SendFilter;
  sort: CustomerSortKey;
}

export const DEFAULT_FILTER: CustomerFilterState = {
  query: "",
  tier: "all",
  marketing: "all",
  kauf: "all",
  send: "all",
  sort: "recent",
};

/** Quick-filter presets the Overview deep-links (?filter=) seed into the list. */
export function presetFilter(preset: string | undefined): CustomerFilterState {
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

export type PurchaseState = "purchased" | "no_purchase" | "unknown";
export type SendState = "sent" | "draft" | "none";

/** Whether the cached purchase history shows a purchase. `null` summary = not yet
 *  loaded ("unknown"), distinct from a loaded-but-empty history ("no_purchase"). */
export function purchaseState(c: CustomerProps): PurchaseState {
  if (c.purchaseSummary == null) return "unknown";
  return c.purchaseSummary.orders.length > 0 ? "purchased" : "no_purchase";
}

/** The customer's latest marketing-send lifecycle state for the list badge/filter. */
export function sendState(c: CustomerProps): SendState {
  if (!c.marketingSend) return "none";
  return c.marketingSend.status === "sent" ? "sent" : "draft";
}

function time(iso: string | null): number {
  if (!iso) return NaN;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? NaN : t;
}

function matches(c: CustomerProps, f: CustomerFilterState): boolean {
  const q = f.query.trim().toLowerCase();
  if (q) {
    const hay = `${c.email} ${c.name ?? ""}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (f.tier !== "all" && String(c.identityTier) !== f.tier) return false;
  if (f.marketing !== "all" && c.marketingStatus !== f.marketing) return false;
  if (f.kauf !== "all" && purchaseState(c) !== f.kauf) return false;
  if (f.send !== "all" && sendState(c) !== f.send) return false;
  return true;
}

/** Apply the active filter + sort to the customer list (newest activity first by
 *  default). Pure — returns a new array, never mutates the input. */
export function filterCustomers(
  customers: CustomerProps[],
  f: CustomerFilterState
): CustomerProps[] {
  const filtered = customers.filter((c) => matches(c, f));
  const sorted = [...filtered];
  sorted.sort((a, b) => {
    switch (f.sort) {
      case "name": {
        const na = (a.name ?? a.email).toLowerCase();
        const nb = (b.name ?? b.email).toLowerCase();
        return na.localeCompare(nb, "de");
      }
      case "sessions":
        return b.sessions.length - a.sessions.length;
      case "first_seen": {
        const ta = time(a.firstSeenAt);
        const tb = time(b.firstSeenAt);
        if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
        if (Number.isNaN(ta)) return 1;
        if (Number.isNaN(tb)) return -1;
        return ta - tb; // oldest first
      }
      case "recent":
      default: {
        const ta = time(a.lastSeenAt);
        const tb = time(b.lastSeenAt);
        if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
        if (Number.isNaN(ta)) return 1;
        if (Number.isNaN(tb)) return -1;
        return tb - ta; // newest first
      }
    }
  });
  return sorted;
}

/** True when any non-default filter/search is active (drives a "Filter zurücksetzen"). */
export function isFilterActive(f: CustomerFilterState): boolean {
  return (
    f.query.trim() !== "" ||
    f.tier !== "all" ||
    f.marketing !== "all" ||
    f.kauf !== "all" ||
    f.send !== "all"
  );
}
