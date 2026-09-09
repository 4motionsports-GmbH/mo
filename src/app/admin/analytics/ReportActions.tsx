"use client";

// Per-report actions: download the whole report as a PDF (a plain GET link to
// the pdf route) and delete the report (ConfirmDialog). Delete routes back to
// the generator and refreshes so the sidebar drops the row.

import * as React from "react";
import { Download, Trash2 } from "lucide-react";
import { Button, buttonVariants, toast, useConfirm } from "../ui";
import { adminFetch, friendlyErrorMessage } from "../lib/admin-fetch";
import { useAsyncAction } from "../lib/use-async-action";

export function ReportActions({
  id,
  canDownload,
  onDeleted,
}: {
  id: number;
  canDownload: boolean;
  onDeleted: () => void;
}) {
  const { confirm, confirmDialog } = useConfirm();
  const del = useAsyncAction(
    async () => {
      const ok = await confirm({
        title: "Analyse löschen?",
        description:
          "Dieser gespeicherte Bericht wird dauerhaft entfernt. Die zugrunde liegenden Gespräche und ihre einzelnen Analysen bleiben erhalten.",
        confirmLabel: "Löschen",
        tone: "destructive",
      });
      if (!ok) return false;
      try {
        await adminFetch("/api/admin/analytics/delete", { body: { id } });
      } catch (err) {
        toast({
          variant: "error",
          title: "Löschen fehlgeschlagen",
          description: friendlyErrorMessage(err),
          duration: 6000,
        });
        throw err;
      }
      return true;
    },
    { errorToast: false, onSuccess: (deleted) => deleted && onDeleted() }
  );

  return (
    <div className="flex items-center gap-2">
      {canDownload && (
        <a href={`/api/admin/analytics/${id}/pdf`} className={buttonVariants({ variant: "default", size: "sm" })}>
          <Download />
          PDF herunterladen
        </a>
      )}
      <Button size="sm" variant="outline" onClick={() => void del.run()} loading={del.pending}>
        {!del.pending && <Trash2 />}
        Löschen
      </Button>
      {confirmDialog}
    </div>
  );
}
