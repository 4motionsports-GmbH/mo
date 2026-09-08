"use client";

// Focus management shared by the overlay primitives (Dialog, Sheet). Keeps Tab
// inside the open panel, moves focus in on open and returns it to the element
// that had it before the overlay opened.

import * as React from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
  'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("hidden") && el.getAttribute("aria-hidden") !== "true"
  );
}

/**
 * Trap keyboard focus inside `ref` while `active`. On activation the first
 * `[autofocus]` / `[data-autofocus]` element (or the first focusable one, or the
 * panel itself) receives focus; on deactivation focus returns to the previously
 * focused element. The panel should carry `tabIndex={-1}` so it can hold focus
 * when it has no focusable children.
 */
export function useFocusTrap(ref: React.RefObject<HTMLElement | null>, active: boolean): void {
  React.useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const previous = document.activeElement as HTMLElement | null;
    const initial =
      root.querySelector<HTMLElement>("[autofocus], [data-autofocus]") ??
      getFocusable(root)[0] ??
      root;
    // Defer one frame so the panel is laid out before focusing (no scroll jump).
    const raf = requestAnimationFrame(() => initial.focus({ preventScroll: true }));

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = getFocusable(root);
      if (items.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement as HTMLElement | null;
      const inside = current ? root.contains(current) : false;
      if (e.shiftKey && (current === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (current === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [ref, active]);
}
