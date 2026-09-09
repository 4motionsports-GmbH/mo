"use client";

// The conversation rail: one page of rows (newest first) + pagination. Rows are
// buttons; the selected one carries aria-current. Every value shown is a
// label or a count — never an identity (see lib/admin-conversations).

import { MessagesSquare } from "lucide-react";
import type { AdminConversationListItem } from "@/lib/admin-conversations";
import { ADMIN_DATE_TIME_SHORT, formatAdmin } from "@/lib/admin-datetime.mjs";
import { plural } from "@/lib/admin-format.mjs";
import { EmptyState, Pagination, cn } from "../ui";
import { AnalysisBadges, OutcomeChips, TierBadge, personaLabel } from "./badges";

export function ConversationList({
  items,
  selectedId,
  onSelect,
  page,
  pageCount,
  total,
  pageSize,
  onPageChange,
  pending,
  searching,
}: {
  items: AdminConversationListItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  pending: boolean;
  /** A free-text search is active (changes the empty-state wording). */
  searching: string | null;
}) {
  return (
    <div className={cn("flex flex-col gap-2", pending && "opacity-60 transition-opacity")} aria-busy={pending}>
      {items.length === 0 ? (
        <EmptyState
          compact
          icon={<MessagesSquare />}
          title={searching ? `Keine Gespräche gefunden für „${searching}“.` : "Keine Gespräche für diesen Zeitraum/Filter."}
        />
      ) : (
        <ul className="flex flex-col gap-1 rounded-lg border border-border bg-card p-1">
          {items.map((it) => (
            <ConversationRow key={it.id} item={it} selected={it.id === selectedId} onSelect={() => onSelect(it.id)} />
          ))}
        </ul>
      )}
      {total > pageSize && (
        <Pagination
          compact
          page={page}
          pageCount={pageCount}
          total={total}
          pageSize={pageSize}
          onPageChange={onPageChange}
          itemLabel={searching ? "Treffer" : "Gespräche"}
        />
      )}
    </div>
  );
}

function ConversationRow({
  item,
  selected,
  onSelect,
}: {
  item: AdminConversationListItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const persona = personaLabel(item.personaLabel);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex w-full flex-col gap-1.5 rounded-md border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          selected ? "border-accent/50 bg-accent-soft" : "border-transparent hover:bg-secondary/60"
        )}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-foreground">
            {formatAdmin(item.createdAt, ADMIN_DATE_TIME_SHORT, item.createdAt || "—")}
          </span>
          <TierBadge tier={item.tier} />
        </span>
        <span className="flex items-center justify-between gap-2 text-2xs text-muted-foreground">
          <span>{plural(item.messageCount, "Nachricht", "Nachrichten")}</span>
          {persona && <span className="truncate">{persona}</span>}
        </span>
        <OutcomeChips item={item} />
        {item.analysis ? (
          <span className="flex flex-col gap-1">
            <AnalysisBadges category={item.analysis.category} quality={item.analysis.quality} />
            {item.analysis.summary && (
              <span className="line-clamp-2 text-2xs leading-snug text-muted-foreground">
                {item.analysis.summary}
              </span>
            )}
          </span>
        ) : (
          <span className="text-2xs italic text-muted-foreground/80">nicht analysiert</span>
        )}
      </button>
    </li>
  );
}
