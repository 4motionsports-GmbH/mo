"use client";

// Sheet — a side drawer for the detail pane on narrow screens (tablet) and for
// secondary editors. Same overlay behaviour as Dialog (portal, Esc, overlay
// click, focus trap + return, scroll lock) anchored to the right edge.

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "./cn";
import { useFocusTrap } from "./focus";
import { getPortalContainer } from "./portal";

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Header actions left of the close button. */
  actions?: React.ReactNode;
  side?: "right" | "left";
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  children: React.ReactNode;
}

const sizes = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl",
} as const;

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  actions,
  side = "right",
  size = "md",
  className,
  children,
}: SheetProps) {
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const titleId = React.useId();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  useFocusTrap(panelRef, open && mounted);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onOpenChange]);

  const container = getPortalContainer();
  if (!mounted || !open || !container) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => onOpenChange(false)} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cn(
          "absolute inset-y-0 flex w-full flex-col border-border bg-popover text-popover-foreground shadow-xl outline-none",
          side === "right" ? "right-0 border-l" : "left-0 border-r",
          sizes[size],
          className
        )}
      >
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            {title && (
              <h2 id={titleId} className="text-base font-semibold leading-tight tracking-tight">
                {title}
              </h2>
            )}
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          {actions}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Schließen"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>,
    container
  );
}
