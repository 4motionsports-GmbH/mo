// StatusBadge — the one way to render a status (queue state, delivery state,
// run state): tone + optional dot/icon + short label. Screens map their domain
// statuses to a tone in one table and never compose colour classes by hand.

import * as React from "react";
import { cn } from "./cn";

export type StatusTone = "neutral" | "accent" | "success" | "warning" | "info" | "destructive";

const tones: Record<StatusTone, { badge: string; dot: string }> = {
  neutral: { badge: "border-border bg-surface-2 text-muted-foreground", dot: "bg-muted-foreground" },
  accent: { badge: "border-accent/30 bg-accent/10 text-accent", dot: "bg-accent" },
  success: { badge: "border-success/30 bg-success/10 text-success", dot: "bg-success" },
  warning: { badge: "border-warning/30 bg-warning/10 text-warning", dot: "bg-warning" },
  info: { badge: "border-info/30 bg-info/10 text-info", dot: "bg-info" },
  destructive: {
    badge: "border-destructive/30 bg-destructive/10 text-destructive",
    dot: "bg-destructive",
  },
};

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
  /** Leading dot (default) — set false when passing an `icon`. */
  dot?: boolean;
  icon?: React.ReactNode;
  size?: "sm" | "md";
  /** Animated dot for in-flight states. */
  pulse?: boolean;
}

export function StatusBadge({
  tone = "neutral",
  dot = true,
  icon,
  size = "sm",
  pulse = false,
  className,
  children,
  ...props
}: StatusBadgeProps) {
  const t = tones[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border font-medium",
        size === "sm" ? "h-5 px-1.5 text-2xs" : "h-6 px-2 text-xs",
        t.badge,
        className
      )}
      {...props}
    >
      {icon ? (
        <span className="inline-flex [&_svg]:size-3" aria-hidden>
          {icon}
        </span>
      ) : dot ? (
        <span className={cn("size-1.5 rounded-full", t.dot, pulse && "animate-pulse")} aria-hidden />
      ) : null}
      {children}
    </span>
  );
}
