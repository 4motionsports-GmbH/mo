"use client";

// Menu — an overflow menu („⋯“) for secondary actions: one trigger, a list of
// items with optional icon, shortcut hint and destructive tone. Roving-focus
// menu semantics (Arrow keys, Home/End, Enter/Space, Esc, type-ahead is not
// needed at this size); positioned by the shared floating engine, closes on
// outside click and after an item ran.

import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "./cn";
import { IconButton } from "./icon-button";
import { FloatingPanel, useFloatingPanel, type FloatingAlign, type FloatingSide } from "./info-tip";
import { Kbd } from "./kbd";

export interface MenuItem {
  key: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** Keyboard hint shown right of the label (the screen owns the binding). */
  shortcut?: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Tooltip-like reason shown as the item's description while disabled. */
  disabledReason?: string;
  tone?: "default" | "destructive";
  /** Hairline above this item. */
  separatorBefore?: boolean;
}

export interface MenuProps {
  /** Accessible name of the trigger and the menu. */
  label: string;
  items: MenuItem[];
  /** Custom trigger; defaults to a „⋯“ icon button. */
  trigger?: React.ReactElement<{
    onClick?: (e: React.MouseEvent) => void;
    "aria-expanded"?: boolean;
    "aria-haspopup"?: React.AriaAttributes["aria-haspopup"];
    "aria-controls"?: string;
  }>;
  side?: FloatingSide;
  align?: FloatingAlign;
  size?: "sm" | "md";
  className?: string;
}

export function Menu({
  label,
  items,
  trigger,
  side = "bottom",
  align = "end",
  size = "md",
  className,
}: MenuProps) {
  const id = React.useId();
  const [open, setOpen] = React.useState(false);
  const { triggerRef, panelRef, pos } = useFloatingPanel(open, side, align);

  const close = React.useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.querySelector<HTMLElement>("button, [tabindex]")?.focus();
  }, [triggerRef]);

  const itemEls = () =>
    Array.from(
      panelRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? []
    );

  // Focus the first item once the panel is positioned.
  React.useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => itemEls()[0]?.focus());
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open, triggerRef, panelRef]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const els = itemEls();
    const index = els.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      els[(index + 1) % els.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      els[(index - 1 + els.length) % els.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      els[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      els[els.length - 1]?.focus();
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  const triggerNode = trigger ?? (
    <IconButton label={label} variant="outline" size={size === "sm" ? "icon-sm" : "icon"} tooltip={false}>
      <MoreHorizontal />
    </IconButton>
  );
  const triggerEl = React.cloneElement(triggerNode, {
    "aria-expanded": open,
    "aria-haspopup": "menu",
    "aria-controls": open ? id : undefined,
    onClick: (e: React.MouseEvent) => {
      triggerNode.props.onClick?.(e);
      setOpen((v) => !v);
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
          role="menu"
          ariaLabel={label}
          pos={pos}
          panelRef={panelRef}
          onKeyDown={onKeyDown}
          className={cn(
            "min-w-[12rem] max-w-[min(20rem,calc(100vw-1rem))] rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg",
            className
          )}
        >
          {items.map((item) => (
            <React.Fragment key={item.key}>
              {item.separatorBefore && <div className="my-1 border-t border-border" role="separator" />}
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                title={undefined}
                onClick={() => {
                  close();
                  item.onSelect();
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                  item.tone === "destructive"
                    ? "text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10"
                    : "text-foreground hover:bg-secondary focus-visible:bg-secondary"
                )}
              >
                {item.icon && (
                  <span className="inline-flex shrink-0 text-muted-foreground [&_svg]:size-4" aria-hidden>
                    {item.icon}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{item.label}</span>
                  {item.disabled && item.disabledReason && (
                    <span className="block truncate text-2xs text-muted-foreground">{item.disabledReason}</span>
                  )}
                </span>
                {item.shortcut && <Kbd className="ml-2">{item.shortcut}</Kbd>}
              </button>
            </React.Fragment>
          ))}
        </FloatingPanel>
      )}
    </>
  );
}
