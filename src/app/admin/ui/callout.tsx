// Callout — the one inline notice (replaces the per-tab `Banner` copies).
// Tone drives border/tint/icon; the body text stays foreground-coloured for
// readability in both themes. Use for states, not for explanations (those go
// into an InfoTip).

import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";
import { cn } from "./cn";

export type CalloutTone = "info" | "warning" | "success" | "destructive" | "neutral";

const tones: Record<CalloutTone, { box: string; icon: string; Icon: React.ComponentType<{ className?: string }> }> = {
  info: { box: "border-info/30 bg-info/10", icon: "text-info", Icon: Info },
  warning: { box: "border-warning/30 bg-warning/10", icon: "text-warning", Icon: AlertTriangle },
  success: { box: "border-success/30 bg-success/10", icon: "text-success", Icon: CheckCircle2 },
  destructive: {
    box: "border-destructive/30 bg-destructive/10",
    icon: "text-destructive",
    Icon: OctagonAlert,
  },
  neutral: { box: "border-border bg-surface-2", icon: "text-muted-foreground", Icon: Info },
};

export interface CalloutProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  tone?: CalloutTone;
  title?: React.ReactNode;
  /** Replace the tone icon; `null` hides it. */
  icon?: React.ReactNode | null;
  /** Right-aligned action (a small Button or link). */
  action?: React.ReactNode;
  compact?: boolean;
}

export function Callout({
  tone = "info",
  title,
  icon,
  action,
  compact = false,
  className,
  children,
  ...props
}: CalloutProps) {
  const t = tones[tone];
  const showIcon = icon !== null;
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border text-foreground",
        compact ? "px-3 py-2 text-xs" : "px-3.5 py-3 text-sm",
        t.box,
        className
      )}
      {...props}
    >
      {showIcon && (
        <span className={cn("mt-0.5 shrink-0", t.icon)} aria-hidden>
          {icon ?? <t.Icon className={compact ? "size-3.5" : "size-4"} />}
        </span>
      )}
      <div className="min-w-0 flex-1 leading-relaxed [&_code]:rounded [&_code]:bg-black/5 [&_code]:px-1 [&_code]:py-0.5 dark:[&_code]:bg-white/10">
        {title && <div className="font-semibold">{title}</div>}
        {children}
      </div>
      {action && <div className="ml-2 shrink-0 self-center">{action}</div>}
    </div>
  );
}
