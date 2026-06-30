"use client";

// Per-report actions: download the whole report as a PDF (a plain GET link to the
// pdf route) and delete the report (with a confirm). Delete routes back to the
// generator and refreshes so the sidebar drops the row.

import * as React from "react";
import { Download, Trash2, Loader2 } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  toast,
} from "../ui";
import { buttonVariants } from "../ui/button";
import { cn } from "../ui/cn";

export function ReportActions({
  id,
  canDownload,
  onDeleted,
}: {
  id: number;
  canDownload: boolean;
  onDeleted: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function del() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/analytics/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        toast({
          variant: "error",
          title: "Löschen fehlgeschlagen",
          description: data.error?.message ?? "Unbekannter Fehler",
          duration: 6000,
        });
        return;
      }
      setOpen(false);
      onDeleted();
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler", description: "Bitte erneut versuchen.", duration: 6000 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {canDownload && (
        <a
          href={`/api/admin/analytics/${id}/pdf`}
          className={cn(buttonVariants({ variant: "default", size: "sm" }))}
        >
          <Download />
          PDF herunterladen
        </a>
      )}
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Trash2 />
        Löschen
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Analyse löschen?</DialogTitle>
            <DialogDescription>
              Dieser gespeicherte Bericht wird dauerhaft entfernt. Die zugrunde liegenden Gespräche
              und ihre einzelnen Analysen bleiben erhalten.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setOpen(false)}>
              Abbrechen
            </Button>
            <Button variant="destructive" size="sm" disabled={busy} onClick={del}>
              {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}
              Löschen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
