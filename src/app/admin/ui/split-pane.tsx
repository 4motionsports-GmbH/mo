// SplitPane — master/detail layout: a list rail that stays in view while the
// detail scrolls (≥ lg), stacked on tablet.

import * as React from "react";
import { cn } from "./cn";

const widths = {
  sm: "lg:grid-cols-[260px_minmax(0,1fr)]",
  md: "lg:grid-cols-[320px_minmax(0,1fr)]",
  lg: "lg:grid-cols-[380px_minmax(0,1fr)]",
} as const;

export interface SplitPaneProps {
  list: React.ReactNode;
  detail: React.ReactNode;
  listWidth?: keyof typeof widths;
  /** Keep the list pinned while the detail scrolls (default true). */
  stickyList?: boolean;
  /** Offset from the top when sticky (default 1rem = the page gutter). */
  stickyTopClassName?: string;
  listLabel?: string;
  className?: string;
  listClassName?: string;
  detailClassName?: string;
}

export function SplitPane({
  list,
  detail,
  listWidth = "md",
  stickyList = true,
  stickyTopClassName = "lg:top-4 lg:max-h-[calc(100vh-2rem)]",
  listLabel,
  className,
  listClassName,
  detailClassName,
}: SplitPaneProps) {
  return (
    <div className={cn("flex flex-col gap-5 lg:grid lg:items-start", widths[listWidth], className)}>
      <aside
        aria-label={listLabel}
        className={cn(
          "min-w-0",
          stickyList && cn("lg:sticky lg:overflow-y-auto", stickyTopClassName),
          listClassName
        )}
      >
        {list}
      </aside>
      <section className={cn("min-w-0", detailClassName)}>{detail}</section>
    </div>
  );
}
