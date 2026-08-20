"use client";

// Segmented control for the generated email's TEXT MODE (email-text-mode.mjs):
// Ausführlich (long-form) / Kompakt (short, image-first — default for new
// drafts) / Minimal (greeting + one sentence). Used by the per-customer email
// composer, the bulk-draft bar and the campaign review card — one widget, one
// vocabulary. Patterned after the Kampagne LanguageToggle.

import {
  EMAIL_TEXT_MODES,
  EMAIL_TEXT_MODE_LABELS,
  EMAIL_TEXT_MODE_HINTS,
} from "@/lib/email-text-mode.mjs";

export type EmailTextModeValue = "detailed" | "compact" | "minimal";

export function EmailTextModeToggle({
  value,
  disabled,
  onSelect,
}: {
  value: EmailTextModeValue;
  disabled?: boolean;
  onSelect: (mode: EmailTextModeValue) => void;
}) {
  return (
    <div
      className="inline-flex overflow-hidden rounded-md border border-border text-xs"
      role="group"
      aria-label="Textmodus der E-Mail"
    >
      {EMAIL_TEXT_MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          disabled={disabled || value === mode}
          onClick={() => onSelect(mode as EmailTextModeValue)}
          title={EMAIL_TEXT_MODE_HINTS[mode]}
          className={
            value === mode
              ? "bg-primary px-2 py-0.5 font-semibold text-primary-foreground"
              : "px-2 py-0.5 text-muted-foreground hover:bg-muted disabled:opacity-50"
          }
        >
          {EMAIL_TEXT_MODE_LABELS[mode]}
        </button>
      ))}
    </div>
  );
}
