// ProgressBar — determinate (0–100) or indeterminate progress.

import * as React from "react";
import { cn } from "./cn";

export interface ProgressBarProps {
  /** 0–100; omit for an indeterminate bar. */
  value?: number | null;
  label?: string;
  tone?: "accent" | "success" | "warning" | "destructive";
  size?: "sm" | "md";
  className?: string;
}

export function ProgressBar({ value, label, tone = "accent", size = "sm", className }: ProgressBarProps) {
  const indeterminate = value === undefined || value === null || !Number.isFinite(value);
  const clamped = indeterminate ? 0 : Math.min(100, Math.max(0, value));
  const tones = {
    accent: "bg-accent",
    success: "bg-success",
    warning: "bg-warning",
    destructive: "bg-destructive",
  } as const;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(clamped)}
      className={cn(
        "relative w-full overflow-hidden rounded-full bg-surface-2",
        size === "sm" ? "h-1.5" : "h-2.5",
        className
      )}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-300",
          tones[tone],
          indeterminate && "w-1/3 animate-[progress-slide_1.2s_ease-in-out_infinite]"
        )}
        style={indeterminate ? undefined : { width: `${clamped}%` }}
      />
    </div>
  );
}
