"use client";

// Segmented control for the generated email's TEXT MODE (email-text-mode.mjs):
// Ausführlich (long-form) / Kompakt (short, image-first — default for new
// drafts) / Minimal (greeting + one sentence). Used by the per-customer email
// composer, the bulk-draft bar and the campaign review card — one widget, one
// vocabulary, built on the shared SegmentedControl primitive.

import {
  EMAIL_TEXT_MODES,
  EMAIL_TEXT_MODE_LABELS,
  EMAIL_TEXT_MODE_HINTS,
} from "@/lib/email-text-mode.mjs";
import { SegmentedControl } from "./ui/segmented-control";

export type EmailTextModeValue = "detailed" | "compact" | "minimal";

const OPTIONS = EMAIL_TEXT_MODES.map((mode) => ({
  value: mode as EmailTextModeValue,
  label: EMAIL_TEXT_MODE_LABELS[mode],
  title: EMAIL_TEXT_MODE_HINTS[mode],
}));

export function EmailTextModeToggle({
  value,
  disabled,
  onSelect,
  size = "sm",
}: {
  value: EmailTextModeValue;
  disabled?: boolean;
  onSelect: (mode: EmailTextModeValue) => void;
  size?: "sm" | "md";
}) {
  return (
    <SegmentedControl
      label="Textmodus der E-Mail"
      value={value}
      onChange={onSelect}
      options={OPTIONS}
      disabled={disabled}
      size={size}
    />
  );
}
