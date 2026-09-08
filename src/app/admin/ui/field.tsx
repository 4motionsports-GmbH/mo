"use client";

// Field — label + control + InfoTip + hint + error, with the ids wired up
// (`htmlFor`, `aria-describedby`, `aria-invalid`). Pass exactly one control as
// the child; it receives the generated id when it has none.

import * as React from "react";
import { cn } from "./cn";
import { InfoTip } from "./info-tip";
import { Label } from "./label";

export interface FieldProps {
  label: React.ReactNode;
  /** Explanation shown in an InfoTip next to the label. */
  info?: React.ReactNode;
  /** One short line under the control. */
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  /** Use the control's own id instead of a generated one. */
  htmlFor?: string;
  /** Label and control side by side (checkbox rows, compact forms). */
  inline?: boolean;
  /** Right-aligned slot in the label row (a counter, a small action). */
  labelEnd?: React.ReactNode;
  className?: string;
  children: React.ReactElement<{
    id?: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean | "true" | "false";
  }>;
}

export function Field({
  label,
  info,
  hint,
  error,
  required,
  htmlFor,
  inline = false,
  labelEnd,
  className,
  children,
}: FieldProps) {
  const generated = React.useId();
  const id = htmlFor ?? children.props.id ?? generated;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [children.props["aria-describedby"], errorId, hintId].filter(Boolean).join(" ") || undefined;

  const control = React.cloneElement(children, {
    id,
    "aria-describedby": describedBy,
    "aria-invalid": error ? true : children.props["aria-invalid"],
  });

  const labelNode = (
    <div className={cn("flex items-center gap-1.5", !inline && "justify-between")}>
      <span className="flex items-center gap-1.5">
        <Label htmlFor={id} className="text-xs">
          {label}
          {required && (
            <span className="ml-0.5 text-destructive" aria-hidden>
              *
            </span>
          )}
        </Label>
        {info && <InfoTip>{info}</InfoTip>}
      </span>
      {labelEnd}
    </div>
  );

  return (
    <div className={cn(inline ? "flex flex-row-reverse items-center justify-start gap-2" : "flex flex-col gap-1.5", className)}>
      {labelNode}
      {control}
      {(error || hint) && !inline && (
        <div className="flex flex-col gap-0.5">
          {error && (
            <p id={errorId} className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
          {hint && (
            <p id={hintId} className="text-xs text-muted-foreground">
              {hint}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
