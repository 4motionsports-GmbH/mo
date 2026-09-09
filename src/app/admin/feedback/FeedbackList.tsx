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
// Newsletter ratings (page = "email:<kind>") carry their own badge.

import { useMemo, useState } from "react";
import { MessageSquareText, Star } from "lucide-react";
import { ADMIN_DATE_TIME_MEDIUM, formatAdmin } from "@/lib/admin-datetime.mjs";
import { num, plural } from "@/lib/admin-format.mjs";
import { EMAIL_THEME_KIND_LABELS } from "@/lib/email-theme.mjs";
import { EmptyState, FilterBar, FilterGroup, SearchInput, Select, StatusBadge } from "../ui";

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

/** "email:<kind>" pages are one-click newsletter ratings, not widget feedback. */
function newsletterKind(page: string | null): string | null {
  if (!page || !page.startsWith("email:")) return null;
  const kind = page.slice("email:".length);
  return (EMAIL_THEME_KIND_LABELS as Record<string, string>)[kind] ?? kind;
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

  const activeCount = (query.trim() ? 1 : 0) + (tier !== TIER_ALL ? 1 : 0);
  const summary =
    visible.length === feedback.length
      ? plural(feedback.length, "Rückmeldung", "Rückmeldungen")
      : `${num(visible.length)} von ${plural(feedback.length, "Rückmeldung", "Rückmeldungen")}`;

  return (
    <div className="flex flex-col gap-4">
      <FilterBar
        activeCount={activeCount}
        onReset={() => {
          setQuery("");
          setTier(TIER_ALL);
        }}
        end={<span className="text-xs text-muted-foreground">{summary}</span>}
      >
        <SearchInput
          id="feedback-search"
          value={query}
          onValueChange={setQuery}
          placeholder="Text, E-Mail, Seite …"
          aria-label="Feedback durchsuchen"
          size="sm"
          containerClassName="w-full sm:w-72"
        />
        <FilterGroup label="Tier" htmlFor="fb-tier">
          <Select id="fb-tier" value={tier} onChange={(e) => setTier(e.target.value)} className="h-8 w-auto min-w-[8rem] py-0 pr-8 text-xs">
            <option value={TIER_ALL}>Alle</option>
            {tiers.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </FilterGroup>
        <FilterGroup label="Sortierung" htmlFor="fb-sort">
          <Select
            id="fb-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="h-8 w-auto min-w-[9rem] py-0 pr-8 text-xs"
          >
            <option value="created_desc">Neueste zuerst</option>
            <option value="created_asc">Älteste zuerst</option>
          </Select>
        </FilterGroup>
      </FilterBar>

      {feedback.length === 0 ? (
        <EmptyState
          icon={<MessageSquareText />}
          title="Noch kein Feedback."
          description="Sobald Nutzer:innen über das Widget eine Rückmeldung senden, erscheint sie hier — neueste zuerst."
        />
      ) : visible.length === 0 ? (
        <EmptyState compact icon={<MessageSquareText />} title="Keine Rückmeldungen für diese Suche/Filter." />
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
  const newsletter = newsletterKind(item.page);
  return (
    <article className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <header className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <time dateTime={item.createdAt} className="font-medium text-foreground">
          {formatAdmin(item.createdAt, ADMIN_DATE_TIME_MEDIUM)}
        </time>
        {newsletter && (
          <StatusBadge tone="accent" dot={false} icon={<Star />}>
            Newsletter-Bewertung · {newsletter}
          </StatusBadge>
        )}
        {item.tier && (
          <StatusBadge tone="neutral" dot={false}>
            {item.tier}
          </StatusBadge>
        )}
        {item.email && (
          <StatusBadge tone="info" dot={false}>
            {item.email}
          </StatusBadge>
        )}
      </header>

      <p className="whitespace-pre-wrap break-words text-sm text-foreground">{item.message}</p>

      {(item.page || item.sessionId || item.conversationId) && (
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-border pt-2 text-2xs text-muted-foreground">
          {item.page && !newsletter && (
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
