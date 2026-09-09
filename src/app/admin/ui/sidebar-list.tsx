"use client";

// SidebarList — the stored-items rail of the Analyse and Verbesserung screens:
// a primary "new" entry, a small heading with the count and one button per
// item (title, status badge, two meta slots). The active item carries
// aria-current; selection is the screen's state.

import * as React from "react";
import { Plus } from "lucide-react";
import { cn } from "./cn";

export interface SidebarListItem {
  id: number;
  title: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  metaLeft?: React.ReactNode;
  metaRight?: React.ReactNode;
}

export interface SidebarListProps {
  /** Accessible name of the nav. */
  label: string;
  newLabel: string;
  onNew: () => void;
  /** The "new" entry is the active view. */
  newActive: boolean;
  heading: React.ReactNode;
  items: SidebarListItem[];
  activeId: number | null;
  onSelect: (id: number) => void;
  emptyText: React.ReactNode;
  className?: string;
}

export function SidebarList({
  label,
  newLabel,
  onNew,
  newActive,
  heading,
  items,
  activeId,
  onSelect,
  emptyText,
  className,
}: SidebarListProps) {
  return (
    <nav aria-label={label} className={cn("flex flex-col gap-2", className)}>
      <button
        type="button"
        onClick={onNew}
        aria-current={newActive ? "true" : undefined}
        className={cn(
          "flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          newActive
            ? "border-accent/40 bg-accent-soft text-accent"
            : "border-border bg-card text-foreground hover:bg-secondary"
        )}
      >
        <Plus className="size-4" aria-hidden />
        {newLabel}
      </button>

      <div className="px-1 pt-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
        {heading}
      </div>

      {items.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item) => {
            const active = activeId === item.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelect(item.id)}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "block w-full rounded-md border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active ? "border-accent/40 bg-accent-soft" : "border-border bg-card hover:bg-secondary"
                  )}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground">
                      {item.icon && (
                        <span className="shrink-0 text-muted-foreground [&_svg]:size-3.5" aria-hidden>
                          {item.icon}
                        </span>
                      )}
                      <span className="truncate">{item.title}</span>
                    </span>
                    {item.badge}
                  </span>
                  {(item.metaLeft || item.metaRight) && (
                    <span className="mt-1 flex items-center justify-between gap-2 text-2xs text-muted-foreground">
                      <span>{item.metaLeft}</span>
                      <span className="tabular-nums">{item.metaRight}</span>
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
