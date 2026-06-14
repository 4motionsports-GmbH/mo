"use client";

// Client-side toolbar over the customer-feedback list. Operates ENTIRELY on the
// array the server already fetched (listFeedback) — no new data endpoints, no
// change to which rows are listed. It only narrows / reorders what is rendered:
//
//   SEARCH  — substring match on the comment, email and page (case-insensitive)
//   FILTER  — by tier bucket (the distinct tiers present in the data, + "all")
//   SORT    — newest- / oldest-first by created_at
//
// Read-only by design: feedback is presentation here, nothing is mutated.

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Badge, Input, Label, Select } from "./ui";

export interface FeedbackItem {
  id: number;
  message: string;
  sessionId: string | null;
  conversationId: string | null;
  tier: string | null;
  email: string | null;
  page: string | null;
  createdAt: string;
}

type SortKey = "created_desc" | "created_asc";

const TIER_ALL = "__all__";

function createdTime(f: FeedbackItem): number {
  const ms = new Date(f.createdAt).getTime();
  return Number.isNaN(ms) ? Number.NaN : ms;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function FeedbackList({ feedback }: { feedback: FeedbackItem[] }) {
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState<string>(TIER_ALL);
  const [sort, setSort] = useState<SortKey>("created_desc");

  // The distinct tiers present, for the filter dropdown (data-driven, so the
  // control only ever offers buckets that actually exist).
  const tiers = useMemo(() => {
    const set = new Set<string>();
    for (const f of feedback) if (f.tier) set.add(f.tier);
    return [...set].sort((a, b) => a.localeCompare(b, "de"));
  }, [feedback]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = feedback.filter((f) => {
      if (tier !== TIER_ALL && (f.tier ?? "") !== tier) return false;
      if (q === "") return true;
      return (
        f.message.toLowerCase().includes(q) ||
        (f.email ?? "").toLowerCase().includes(q) ||
        (f.page ?? "").toLowerCase().includes(q)
      );
    });

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      const ta = createdTime(a);
      const tb = createdTime(b);
      const aNan = Number.isNaN(ta);
      const bNan = Number.isNaN(tb);
      if (aNan && bNan) return 0;
      if (aNan) return 1;
      if (bNan) return -1;
      return sort === "created_desc" ? tb - ta : ta - tb;
    });
    return sorted;
  }, [feedback, query, tier, sort]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <Label htmlFor="fb-search" className="mb-1.5 block text-muted-foreground">
            Suche (Text, E-Mail, Seite)
          </Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="fb-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Stichwort…"
              className="pl-9"
            />
          </div>
        </div>

        <div className="w-44">
          <Label htmlFor="fb-tier" className="mb-1.5 block text-muted-foreground">
            Tier
          </Label>
          <Select id="fb-tier" value={tier} onChange={(e) => setTier(e.target.value)}>
            <option value={TIER_ALL}>Alle</option>
            {tiers.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>

        <div className="w-44">
          <Label htmlFor="fb-sort" className="mb-1.5 block text-muted-foreground">
            Sortierung
          </Label>
          <Select id="fb-sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="created_desc">Neueste zuerst</option>
            <option value="created_asc">Älteste zuerst</option>
          </Select>
        </div>
      </div>

      <p className="mb-4 text-sm text-muted-foreground">
        {visible.length === feedback.length
          ? `${feedback.length} Rückmeldung(en)`
          : `${visible.length} von ${feedback.length} Rückmeldung(en)`}
      </p>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-border bg-card px-3.5 py-3 text-sm text-muted-foreground">
          Keine Rückmeldungen für diese Suche/Filter.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((f) => (
            <FeedbackCard key={f.id} item={f} />
          ))}
        </div>
      )}
    </div>
  );
}

function FeedbackCard({ item }: { item: FeedbackItem }) {
  return (
    <article className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <header className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <time dateTime={item.createdAt} className="font-medium text-foreground">
          {formatDate(item.createdAt)}
        </time>
        {item.tier && <Badge variant="secondary">{item.tier}</Badge>}
        {item.email && <Badge variant="info">{item.email}</Badge>}
      </header>

      <p className="whitespace-pre-wrap break-words text-sm text-foreground">
        {item.message}
      </p>

      {(item.page || item.sessionId || item.conversationId) && (
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
          {item.page && (
            <div className="flex gap-1.5">
              <dt className="font-medium">Seite:</dt>
              <dd className="break-all">{item.page}</dd>
            </div>
          )}
          {item.sessionId && (
            <div className="flex gap-1.5">
              <dt className="font-medium">Session:</dt>
              <dd className="break-all font-mono">{item.sessionId}</dd>
            </div>
          )}
          {item.conversationId && (
            <div className="flex gap-1.5">
              <dt className="font-medium">Thread:</dt>
              <dd className="break-all font-mono">{item.conversationId}</dd>
            </div>
          )}
        </dl>
      )}
    </article>
  );
}
