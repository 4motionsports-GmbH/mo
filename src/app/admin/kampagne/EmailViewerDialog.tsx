"use client";

// Near-fullscreen rendered-email viewer (draft preview + retained sent content)
// with the Desktop/Mobil frame.

import * as React from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui";
import { EmailPreviewFrame } from "../EmailPreviewFrame";
import type { EmailView } from "./useCampaignActions";

export function EmailViewerDialog({ view, onClose }: { view: EmailView | null; onClose: () => void }) {
  return (
    <Dialog open={view !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent size="full" className="flex flex-col" style={{ height: "92vh" }}>
        <DialogHeader>
          <DialogTitle>{view?.title}</DialogTitle>
          <DialogDescription>{view?.description}</DialogDescription>
        </DialogHeader>
        {view && <EmailPreviewFrame title={view.title} src={view.url} />}
      </DialogContent>
    </Dialog>
  );
}
