"use client";

// Reusable "Vorschau" button + rendered-email viewer dialog.
//
// On click it POSTs to a guarded admin preview route that returns text/html,
// turns the response into a blob object-URL and shows it in a sandboxed
// iframe — the same fetch→blob→object-URL pattern the Kampagne workspace and
// the letter preview use. The object URL is revoked on replace/close.
//
// `getPayload` is read at CLICK time so unsaved on-screen edits (subject/body
// textareas) always ride along into the preview.

import { useCallback, useState } from "react";
import { Eye } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  toast,
} from "./ui";

export function EmailPreviewButton({
  path,
  getPayload,
  title,
  description,
  disabled,
  variant = "outline",
  size,
  label = "Vorschau",
}: {
  /** Guarded admin route returning text/html (e.g. /api/admin/marketing/email-preview). */
  path: string;
  /** Called at click time — include unsaved on-screen edits here. */
  getPayload: () => Record<string, unknown>;
  /** Dialog title (e.g. "Vorschau — kunde@example.com"). */
  title: string;
  /** One-liner under the title (what the preview does/doesn't show). */
  description: string;
  disabled?: boolean;
  variant?: "outline" | "secondary" | "ghost";
  size?: "sm";
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  const open = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(getPayload()),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(json?.error?.message ?? `Fehler (${res.status})`);
      }
      const blob = await res.blob();
      const nextUrl = URL.createObjectURL(blob);
      setUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return nextUrl;
      });
    } catch (err) {
      toast({
        variant: "error",
        title: "Vorschau fehlgeschlagen",
        description: String((err as Error).message ?? err),
      });
    } finally {
      setBusy(false);
    }
  }, [busy, path, getPayload]);

  const close = useCallback(() => {
    setUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={() => void open()}
        disabled={disabled || busy}
        title="Gerenderte E-Mail-Vorschau — so erscheint die E-Mail im Postfach"
      >
        <Eye className="me-1.5 h-4 w-4" />
        {busy ? "Lädt…" : label}
      </Button>

      <Dialog open={url !== null} onOpenChange={(v) => !v && close()}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {url && (
            <iframe
              title={title}
              src={url}
              sandbox=""
              className="mt-3 h-[65vh] w-full rounded-md border border-border bg-white"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
