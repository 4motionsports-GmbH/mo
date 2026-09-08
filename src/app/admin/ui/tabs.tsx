"use client";

// Tabs — minimal controlled/uncontrolled tabs (no Radix) with roving focus
// (Tab lands on the active tab; ←/→/Home/End move AND select). Two looks:
// `pill` (segmented, default) and `underline` (in-page sub-navigation).
// TabsContent supports `forceMount` so panels can stay mounted (and keep their
// React state) while hidden.

import * as React from "react";
import { cn } from "./cn";

type TabsVariant = "pill" | "underline";

interface TabsContextValue {
  value: string;
  setValue: (v: string) => void;
}
const TabsContext = React.createContext<TabsContextValue | null>(null);
const TabsVariantContext = React.createContext<TabsVariant>("pill");

function useTabs(): TabsContextValue {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error("Tabs components must be used within <Tabs>");
  return ctx;
}

export interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
}

export function Tabs({
  value: controlled,
  defaultValue,
  onValueChange,
  className,
  children,
  ...props
}: TabsProps) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue ?? "");
  const value = controlled ?? uncontrolled;
  const setValue = React.useCallback(
    (v: string) => {
      if (controlled === undefined) setUncontrolled(v);
      onValueChange?.(v);
    },
    [controlled, onValueChange]
  );
  return (
    <TabsContext.Provider value={{ value, setValue }}>
      <div className={className} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

const KEYS = ["ArrowRight", "ArrowLeft", "Home", "End"];

function onListKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
  if (!KEYS.includes(e.key)) return;
  const tabs = Array.from(
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])')
  );
  if (tabs.length === 0) return;
  const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
  let next = index;
  if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
  else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
  else if (e.key === "Home") next = 0;
  else next = tabs.length - 1;
  e.preventDefault();
  tabs[next].focus();
  tabs[next].click();
}

export interface TabsListProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: TabsVariant;
}

export function TabsList({ className, variant = "pill", ...props }: TabsListProps) {
  return (
    <TabsVariantContext.Provider value={variant}>
      <div
        role="tablist"
        onKeyDown={onListKeyDown}
        className={cn(
          variant === "pill"
            ? "inline-flex items-center gap-1 rounded-full border border-border bg-secondary p-1"
            : "flex items-end gap-1 border-b border-border",
          className
        )}
        {...props}
      />
    </TabsVariantContext.Provider>
  );
}

export interface TabsTriggerProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
  /** Small count/badge right of the label. */
  badge?: React.ReactNode;
}

export function TabsTrigger({
  value,
  className,
  badge,
  children,
  ...props
}: TabsTriggerProps) {
  const { value: active, setValue } = useTabs();
  const variant = React.useContext(TabsVariantContext);
  const selected = active === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      data-state={selected ? "active" : "inactive"}
      onClick={() => setValue(value)}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        variant === "pill"
          ? cn(
              "rounded-full px-4 py-1.5",
              selected
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )
          : cn(
              "-mb-px rounded-t-md border-b-2 px-3 py-2",
              selected
                ? "border-accent text-foreground"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
            ),
        className
      )}
      {...props}
    >
      {children}
      {badge !== undefined && badge !== null && (
        <span
          className={cn(
            "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-2xs font-semibold tabular-nums",
            variant === "pill" && selected
              ? "bg-primary-foreground/20 text-primary-foreground"
              : "bg-surface-2 text-muted-foreground"
          )}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

export interface TabsContentProps
  extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
  forceMount?: boolean;
}

export function TabsContent({
  value,
  forceMount,
  className,
  ...props
}: TabsContentProps) {
  const { value: active } = useTabs();
  const selected = active === value;
  if (!selected && !forceMount) return null;
  return (
    <div
      role="tabpanel"
      hidden={!selected}
      data-state={selected ? "active" : "inactive"}
      className={cn("focus-visible:outline-none", className)}
      {...props}
    />
  );
}
