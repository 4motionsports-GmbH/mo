"use client";

// SearchInput — text search with a leading icon, a clear button and an
// optional keyboard-shortcut hint. Controlled (value / onValueChange).

import * as React from "react";
import { Search, X } from "lucide-react";
import { cn } from "./cn";
import { Kbd } from "./kbd";

export interface SearchInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "size"> {
  value: string;
  onValueChange: (value: string) => void;
  /** Shown at the right edge while the field is empty, e.g. "/" */
  shortcut?: string;
  clearLabel?: string;
  size?: "sm" | "md";
  containerClassName?: string;
}

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  (
    {
      value,
      onValueChange,
      shortcut,
      clearLabel = "Suche löschen",
      size = "md",
      className,
      containerClassName,
      placeholder = "Suchen…",
      ...props
    },
    ref
  ) => {
    const innerRef = React.useRef<HTMLInputElement | null>(null);
    return (
      <div className={cn("relative flex items-center", containerClassName)}>
        <Search
          className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground"
          aria-hidden
        />
        <input
          ref={(node) => {
            innerRef.current = node;
            if (typeof ref === "function") ref(node);
            else if (ref) ref.current = node;
          }}
          type="text"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            "flex w-full rounded-md border border-input bg-card pl-8 text-foreground shadow-sm transition-colors",
            "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            size === "sm" ? "h-8 text-xs" : "h-9 text-sm",
            value || shortcut ? "pr-8" : "pr-3",
            className
          )}
          {...props}
        />
        {value ? (
          <button
            type="button"
            aria-label={clearLabel}
            onClick={() => {
              onValueChange("");
              innerRef.current?.focus();
            }}
            className="absolute right-1.5 inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        ) : shortcut ? (
          <Kbd className="pointer-events-none absolute right-2">{shortcut}</Kbd>
        ) : null}
      </div>
    );
  }
);
SearchInput.displayName = "SearchInput";
