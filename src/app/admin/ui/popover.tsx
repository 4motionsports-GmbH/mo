"use client";

// Popover — a small anchored panel for a control group that does not deserve
// a dialog (the Vorbereiten settings, a custom value input). Controlled via
// `open`/`onOpenChange`; the trigger is any button element (cloned with the
// ARIA wiring). Positioned by the shared floating engine (portal into
// #admin-root, flip, clamp, follows scroll), closes on Esc and outside click,
// moves focus into the panel on open and back to the trigger on close.

import * as React from "react";
import { cn } from "./cn";
import { useFocusTrap } from "./focus";
import { FloatingPanel, useFloatingPanel, type FloatingAlign, type FloatingSide } from "./info-tip";

export interface PopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The opener — a button-like element; it receives the ARIA attributes. */
  trigger: React.ReactElement<{
    onClick?: (e: React.MouseEvent) => void;
    "aria-expanded"?: boolean;
    "aria-haspopup"?: React.AriaAttributes["aria-haspopup"];
    "aria-controls"?: string;
  }>;
  /** Accessible name of the panel. */
  label: string;
  side?: FloatingSide;
  align?: FloatingAlign;
  className?: string;
  children: React.ReactNode;
}

export function Popover({
  open,
  onOpenChange,
  trigger,
  label,
  side = "bottom",
  align = "center",
  className,
  children,
}: PopoverProps) {
  const id = React.useId();
  const { triggerRef, panelRef, pos } = useFloatingPanel(open, side, align);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  useFocusTrap(panelRef, open && mounted);

  const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
      triggerRef.current?.querySelector<HTMLElement>("button, [tabindex]")?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, close, triggerRef, panelRef]);

  // The trigger keeps its own handlers; the wrapper span is the measured
  // anchor (like Tooltip), so no ref has to be threaded into the child.
  const triggerEl = React.cloneElement(trigger, {
    "aria-expanded": open,
    "aria-haspopup": "dialog",
    "aria-controls": open ? id : undefined,
    onClick: (e: React.MouseEvent) => {
      trigger.props.onClick?.(e);
      onOpenChange(!open);
    },
  });

  return (
    <>
      <span ref={triggerRef as React.RefObject<HTMLSpanElement>} className="inline-flex">
        {triggerEl}
      </span>
      {open && (
        <FloatingPanel
          id={id}
          role="dialog"
          ariaLabel={label}
          pos={pos}
          panelRef={panelRef}
          className={cn(
            "w-[min(22rem,calc(100vw-1rem))] rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-lg",
            className
          )}
        >
          {children}
        </FloatingPanel>
      )}
    </>
  );
}
