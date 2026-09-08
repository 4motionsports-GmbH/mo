// Kbd — keyboard key hint.

import * as React from "react";
import { cn } from "./cn";

export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-surface-2 px-1 font-sans text-2xs font-medium text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}
