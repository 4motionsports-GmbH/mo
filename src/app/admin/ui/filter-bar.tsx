"use client";

// FilterBar — one row of list controls: search, selects, segmented toggles,
// active-filter chips and a reset. Purely layout + the reset affordance; the
// filter state lives in the screen.

import * as React from "react";
import { X } from "lucide-react";
import { Button } from "./button";
import { cn } from "./cn";

export interface FilterBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Number of filters currently deviating from the default — shows the reset. */
  activeCount?: number;
  onReset?: () => void;
  resetLabel?: string;
  /** Right-aligned slot (result count, sort control, secondary actions). */
  end?: React.ReactNode;
}

export function FilterBar({
  activeCount = 0,
  onReset,
  resetLabel = "Zurücksetzen",
  end,
  className,
  children,
  ...props
}: FilterBarProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} {...props}>
      {children}
      {activeCount > 0 && onReset && (
        <Button variant="ghost" size="sm" onClick={onReset} className="text-muted-foreground">
          <X aria-hidden />
          {resetLabel}
          <span className="tabular-nums">({activeCount})</span>
        </Button>
      )}
      {end && <div className="ml-auto flex items-center gap-2">{end}</div>}
    </div>
  );
}

export interface FilterChipProps {
  children: React.ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
  className?: string;
}

/** An active filter shown as a removable chip. */
export function FilterChip({ children, onRemove, removeLabel = "Filter entfernen", className }: FilterChipProps) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface-2 pl-2 text-xs font-medium text-foreground",
        onRemove ? "pr-1" : "pr-2",
        className
      )}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10"
        >
          <X className="size-3" aria-hidden />
        </button>
      )}
    </span>
  );
}

/** A labelled control inside the bar ("Status" + select). */
export function FilterGroup({
  label,
  htmlFor,
  children,
  className,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <label htmlFor={htmlFor} className="whitespace-nowrap text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
