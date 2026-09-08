// Button — shadcn-style, themed via design tokens. Copy-in (no Radix dep).
// `loading` disables the button and shows a spinner in front of the label so
// call sites don't hand-roll "…" states.

import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "./cn";

type Variant =
  | "default"
  | "secondary"
  | "outline"
  | "ghost"
  | "destructive"
  | "accent"
  | "link";
type Size = "default" | "sm" | "xs" | "lg" | "icon" | "icon-sm";

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";

const variants: Record<Variant, string> = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary:
    "bg-secondary text-secondary-foreground border border-border hover:bg-secondary/80",
  outline:
    "border border-input bg-card text-foreground hover:bg-secondary hover:text-secondary-foreground",
  ghost: "text-foreground hover:bg-secondary hover:text-secondary-foreground",
  destructive:
    "bg-destructive text-destructive-foreground hover:bg-destructive/90",
  accent: "bg-accent text-accent-foreground hover:bg-accent/90",
  link: "text-accent underline-offset-4 hover:underline",
};

const sizes: Record<Size, string> = {
  default: "h-9 px-4 py-2",
  sm: "h-8 px-3 text-xs gap-1.5 [&_svg]:size-3.5",
  xs: "h-7 px-2.5 text-xs gap-1.5 [&_svg]:size-3.5",
  lg: "h-10 px-6",
  icon: "h-9 w-9",
  "icon-sm": "h-7 w-7 [&_svg]:size-3.5",
};

export function buttonVariants({
  variant = "default",
  size = "default",
}: { variant?: Variant; size?: Size } = {}): string {
  return cn(base, variants[variant], sizes[size]);
}

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Disables the button and shows a spinner before the label. */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type, loading = false, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {loading && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </button>
  )
);
Button.displayName = "Button";
