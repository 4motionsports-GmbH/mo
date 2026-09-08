"use client";

// ConfirmDialog + useConfirm — the one confirmation pattern (replaces
// window.confirm and ad-hoc "Wirklich?" states). Usage:
//
//   const { confirm, confirmDialog } = useConfirm();
//   ...
//   if (await confirm({ title: "Kontakt überspringen?", tone: "destructive" })) { … }
//   return <>{…}{confirmDialog}</>;

import * as React from "react";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";

export interface ConfirmOptions {
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `destructive` renders a red confirm button and focuses "Abbrechen" first. */
  tone?: "default" | "destructive";
}

export interface ConfirmDialogProps {
  open: boolean;
  options: ConfirmOptions | null;
  onClose: (confirmed: boolean) => void;
}

export function ConfirmDialog({ open, options, onClose }: ConfirmDialogProps) {
  const destructive = options?.tone === "destructive";
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose(false)}>
      <DialogContent size="sm" showClose={false}>
        <DialogHeader>
          <DialogTitle>{options?.title}</DialogTitle>
          {options?.description && <DialogDescription>{options.description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onClose(false)}
            data-autofocus={destructive ? "" : undefined}
          >
            {options?.cancelLabel ?? "Abbrechen"}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={() => onClose(true)}
            data-autofocus={destructive ? undefined : ""}
          >
            {options?.confirmLabel ?? "Bestätigen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function useConfirm(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  confirmDialog: React.ReactNode;
} {
  const [options, setOptions] = React.useState<ConfirmOptions | null>(null);
  const resolver = React.useRef<((ok: boolean) => void) | null>(null);

  const confirm = React.useCallback((next: ConfirmOptions) => {
    // A second confirm() while one is open cancels the first one.
    resolver.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setOptions(next);
    });
  }, []);

  const onClose = React.useCallback((ok: boolean) => {
    const resolve = resolver.current;
    resolver.current = null;
    setOptions(null);
    resolve?.(ok);
  }, []);

  const confirmDialog = <ConfirmDialog open={options !== null} options={options} onClose={onClose} />;
  return { confirm, confirmDialog };
}
