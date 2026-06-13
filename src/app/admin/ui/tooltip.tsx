"use client";

// Tooltip — minimal hover/focus tooltip (no Radix). Wrap a trigger and pass the
// label via `content`. Pure CSS/JS, themed via tokens.

import * as React from "react";
import { cn } from "./cn";

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom";
  className?: string;
}

export function Tooltip({ content, children, side = "top", className }: TooltipProps) {
  const [open, setOpen] = React.useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && content != null && (
        <span
          role="tooltip"
          className={cn(
            "pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md",
            side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
            className
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}

// API-parity no-op provider so call sites can mirror shadcn's <TooltipProvider>.
export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
