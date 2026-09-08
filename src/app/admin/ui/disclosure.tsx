"use client";

// Disclosure — a collapsible section with a button header (chevron, optional
// count/meta and actions). Content unmounts while closed unless `keepMounted`.

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "./cn";

export interface DisclosureProps {
  title: React.ReactNode;
  /** Small text right of the title (count, state). */
  meta?: React.ReactNode;
  /** Actions on the right — clicks do not toggle the section. */
  actions?: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  keepMounted?: boolean;
  /** Card-like frame (default) or a bare row. */
  framed?: boolean;
  className?: string;
  contentClassName?: string;
  children: React.ReactNode;
}

export function Disclosure({
  title,
  meta,
  actions,
  open: controlled,
  defaultOpen = false,
  onOpenChange,
  keepMounted = false,
  framed = true,
  className,
  contentClassName,
  children,
}: DisclosureProps) {
  const id = React.useId();
  const [uncontrolled, setUncontrolled] = React.useState(defaultOpen);
  const open = controlled ?? uncontrolled;
  const toggle = () => {
    const next = !open;
    if (controlled === undefined) setUncontrolled(next);
    onOpenChange?.(next);
  };
  return (
    <div className={cn(framed && "rounded-lg border border-border bg-card", className)}>
      <div className={cn("flex items-center gap-2", framed ? "px-3 py-2" : "py-1")}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={toggle}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight
            className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
            aria-hidden
          />
          <span className="truncate">{title}</span>
          {meta && <span className="ml-1 truncate text-xs font-normal text-muted-foreground">{meta}</span>}
        </button>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      {(open || keepMounted) && (
        <div
          id={id}
          hidden={!open}
          className={cn(framed ? "border-t border-border px-3 py-3" : "pb-2 pl-6", contentClassName)}
        >
          {children}
        </div>
      )}
    </div>
  );
}
