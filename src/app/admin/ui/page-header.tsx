// PageHeader — title row of a screen: name, optional InfoTip with the screen's
// explanation, small meta (badges / counts) and right-aligned actions. Children
// render a toolbar row underneath (filters, segmented controls).

import * as React from "react";
import { cn } from "./cn";
import { InfoTip } from "./info-tip";

export interface PageHeaderProps {
  title: React.ReactNode;
  /** Explanation shown in an InfoTip next to the title. */
  info?: React.ReactNode;
  /** One short line under the title — use sparingly. */
  description?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  /** Render as an in-page section heading (h2) instead of the page title. */
  level?: 1 | 2;
}

export function PageHeader({
  title,
  info,
  description,
  meta,
  actions,
  children,
  className,
  level = 1,
}: PageHeaderProps) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <div className={cn("flex flex-col gap-3", level === 1 ? "mb-5" : "mb-3", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Heading
              className={cn(
                "font-semibold tracking-tight text-foreground",
                level === 1 ? "text-xl" : "text-lg"
              )}
            >
              {title}
            </Heading>
            {info && <InfoTip size={level === 1 ? "md" : "sm"}>{info}</InfoTip>}
            {meta}
          </div>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
