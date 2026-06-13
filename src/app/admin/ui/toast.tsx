"use client";

// Toast / Toaster — minimal toast system (no Radix/sonner). A module-level store
// lets any client component call `toast(...)` without threading a context, while
// a single <Toaster /> (mounted once in the admin shell) renders the stack.

import * as React from "react";
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from "lucide-react";
import { cn } from "./cn";

export type ToastVariant = "default" | "success" | "warning" | "error" | "info";

export interface ToastOptions {
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: ToastVariant;
  /** Auto-dismiss after this many ms (default 4000; 0 disables). */
  duration?: number;
}

interface ToastRecord extends ToastOptions {
  id: number;
}

type Listener = (toasts: ToastRecord[]) => void;

let toasts: ToastRecord[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l([...toasts]);
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** Show a toast. Returns the toast id (so it can be dismissed early). */
export function toast(options: ToastOptions): number {
  const id = nextId++;
  const record: ToastRecord = { duration: 4000, variant: "default", ...options, id };
  toasts = [...toasts, record];
  emit();
  if (record.duration && record.duration > 0) {
    setTimeout(() => dismiss(id), record.duration);
  }
  return id;
}

toast.dismiss = dismiss;

/** Update an existing toast in place (e.g. a live progress counter). No-op if the
 * toast was already dismissed. Pass `duration: 0` on create to keep it pinned. */
function update(id: number, options: ToastOptions): void {
  let changed = false;
  toasts = toasts.map((t) => (t.id === id ? ((changed = true), { ...t, ...options }) : t));
  if (changed) emit();
}

toast.update = update;

function useToasts(): ToastRecord[] {
  const [state, setState] = React.useState<ToastRecord[]>(toasts);
  React.useEffect(() => {
    listeners.add(setState);
    setState([...toasts]);
    return () => {
      listeners.delete(setState);
    };
  }, []);
  return state;
}

const variantStyles: Record<ToastVariant, string> = {
  default: "border-border bg-popover text-popover-foreground",
  success: "border-success/40 bg-popover text-popover-foreground",
  warning: "border-warning/40 bg-popover text-popover-foreground",
  error: "border-destructive/40 bg-popover text-popover-foreground",
  info: "border-info/40 bg-popover text-popover-foreground",
};

const variantIcon: Record<ToastVariant, React.ReactNode> = {
  default: null,
  success: <CheckCircle2 className="size-4 text-success" />,
  warning: <AlertTriangle className="size-4 text-warning" />,
  error: <XCircle className="size-4 text-destructive" />,
  info: <Info className="size-4 text-info" />,
};

export function Toaster() {
  const items = useToasts();
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
      role="region"
      aria-label="Benachrichtigungen"
    >
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            "pointer-events-auto flex items-start gap-3 rounded-lg border p-3 shadow-lg",
            variantStyles[t.variant ?? "default"]
          )}
        >
          {variantIcon[t.variant ?? "default"]}
          <div className="flex-1 text-sm">
            {t.title && <div className="font-semibold leading-tight">{t.title}</div>}
            {t.description && (
              <div className="mt-0.5 text-muted-foreground">{t.description}</div>
            )}
          </div>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            className="rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Schließen"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
