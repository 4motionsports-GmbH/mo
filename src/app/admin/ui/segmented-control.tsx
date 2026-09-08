"use client";

// SegmentedControl — a compact single-choice toggle (language DE/EN, text mode,
// preview width, list scope). Radio-group semantics with roving focus: Tab lands
// on the selected option, arrow keys move and select.

import * as React from "react";
import { cn } from "./cn";

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
  /** Native tooltip for icon-only options. */
  title?: string;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  /** Accessible name of the group, e.g. "Sprache". */
  label: string;
  size?: "sm" | "md";
  fullWidth?: boolean;
  disabled?: boolean;
  className?: string;
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "sm",
  fullWidth = false,
  disabled = false,
  className,
}: SegmentedControlProps<T>) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const enabled = options.filter((o) => !o.disabled);
    if (enabled.length === 0) return;
    const index = enabled.findIndex((o) => o.value === value);
    let next = index;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % enabled.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (index - 1 + enabled.length) % enabled.length;
    else if (e.key === "Home") next = 0;
    else next = enabled.length - 1;
    e.preventDefault();
    const target = enabled[next];
    onChange(target.value);
    const el = e.currentTarget.querySelector<HTMLButtonElement>(`[data-value="${target.value}"]`);
    el?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      className={cn(
        "inline-flex items-center rounded-md border border-border bg-surface-2 p-0.5",
        fullWidth && "flex w-full",
        disabled && "opacity-50",
        className
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const isDisabled = disabled || option.disabled;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={typeof option.label === "string" ? undefined : option.title}
            title={option.title}
            data-value={option.value}
            disabled={isDisabled}
            tabIndex={selected ? 0 : -1}
            onClick={() => !selected && onChange(option.value)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[5px] font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:cursor-not-allowed disabled:opacity-50",
              size === "sm" ? "h-7 px-2.5 text-xs [&_svg]:size-3.5" : "h-8 px-3 text-sm [&_svg]:size-4",
              fullWidth && "flex-1",
              selected
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
