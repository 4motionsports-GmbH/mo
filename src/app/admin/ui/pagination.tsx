"use client";

// Pagination — page controls for long lists ("1–25 von 312", page numbers with
// gaps, optional page-size select). Pure paging math lives in
// src/lib/admin-table.mjs.

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { pageWindow } from "@/lib/admin-table.mjs";
import { num } from "@/lib/admin-format.mjs";
import { cn } from "./cn";
import { IconButton } from "./icon-button";
import { Select } from "./select";

export interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Total items — enables the "x–y von z" summary together with pageSize. */
  total?: number;
  pageSize?: number;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: readonly number[];
  /** Hide the numbered buttons (prev/next + summary only). */
  compact?: boolean;
  itemLabel?: string;
  className?: string;
}

export function Pagination({
  page,
  pageCount,
  onPageChange,
  total,
  pageSize,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100],
  compact = false,
  itemLabel = "Einträge",
  className,
}: PaginationProps) {
  const count = Math.max(1, pageCount);
  const current = Math.min(Math.max(1, page), count);
  const from = total !== undefined && pageSize ? Math.min(total, (current - 1) * pageSize + 1) : null;
  const to = total !== undefined && pageSize ? Math.min(total, current * pageSize) : null;
  const windowPages = (pageWindow as (p: number, c: number) => (number | "…")[])(current, count);
  const sizeId = React.useId();

  return (
    <nav
      aria-label="Seitennavigation"
      className={cn("flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground", className)}
    >
      <div className="flex items-center gap-3">
        {total !== undefined && (
          <span className="tabular-nums">
            {total === 0
              ? `Keine ${itemLabel}`
              : from !== null && to !== null
                ? `${num(from)}–${num(to)} von ${num(total)} ${itemLabel}`
                : `${num(total)} ${itemLabel}`}
          </span>
        )}
        {onPageSizeChange && pageSize && (
          <label htmlFor={sizeId} className="flex items-center gap-1.5">
            <span>Pro Seite</span>
            <Select
              id={sizeId}
              value={String(pageSize)}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="h-7 w-auto py-0 pr-7 text-xs"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </Select>
          </label>
        )}
      </div>
      {count > 1 && (
        <div className="flex items-center gap-1">
          <IconButton
            label="Vorherige Seite"
            size="icon-sm"
            variant="ghost"
            disabled={current <= 1}
            onClick={() => onPageChange(current - 1)}
            tooltip={false}
          >
            <ChevronLeft />
          </IconButton>
          {compact ? (
            <span className="px-1 tabular-nums">
              Seite {num(current)} von {num(count)}
            </span>
          ) : (
            windowPages.map((entry, index) =>
              entry === "…" ? (
                <span key={`gap-${index}`} className="w-6 text-center" aria-hidden>
                  …
                </span>
              ) : (
                <button
                  key={entry}
                  type="button"
                  aria-current={entry === current ? "page" : undefined}
                  aria-label={`Seite ${entry}`}
                  onClick={() => onPageChange(entry)}
                  className={cn(
                    "inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-xs font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    entry === current
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  {entry}
                </button>
              )
            )
          )}
          <IconButton
            label="Nächste Seite"
            size="icon-sm"
            variant="ghost"
            disabled={current >= count}
            onClick={() => onPageChange(current + 1)}
            tooltip={false}
          >
            <ChevronRight />
          </IconButton>
        </div>
      )}
    </nav>
  );
}
