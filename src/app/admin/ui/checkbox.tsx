// Checkbox — themed native <input type="checkbox">. A styled native control (no
// custom widget) so keyboard + ARIA behavior come for free; `indeterminate` is a
// DOM-only property, so it's mirrored onto the element via a ref. Used by the
// Marketing tab's bulk-select toolbar.

import * as React from "react";
import { cn } from "./cn";

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Tri-state visual: a master "select all" that's partially selected. */
  indeterminate?: boolean;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, indeterminate = false, ...props }, forwardedRef) => {
    const innerRef = React.useRef<HTMLInputElement>(null);

    // Keep the forwarded ref and our inner ref in sync so we can set the
    // DOM-only `indeterminate` flag.
    React.useImperativeHandle(forwardedRef, () => innerRef.current as HTMLInputElement);

    React.useEffect(() => {
      if (innerRef.current) innerRef.current.indeterminate = indeterminate;
    }, [indeterminate]);

    return (
      <input
        ref={innerRef}
        type="checkbox"
        className={cn(
          "size-4 shrink-0 cursor-pointer rounded border-input bg-card text-accent shadow-sm",
          "accent-[var(--accent)] transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
    );
  }
);
Checkbox.displayName = "Checkbox";
