// Spinner — inline loading indicator. Pass `label` for a screen-reader text
// when the spinner stands alone (not next to visible "Lädt…" copy).

import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "./cn";

export function Spinner({
  size = "sm",
  label,
  className,
}: {
  size?: "xs" | "sm" | "md" | "lg";
  label?: string;
  className?: string;
}) {
  const sizes = { xs: "size-3", sm: "size-4", md: "size-5", lg: "size-8" } as const;
  return (
    <span role={label ? "status" : undefined} className={cn("inline-flex items-center", className)}>
      <Loader2 className={cn("animate-spin text-muted-foreground", sizes[size])} aria-hidden />
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}
