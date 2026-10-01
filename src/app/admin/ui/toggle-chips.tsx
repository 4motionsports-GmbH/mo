"use client";

// ToggleChips — a multi-choice row of pressable chips (audience builder,
// Kunden filters). Native buttons with aria-pressed, so keyboard and screen
// readers get the toggle semantics for free. For a SINGLE choice use
// SegmentedControl.

import * as React from "react";
import { cn } from "./cn";

export interface ToggleChipOption<T extends string> {
  value: T;
  label: React.ReactNode;
}

export interface ToggleChipsProps<T extends string> {
  /** Accessible name of the group. */
  label: string;
  options: readonly ToggleChipOption<T>[];
  value: readonly T[];
  onChange: (value: T[]) => void;
  disabled?: boolean;
  className?: string;
}

export function ToggleChips<T extends string>({ label, options, value, onChange, disabled, className }: ToggleChipsProps<T>) {
  return (
    <div role="group" aria-label={label} className={cn("flex flex-wrap gap-1.5", className)}>
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
            className={cn(
              "inline-flex h-7 items-center rounded-md border px-2.5 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
              on
                ? "border-accent bg-accent-soft text-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-surface-2 hover:text-foreground"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
