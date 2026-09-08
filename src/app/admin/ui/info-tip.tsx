"use client";

// InfoTip + Tooltip — the ONE explanation primitive of the admin UI.
//
// InfoTip replaces helper paragraphs: a small (i) that reveals the original
// explanation text on hover, on keyboard focus and on click/tap (click pins the
// panel open until Esc, an outside click or a second click). Tooltip is the
// same positioning engine for icon buttons (hover/focus only, short text).
//
// Both render the floating panel through a portal into #admin-root (so dark
// mode tokens apply), position it viewport-aware (flip top/bottom, clamp to the
// viewport horizontally) and use `position: fixed`, so they work inside
// scrolling panes and sticky rails.

import * as React from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { cn } from "./cn";
import { getPortalContainer } from "./portal";

export type FloatingSide = "top" | "bottom";

interface FloatingPosition {
  top: number;
  left: number;
  side: FloatingSide;
  arrowLeft: number;
}

const GAP = 8;
const MARGIN = 8;

function computePosition(
  trigger: DOMRect,
  panel: { width: number; height: number },
  preferred: FloatingSide
): FloatingPosition {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const spaceBelow = vh - trigger.bottom;
  const spaceAbove = trigger.top;
  let side = preferred;
  const needed = panel.height + GAP + MARGIN;
  if (preferred === "bottom" && spaceBelow < needed && spaceAbove > spaceBelow) side = "top";
  if (preferred === "top" && spaceAbove < needed && spaceBelow > spaceAbove) side = "bottom";
  const top = side === "bottom" ? trigger.bottom + GAP : trigger.top - panel.height - GAP;
  const centre = trigger.left + trigger.width / 2;
  const maxLeft = Math.max(MARGIN, vw - panel.width - MARGIN);
  const left = Math.min(Math.max(MARGIN, centre - panel.width / 2), maxLeft);
  const arrowLeft = Math.min(Math.max(12, centre - left), Math.max(12, panel.width - 12));
  return { top, left, side, arrowLeft };
}

function useFloatingPanel(open: boolean, preferred: FloatingSide) {
  const triggerRef = React.useRef<HTMLElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = React.useState<FloatingPosition | null>(null);

  React.useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const t = triggerRef.current;
      const p = panelRef.current;
      if (!t || !p) return;
      setPos(
        computePosition(
          t.getBoundingClientRect(),
          { width: p.offsetWidth, height: p.offsetHeight },
          preferred
        )
      );
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      setPos(null);
    };
  }, [open, preferred]);

  return { triggerRef, panelRef, pos };
}

