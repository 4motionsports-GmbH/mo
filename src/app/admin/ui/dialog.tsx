"use client";

// Dialog — minimal modal (no Radix). Controlled via `open`/`onOpenChange`.
// Renders an overlay + centered panel in a portal, closes on Esc / overlay
// click, locks body scroll while open, traps Tab focus inside the panel and
// returns focus to the opener on close. Sizes: sm · md (default) · lg · xl · full.

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "./cn";
import { useFocusTrap } from "./focus";
import { getPortalContainer } from "./portal";

interface DialogContextValue {
  open: boolean;
  setOpen: (v: boolean) => void;
  titleId: string;
  descriptionId: string;
}
const DialogContext = React.createContext<DialogContextValue | null>(null);

export interface DialogProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (v: boolean) => void;
  children: React.ReactNode;
}

export function Dialog({ open: controlled, defaultOpen, onOpenChange, children }: DialogProps) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultOpen ?? false);
  const open = controlled ?? uncontrolled;
  const setOpen = React.useCallback(
    (v: boolean) => {
      if (controlled === undefined) setUncontrolled(v);
      onOpenChange?.(v);
    },
    [controlled, onOpenChange]
  );
  const titleId = React.useId();
  const descriptionId = React.useId();
  return (
    <DialogContext.Provider value={{ open, setOpen, titleId, descriptionId }}>
      {children}
    </DialogContext.Provider>
  );
}

function useDialog(): DialogContextValue {
  const ctx = React.useContext(DialogContext);
  if (!ctx) throw new Error("Dialog components must be used within <Dialog>");
  return ctx;
}

export function DialogTrigger({
  children,
  asChild,
}: {
  children: React.ReactElement<{ onClick?: (e: React.MouseEvent) => void }>;
  asChild?: boolean;
}) {
  const { setOpen } = useDialog();
  // asChild kept for API parity; we always clone the single child.
  void asChild;
  return React.cloneElement(children, {
    onClick: (e: React.MouseEvent) => {
      children.props.onClick?.(e);
      setOpen(true);
    },
  });
}

export function DialogClose({
  children,
}: {
  children: React.ReactElement<{ onClick?: (e: React.MouseEvent) => void }>;
}) {
  const { setOpen } = useDialog();
  return React.cloneElement(children, {
    onClick: (e: React.MouseEvent) => {
      children.props.onClick?.(e);
      setOpen(false);
    },
  });
}

export type DialogSize = "sm" | "md" | "lg" | "xl" | "full";

const sizes: Record<DialogSize, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
  full: "max-w-[min(96vw,1200px)]",
};

export function DialogContent({
  className,
  children,
  showClose = true,
  size = "md",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { showClose?: boolean; size?: DialogSize }) {
  const { open, setOpen, titleId, descriptionId } = useDialog();
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  useFocusTrap(panelRef, open && mounted);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, setOpen]);

  const container = getPortalContainer();
  if (!mounted || !open || !container) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => setOpen(false)}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className={cn(
          "relative z-10 max-h-[calc(100vh-2rem)] w-full overflow-y-auto rounded-xl border border-border bg-popover p-6 text-popover-foreground shadow-lg outline-none",
          sizes[size],
          className
        )}
        {...props}
      >
        {children}
        {showClose && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Schließen"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
    </div>,
    container
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 pr-6", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  const { titleId } = useDialog();
  return (
    <h2
      id={titleId}
      className={cn("text-lg font-semibold leading-none tracking-tight", className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  const { descriptionId } = useDialog();
  return <p id={descriptionId} className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}
