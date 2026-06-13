// Shared, framework-neutral definition of the Marketing tab's status filter.
// Deliberately NOT a "use client" module: the client toolbar (MarketingList) and
// the SERVER page both need it — the page validates a ?status= deep link with
// toStatusFilter() before handing the seed to MarketingList, and a server
// component can't call a function exported from a "use client" module.

// The status buckets the toolbar can filter by.
export const MARKETING_STATUS_FILTERS = [
  "all",
  "no_purchase",
  "draft",
  "sent",
  "purchased",
  "unknown",
] as const;

export type StatusFilter = (typeof MARKETING_STATUS_FILTERS)[number];

/** Coerce an arbitrary (URL) value to a valid StatusFilter, defaulting to "all". */
export function toStatusFilter(value: unknown): StatusFilter {
  return (MARKETING_STATUS_FILTERS as readonly string[]).includes(value as string)
    ? (value as StatusFilter)
    : "all";
}
