"use client";

// IconButton — a Button that only shows an icon. The label is REQUIRED: it
// becomes the accessible name and (unless disabled) the hover/focus tooltip.

import * as React from "react";
import { Button, type ButtonProps } from "./button";
import { Tooltip, type FloatingSide } from "./info-tip";

export interface IconButtonProps extends Omit<ButtonProps, "children" | "aria-label"> {
  label: string;
  children: React.ReactNode;
  /** Set false to rely on aria-label only (e.g. inside a dense table). */
  tooltip?: boolean;
  tooltipSide?: FloatingSide;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    { label, tooltip = true, tooltipSide = "top", size = "icon", variant = "ghost", children, ...props },
    ref
  ) => {
    const button = (
      <Button ref={ref} aria-label={label} size={size} variant={variant} {...props}>
        {children}
      </Button>
    );
    if (!tooltip) return button;
    return (
      <Tooltip content={label} side={tooltipSide}>
        {button}
      </Tooltip>
    );
  }
);
IconButton.displayName = "IconButton";
