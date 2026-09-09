"use client";

// One preview dialog per design: a type selector inside the dialog swaps the
// rendered sample e-mail (POST /api/admin/email-designs/preview {designKey,
// kind}) — instead of one button per type on every design card (UX-E1).
// Same fetch → blob → object-URL pattern as EmailPreviewButton; the URL is
// revoked on swap/close.

import * as React from "react";
import { EMAIL_THEME_KIND_LABELS } from "@/lib/email-theme.mjs";
import {
  Callout,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  SegmentedControl,
  Skeleton,
} from "../ui";
import { EmailPreviewFrame } from "../EmailPreviewFrame";

export interface DesignPreviewTarget {
  designKey: string;
  designName: string;
  supportedKinds: string[];
  kind: string;
}

const kindLabel = (kind: string): string =>
  (EMAIL_THEME_KIND_LABELS as Record<string, string>)[kind] ?? kind;

export function DesignPreviewDialog({
  target,
  onClose,
}: {
  target: DesignPreviewTarget | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(v) => !v && onClose()}>
      {target && <PreviewBody key={target.designKey} target={target} />}
    </Dialog>
  );
}

function PreviewBody({ target }: { target: DesignPreviewTarget }) {
  const [kind, setKind] = React.useState(target.kind);
  const [state, setState] = React.useState<{ kind: string; url: string | null; error: string | null } | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    fetch("/api/admin/email-designs/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ designKey: target.designKey, kind }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
          throw new Error(json?.error?.message ?? `Fehler (${res.status})`);
        }
        const blob = await res.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ kind, url: objectUrl, error: null });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          kind,
          url: null,
          error: err instanceof Error ? err.message : "Vorschau fehlgeschlagen.",
        });
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [target.designKey, kind]);

  const current = state && state.kind === kind ? state : null;
  const options = target.supportedKinds.map((k) => ({ value: k, label: kindLabel(k) }));

  return (
    <DialogContent className="flex flex-col" style={{ maxWidth: "95vw", height: "92vh" }}>
      <DialogHeader>
        <DialogTitle>Vorschau — {target.designName}</DialogTitle>
        <DialogDescription>
          Beispiel-E-Mail des gewählten Typs in diesem Design — Inhalte sind Beispieldaten, Links
          inaktiv.
        </DialogDescription>
      </DialogHeader>
      <div className="mt-2">
        <SegmentedControl label="E-Mail-Typ" value={kind} options={options} onChange={setKind} />
      </div>
      {current?.error ? (
        <Callout tone="destructive" compact className="mt-3">
          {current.error}
        </Callout>
      ) : current?.url ? (
        <EmailPreviewFrame title={`${target.designName} — ${kindLabel(kind)}`} src={current.url} />
      ) : (
        <Skeleton className="mt-3 min-h-0 flex-1 rounded-lg" aria-label="Vorschau wird geladen" />
      )}
    </DialogContent>
  );
}
