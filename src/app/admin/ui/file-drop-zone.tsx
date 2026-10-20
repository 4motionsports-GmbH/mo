"use client";

// FileDropZone — pick ONE file by dragging it onto a dashed area or with the
// labelled „Datei wählen“ button over a hidden <input type="file">. Keyboard:
// Tab reaches the button, Enter/Space opens the file dialog.
//
// Disabled (e.g. a required choice is still missing) the button stays
// focusable (aria-disabled) so its Tooltip with the reason is reachable by
// keyboard too; a file dropped meanwhile is swallowed and the reason is shown
// in the zone. While the zone is mounted, a file dropped anywhere else on the
// page is swallowed as well — the browser would otherwise open it in place
// of the admin and the unsaved form would be lost. Busy, a spinner + label
// replace the prompt. Tokens only: dashed border-border on surface-2, accent
// while dragging.

import * as React from "react";
import { Upload } from "lucide-react";
import { Button } from "./button";
import { cn } from "./cn";
import { Tooltip } from "./info-tip";
import { Spinner } from "./spinner";

export interface FileDropZoneProps {
  /** `accept` of the file input, e.g. "image/jpeg,image/png,image/webp". */
  accept: string;
  /** The picked or dropped file (the first one when several are dropped). */
  onFile: (file: File) => void;
  disabled?: boolean;
  /** Why it is disabled — Tooltip on the button, text while a file is dragged over. */
  disabledReason?: React.ReactNode;
  /** Processing: spinner + `busyLabel`, nothing can be picked. */
  busy?: boolean;
  busyLabel?: React.ReactNode;
  /** Text in front of the button. */
  prompt?: React.ReactNode;
  /** Visible label of the button (required, never icon-only). */
  buttonLabel?: string;
  /** One short line under the prompt (formats, size). */
  hint?: React.ReactNode;
  /** Accessible name of the whole zone. */
  label?: string;
  id?: string;
  "aria-describedby"?: string;
  className?: string;
}

const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

export function FileDropZone({
  accept,
  onFile,
  disabled = false,
  disabledReason,
  busy = false,
  busyLabel = "Wird verarbeitet …",
  prompt = "Datei hierher ziehen oder",
  buttonLabel = "Datei wählen",
  hint,
  label,
  id,
  "aria-describedby": describedBy,
  className,
}: FileDropZoneProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  // dragenter/dragleave fire for every child — count them so the highlight
  // does not flicker while the pointer crosses the button.
  const depth = React.useRef(0);
  const [dragging, setDragging] = React.useState(false);
  const blocked = disabled || busy;

  // While the zone is on screen, a file that misses it is swallowed too: the
  // browser would otherwise open it in place of the admin (and the unsaved
  // form). The zone's own handlers prevent the default first, so they win.
  React.useEffect(() => {
    const swallow = (e: DragEvent) => {
      if (e.defaultPrevented || !Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
    };
    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", swallow);
    return () => {
      window.removeEventListener("dragover", swallow);
      window.removeEventListener("drop", swallow);
    };
  }, []);

  const reset = () => {
    depth.current = 0;
    setDragging(false);
  };

  const onDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth.current += 1;
    setDragging(true);
  };
  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = blocked ? "none" : "copy";
  };
  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  };
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    // Always swallow a dropped file (never let the browser navigate to it).
    e.preventDefault();
    reset();
    if (blocked) return;
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  };

  const openPicker = () => {
    if (blocked) return;
    inputRef.current?.click();
  };

  const button = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-disabled={blocked || undefined}
      onClick={openPicker}
      className={cn(blocked && "cursor-not-allowed opacity-50")}
    >
      <Upload aria-hidden /> {buttonLabel}
    </Button>
  );

  return (
    <div
      id={id}
      role="group"
      aria-label={label}
      aria-describedby={describedBy}
      aria-busy={busy || undefined}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        "flex min-h-28 flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-5 text-center transition-colors",
        dragging && !blocked ? "border-accent bg-accent-soft" : "border-border bg-surface-2",
        className
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Reset so picking the same file again fires a change.
          e.target.value = "";
          if (file && !blocked) onFile(file);
        }}
      />
      {busy ? (
        <span className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Spinner size="sm" /> {busyLabel}
        </span>
      ) : dragging && disabled && disabledReason ? (
        <span className="text-sm text-muted-foreground">{disabledReason}</span>
      ) : (
        <>
          <span className="flex flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground">
            {prompt}
            {disabled && disabledReason ? <Tooltip content={disabledReason}>{button}</Tooltip> : button}
          </span>
          {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        </>
      )}
    </div>
  );
}
