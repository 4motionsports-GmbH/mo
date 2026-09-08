// DescriptionList — label/value pairs (profile facts, send metadata).

import * as React from "react";
import { cn } from "./cn";
import { InfoTip } from "./info-tip";

export function DescriptionList({
  columns = 1,
  className,
  ...props
}: React.HTMLAttributes<HTMLDListElement> & { columns?: 1 | 2 | 3 }) {
  const cols = { 1: "grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3" } as const;
  return <dl className={cn("grid gap-x-6 gap-y-3", cols[columns], className)} {...props} />;
}

export function DescriptionItem({
  label,
  info,
  children,
  className,
  valueClassName,
}: {
  label: React.ReactNode;
  info?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="flex items-center gap-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
        {info && <InfoTip>{info}</InfoTip>}
      </dt>
      <dd className={cn("mt-0.5 break-words text-sm text-foreground", valueClassName)}>{children}</dd>
    </div>
  );
}
