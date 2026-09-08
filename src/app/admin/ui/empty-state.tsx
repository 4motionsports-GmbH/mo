// EmptyState — "nothing here yet" block for lists, tables and panels. One
// sentence, optional primary action; never a paragraph of explanation.

import * as React from "react";
import { Inbox } from "lucide-react";
import { cn } from "./cn";

export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** Tighter padding for use inside cards and table bodies. */
  compact?: boolean;
  /** Drop the dashed frame (when the parent already is a card). */
  plain?: boolean;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
  plain = false,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        !plain && "rounded-lg border border-dashed border-border bg-card/60",
        compact ? "gap-1.5 px-4 py-6" : "gap-2 px-6 py-10",
        className
      )}
      {...props}
    >
      <span
        className={cn(
          "flex items-center justify-center rounded-full bg-surface-2 text-muted-foreground",
          compact ? "size-8 [&_svg]:size-4" : "size-10 [&_svg]:size-5"
        )}
        aria-hidden
      >
        {icon ?? <Inbox />}
      </span>
      <div className={cn("font-semibold text-foreground", compact ? "text-xs" : "text-sm")}>{title}</div>
      {description && (
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