function FloatingPanel({
  id,
  role,
  pos,
  panelRef,
  className,
  children,
  onMouseEnter,
  onMouseLeave,
}: {
  id: string;
  role: "tooltip" | "dialog";
  pos: FloatingPosition | null;
  panelRef: React.RefObject<HTMLDivElement | null>;
  className?: string;
  children: React.ReactNode;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const container = getPortalContainer();
  if (!container) return null;
  return createPortal(
    <div
      id={id}
      role={role}
      ref={panelRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={
        pos
          ? { position: "fixed", top: pos.top, left: pos.left }
          : { position: "fixed", top: 0, left: 0, visibility: "hidden" }
      }
      className={cn("z-[70] outline-none", className)}
    >
      {children}
    </div>,
    container
  );
}

// ─── InfoTip ─────────────────────────────────────────────────────────────────

export interface InfoTipProps {
  /** The explanation (plain text or small markup). */
  children: React.ReactNode;
  /** Accessible name of the trigger (default "Erklärung anzeigen"). */
  label?: string;
  side?: FloatingSide;
  size?: "sm" | "md";
  className?: string;
  /** Extra classes for the panel (e.g. a wider max-width). */
  panelClassName?: string;
}

export function InfoTip({
  children,
  label = "Erklärung anzeigen",
  side = "bottom",
  size = "sm",
  className,
  panelClassName,
}: InfoTipProps) {
  const id = React.useId();
  const [open, setOpen] = React.useState(false);
  const [pinned, setPinned] = React.useState(false);
  const timer = React.useRef<number | null>(null);
  const { triggerRef, panelRef, pos } = useFloatingPanel(open, side);

  const clearTimer = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const showSoon = () => {
    clearTimer();
    timer.current = window.setTimeout(() => setOpen(true), 120);
  };
  const hideUnlessPinned = () => {
    clearTimer();
    if (!pinned) setOpen(false);
  };
  const close = React.useCallback(() => {
    setOpen(false);
    setPinned(false);
  }, []);

  React.useEffect(() => clearTimer, []);

  // Esc and outside clicks close a pinned panel and return focus to the (i).
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      close();
      triggerRef.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, close, triggerRef, panelRef]);

  return (
    <>
      <button
        type="button"
        ref={triggerRef as React.RefObject<HTMLButtonElement>}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-describedby={open ? id : undefined}
        onMouseEnter={showSoon}
        onMouseLeave={hideUnlessPinned}
        onFocus={() => setOpen(true)}
        onBlur={hideUnlessPinned}
        onClick={() => {
          clearTimer();
          if (open && pinned) {
            close();
          } else {
            setOpen(true);
            setPinned(true);
          }
        }}
        className={cn(
          "inline-flex shrink-0 cursor-help items-center justify-center rounded-full align-middle text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          size === "sm" ? "size-4" : "size-5",
          pinned && "text-foreground",
          className
        )}
      >
        <Info className={size === "sm" ? "size-3.5" : "size-4"} aria-hidden />
      </button>
      {open && (
        <FloatingPanel
          id={id}
          role="tooltip"
          pos={pos}
          panelRef={panelRef}
          onMouseEnter={clearTimer}
          onMouseLeave={hideUnlessPinned}
          className={cn(
            "max-w-xs rounded-lg border border-border bg-popover px-3 py-2.5 text-xs font-normal leading-relaxed text-popover-foreground shadow-md [&_a]:text-accent [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_p+p]:mt-1.5",
            panelClassName
          )}
        >
          {children}
        </FloatingPanel>
      )}
    </>
  );
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement<{ "aria-describedby"?: string }>;
  side?: FloatingSide;
  disabled?: boolean;
  delay?: number;
  className?: string;
}

/**
 * Short hover/focus label for a control (icon buttons). The child keeps its own
 * handlers and `aria-label`; the tooltip wraps it in an inline-flex span that
 * listens for hover/focus (focus events bubble) and adds `aria-describedby`.
 */
export function Tooltip({
  content,
  children,
  side = "top",
  disabled,
  delay = 300,
  className,
}: TooltipProps) {
  const id = React.useId();
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef<number | null>(null);
  const { triggerRef, panelRef, pos } = useFloatingPanel(open && !disabled, side);

  const clearTimer = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };
  React.useEffect(() => clearTimer, []);

  const show = () => {
    clearTimer();
    timer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    clearTimer();
    setOpen(false);
  };

  const visible = open && !disabled;
  const child = visible
    ? React.cloneElement(children, { "aria-describedby": id })
    : children;

  return (
    <>
      <span
        ref={triggerRef as React.RefObject<HTMLSpanElement>}
        className={cn("inline-flex", className)}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={() => {
          clearTimer();
          setOpen(true);
        }}
        onBlur={hide}
        onPointerDown={hide}
      >
        {child}
      </span>
      {visible && (
        <FloatingPanel
          id={id}
          role="tooltip"
          pos={pos}
          panelRef={panelRef}
          className="pointer-events-none max-w-[240px] rounded-md bg-foreground px-2 py-1 text-xs font-medium leading-snug text-background shadow-md"
        >
          {content}
        </FloatingPanel>
      )}
    </>
  );
}
