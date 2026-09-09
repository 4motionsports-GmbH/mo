"use client";

// Master–detail workspace of the conversation inspector ("Gespräche").
//
//   filters  — URL state (g* params): a change lets the server re-render the tab
//   stats    — free distribution of the window; bars filter the list
//   list     — one server-rendered page (newest first) in the sticky rail
//   detail   — the selected conversation (?gid=, fetched on selection)
//   report   — the collapsed aggregate insights rollup
//
// ZERO tokens on render: only the explicit buttons (Analysieren, Alle
// auswerten, Insights generieren) call a model.

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  activeConversationFilterCount,
  conversationFilterHref,
  defaultConversationFilterState,
} from "@/lib/admin-conversation-filter.mjs";
import type { AdminConversationListItem, ConversationStats, InsightsRollup } from "@/lib/admin-conversations";
import { num } from "@/lib/admin-format.mjs";
import { pageCount } from "@/lib/admin-table.mjs";
import { SplitPane } from "../ui";
import { ConversationDetail } from "./ConversationDetail";
import { ConversationFilters } from "./ConversationFilters";
import { ConversationList } from "./ConversationList";
import { ReportPanel } from "./ReportPanel";
import { StatsPanel } from "./StatsPanel";
import type { ConversationFilterState } from "./types";

function syncConversationParam(id: number | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (id === null) url.searchParams.delete("gid");
  else url.searchParams.set("gid", String(id));
  window.history.replaceState(window.history.state, "", url.toString());
}

export function GespraecheWorkspace({
  items,
  total,
  page,
  pageSize,
  stats,
  unanalyzed,
  bulkEstimateEur,
  insights,
  filter,
  initialConversationId,
}: {
  items: AdminConversationListItem[];
  total: number;
  /** The page actually served (a stale ?gpage= beyond the end falls back to 1). */
  page: number;
  pageSize: number;
  stats: ConversationStats;
  unanalyzed: number;
  bulkEstimateEur: number;
  insights: InsightsRollup | null;
  filter: ConversationFilterState;
  initialConversationId: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [selectedId, setSelectedId] = React.useState<number | null>(initialConversationId);
  const detailRef = React.useRef<HTMLDivElement | null>(null);

  const select = React.useCallback((id: number) => {
    setSelectedId(id);
    syncConversationParam(id);
  }, []);

  // Insights reference links select by ID (the detail endpoint fetches
  // directly, so this works even when the conversation is not on the current
  // page) and scroll the detail into view — tablets stack the panes.
  const openConversation = React.useCallback(
    (id: number) => {
      select(id);
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [select]
  );

  // URL navigation: build the next g* state and let the server re-render.
  const go = React.useCallback(
    (next: Partial<ConversationFilterState>) => {
      startTransition(() =>
        router.push(conversationFilterHref(filter, next, selectedId), { scroll: false })
      );
    },
    [filter, router, selectedId]
  );

  const pages = pageCount(total, pageSize);
  const noun = filter.q ? "Treffer" : total === 1 ? "Gespräch" : "Gespräche";
  const summary = `${filter.label} · ${num(total)} ${noun}${
    pages > 1 ? ` · Seite ${num(page)}/${num(pages)}` : ""
  }`;

  return (
    <div className="flex flex-col gap-4">
      <ConversationFilters
        filter={filter}
        pending={pending}
        activeCount={activeConversationFilterCount(filter)}
        go={go}
        onReset={() => go({ ...(defaultConversationFilterState() as ConversationFilterState), page: 1 })}
        end={
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {summary}
          </span>
        }
      />

      <StatsPanel
        from={filter.from}
        to={filter.to}
        stats={stats}
        unanalyzed={unanalyzed}
        bulkEstimateEur={bulkEstimateEur}
        activeCategory={filter.category}
        activeQuality={filter.quality}
        onFilterCategory={(category) => go({ category, page: 1 })}
        onFilterQuality={(quality) => go({ quality, page: 1 })}
      />

      <SplitPane
        listWidth="lg"
        listLabel="Gespräche"
        stickyTopClassName="lg:top-[4.5rem] lg:max-h-[calc(100vh-5.5rem)]"
        list={
          <ConversationList
            items={items}
            selectedId={selectedId}
            onSelect={select}
            page={page}
            pageCount={pages}
            total={total}
            pageSize={pageSize}
            onPageChange={(p) => go({ page: p })}
            pending={pending}
            searching={filter.q}
          />
        }
        detail={
          <div ref={detailRef} className="scroll-mt-20">
            <ConversationDetail conversationId={selectedId} />
          </div>
        }
      />

      <ReportPanel
        from={filter.from}
        to={filter.to}
        analyzedCount={stats.analyzedCount}
        initialInsights={insights}
        onOpenConversation={openConversation}
      />
    </div>
  );
}
