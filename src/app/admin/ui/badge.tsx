// Badge — small status pill. Includes semantic status variants used across the
// admin cards (success / warning / info / destructive) so colored badges stay
// theme-aware in both light and dark.

import * as React from "react";
import { cn } from "./cn";

type Variant =
  | "default"
  | "secondary"
  | "outline"
  | "accent"
  | "success"
  | "warning"
  | "info"
  | "destructive";

const variants: Record<Variant, string> = {
  default: "bg-primary text-primary-foreground",
  secondary: "bg-secondary text-secondary-foreground border border-border",
  outline: "border border-border text-foreground",
  accent: "bg-accent text-accent-foreground",
  success: "bg-success/15 text-success border border-success/30",
  warning: "bg-warning/15 text-warning border border-warning/30",
  info: "bg-info/15 text-info border border-info/30",
  destructive: "bg-destructive/15 text-destructive border border-destructive/30",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
