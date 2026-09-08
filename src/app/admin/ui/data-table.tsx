"use client";

// DataTable — the one list table: typed columns, click-to-sort headers
// (aria-sort), sticky head, loading skeleton rows, empty state, selectable
// rows (click / Enter / Space) and an optional footer (Pagination). Sorting
// rules live in src/lib/admin-table.mjs so they are unit-tested.

import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { sortRows } from "@/lib/admin-table.mjs";
import { cn } from "./cn";
import { EmptyState } from "./empty-state";
import { Skeleton } from "./skeleton";

export type SortDir = "asc" | "desc";
export interface SortState {
  key: string;
  dir: SortDir;
}

export interface DataTableColumn<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  /** Makes the column sortable; return the raw value (string/number/Date/null). */
  sortValue?: (row: T) => unknown;
  /** Direction used when the column becomes the sort key (default asc). */
  defaultDir?: SortDir;
  align?: "left" | "right" | "center";
  /** CSS width (e.g. "8rem", "20%"). */
  width?: string;
  className?: string;
  headerClassName?: string;
  /** Hide the column below a breakpoint. */
  hideBelow?: "sm" | "md" | "lg" | "xl";
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string | number;
  sort?: SortState | null;
  onSortChange?: (sort: SortState | null) => void;
  defaultSort?: SortState | null;
  /** Sort rows client-side (default true). Set false when the server sorts. */
  clientSort?: boolean;
  loading?: boolean;
  loadingRows?: number;
  empty?: React.ReactNode;
  onRowClick?: (row: T) => void;
  selectedKey?: string | number | null;
  rowClassName?: (row: T) => string | undefined;
  dense?: boolean;
  stickyHeader?: boolean;
  /** Max height of the scroll area (enables vertical scrolling with sticky head). */
  maxHeight?: string;
  caption?: string;
  footer?: React.ReactNode;
  className?: string;
}

const hideClasses = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
} as const;

const alignClasses = { left: "text-left", right: "text-right", center: "text-center" } as const;

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  sort: controlledSort,
  onSortChange,
  defaultSort = null,
  clientSort = true,
  loading = false,
  loadingRows = 5,
  empty,
  onRowClick,
  selectedKey,
  rowClassName,
  dense = false,
  stickyHeader = true,
  maxHeight,
  caption,
  footer,
  className,
}: DataTableProps<T>) {
  const [uncontrolledSort, setUncontrolledSort] = React.useState<SortState | null>(defaultSort);
  const sort = controlledSort !== undefined ? controlledSort : uncontrolledSort;

  const setSort = (next: SortState | null) => {
    if (controlledSort === undefined) setUncontrolledSort(next);
    onSortChange?.(next);
  };

  const toggleSort = (column: DataTableColumn<T>) => {
    if (!column.sortValue) return;
    if (sort?.key === column.key) {
      setSort({ key: column.key, dir: sort.dir === "asc" ? "desc" : "asc" });
    } else {
      setSort({ key: column.key, dir: column.defaultDir ?? "asc" });
    }
  };

  const sorted = React.useMemo(() => {
    if (!clientSort || !sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column?.sortValue) return rows;
    return (sortRows as (r: readonly T[], g: (row: T) => unknown, d: SortDir) => T[])(
      rows,
      column.sortValue,
      sort.dir
    );
  }, [rows, columns, sort, clientSort]);

  const cellPadding = dense ? "px-3 py-1.5" : "px-3 py-2.5";

  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-card", className)}>
      <div className={cn("w-full overflow-x-auto", maxHeight && "overflow-y-auto")} style={maxHeight ? { maxHeight } : undefined}>
        <table className="w-full caption-bottom border-collapse text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {columns.map((column) => {
                const active = sort?.key === column.key;
                const sortable = Boolean(column.sortValue);
                const Icon = !active ? ArrowUpDown : sort?.dir === "asc" ? ArrowUp : ArrowDown;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={active ? (sort?.dir === "asc" ? "ascending" : "descending") : undefined}
                    style={column.width ? { width: column.width } : undefined}
                    className={cn(
                      "h-9 whitespace-nowrap border-b border-border bg-surface-2 px-3 text-xs font-semibold text-muted-foreground",
                      stickyHeader && "sticky top-0 z-10",
                      alignClasses[column.align ?? "left"],
                      column.hideBelow && hideClasses[column.hideBelow],
                      column.headerClassName
                    )}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          active && "text-foreground",
                          column.align === "right" && "flex-row-reverse"
                        )}
                      >
                        {column.header}
                        <Icon className={cn("size-3", !active && "opacity-60")} aria-hidden />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: loadingRows }, (_, i) => (
                <tr key={`loading-${i}`} className="border-b border-border last:border-0">
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(cellPadding, column.hideBelow && hideClasses[column.hideBelow])}
                    >
                      <Skeleton className="h-3.5 w-full max-w-[12rem]" />
                    </td>
                  ))}
                </tr>
              ))
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="p-0">
                  {empty ?? <EmptyState compact plain title="Keine Einträge" />}
                </td>
              </tr>
            ) : (
              sorted.map((row) => {
                const key = rowKey(row);
                const selected = selectedKey !== undefined && selectedKey !== null && key === selectedKey;
                const interactive = Boolean(onRowClick);
                return (
                  <tr
                    key={key}
                    tabIndex={interactive ? 0 : undefined}
                    aria-selected={interactive ? selected : undefined}
                    data-selected={selected || undefined}
                    onClick={interactive ? () => onRowClick?.(row) : undefined}
                    onKeyDown={
                      interactive
                        ? (e) => {
                            if (e.target !== e.currentTarget) return;
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onRowClick?.(row);
                            }
                          }
                        : undefined
                    }
                    className={cn(
                      "border-b border-border transition-colors last:border-0",
                      interactive &&
                        "cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      selected && "bg-accent-soft hover:bg-accent-soft",
                      rowClassName?.(row)
                    )}
                  >
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={cn(
                          "align-middle",
                          cellPadding,
                          alignClasses[column.align ?? "left"],
                          column.align === "right" && "tabular-nums",
                          column.hideBelow && hideClasses[column.hideBelow],
                          column.className
                        )}
                      >
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {footer && <div className="border-t border-border px-3 py-2">{footer}</div>}
    </div>
  );
}
