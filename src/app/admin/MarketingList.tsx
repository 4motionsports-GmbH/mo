"use client";

// Client-side toolbar over the marketing contact list. Operates ENTIRELY on the
// array the server already fetched (listMarketingTargets) — no new data
// endpoints, no change to which contacts are listed. It only narrows / reorders
// what is rendered:
//
//   SEARCH  — substring match on email (case-insensitive)
//   FILTER  — by status bucket (chatted-not-purchased / open draft / sent /
//             purchased / unknown). Buckets can overlap (a contact may both be
//             "not purchased" and have an open draft); a card matches whichever
//             bucket is selected.
//   SORT    — by DOI-confirmed date (newest/oldest) or persona (A–Z).

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { CustomerCard, type MarketingTargetProps } from "./CustomerCard";
import { Input, Label, Select } from "./ui";

// The status buckets the toolbar can filter by. Exported (with a runtime guard)
// so the Overview tab's quick links can deep-link straight into a pre-applied
// filter via ?status=… without re-declaring the union.
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

type SortKey = "confirmed_desc" | "confirmed_asc" | "persona";

function matchesStatus(t: MarketingTargetProps, filter: StatusFilter): boolean {
  const send = t.latestSend;
  const isSent = send?.status === "sent";
  const hasDraft = Boolean(send) && !isSent;
  switch (filter) {
    case "all":
      return true;
    case "no_purchase":
      return t.purchase.status === "no_purchase";
    case "draft":
      return hasDraft;
    case "sent":
      return isSent;
    case "purchased":
      return t.purchase.status === "purchased";
    case "unknown":
      return t.purchase.status === "unknown";
  }
}

function confirmedTime(t: MarketingTargetProps): number {
  if (!t.confirmedAt) return Number.NaN;
  const ms = new Date(t.confirmedAt).getTime();
  return Number.isNaN(ms) ? Number.NaN : ms;
}

export function MarketingList({
  targets,
  initialStatus = "all",
}: {
  targets: MarketingTargetProps[];
  /** Seeds the status filter — set by an Overview quick link's ?status= deep link. */
  initialStatus?: StatusFilter;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>(initialStatus);
  const [sort, setSort] = useState<SortKey>("confirmed_desc");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = targets.filter(
      (t) => (q === "" || t.email.toLowerCase().includes(q)) && matchesStatus(t, status)
    );

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sort === "persona") {
        const pa = a.personaDisplay ?? "";
        const pb = b.personaDisplay ?? "";
        // Empty persona sorts last so labelled contacts lead.
        if (pa === "" && pb !== "") return 1;
        if (pb === "" && pa !== "") return -1;
        return pa.localeCompare(pb, "de");
      }
      // confirmed date — NaN (missing/invalid date) sorts last either way.
      const ta = confirmedTime(a);
      const tb = confirmedTime(b);
      const aNan = Number.isNaN(ta);
      const bNan = Number.isNaN(tb);
      if (aNan && bNan) return 0;
      if (aNan) return 1;
      if (bNan) return -1;
      return sort === "confirmed_desc" ? tb - ta : ta - tb;
    });
    return sorted;
  }, [targets, query, status, sort]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <Label htmlFor="ms-search" className="mb-1.5 block text-muted-foreground">
            Suche (E-Mail)
          </Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="ms-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="name@beispiel.de"
              className="pl-9"
            />
          </div>
        </div>

        <div className="w-44">
          <Label htmlFor="ms-status" className="mb-1.5 block text-muted-foreground">
            Status
          </Label>
          <Select
            id="ms-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
          >
            <option value="all">Alle</option>
            <option value="no_purchase">Beraten, nicht gekauft</option>
            <option value="draft">Offener Entwurf</option>
            <option value="sent">Gesendet</option>
            <option value="purchased">Hat gekauft</option>
            <option value="unknown">Kaufstatus unbekannt</option>
          </Select>
        </div>

        <div className="w-44">
          <Label htmlFor="ms-sort" className="mb-1.5 block text-muted-foreground">
            Sortierung
          </Label>
          <Select id="ms-sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="confirmed_desc">Bestätigt — neueste</option>
            <option value="confirmed_asc">Bestätigt — älteste</option>
            <option value="persona">Persona (A–Z)</option>
          </Select>
        </div>
      </div>

      <p className="mb-4 text-sm text-muted-foreground">
        {visible.length === targets.length
          ? `${targets.length} Kontakt(e)`
          : `${visible.length} von ${targets.length} Kontakt(en)`}
      </p>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-border bg-card px-3.5 py-3 text-sm text-muted-foreground">
          Keine Kontakte für diese Suche/Filter.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {visible.map((t) => (
            <CustomerCard key={t.captureId} target={t} />
          ))}
        </div>
      )}
    </div>
  );
}
